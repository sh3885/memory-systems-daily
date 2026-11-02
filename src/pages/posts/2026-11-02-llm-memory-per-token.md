---
layout: ../../layouts/PostLayout.astro
title: "토큰 하나를 만들 때 메모리에서 일어나는 일: multi-head부터 batching까지"
description: "multi-head와 GQA, prefill과 decode, KV cache 크기, roofline, batching을 같은 4차원 예시와 Llama-3-70B 숫자로 끝까지 따라간다."
lessonDate: "2026-11-02"
category: "LLM"
tags: ["Multi-head", "GQA", "Prefill", "Decode", "KV cache", "Roofline", "Batching", "HBM"]
---

# 토큰 하나를 만들 때 메모리에서 일어나는 일: multi-head부터 batching까지

> 이 글이 답할 질문: LLM이 토큰을 하나 만들 때 메모리에서는 무엇을 얼마나 읽고, 왜 그것이 병목인가?

## 먼저 답하기

- **multi-head**는 attention을 하나 더 붙이는 것이 아니다. 같은 차원을 묶음(head)으로 나눠서 **묶음마다 비율을 따로 정하는 것**이다. 숫자 개수와 weight 크기는 그대로다.
- **GQA**는 q는 head마다 그대로 두고, k와 v는 여러 head가 한 세트를 나눠 쓰게 한다. 그래서 W_K, W_V의 열과 KV cache가 그 비율만큼 줄어든다. Llama-3-70B는 1/8이다.
- **prefill**(입력을 한꺼번에)과 **decode**(답을 한 토큰씩)는 같은 계산이다. 다른 것은 X의 행 수뿐이다. 그런데 weight를 한 번 읽어 몇 행에 쓰느냐가 달라서, prefill은 계산이, decode는 메모리 읽기가 병목이다.
- **KV cache**는 토큰마다, 레이어마다, 사용자마다 쌓인다. 문맥이 길고 사용자가 많으면 weight보다 커진다.
- **roofline**은 "1바이트 읽어서 몇 번 계산하나"(arithmetic intensity)를 GPU의 기준점(H100은 약 295)과 비교해 병목을 판정한다. 사용자 1명의 decode는 1이다.
- **batching**은 여러 사용자의 decode를 묶어 weight를 한 번만 읽는다. 처리량은 크게 늘지만, 사용자마다 따로인 KV cache 읽기는 그대로 남고 사용자 수만큼 커진다.
- 이 글의 4차원 예시 숫자는 설명용 임의 값이다. Llama-3-70B와 H100 숫자는 공개 자료 기준이다.

## 시작 전에: 지난 글에서 가져올 것과 단위

**지난 글의 4차원 예시.** 문장 "고양이가 생선을 먹었다"의 X₀(3×4)와 W_Q, W_K, W_V(각 4×2)를 그대로 쓴다. 토큰은 항상 행이다. 숫자는 [숫자로 끝까지 따라가는 Attention](/posts/2026-11-02-attention-data-flow-walkthrough/)에 있다.

| | d0 | d1 | d2 | d3 |
|---|---|---|---|---|
| 고양이가 | 1.0 | 0.2 | 0.0 | 0.5 |
| 생선을 | 0.1 | 1.0 | 0.3 | 0.0 |
| 먹었다 | 0.0 | 0.3 | 1.0 | 0.4 |

**단위.** 이 글은 바이트와 계산 횟수를 같이 다룬다. 바이트는 항상 **B**로, 계산 횟수는 **FLOP**으로 쓴다.

| 기호 | 뜻 |
|---|---|
| B | 바이트. BF16 숫자 하나는 2 B, FP8은 1 B |
| FLOP | 소수점 숫자 연산 1번(곱셈 1번 또는 덧셈 1번) |
| FLOPS | 1초에 하는 FLOP 수(계산 속도) |
| G (기가) | 10⁹, 10억 |
| T (테라) | 10¹², 1조 |
| P (페타) | 10¹⁵ |

예를 들어 989 TFLOPS는 1초에 989조 번 계산, 3.35 TB/s는 1초에 3.35조 바이트를 읽는다는 뜻이다.

## 1. multi-head: 차원을 나눠서 비율을 따로 정한다

### 1-1. 내적

**길이가 같은 숫자 묶음 두 개를 같은 위치끼리 곱해서 전부 더한 값**이 내적이다.

> [1, 2] · [3, 4] = 1×3 + 2×4 = **11**

결과는 숫자 하나다. 두 묶음이 비슷한 방향일수록 커진다. attention의 점수가 바로 q와 k의 내적이다. 그래서 **q와 k는 숫자 개수가 같아야 한다.**

### 1-2. W_Q의 열 하나가 q의 숫자 하나를 만든다

지난 글에서 "먹었다"의 X 행은 숫자 4개였고, W_Q는 4×2였다.

- q의 첫 번째 숫자 = X 행 · W_Q의 **1열** (숫자 4개끼리 내적)
- q의 두 번째 숫자 = X 행 · W_Q의 **2열**

**W_Q의 열 수 = q의 숫자 개수**다. 열이 2개라 q가 [1.05, 0.51]로 숫자 2개였다. 행이 4개인 이유는 X 행의 숫자 4개와 내적 길이를 맞춰야 해서다. 행 수는 선택이 아니라 행렬곱 규칙이다.

### 1-3. head가 1개일 때의 한계

head가 1개여도 "먹었다"의 O에는 고양이가와 생선을 정보가 **이미 다 섞여 있다.** 한쪽을 못 보는 것이 문제가 아니다.

한계는 **점수가 하나라서 모든 차원이 같은 비율로 섞인다**는 것이다. "먹었다 → 고양이가" 점수는 q와 k의 모든 숫자를 곱해 더한 값 하나다. 그 점수로 비율 A가 정해지고, O의 모든 차원이 이 한 세트의 비율로 섞인다. V의 차원마다 담긴 정보가 달라서 어떤 차원은 고양이가 쪽, 어떤 차원은 생선을 쪽에서 많이 가져오는 게 좋더라도 그렇게 할 수 없다.

### 1-4. 4차원을 2 + 2로 나누기

W_Q를 **4×4**로 만든다. 그러면 q가 숫자 4개가 된다. W_K, W_V도 4×4로 만든다. 그리고 결과의 **앞 2개는 head 1, 뒤 2개는 head 2**가 쓴다.

