---
layout: ../../layouts/PostLayout.astro
title: "LLM은 어떻게 다음 토큰을 예측하는가"
description: "문장을 token으로 바꾸고, Transformer가 마지막 위치의 확률분포를 만든 뒤, 다음 token을 선택하는 과정을 memory traffic 관점까지 연결한다."
lessonDate: "2026-07-22"
curriculumRef: "M01-W01-D1"
category: "LLM"
tags: ["LLM", "Transformer", "Token", "KV Cache", "Memory Bandwidth"]
minutes: 18
---

# LLM은 어떻게 다음 토큰을 예측하는가

LLM을 가장 단순하게 보면 “지금까지의 token을 읽고 다음 token의 확률분포를 만드는 함수”다. 사용자가 문장을 입력하면 tokenizer가 문장을 token ID로 나누고, embedding table이 각 ID를 vector로 바꾼다. 그 vector들이 Transformer block을 지나면 마지막 위치의 hidden state가 나오고, 최종 projection과 softmax를 거쳐 vocabulary 전체에 대한 확률분포가 만들어진다.

## Token에서 확률분포까지

예를 들어 `"memory matters"`라는 입력은 tokenizer를 거쳐 `[4821, 917]` 같은 token ID 배열이 된다. 각 ID는 embedding lookup으로 dense vector가 되고, sequence length와 hidden dimension을 가진 tensor로 Transformer에 들어간다.

| 단계 | 데이터 형태 | 의미 |
| --- | --- | --- |
| Text | `"memory matters"` | 사람이 읽는 문자열 |
| Token IDs | `[4821, 917]` | vocabulary 안의 정수 ID |
| Embedding | `[2, d_model]` | 모델이 계산하는 vector |
| Logits | `[vocab_size]` | 다음 token 후보별 점수 |

Logit은 아직 확률이 아니다. Softmax를 적용해야 합이 1인 확률분포가 된다.

```text
p(token_i) = exp(logit_i) / sum(exp(logit_j))
```

그 다음 sampling, greedy decoding, temperature 같은 정책으로 하나의 token을 고르고, 그 token을 다시 입력 뒤에 붙인다. 이 과정을 반복하면 문장이 생성된다.

## Prefill과 Decode

LLM serving에서는 보통 prefill과 decode를 나눠 생각한다.

Prefill은 사용자가 넣은 prompt 전체를 한 번에 처리하는 단계다. sequence 안의 많은 token을 병렬로 계산할 수 있어서 연산량이 크지만 GPU 활용률을 높이기 좋다.

Decode는 다음 token을 하나씩 생성하는 단계다. 새 token이 생길 때마다 이전 context의 KV cache를 참고하고, 모델 weight를 계속 읽는다. 그래서 작은 batch의 decode에서는 compute보다 memory bandwidth가 먼저 병목이 되는 경우가 많다.

## Memory Traffic 관점

LLM inference의 시간은 FLOP만으로 정해지지 않는다. 특히 decode에서는 매 token마다 모델 weight와 KV cache를 읽어야 한다. batch가 작으면 weight를 여러 요청이 충분히 공유하지 못해 `bytes read / effective bandwidth`가 token latency의 큰 부분을 결정한다.

```text
rough token latency ~= bytes read per token / effective memory bandwidth
```

여기서 중요한 질문은 “몇 개의 parameter인가?”에서 끝나지 않는다. 같은 parameter 수라도 precision, batch size, KV cache 크기, context length, memory hierarchy에 따라 병목 위치가 달라진다.

## 오늘의 체크포인트

1. Logit은 확률이 아니라 softmax 이전의 점수다.
2. Decode는 token을 하나씩 생성하기 때문에 prefill과 병목 특성이 다르다.
3. LLM을 이해하려면 tensor shape과 byte traffic을 같이 봐야 한다.

## 출발 자료

- Vaswani et al., [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- NVIDIA, [GPU Performance Background](https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html)
