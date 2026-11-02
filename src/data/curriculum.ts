// Curriculum: understand LLMs through how they use memory.
// One part = one long post. Sections are the questions that post answers.
// Pace is intentionally unset. Posts are written as: concept intro in chat ->
// Q&A until understood -> Q&A folded into the post -> published on approval.
// Offline training notes (file system, NAND) stay outside this curriculum.

export type PostType =
  | "Foundation Explainer"
  | "Mechanism Walkthrough"
  | "System Path"
  | "Quantitative Note"
  | "Interface Comparison"
  | "Paper / Trend Reading";

export type PostStatus = "published" | "in-progress" | "planned";

export type CurriculumPart = {
  id: string;
  title: string;
  question: string;
  status: PostStatus;
  optional?: boolean;
  slugs?: string[];
  sections: string[];
};

export type PostBlueprint = {
  type: PostType;
  purpose: string;
  requiredBlocks: string[];
  optionalBlocks: string[];
};

export const curriculumQualityGate = [
  "Every post answers one learner question rather than listing terms.",
  "Define new terms in plain language before using them in an argument.",
  "Use a calculation, experiment, table, or diagram only when it improves the explanation.",
  "Tie important factual claims about standards, products, papers, or benchmarks to public sources.",
  "Separate established fact, personal interpretation, and prediction.",
  "End with likely learner questions and concise answers.",
];

export const postBlueprints: PostBlueprint[] = [
  {
    type: "Foundation Explainer",
    purpose: "Build a beginner's mental model before introducing performance or hardware detail.",
    requiredBlocks: ["why this matters", "key terms", "small example", "big-picture flow", "Q&A"],
    optionalBlocks: ["analogy", "one diagram", "one small exercise"],
  },
  {
    type: "Mechanism Walkthrough",
    purpose: "Explain how a component or algorithm changes input into output.",
    requiredBlocks: ["input and output", "step-by-step mechanism", "state or data changes", "Q&A"],
    optionalBlocks: ["shape table", "sequence diagram", "toy calculation"],
  },
  {
    type: "System Path",
    purpose: "Follow a request or data through several hardware and software components.",
    requiredBlocks: ["components", "data path", "conditions that change behavior", "trade-offs"],
    optionalBlocks: ["traffic estimate", "pipeline diagram", "comparison table"],
  },
  {
    type: "Quantitative Note",
    purpose: "Use a small transparent calculation to build engineering intuition.",
    requiredBlocks: ["question", "assumptions and units", "formula and result", "interpretation and limits"],
    optionalBlocks: ["spreadsheet", "sensitivity table", "measurement plan"],
  },
  {
    type: "Interface Comparison",
    purpose: "Compare technologies as workload and system choices rather than specification lists.",
    requiredBlocks: ["comparison context", "selected comparison axes", "trade-off table", "selection guidance"],
    optionalBlocks: ["packaging sketch", "cost or power caveat", "source caveat"],
  },
  {
    type: "Paper / Trend Reading",
    purpose: "Turn a paper, standard, or announcement into a bounded engineering interpretation.",
    requiredBlocks: ["what the source says", "background", "verified facts", "interpretation", "open questions"],
    optionalBlocks: ["claim ledger", "timeline", "workload impact table"],
  },
];

export const curriculum: CurriculumPart[] = [
  {
    id: "P1",
    title: "LLM은 무엇을 계산하나",
    question: "LLM은 token에서 다음 token까지 무엇을 계산하는가?",
    status: "published",
    slugs: [
      "2026-07-23-m01-w01-d1-r4",
      "2026-07-23-m01-w01-d2-r4",
      "2026-07-23-m01-w01-d3-r2",
      "2026-07-23-m01-w01-d4-r1",
      "2026-07-27-m01-w01-d5-r1",
      "2026-07-28-m01-w01-d6-r1",
      "2026-07-28-m01-w01-d7-r1",
      "2026-08-07-m01-w02-d1-r1",
      "2026-09-01-m01-w02-d2-r1",
      "2026-11-02-attention-data-flow-walkthrough",
    ],
    sections: [
      "LLM은 무엇이고, 다음 token 예측으로 어떻게 답을 만드는가?",
      "embedding: token을 숫자로 바꾸면 무엇을 할 수 있는가?",
      "attention의 직관: 임베딩만으로는 왜 부족한가?",
      "Transformer 한 층을 숫자로 끝까지 따라가면 무엇이 계산되는가?",
    ],
  },
  {
    id: "P2",
    title: "토큰 하나를 만들 때 메모리에서 일어나는 일",
    question: "LLM이 토큰을 하나 만들 때 메모리에서는 무엇을 얼마나 읽고, 왜 그것이 병목인가?",
    status: "published",
    slugs: ["2026-11-02-llm-memory-per-token"],
    sections: [
      "multi-head와 GQA: K, V는 왜 8,192가 아니라 1,024인가?",
      "prefill과 decode: 같은 계산인데 왜 병목이 다른가?",
      "KV cache는 문장 길이 × 사용자 수가 되면 얼마나 커지는가?",
      "arithmetic intensity와 roofline: decode는 왜 memory-bound인가?",
      "batching: 사용자를 묶으면 무엇이 좋아지고 무엇이 커지는가?",
    ],
  },
  {
    id: "P3",
    title: "메모리를 아끼는 기법",
    question: "같은 모델을 더 적은 메모리와 대역폭으로 돌리려면 무엇을 줄이고 무엇을 피하는가?",
    status: "planned",
    sections: [
      "양자화: weight와 KV cache를 몇 비트까지 줄일 수 있는가?",
      "PagedAttention: KV cache는 왜 조각나고 어떻게 모으는가?",
      "FlashAttention: 토큰 수의 제곱 크기인 점수 행렬을 왜 메모리에 쓰지 않는가?",
      "speculative decoding: memory-bound라는 성질을 어떻게 역으로 이용하는가?",
    ],
  },
  {
    id: "P4",
    title: "하드웨어로 내려가기",
    question: "LLM이 요구하는 용량과 대역폭은 GPU 메모리 계층과 DRAM 구조에서 어떻게 만들어지는가?",
    status: "planned",
    sections: [
      "GPU 메모리 계층: register, SRAM, HBM은 각각 무엇을 담는가?",
      "HBM 대역폭은 어디서 나오는가: bus 폭 × 핀 속도",
      "DRAM의 row, bank 구조와 LLM의 접근 패턴은 어떻게 만나는가?",
      "HBM, DDR, LPDDR: 용량과 대역폭의 trade-off는 무엇인가?",
    ],
  },
  {
    id: "P5",
    title: "한 장비를 넘어서",
    question: "모델과 KV cache가 장비 하나를 넘치면 어디에 두고, 그 비용은 무엇인가?",
    status: "planned",
    sections: [
      "모델이 GPU 하나에 안 들어갈 때, 나눠 싣는 방법과 통신 비용은?",
      "MoE: weight는 큰데 왜 일부만 읽는가?",
      "KV cache를 CPU DRAM, CXL, SSD로 내리면 무엇을 얻고 잃는가?",
      "prefill과 decode를 다른 장비로 나누면(disaggregated serving) 무엇이 좋아지는가?",
    ],
  },
  {
    id: "P6",
    title: "학습은 왜 메모리가 더 필요한가",
    question: "학습에서는 추론보다 무엇이 더 메모리를 차지하는가?",
    status: "planned",
    optional: true,
    sections: ["학습에서는 gradient, optimizer state, activation이 메모리를 얼마나 차지하는가?"],
  },
];