- W_Q 4×4의 앞 2열 = 지난 글의 W_Q(4×2) 그대로 → head 1의 q
- 뒤 2열 = 새로 추가한 열 → head 2의 q

head 2가 쓰는 뒤 2열(설명용 임의 값):

| weight 행 | W_Q 뒤 2열 | W_K 뒤 2열 | W_V 뒤 2열 |
|---|---|---|---|
| d0 행 | 0, 0 | 0, 0 | 0, 1 |
| d1 행 | 0, 0 | 1, 0 | 1, 0 |
| d2 행 | 2, 0 | 0, 0.5 | 0, 0 |
| d3 행 | 0, 1 | 0, 0 | 0, 0 |

계산하면 이렇게 된다(｜ 왼쪽이 head 1, 오른쪽이 head 2).

| 토큰 | q | k | v |
|---|---|---|---|
| 먹었다 | 1.05, 0.51 ｜ 2.0, 0.4 | 0.37, 0.45 ｜ 0.3, 0.5 | 0.58, 0.88 ｜ 0.3, 0 |
| 고양이가 | | 1.12, 0.38 ｜ 0.2, 0 | 1.10, 0.30 ｜ 0.2, 1.0 |
| 생선을 | | 0.21, 0.94 ｜ 1.0, 0.15 | 0.25, 1.15 ｜ 1.0, 0.1 |

예를 들어 "먹었다"의 head 2 q는 X 행 [0.0, 0.3, 1.0, 0.4]로 계산한다. d2 값 1.0 × [2, 0] + d3 값 0.4 × [0, 1] = **[2.0, 0.4]**다.

### 1-5. head마다 따로 점수를 낸다

**head 1**은 앞 2개끼리만 내적한다. "먹었다 → 고양이가"는 이렇게 계산한다.

> 1.05×1.12 + 0.51×0.38 = 1.37 → ÷√2 → **0.97**

**head 2**는 뒤 2개끼리만 내적한다. 같은 "먹었다 → 고양이가"인데 값이 다르다.

> 2.0×0.2 + 0.4×0 = 0.4 → ÷√2 → **0.28**

모든 토큰에 대해 계산하고 softmax를 하면 다음과 같다.

| "먹었다"가 볼 비율 | 고양이가 | 생선을 | 먹었다 | 그 head의 O |
|---|---|---|---|---|
| head 1 (앞 2개) | **0.45** | 0.28 | 0.27 | 0.72, 0.69 |
| head 2 (뒤 2개) | 0.18 | **0.58** | 0.24 | 0.69, 0.24 |

head 1은 자기 비율로 v의 앞 2개를, head 2는 자기 비율로 v의 뒤 2개를 섞는다. 둘을 이어 붙이면 O = **[0.72, 0.69, 0.69, 0.24]**로 다시 숫자 4개가 된다. 이 O가 W_O(4×4)를 거쳐 X에 더해진다.

**같은 숫자를 head 1개로 계산하면**(4개 전체로 내적, ÷√4) 비율이 [0.29, 0.47, 0.24] 한 세트이고, O = [0.57, 0.84, 0.60, 0.33]으로 4차원 모두 같은 비율로 섞인다.

| | head 1개 | head 2개 |
|---|---|---|
| 다루는 숫자 개수 | 4 | 같은 4 (2 + 2) |
| 점수 | 4개 전체로 1개 | head마다 1개씩 |
| 비율 A | 1세트, 모든 차원 공통 | 2세트, head마다 다름 |
| O | 모든 차원이 같은 비율 | head마다 다른 비율로 섞어 이어 붙임 |
| weight 크기 | W_Q 4×4 | W_Q 4×4 (같음) |

**multi-head의 목적은 같은 비용으로 표현력을 늘리는 것이다.** head마다 다른 토큰이나 다른 관계를 볼 수 있다. 다만 어떤 head가 무엇을 볼지는 정해 주는 것이 아니라 학습으로 정해진다.

### 1-6. weight 크기 공식

| 행렬 | 크기 (행 × 열) | 4차원 예시 |
|---|---|---|
| W_Q | d_model × (Q head 수 × head 차원) | 4 × (2×2) = 4×4 |
| W_K, W_V | d_model × (KV head 수 × head 차원) | 4 × (2×2) = 4×4 |
| W_O | (Q head 수 × head 차원) × d_model | 4×4 |

- **d_model**은 X 한 행의 숫자 개수다(예시 4, Llama 8,192).
- **head 차원**은 head 하나가 갖는 q 숫자의 개수다. 보통 **head 차원 = d_model ÷ Q head 수**로 정한다. 그러면 head를 몇 개로 나누든 W_Q는 d_model × d_model로 head 1개일 때와 크기가 같고, 비율 세트 수만 늘어난다.
- q와 k는 head 안에서 내적하므로 head 차원이 같아야 한다.
- W_O의 열이 d_model인 이유는 결과를 X에 더하기 위해서다(residual).

**"W_Q는 4×2냐 4×4냐"는 둘 다 맞는 표현이다.** head마다 4×2짜리 W_Q를 하나씩 가진다고 봐도 되고, 둘을 옆으로 붙인 4×4 하나로 봐도 된다. 계산 결과는 같다. 모델 파일에는 붙인 형태로 저장된다.

### 1-7. Llama-3-70B로 키우면

| | 4차원 예시 | Llama-3-70B |
|---|---|---|
| d_model | 4 | 8,192 |
| Q head 수 | 2 | 64 |
| head 차원 | 4 ÷ 2 = 2 | 8,192 ÷ 64 = **128** |
| W_Q 전체 | 4×4 | 8,192 × 8,192 |
| head 하나의 W_Q | 4×2 | 8,192 × 128 |
| 비율 세트 수 | 2 | 64 |
| 점수 하나의 내적 길이 | 2 | 128 |

## 2. GQA: k와 v만 여러 head가 나눠 쓴다

1장의 예시에서는 head 2개가 각자 자기 k, v를 가졌다. W_K, W_V도 W_Q처럼 열을 나눠서 head마다 k, v를 만든다. 이것을 **MHA**(Multi-Head Attention)라고 한다.

