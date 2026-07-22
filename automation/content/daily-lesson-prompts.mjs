const dailyLessons = [
  {
    ref: "M01-W01-D1",
    title: "다음 token 예측을 데이터 경로로 보기",
    coreQuestion: "LLM이 다음 token을 고르는 순간 실제로는 어떤 data movement가 일어나는가?",
    concepts: ["token", "embedding", "logit", "softmax", "autoregressive decode"],
    practice: "문장 하나를 token sequence로 가정하고 embedding lookup부터 logit vector까지 shape를 표로 쓴다.",
    artifact: "token -> embedding -> transformer -> logits -> sampling pipeline diagram",
    postSections: ["오늘의 질문", "toy example", "tensor shape table", "memory traffic 관점", "헷갈린 점"],
    sourceHints: ["https://arxiv.org/abs/1706.03762"],
  },
  {
    ref: "M01-W01-D2",
    title: "Transformer block을 memory map으로 그리기",
    coreQuestion: "Q, K, V, attention score, FFN은 각각 어디에 저장되고 얼마나 읽히는가?",
    concepts: ["Q/K/V projection", "attention score", "FFN", "residual", "normalization"],
    practice: "hidden size 4, sequence length 3인 toy block의 intermediate tensor 크기를 계산한다.",
    artifact: "Transformer block memory map with read/write arrows",
    postSections: ["block overview", "shape walk-through", "activation lifetime", "병목 후보", "claim ledger"],
    sourceHints: ["https://arxiv.org/abs/1706.03762"],
  },
  {
    ref: "M01-W01-D3",
    title: "Prefill과 decode를 분리해서 이해하기",
    coreQuestion: "첫 prompt 처리와 token-by-token 생성은 왜 병목 위치가 다른가?",
    concepts: ["prefill", "decode", "batch", "TTFT", "TPOT"],
    practice: "prompt 1,024 tokens와 output 128 tokens의 처리 단계를 timeline으로 나눈다.",
    artifact: "prefill/decode timeline table",
    postSections: ["두 단계 정의", "timeline", "memory vs compute", "serving 지표", "다음 질문"],
    sourceHints: ["https://arxiv.org/abs/2309.06180", "https://vllm.ai/blog/2023-06-20-vllm"],
  },
  {
    ref: "M01-W01-D4",
    title: "Weight는 parameter가 아니라 매 token 읽는 data다",
    coreQuestion: "7B FP16 모델에서 한 token 생성에 weight read만 대략 얼마인가?",
    concepts: ["parameter count", "precision", "weight bandwidth", "batch reuse", "memory-bound decode"],
    practice: "7B, 13B, 70B 모델의 FP16/INT8 weight footprint와 token당 read traffic을 계산한다.",
    artifact: "model size vs bytes-per-token table",
    postSections: ["공식", "계산표", "batch가 주는 reuse", "HBM 관점", "주의할 가정"],
    sourceHints: ["https://developer.nvidia.com/blog/inside-nvidia-blackwell-ultra-the-chip-powering-the-ai-factory-era/"],
  },
  {
    ref: "M01-W01-D5",
    title: "KV cache 첫 계산",
    coreQuestion: "context length가 늘면 KV cache는 어떤 식으로 메모리를 잡아먹는가?",
    concepts: ["key/value tensor", "layers", "heads", "head dimension", "context length"],
    practice: "layers, heads, head_dim, dtype, context, batch를 변수로 KV cache capacity 공식을 만든다.",
    artifact: "KV cache formula card and spreadsheet table",
    postSections: ["왜 cache가 필요한가", "공식", "예시 계산", "serving 영향", "출처 후보"],
    sourceHints: ["https://arxiv.org/abs/2309.06180"],
  },
  {
    ref: "M01-W01-D6",
    title: "FlashAttention을 IO-aware 관점으로 읽기",
    coreQuestion: "attention을 빠르게 만든 핵심이 연산량 감소가 아니라 HBM 접근 감소라면 무엇이 달라지는가?",
    concepts: ["IO awareness", "tiling", "SRAM", "HBM traffic", "attention matrix"],
    practice: "naive attention이 score matrix를 저장할 때와 tiled attention이 줄이는 read/write를 비교한다.",
    artifact: "naive vs tiled attention memory traffic diagram",
    postSections: ["문제", "HBM/SRAM 계층", "tiling 직관", "계산 예시", "내 해석"],
    sourceHints: ["https://arxiv.org/abs/2205.14135"],
  },
  {
    ref: "M01-W01-D7",
    title: "1주차 종합: next token의 병목 지도",
    coreQuestion: "LLM 추론 병목을 weight, KV cache, activation, scheduling으로 나누면 무엇이 보이는가?",
    concepts: ["data path", "capacity", "bandwidth", "latency", "reuse"],
    practice: "이번 주 계산을 한 장의 traffic map으로 합친다.",
    artifact: "one-page LLM inference bottleneck map",
    postSections: ["한 주 요약", "계산 모음", "병목 지도", "내가 아직 모르는 것", "다음 주 연결"],
    sourceHints: ["https://arxiv.org/abs/1706.03762", "https://arxiv.org/abs/2205.14135", "https://arxiv.org/abs/2309.06180"],
  },
];

