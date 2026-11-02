// Curriculum: understand LLMs through how they use memory.
// One item = one post (one learner question). Parts only group related posts.
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

export type PostStatus = "published" | "next" | "planned";

export type CurriculumPost = {
  id: string;
  question: string;
  status: PostStatus;
  slugs?: string[];
};

export type CurriculumPart = {
  index: number;
  title: string;
  optional?: boolean;
  posts: CurriculumPost[];
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
    index: 1,
    title: "LLM은 무엇을 계산하나",
    posts: [
      {
        id: "P1-01",
        question: "LLM은 무엇이고, 다음 token 예측으로 어떻게 답을 만드는가?",
        status: "published",
        slugs: [
          "2026-07-23-m01-w01-d1-r4",
          "2026-07-23-m01-w01-d2-r4",
          "2026-07-23-m01-w01-d3-r2",
          "2026-07-23-m01-w01-d4-r1",
          "2026-07-27-m01-w01-d5-r1",
          "2026-07-28-m01-w01-d6-r1",
          "2026-07-28-m01-w01-d7-r1",
        ],
      },
      { id: "P1-02", question: "embedding: token을 숫자로 바꾸면 무엇을 할 수 있는가?", status: "published", slugs: ["2026-08-07-m01-w02-d1-r1"] },
      { id: "P1-03", question: "attention의 직관: 임베딩만으로는 왜 부족한가?", status: "published", slugs: ["2026-09-01-m01-w02-d2-r1"] },
      { id: "P1-04", question: "Transformer 한 층을 숫자로 끝까지 따라가면 무엇이 계산되는가?", status: "published", slugs: ["2026-11-02-attention-data-flow-walkthrough"] },
    ],
  },
  {
    index: 2,
    title: "토큰 하나를 만들 때 메모리에서 일어나는 일",
    posts: [
      { id: "P2-01", question: "multi-head와 GQA: K, V는 왜 8,192가 아니라 1,024인가?", status: "next" },
      { id: "P2-02", question: "prefill과 decode: 같은 계산인데 왜 병목이 다른가?", status: "planned" },
      { id: "P2-03", question: "KV cache는 문장 길이 × 사용자 수가 되면 얼마나 커지는가?", status: "planned" },
      { id: "P2-04", question: "arithmetic intensity와 roofline: decode는 왜 memory-bound인가?", status: "planned" },
      { id: "P2-05", question: "batching: 사용자를 묶으면 무엇이 좋아지고 무엇이 커지는가?", status: "planned" },
    ],
  },
  {
    index: 3,
    title: "메모리를 아끼는 기법",
    posts: [
      { id: "P3-01", question: "양자화: weight와 KV cache를 몇 비트까지 줄일 수 있는가?", status: "planned" },
      { id: "P3-02", question: "PagedAttention: KV cache는 왜 조각나고 어떻게 모으는가?", status: "planned" },
      { id: "P3-03", question: "FlashAttention: 토큰 수의 제곱 크기인 점수 행렬을 왜 메모리에 쓰지 않는가?", status: "planned" },
      { id: "P3-04", question: "speculative decoding: memory-bound라는 성질을 어떻게 역으로 이용하는가?", status: "planned" },
    ],
  },
  {
    index: 4,
    title: "하드웨어로 내려가기",
    posts: [
      { id: "P4-01", question: "GPU 메모리 계층: register, SRAM, HBM은 각각 무엇을 담는가?", status: "planned" },
      { id: "P4-02", question: "HBM 대역폭은 어디서 나오는가: bus 폭 × 핀 속도", status: "planned" },
      { id: "P4-03", question: "DRAM의 row, bank 구조와 LLM의 접근 패턴은 어떻게 만나는가?", status: "planned" },
      { id: "P4-04", question: "HBM, DDR, LPDDR: 용량과 대역폭의 trade-off는 무엇인가?", status: "planned" },
    ],
  },
  {
    index: 5,
    title: "한 장비를 넘어서",
    posts: [
      { id: "P5-01", question: "모델이 GPU 하나에 안 들어갈 때, 나눠 싣는 방법과 통신 비용은?", status: "planned" },
      { id: "P5-02", question: "MoE: weight는 큰데 왜 일부만 읽는가?", status: "planned" },
      { id: "P5-03", question: "KV cache를 CPU DRAM, CXL, SSD로 내리면 무엇을 얻고 잃는가?", status: "planned" },
      { id: "P5-04", question: "prefill과 decode를 다른 장비로 나누면(disaggregated serving) 무엇이 좋아지는가?", status: "planned" },
    ],
  },
  {
    index: 6,
    title: "학습은 왜 메모리가 더 필요한가",
    optional: true,
    posts: [
      { id: "P6-01", question: "학습에서는 gradient, optimizer state, activation이 메모리를 얼마나 차지하는가?", status: "planned" },
    ],
  },
];