**GQA**(Grouped-Query Attention)는 q는 head마다 그대로 두고, **k와 v만 여러 head가 한 세트를 같이 쓰게** 한다.

| | MHA | GQA (예시: KV head 1개) |
|---|---|---|
| q | head마다 자기 것 | head마다 자기 것 (그대로) |
| k, v | head마다 자기 것 | head 2개가 **한 세트를 같이 씀** |
| W_Q | 4×4 | 4×4 (그대로) |
| W_K, W_V | 4×4 | **4×2** |
| 비율 세트 수 | 2 | 2 (그대로) |
| 토큰 하나가 KV cache에 남기는 숫자 | k 4 + v 4 = 8 | k 2 + v 2 = **4** |

- head마다 q가 다르니 같은 k와 내적해도 점수는 head마다 다르다. **비율 세트 수는 Q head 수를 따라간다.**
- 줄어드는 것은 **KV head의 개수**다. KV head 하나의 숫자 개수(head 차원)는 그대로다. k는 q와 내적해야 하기 때문이다.
- KV head를 1개까지 줄인 것을 **MQA**(Multi-Query Attention)라고 한다.

**Llama-3-70B는 Q head 64개가 KV head 8개를 나눠 쓴다.** Q head 8개당 KV 1세트다.

| | 개수 | head 차원 | 열 수 |
|---|---|---|---|
| Q head | 64 | 128 | W_Q 8,192 × **8,192** |
| KV head | **8** | **128** (그대로) | W_K, W_V 8,192 × **1,024** |

토큰 하나, 레이어 하나가 KV cache에 남기는 숫자는 k 1,024 + v 1,024 = 2,048개, BF16이면 4,096 B다. MHA였다면 8배다.

## 3. prefill과 decode: 같은 계산인데 왜 병목이 다른가

### 3-1. 두 단계

사용자가 "고양이가 생선을"을 입력하고 모델이 이어서 답을 만든다고 하자.

- **prefill**: 입력 토큰을 **한꺼번에** 처리한다. 입력은 이미 다 알고 있으니 기다릴 필요가 없다.
- **decode**: 답을 **한 토큰씩** 만든다. 다음 토큰은 앞 토큰이 나와야 알 수 있다.

계산 자체(X·W_Q, 점수, softmax, A·V, FFN …)는 똑같다. **다른 것은 X의 행 수뿐이다.**

### 3-2. 이름이 비슷한 세 가지를 먼저 구분한다

| 이름 | 무엇인가 | 4차원 예시 크기 | 토큰이 늘면 |
|---|---|---|---|
| **W_K** | weight (학습으로 정해진 고정값) | 4×4 | 안 늘어남 |
| **새 k** | 이번 토큰으로 만든 결과 (X 1행 · W_K) | 1×4 | 매번 1행씩 새로 생김 |
| **K cache** | 지금까지 만든 k를 전부 쌓은 것 | (토큰 수)×4 | **1행씩 늘어남** |

V도 W_V, 새 v, V cache로 같은 관계다. "d_model × (head 수 × head 차원)"은 W_K의 크기이고, 쌓이는 것은 K cache다. K cache의 열 수는 W_K의 열 수와 같고, 행 수는 토큰 수다.

### 3-3. 행렬 크기로 비교

**prefill**: 입력 2토큰이 X의 2행이다.

| 단계 | 크기 |
|---|---|
| X (고양이가, 생선을) | 2×4 |
| X · W_Q(4×4) → Q | 2×4 |
| K, V | 각 2×4 → **K, V cache에 2행 저장** |
| 점수 Q·Kᵀ | 2×2 (mask로 미래를 가림) |
| 결과 | 마지막 행으로 다음 토큰 "먹었다"를 예측 |

**decode**: 새 토큰 "먹었다" 하나만 X의 1행이다.

| 단계 | 크기 |
|---|---|
| X (먹었다) | **1×4** |
| X · W_K(4×4, 고정) → 새 k | 1×4 |
| K cache에 붙이기: 2행 → 3행 | **3×4** |
| 점수: q(1×4) · K cache(3×4)ᵀ | 1×3 |
| 결과 | 다음 토큰 예측 → 다시 decode |

decode를 계속하면 W_K는 4×4 그대로이고 K cache만 자란다. 입력 2토큰에 decode를 10번 하면 K cache는 12×4다. Llama-3-70B라면 80 레이어가 **각자** K cache(토큰 수 × 1,024)와 V cache(토큰 수 × 1,024)를 갖는다.

### 3-4. 병목이 갈리는 지점: weight를 읽어서 몇 행에 쓰나

weight는 GPU 메모리(HBM)에 있고, 계산하려면 읽어 와야 한다.

- **prefill**: W_Q를 한 번 읽어 X의 **T개 행 모두**에 쓴다. 입력 1,000토큰이면 한 번 읽고 1,000행에 쓴다.
- **decode**: W_Q를 한 번 읽어도 X는 **1행**뿐이다. 다음 토큰에서 **또 전부 읽는다.**

### 3-5. Llama-3-70B 숫자

토큰 하나당 계산량은 weight 하나당 곱셈 1번 + 덧셈 1번이다. 4차원 예시로 확인하면 X(1×4)·W_Q(4×4)는 곱셈 16번 + 덧셈 12번 ≈ 32 = 2 × weight 16개다. 그래서 약 **2 × 70.6B ≈ 141 GFLOP**이다. weight 전체는 BF16으로 **141 GB**다.

GPU는 H100 SXM(BF16 989 TFLOPS, 3.35 TB/s, 스펙은 4장 참고)이고, 계산 편의상 모델이 한 장에 다 들어간다고 가정한다. 실제로는 141 GB라 80 GB 한 장에 안 들어가며, 나눠 싣는 방법은 다음 파트에서 다룬다.

| | 계산 시간 | weight 읽기 시간 | 병목 |
|---|---|---|---|
| prefill (입력 1,000토큰) | 141 TFLOP ÷ 989 TFLOPS ≈ **0.14 s** | 141 GB ÷ 3.35 TB/s ≈ 0.042 s | **계산** |
| decode (토큰 1개) | 141 GFLOP ÷ 989 TFLOPS ≈ 0.00014 s | ≈ **0.042 s** | **메모리 읽기** (약 300배 차이) |