const qualityGate = [
  "용어 정의만 하지 말고 반드시 하나의 system behavior를 설명한다.",
  "byte, latency, bandwidth, capacity, energy 중 하나 이상의 계산을 포함한다.",
  "Markdown 표 1개와 inline SVG 다이어그램 1개를 본문에 포함한다.",
  "표준, 제품, 논문, 벤치마크 claim은 public source 후보와 연결한다.",
  "확정 사실, 해석, 추정을 분리한다.",
  "공개 출처로 확인 가능한 내용과 개인적인 해석을 구분한다.",
];

export function findDailyLesson(curriculumRef) {
  const normalized = String(curriculumRef ?? "").trim();
  return dailyLessons.find((lesson) => lesson.ref === normalized) ?? null;
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildArtifactScaffold(lesson) {
  const title = lesson?.title ?? "오늘 주제";
  const artifact = lesson?.artifact ?? "system data-path diagram and calculation table";
  return [
    "필수 산출물:",
    "",
    "1. Markdown 계산표를 본문 중간에 넣어라.",
    "   표 column은 최소한 `항목 | 조건/shape | 계산식 | 결과 | 해석`을 포함한다.",
    "   숫자를 모르면 toy example을 명시하고 계산한다.",
    "",
    "2. inline SVG 다이어그램을 본문에 넣어라.",
    "   외부 이미지 파일 링크나 Mermaid 코드블록만 쓰지 말고, Markdown 안에 바로 렌더링되는 `<svg ...>` 블록을 작성한다.",
    "   SVG는 960x420 viewBox 기준으로 만들고, 노드/화살표/짧은 label을 포함한다.",
    "   모바일에서도 보이도록 `<svg viewBox=\"0 0 960 420\" role=\"img\" aria-label=\"...\" style=\"max-width:100%;height:auto;\">` 형태를 사용한다.",
    "",
    `오늘 다이어그램 주제: ${artifact}`,
    `다이어그램 제목: ${title}`,
  ].join("\n");
}

export function buildDailyLessonPromptContext({ curriculumRef }) {
  const lesson = findDailyLesson(curriculumRef);
  if (!lesson) {
    return {
      lesson: null,
      text: [
        "오늘 lesson 상세 데이터:",
        `- ref: ${curriculumRef ?? "unknown"}`,
        "- 아직 상세 lesson 데이터가 없다. 그래도 아래 품질 게이트와 산출물 요구사항은 반드시 지킨다.",
        "",
        "품질 게이트:",
        markdownList(qualityGate),
        "",
        buildArtifactScaffold(null),
      ].join("\n"),
    };
  }

  return {
    lesson,
    text: [
      "오늘 lesson 상세 데이터:",
      `- ref: ${lesson.ref}`,
      `- 제목: ${lesson.title}`,
      `- 핵심 질문: ${lesson.coreQuestion}`,
      "- 핵심 개념:",
      markdownList(lesson.concepts),
      `- 계산/실험: ${lesson.practice}`,
      `- 시각 산출물: ${lesson.artifact}`,
      "- 권장 글 섹션:",
      markdownList(lesson.postSections),
      "- public source 후보:",
      markdownList(lesson.sourceHints),
      "",
      "품질 게이트:",
      markdownList(qualityGate),
      "",
      buildArtifactScaffold(lesson),
    ].join("\n"),
  };
}