decode는 토큰마다 141 GB를 통째로 읽으니 **초당 약 24토큰(1 ÷ 0.042)이 상한**이다. 답을 100토큰 만들면 weight만 141 GB × 100 = 14.1 TB를 읽는다.

### 3-6. 사용자가 체감하는 두 시간

- **TTFT**(Time To First Token): 입력 후 첫 글자가 나오기까지의 시간으로, 대부분 prefill 시간이다. 입력이 길수록 늘어난다.
- **토큰 간 시간**: 답이 흘러나오는 속도로, decode 시간이다. 주로 메모리 대역폭이 결정한다.

decode는 weight 말고 **KV cache도 매번 전부 읽는다.** 점수 q·Kᵀ에 K cache 전체, A·V에 V cache 전체가 필요하다.

## 4. KV cache는 문장 길이 × 사용자 수가 되면 얼마나 커지는가

### 4-1. 토큰 하나가 남기는 양

> 2 (K와 V) × 80 레이어 × KV head 8개 × head 차원 128 × 2 B = **327,680 B ≈ 0.33 MB**

여기에 **토큰 수**와 **사용자 수**를 곱하면 전체 KV cache가 된다. FP8(1 B)로 저장하면 절반인 163,840 B다.

### 4-2. weight는 공유, KV cache는 사용자마다 따로

- weight는 모든 사용자가 같은 모델을 쓰니 사용자가 몇 명이든 141 GB 한 벌이다.
- KV cache는 대화마다 토큰이 다르니 K, V 행도 다르다. 사용자 수만큼 곱해진다.

| 상황 | KV cache (BF16) |
|---|---|
| 1명, 1,000토큰 | 0.33 GB |
| 1명, 8,192토큰 | 2.7 GB |
| 1명, 131,072토큰 (128K 문맥) | 42.9 GB |
| 10명, 각 4,096토큰 | 13.4 GB |
| 32명, 각 8,192토큰 | 85.9 GB |
| 64명, 각 8,192토큰 | **171.8 GB**, weight(141 GB)보다 큼 |

**GQA가 없었다면**(MHA) 모든 숫자가 8배다. 1명 128K 문맥만으로 343 GB다.

### 4-3. 참고 스펙: NVIDIA H100

| 항목 | H100 SXM | H100 NVL | DGX H100 (서버 1대) |
|---|---|---|---|
| GPU 메모리 | **HBM3 80 GB** | 94 GB | H100 SXM 8장, 합계 **640 GB** |
| 메모리 대역폭 | **3.35 TB/s** | 3.9 TB/s | 장당 3.35 TB/s |
| BF16 계산 (스펙표 / 일반 모델) | 1,979 / **989 TFLOPS** | 1,671 / 835 TFLOPS | |
| FP8 계산 (스펙표 / 일반 모델) | 3,958 / 1,979 TFLOPS | 3,341 / 1,671 TFLOPS | |
| GPU 간 연결 (NVLink) | 900 GB/s | 600 GB/s | 8장이 NVLink로 연결 |
| 최대 전력 | 700 W | 350–400 W | |

**스펙표의 계산 속도는 sparsity 기준이다.** NVIDIA 표의 계산 속도에는 "With sparsity" 주석이 붙어 있다. 0이 많은 weight를 건너뛰는 기능을 쓸 때의 값이라, 일반 모델에서는 그 절반이 상한이다. 이 글은 절반 값(H100 SXM BF16 **989 TFLOPS**)을 쓴다. 회사 장표에서 계산 속도가 두 배씩 다르게 보이면 대개 이 차이다.

**"H100 8장"이 흔한 단위인 이유.** 서버 한 대에 GPU 8장이 NVLink로 묶여 들어가는 구성(DGX H100, HGX H100)이 표준이라서다.

### 4-4. 용량으로 보면: 몇 명까지 받을 수 있나

DGX H100 한 대(640 GB)에서 weight 141 GB를 빼면 약 **499 GB**가 KV cache 자리다(그 밖의 중간값 등은 무시).

| 사용자 1명의 문맥 | 1명 KV cache | 동시에 받을 수 있는 사용자 |
|---|---|---|
| 8,192토큰 | 2.7 GB | 약 186명 |
| 131,072토큰 | 42.9 GB | 약 11명 |

같은 서버라도 문맥 길이에 따라 받을 수 있는 사용자 수가 17배 차이 난다.

## 5. arithmetic intensity와 roofline: decode는 왜 memory-bound인가

### 5-1. arithmetic intensity: 1바이트 읽어서 몇 번 계산하나

> **arithmetic intensity = 계산 횟수(FLOP) ÷ 메모리에서 읽은 양(B)**, 단위 FLOP/B

| 작업 | weight 하나 읽는 양 | 그 weight로 하는 계산 | intensity |
|---|---|---|---|
| decode, 사용자 1명, BF16 | 2 B | 2 FLOP | **1** |
| decode, 사용자 1명, FP8 | 1 B | 2 FLOP | **2** |
| prefill, 입력 T토큰, BF16 | 2 B | 2 FLOP × T행 | **T** |

**바이트는 분모다.** FP8로 읽는 양을 절반으로 줄이면 intensity는 2배가 된다.

### 5-2. GPU의 기준점

> H100 기준점 = 계산 속도 ÷ 메모리 대역폭 = (989 × 10¹² FLOP/초) ÷ (3.35 × 10¹² B/초) ≈ **295 FLOP/B**

10¹²끼리, "/초"끼리 약분되고 FLOP/B만 남는다. H100은 1바이트가 도착하는 동안 295번 계산할 능력이 있다는 뜻이다.

- 작업의 intensity가 **295보다 작으면**: 계산 유닛이 데이터를 기다리며 논다. **memory-bound**이고, 속도는 대역폭이 정한다.
- **295보다 크면**: 데이터는 충분히 오고 계산이 못 따라간다. **compute-bound**이고, 속도는 계산 속도가 정한다.

### 5-3. roofline

> 실제로 낼 수 있는 계산 속도 = **min(989 TFLOPS, intensity × 3.35 TB/s)**

| 작업 | intensity | intensity × 3.35 TB/s | 실제 속도 | 계산 유닛 사용률 | 판정 |
|---|---|---|---|---|---|
| decode, 1명, BF16 | 1 | 3.35 TFLOPS | 3.35 TFLOPS | **약 0.3%** | memory-bound |
| decode, 1명, FP8 | 2 | 6.7 TFLOPS | 6.7 TFLOPS | 약 0.7% | memory-bound |
| prefill, 100토큰 | 100 | 335 TFLOPS | 335 TFLOPS | 약 34% | memory-bound |
| prefill, 500토큰 | 500 | 1,675 TFLOPS | 989 TFLOPS | 100% | compute-bound |
| prefill, 1,000토큰 | 1,000 | 3,350 TFLOPS | **989 TFLOPS** (천장) | 100% | compute-bound |

<figure style="margin:22px 0;overflow-x:auto">
<svg viewBox="0 0 720 430" role="img" aria-label="H100 roofline. 가로축 arithmetic intensity, 세로축 낼 수 있는 계산 속도, 둘 다 로그 눈금. 295 FLOP/B까지는 대역폭 선을 따라 올라가고 이후 989 TFLOPS에서 평평하다. decode는 1, prefill 100토큰은 100, prefill 1000토큰은 1000에 있다." style="width:100%;min-width:560px;height:auto;max-width:720px;display:block;margin:0 auto;font-family:inherit">
<rect x="0" y="0" width="720" height="430" fill="#ffffff"/>
<rect x="90" y="40" width="419" height="320" fill="#fdf0e3"/>
<rect x="509" y="40" width="141" height="320" fill="#e3f4ea"/>
<text x="100" y="58" font-size="13" fill="#c26a12">memory-bound (대역폭이 속도를 정함)</text>
<text x="518" y="58" font-size="13" fill="#1f8a5b">compute-bound</text>
<line x1="90" y1="360" x2="650" y2="360" stroke="#1d252c"/>
<line x1="90" y1="40" x2="90" y2="360" stroke="#1d252c"/>
<line x1="259.7" y1="360" x2="259.7" y2="366" stroke="#1d252c"/><line x1="429.4" y1="360" x2="429.4" y2="366" stroke="#1d252c"/><line x1="599.1" y1="360" x2="599.1" y2="366" stroke="#1d252c"/>
<text x="90" y="382" font-size="12" text-anchor="middle" fill="#364049">1</text>
<text x="259.7" y="382" font-size="12" text-anchor="middle" fill="#364049">10</text>
<text x="429.4" y="382" font-size="12" text-anchor="middle" fill="#364049">100</text>
<text x="599.1" y="382" font-size="12" text-anchor="middle" fill="#364049">1,000</text>
<text x="370" y="410" font-size="13" text-anchor="middle" fill="#1d252c">arithmetic intensity (FLOP/B, 로그 눈금)</text>
<line x1="84" y1="260" x2="90" y2="260" stroke="#1d252c"/><line x1="84" y1="160" x2="90" y2="160" stroke="#1d252c"/><line x1="84" y1="60" x2="90" y2="60" stroke="#1d252c"/>
<text x="80" y="364" font-size="12" text-anchor="end" fill="#364049">1</text>
<text x="80" y="264" font-size="12" text-anchor="end" fill="#364049">10</text>
<text x="80" y="164" font-size="12" text-anchor="end" fill="#364049">100</text>
<text x="80" y="64" font-size="12" text-anchor="end" fill="#364049">1,000</text>
<text x="22" y="200" font-size="13" text-anchor="middle" fill="#1d252c" transform="rotate(-90 22 200)">계산 속도 (TFLOPS, 로그 눈금)</text>
<line x1="509.1" y1="60.5" x2="509.1" y2="360" stroke="#8a939c" stroke-dasharray="4 4"/>
<text x="513" y="350" font-size="12" fill="#364049">기준점 295</text>
<path d="M90 307.5 L509.1 60.5 L650 60.5" fill="none" stroke="#1d252c" stroke-width="3"/>
<text x="560" y="84" font-size="12" text-anchor="middle" fill="#1d252c">천장 989 TFLOPS</text>
<text x="250" y="250" font-size="12" fill="#1d252c" transform="rotate(-30.5 250 250)">대역폭 선: intensity × 3.35 TB/s</text>
<circle cx="90" cy="307.5" r="6" fill="#c0392b"/>
<text x="102" y="326" font-size="12" fill="#c0392b">decode 1명 BF16 (1 → 3.35)</text>
<circle cx="141.1" cy="277.4" r="6" fill="#ffffff" stroke="#c0392b" stroke-width="2"/>
<text x="152" y="296" font-size="12" fill="#c0392b">decode FP8 (2 → 6.7)</text>
<circle cx="429.4" cy="107.5" r="6" fill="#2f6fb5"/>
<text x="418" y="96" font-size="12" text-anchor="end" fill="#2f6fb5">prefill 100토큰 (100 → 335)</text>
<circle cx="599.1" cy="60.5" r="6" fill="#2f6fb5"/>
<text x="599.1" y="104" font-size="12" text-anchor="middle" fill="#2f6fb5">prefill 1,000토큰</text>
</svg>
<figcaption>H100 SXM의 roofline. 기준점 295보다 왼쪽은 대역폭이, 오른쪽은 계산 속도가 성능을 정한다. 사용자 1명의 decode는 맨 왼쪽 아래에 있다.</figcaption>
</figure>

그래프의 가로축은 intensity, 세로축은 실제 계산 속도다. 295까지는 **비스듬히 올라가는 선**(대역폭이 결정)이고, 295 이후는 **평평한 천장**(계산 속도가 결정)이다. 지붕 모양이라 roofline이라고 부른다.

- **decode는 지붕 한참 아래 왼쪽 끝에 있다.** 989 TFLOPS짜리 GPU를 3.35 TFLOPS로 쓰는 셈이다. decode 속도는 GPU 계산 성능이 아니라 **HBM 대역폭**이 정한다.
- **prefill이라고 항상 compute-bound는 아니다.** 입력이 약 295토큰보다 짧으면 prefill도 memory-bound다.
- **읽을 양을 줄이면 decode가 그대로 빨라진다.** weight를 FP8(70.6 GB)로 바꾸면 토큰당 읽기가 70.6 GB ÷ 3.35 TB/s ≈ **21 ms**로, 초당 약 47토큰이 된다. BF16의 2배다. 양자화의 가장 큰 효과가 이것이다.
- **KV cache 읽기도 같은 판정을 받는다.** decode에서 K cache 숫자 하나(2 B)는 같은 그룹의 Q head 8개가 같이 쓴다. 그래서 intensity가 약 8 FLOP/B로, 역시 295보다 한참 작다.

## 6. batching: 사용자를 묶으면 무엇이 좋아지고 무엇이 커지는가

### 6-1. batching이란

서비스에는 여러 사용자가 동시에 대화 중이다. 사용자 A, B, C 3명이 각자 다음 토큰을 기다린다고 하자.

- **따로 하기**: A의 decode, B의 decode, C의 decode를 차례로 한다.
- **묶어서 하기 (batching)**: A, B, C의 이번 토큰을 X의 행 3개로 쌓아 decode를 한 번에 한다.

묶은 사용자 수를 **batch 크기**라고 하고, 이 글에서는 **N**으로 쓴다(위 예에서 N = 3).

### 6-2. 무엇이 묶이고 무엇이 따로인가

| 단계 | 묶이나? | 이유 |
|---|---|---|
| X · W_Q, X · W_K, X · W_V | **묶음** | 모든 사용자가 같은 W_Q를 쓴다. 한 번 읽어 3행에 곱한다. X 3×4 · W_Q 4×4 = Q 3×4 |
| 점수 q·Kᵀ, softmax, A·V | **사용자별로 따로** | A의 q는 A의 K cache와만, B의 q는 B의 K cache와만 내적한다. KV cache는 대화마다 내용도 길이도 다르다 |
| O · W_O, FFN | **묶음** | 다시 같은 weight를 쓰니 3행을 한 번에 곱한다 |

<figure style="margin:22px 0;overflow-x:auto">
<svg viewBox="0 0 720 410" role="img" aria-label="batching. 사용자 A, B, C의 이번 토큰을 X의 3행으로 쌓아 W_Q를 한 번 읽어 곱한다. attention 단계에서는 각 사용자의 q가 자기 KV cache와만 계산한다." style="width:100%;min-width:560px;height:auto;max-width:720px;display:block;margin:0 auto;font-family:inherit">
<rect x="0" y="0" width="720" height="410" fill="#ffffff"/>
<text x="16" y="26" font-size="16" font-weight="700" fill="#1d252c">① weight 곱하기: 묶어서 한 번</text>
<text x="16" y="56" font-size="13" fill="#56606b">X (3×4)</text>
<rect x="16" y="66" width="130" height="30" fill="#e6f0fb" stroke="#2f6fb5"/><text x="81" y="86" font-size="13" text-anchor="middle" fill="#1d252c">A의 이번 토큰</text>
<rect x="16" y="96" width="130" height="30" fill="#fdf0e3" stroke="#c26a12"/><text x="81" y="116" font-size="13" text-anchor="middle" fill="#1d252c">B의 이번 토큰</text>
<rect x="16" y="126" width="130" height="30" fill="#f1eafa" stroke="#7a4cb3"/><text x="81" y="146" font-size="13" text-anchor="middle" fill="#1d252c">C의 이번 토큰</text>
<text x="168" y="118" font-size="22" text-anchor="middle" fill="#1d252c">·</text>
<text x="190" y="56" font-size="13" fill="#56606b">W_Q (4×4)</text>
<rect x="190" y="66" width="130" height="90" fill="#f1f3f5" stroke="#8a939c"/>
<text x="255" y="100" font-size="13" text-anchor="middle" fill="#1d252c">메모리에서 1번 읽음</text>
<text x="255" y="122" font-size="13" text-anchor="middle" fill="#1d252c">3명이 공유</text>
<path d="M332 111 H376" stroke="#1d252c" stroke-width="1.5"/><path d="M376 111 l-7 -4 v8 z" fill="#1d252c"/>
<text x="390" y="56" font-size="13" fill="#56606b">Q (3×4)</text>
<rect x="390" y="66" width="110" height="30" fill="#e6f0fb" stroke="#2f6fb5"/><text x="445" y="86" font-size="13" text-anchor="middle" fill="#1d252c">A의 q</text>
<rect x="390" y="96" width="110" height="30" fill="#fdf0e3" stroke="#c26a12"/><text x="445" y="116" font-size="13" text-anchor="middle" fill="#1d252c">B의 q</text>
<rect x="390" y="126" width="110" height="30" fill="#f1eafa" stroke="#7a4cb3"/><text x="445" y="146" font-size="13" text-anchor="middle" fill="#1d252c">C의 q</text>
<text x="520" y="100" font-size="13" fill="#364049">W_K, W_V, W_O, FFN도</text>
<text x="520" y="120" font-size="13" fill="#364049">같은 방식으로 묶는다</text>
<line x1="16" y1="186" x2="704" y2="186" stroke="#d7dce1"/>
<text x="16" y="214" font-size="16" font-weight="700" fill="#1d252c">② attention: 사용자마다 따로</text>
<rect x="16" y="234" width="90" height="30" fill="#e6f0fb" stroke="#2f6fb5"/><text x="61" y="254" font-size="13" text-anchor="middle" fill="#1d252c">A의 q</text>
<text x="124" y="256" font-size="22" text-anchor="middle" fill="#1d252c">·</text>
<rect x="142" y="234" width="300" height="30" fill="#e6f0fb" stroke="#2f6fb5" stroke-dasharray="4 3"/><text x="292" y="254" font-size="13" text-anchor="middle" fill="#1d252c">A의 KV cache: 5행 (A 대화의 토큰 5개)</text>
<rect x="16" y="284" width="90" height="30" fill="#fdf0e3" stroke="#c26a12"/><text x="61" y="304" font-size="13" text-anchor="middle" fill="#1d252c">B의 q</text>
<text x="124" y="306" font-size="22" text-anchor="middle" fill="#1d252c">·</text>
<rect x="142" y="284" width="300" height="30" fill="#fdf0e3" stroke="#c26a12" stroke-dasharray="4 3"/><text x="292" y="304" font-size="13" text-anchor="middle" fill="#1d252c">B의 KV cache: 8행 (B 대화의 토큰 8개)</text>
<rect x="16" y="334" width="90" height="30" fill="#f1eafa" stroke="#7a4cb3"/><text x="61" y="354" font-size="13" text-anchor="middle" fill="#1d252c">C의 q</text>
<text x="124" y="356" font-size="22" text-anchor="middle" fill="#1d252c">·</text>
<rect x="142" y="334" width="300" height="30" fill="#f1eafa" stroke="#7a4cb3" stroke-dasharray="4 3"/><text x="292" y="354" font-size="13" text-anchor="middle" fill="#1d252c">C의 KV cache: 3행 (C 대화의 토큰 3개)</text>
<text x="462" y="284" font-size="13" fill="#364049">내용도 길이도 달라서</text>
<text x="462" y="304" font-size="13" fill="#364049">하나로 묶을 수 없다.</text>
<text x="462" y="324" font-size="13" fill="#364049">사용자마다 따로 읽는다.</text>
<rect x="16" y="384" width="16" height="14" fill="#f1f3f5" stroke="#8a939c"/><text x="40" y="396" font-size="13" fill="#364049">공유 weight (1번 읽음)</text>
<rect x="230" y="384" width="16" height="14" fill="#e6f0fb" stroke="#2f6fb5"/><text x="254" y="396" font-size="13" fill="#364049">사용자별 데이터 (따로 읽음)</text>
</svg>
<figcaption>batching은 weight를 곱하는 단계만 묶는다. attention은 사용자마다 자기 KV cache로 따로 한다.</figcaption>
</figure>

### 6-3. 계산이 줄지 않는데 왜 묶나

**계산량은 그대로다.** 줄어드는 것은 **weight를 읽는 횟수**다. decode의 병목은 읽기였으니, 계산이 그대로여도 읽기가 줄면 시간이 준다.

사용자 8명, 각자 문맥 8,192토큰일 때(H100 1장 가정은 3장과 같다):

| | weight 읽는 횟수 | 읽는 양 | 걸리는 시간 | 결과 |
|---|---|---|---|---|
| 따로 8번 | 8번 | (141 + 2.7) GB × 8 = 1,150 GB | 42.9 ms × 8 = **343 ms** | 8명에게 토큰 1개씩 |
| 묶어서 1번 | **1번** | 141 + 2.7 × 8 = 162.5 GB | **48.5 ms** | 8명에게 토큰 1개씩 |

같은 결과를 7배 빨리 낸다. 계산 시간은 어느 쪽이든 1.1 ms로 작다. 차이는 전부 141 GB를 8번 읽느냐 1번 읽느냐에서 나온다.

> **decode 한 번에 읽는 양 = weight 141 GB (N명이 공유, 1번만 읽음) + N × 사용자 1명의 KV cache (따로)**

### 6-4. 묶은 사용자 수 N을 늘리면

decode 한 번에 N명 모두 토큰을 1개씩 받는다. 그래서 **전체 처리량 = N ÷ decode 한 번 시간**, **1명이 체감하는 속도 = 1 ÷ decode 한 번 시간**이다. 아래 표는 attention 자체의 계산량을 생략한 근사다.

**사용자마다 문맥 8,192토큰 (1명 KV cache 2.7 GB)**

| N | 한 번에 읽는 양 | 그중 KV cache | decode 한 번 | 계산 시간 | 전체 처리량 | 1명 체감 속도 |
|---|---|---|---|---|---|---|
| 1 | 143.7 GB | 2% | 42.9 ms | 0.1 ms | 23 토큰/초 | 23.3 토큰/초 |
| 8 | 162.5 GB | 13% | 48.5 ms | 1.1 ms | 165 | 20.6 |
| 32 | 226.9 GB | 38% | 67.7 ms | 4.6 ms | 472 | 14.8 |
| 64 | 312.8 GB | 55% | 93.4 ms | 9.1 ms | 685 | 10.7 |
| 128 | 484.6 GB | **71%** | 144.7 ms | 18.2 ms | 885 | **6.9** |

**사용자마다 문맥 1,000토큰 (1명 KV cache 0.33 GB)**

| N | 한 번에 읽는 양 | decode 한 번 | 전체 처리량 | 1명 체감 속도 |
|---|---|---|---|---|
| 64 | 162.0 GB | 48.3 ms | 1,324 토큰/초 | 20.7 |
| 128 | 182.9 GB | 54.6 ms | **2,344** | **18.3** |

### 6-5. 표에서 읽을 것

1. **전체 처리량은 크게 늘어난다.** weight 읽기를 N명이 나눠 내기 때문이다. GPU 한 장으로 더 많은 사람을 받으니 토큰당 비용이 내려가고, 그래서 실제 서비스는 거의 항상 batching을 한다.
2. **1명이 체감하는 속도는 느려진다.** 한 번에 읽을 양이 늘어 decode 한 번이 길어진다. 처리량과 응답 속도 사이의 trade-off다.
3. **문맥이 길면 KV cache가 발목을 잡는다.** 8,192 문맥, N = 128이면 읽는 양의 71%가 KV cache다. 계산(18 ms)은 여전히 읽기(145 ms)보다 한참 짧아 계속 memory-bound다. 같은 N = 128이어도 1,000 문맥은 처리량이 2.6배다. 용량도 KV cache가 먼저 채운다(4-4).
4. **KV cache를 줄이면 바로 효과가 난다.** 8,192 문맥, N = 64에서 KV cache만 FP8로 저장하면 읽는 양은 141 + 85.9 = 226.9 GB로, BF16일 때(312.8 GB)보다 27% 줄어든다.

> **batching은 weight 읽기를 사용자끼리 나눠 내게 해 주지만, 사용자마다 따로인 KV cache 읽기는 그대로 남기고 N만큼 키운다.**

## 자주 나올 질문과 답변

### Q. head가 1개여도 "먹었다"의 O에는 고양이가, 생선을 정보가 다 섞여 있지 않나?

맞다. head 1개의 한계는 "한쪽을 못 본다"가 아니라 "모든 차원이 같은 비율로 섞인다"는 것이다. multi-head는 차원을 나눠 묶음마다 비율을 따로 갖게 한다(1-3, 1-5).

### Q. multi-head는 차원을 나눠 갖는 것인가, attention을 여러 번 돌리는 것인가?

같은 일을 다르게 본 것이다. 4차원을 2 + 2로 나누면 2차원짜리 attention을 두 번 돌리는 것과 같다. 전체 숫자 개수와 weight 크기는 head 1개일 때와 같다.

### Q. W_Q는 4×2인가, 4×4인가?

둘 다 맞다. head마다 4×2짜리를 하나씩 가진다고 봐도 되고, 둘을 옆으로 붙인 4×4 하나로 봐도 된다. 계산 결과는 같고, 모델 파일에는 붙인 형태로 저장된다. Llama-3-70B는 "head마다 8,192×128이 64개" = "8,192×8,192 하나"다.

### Q. head 차원은 KV head 수로 정해지나?

아니다. head 차원은 d_model ÷ Q head 수다. GQA에서 줄어드는 것은 KV head의 **개수**이고, KV head 하나의 숫자 개수는 그대로다. k는 q와 내적해야 하기 때문이다. d_model 4,096, Q head 32, KV head 8이면 head 차원 128, W_Q 4,096×4,096, W_K 4,096×1,024다.

### Q. 점수(비율 A)는 몇 세트 나오나?

Q head 수만큼이다. Llama-3-70B는 64세트이고, 각 점수는 128개끼리 내적한 값이다. 1,024는 K 한 행의 길이(KV head 8 × 128)이지 점수 세트 수가 아니다.

### Q. decode 표에서 k, v가 1×4인데, KV cache는 누적되는 것 아닌가?

누적된다. 1×4는 이번 토큰이 **새로 만든 1행**이고, 점수 계산에는 이 행을 붙인 **K cache 전체**(토큰 수 × 4)를 쓴다. W_K(4×4)는 고정이라 안 늘어난다(3-2).

### Q. 대역폭은 TB/s인데 기준점 295는 어떻게 단위 없이 나오나?

989 TFLOPS = 989 × 10¹² FLOP/초, 3.35 TB/s = 3.35 × 10¹² B/초다. 나누면 10¹²와 "/초"가 약분되고 FLOP/B만 남는다(5-2).

### Q. prefill은 항상 compute-bound인가?

아니다. prefill의 intensity는 입력 토큰 수다. H100에서는 입력이 약 295토큰보다 짧으면 prefill도 memory-bound다.

### Q. batching은 q·k 내적도 묶어서 하나?

아니다. 묶는 것은 weight를 곱하는 단계(W_Q, W_K, W_V, W_O, FFN)뿐이다. 점수, softmax, A·V는 사용자마다 자기 KV cache로 따로 한다(6-2).

### Q. 묶어도 계산량이 그대로인데 왜 묶나?

decode의 병목이 계산이 아니라 weight 읽기이기 때문이다. 묶으면 weight를 N번 읽던 것을 1번만 읽는다(6-3).

## 정리

- 오늘 확실히 알게 된 것: 토큰 하나를 만들 때마다 weight 전체와 그 사용자의 KV cache 전체를 HBM에서 읽는다. 사용자 1명의 decode는 1바이트당 계산이 1번뿐이라 GPU 계산 능력의 0.3%만 쓴다. batching은 weight 읽기를 나눠 내게 하지만, KV cache는 사용자마다 따로라 문맥 길이 × 사용자 수만큼 커지며 결국 읽기와 용량 양쪽의 병목이 된다.
- 적용할 때 확인할 조건: 이 글의 시간 계산은 모델이 H100 한 장에 들어간다는 가정, attention 계산량 생략, 이론 대역폭 100% 사용을 전제로 한 상한이다. 실제 시스템은 여러 GPU에 나눠 돌리고 통신과 효율 손실이 있다.
- 다음 글에서 답할 질문: weight와 KV cache를 더 적은 비트로 저장하거나(양자화), 조각난 KV cache를 모으거나(PagedAttention), 점수 행렬을 메모리에 쓰지 않거나(FlashAttention), memory-bound를 역이용하는(speculative decoding) 방법은 각각 무엇을 얼마나 줄이는가?

## 참고 자료와 Claim ledger

| 주장 | 구분 | 출처 | 확인 메모 |
| --- | --- | --- | --- |
| multi-head attention, head 차원 = d_model ÷ head 수 | fact | [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | 원 논문은 d_model 512, head 8, head 차원 64 |
| GQA: Q head를 그룹으로 묶어 KV head를 공유 | fact | [GQA: Training Generalized Multi-Query Transformer Models](https://arxiv.org/abs/2305.13245) | |
| MQA: KV head 1개 | fact | [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150) | |
| Llama-3-70B: 80층, 차원 8,192, Q head 64, KV head 8 | fact | [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783), Table 3 | |
| H100 SXM 80 GB, 3.35 TB/s, BF16 1,979 / FP8 3,958 TFLOPS(sparsity), NVLink 900 GB/s, 700 W. H100 NVL 94 GB, 3.9 TB/s | fact | [NVIDIA H100](https://www.nvidia.com/en-us/data-center/h100/) | 2026-11-02 확인. 계산 속도는 "With sparsity" 주석, 본문은 절반 값 사용 |
| DGX H100: H100 SXM 8장, GPU 메모리 합계 640 GB | fact | [NVIDIA DGX H100](https://www.nvidia.com/en-us/data-center/dgx-h100/) | |
| roofline 모델: 성능 = min(최대 계산 속도, intensity × 대역폭) | fact | [Roofline: An Insightful Visual Performance Model](https://doi.org/10.1145/1498765.1498785) (Williams, Waterman, Patterson, 2009) | |
| 토큰당 계산량 ≈ 2 × 파라미터 수 | interpretation | weight 하나당 곱셈 1 + 덧셈 1로 직접 계산 | attention 점수 계산은 제외 |
| KV cache 토큰당 327,680 B, 사용자·문맥별 크기, 동시 사용자 수 | interpretation | 위 하이퍼파라미터로 직접 계산 | activation 등 다른 메모리는 무시 |
| H100 기준점 295 FLOP/B, prefill/decode/batching 시간과 처리량 | illustrative | 989 TFLOPS, 3.35 TB/s로 계산한 이론 상한 | 한 장에 모델이 들어간다는 가정. 실제 값은 더 낮다 |
| 4차원 예시의 모든 숫자 | illustrative | 설명용 임의 값 | 실제 모델 값 아님 |
