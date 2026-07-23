export type CurriculumModule = {
  index: string;
  weeks: string;
  title: string;
  question: string;
  topics: string[];
  lab: string;
  outcome: string;
  color: "green" | "blue" | "amber" | "red";
};

export type PostType =
  | "Foundation Explainer"
  | "Mechanism Walkthrough"
  | "System Path"
  | "Quantitative Note"
  | "Interface Comparison"
  | "Paper / Trend Reading";

export type BlogTheme = "LLM" | "Memory" | "System";

export type DailyLesson = {
  ref: string;
  week: string;
  title: string;
  coreQuestion: string;
  concepts: string[];
  practice: string;
  artifact: string;
  theme: BlogTheme;
  postType: PostType;
  postSections: string[];
  sourceHints: string[];
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

export const curriculum: CurriculumModule[] = [
  {
    index: "01",
    weeks: "1-4주",
    title: "LLM 기초: 언어 모델의 작동 방식",
    question: "LLM은 무엇을 입력으로 받아 어떤 과정을 거쳐 다음 단어를 만드는가?",
    topics: ["생성형 AI와 LLM", "token과 확률", "context window", "Transformer의 큰 그림", "학습과 추론"],
    lab: "짧은 문장을 token과 확률 분포라는 관점에서 설명하고, 질문-응답 흐름을 한 장으로 정리한다.",
    outcome: "LLM의 핵심 용어를 자신의 말로 설명하고, 학습과 추론의 차이를 구분한다.",
    color: "green",
  },
  {
    index: "02",
    weeks: "5-7주",
    title: "LLM 내부: Transformer와 추론 기초",
    question: "attention과 feed-forward layer는 왜 필요하고, 생성 단계는 어떻게 이어지는가?",
    topics: ["embedding", "self-attention", "MLP와 residual", "sampling", "prefill과 decode"],
    lab: "작은 Transformer의 입력과 출력 흐름을 그리고, prefill/decode를 시간축으로 비교한다.",
    outcome: "Transformer의 핵심 부품과 LLM 응답 생성 과정을 연결해 설명한다.",
    color: "blue",
  },
  {
    index: "03",
    weeks: "8-10주",
    title: "컴퓨터 기초: 연산과 데이터 이동",
    question: "프로그램의 데이터는 CPU, cache, DRAM, storage 사이를 어떻게 이동하는가?",
    topics: ["bit/byte와 주소", "CPU와 GPU", "storage hierarchy", "latency/bandwidth/capacity", "locality"],
    lab: "한 프로그램의 데이터 경로를 cache와 DRAM까지 그려 보고, 단위와 지연 시간을 비교한다.",
    outcome: "성능을 연산량만이 아니라 데이터 이동과 대기 시간으로도 읽는다.",
    color: "amber",
  },
  {
    index: "04",
    weeks: "11-13주",
    title: "DRAM과 메모리 컨트롤러",
    question: "DRAM은 왜 row, bank, channel 구조를 가지며 접근 패턴은 왜 중요한가?",
    topics: ["DRAM cell/array", "row buffer", "channel/rank/bank", "controller scheduling", "refresh/ECC"],
    lab: "순차, stride, random 접근을 DRAM 동작과 연결하는 표를 만든다.",
    outcome: "소프트웨어 접근 패턴을 DRAM의 병렬성, locality, 지연으로 번역한다.",
    color: "red",
  },
  {
    index: "05",
    weeks: "14-16주",
    title: "메모리 인터페이스와 제품 선택",
    question: "DDR, LPDDR, GDDR, HBM은 어떤 시스템 제약 때문에 서로 달라졌는가?",
    topics: ["bandwidth와 bus width", "pin speed", "power", "package/thermal", "HBM4 public facts"],
    lab: "서버, 모바일, GPU workload에 맞춰 메모리 요구사항 비교표를 만든다.",
    outcome: "메모리 규격을 수치 나열이 아닌 시스템 trade-off로 비교한다.",
    color: "green",
  },
  {
    index: "06",
    weeks: "17-19주",
    title: "GPU와 AI accelerator의 메모리 계층",
    question: "많은 연산기가 데이터를 기다리지 않게 하려면 어떤 계층과 dataflow가 필요한가?",
    topics: ["GPU execution model", "register/shared memory/HBM", "GEMM", "arithmetic intensity", "roofline"],
    lab: "GEMM과 element-wise 연산을 대략적인 연산량과 데이터 이동으로 비교한다.",
    outcome: "compute-bound와 memory-bound workload를 구분한다.",
    color: "blue",
  },
  {
    index: "07",
    weeks: "20-22주",
    title: "LLM 학습의 메모리",
    question: "학습에서는 weight 외에 무엇이 메모리를 차지하고, 왜 parallelism이 필요한가?",
    topics: ["dataset/batch", "activation", "gradient", "optimizer state", "checkpointing/parallelism"],
    lab: "모델 크기와 dtype을 바꿔 weight, gradient, optimizer state 예산을 계산한다.",
    outcome: "LLM 학습 메모리 요구량을 구성 요소와 절감 기법으로 나눠 설명한다.",
    color: "amber",
  },
  {
    index: "08",
    weeks: "23-25주",
    title: "LLM 추론과 serving의 메모리",
    question: "긴 context와 많은 동시 사용자는 weight, KV cache, scheduling에 어떤 부담을 주는가?",
    topics: ["TTFT/TPOT", "batching", "KV cache", "quantization", "PagedAttention/FlashAttention"],
    lab: "모델, context, batch 조건을 바꿔 capacity와 traffic의 변화를 계산한다.",
    outcome: "LLM serving 성능을 latency, throughput, capacity, bandwidth의 언어로 설명한다.",
    color: "red",
  },
  {
    index: "09",
    weeks: "26-28주",
    title: "분산 AI와 interconnect",
    question: "GPU를 더 붙일 때 왜 HBM 문제가 network와 fabric 문제로 이어지는가?",
    topics: ["data/tensor/pipeline/expert parallelism", "collective communication", "PCIe/NVLink/Ethernet", "scale-up/scale-out"],
    lab: "parallelism별 통신량을 간단한 모델로 비교한다.",
    outcome: "AI 시스템의 병목 위치를 accelerator, host, fabric 사이에서 찾는다.",
    color: "green",
  },
  {
    index: "10",
    weeks: "29-31주",
    title: "I/O, storage, network와 메모리",
    question: "SSD와 NIC의 데이터는 DRAM을 어떤 경로로 지나고, 복사와 queue는 왜 생기는가?",
    topics: ["DMA/IOMMU", "page cache", "direct I/O", "RDMA", "queueing"],
    lab: "block size와 queue depth가 달라질 때 I/O 경로에서 달라지는 점을 정리한다.",
    outcome: "I/O 성능을 device 숫자만이 아니라 데이터 경로와 CPU 비용으로 해석한다.",
    color: "blue",
  },
  {
    index: "11",
    weeks: "32-34주",
    title: "CXL과 차세대 메모리",
    question: "메모리를 멀리 두거나 연산 가까이 옮기면 어떤 이득과 비용이 생기는가?",
    topics: ["CXL.mem", "tiering/pooling", "PIM/near-memory", "MRAM/ReRAM/PCM", "placement"],
    lab: "local DRAM, HBM, CXL memory의 placement matrix를 만든다.",
    outcome: "차세대 메모리를 workload, placement, latency, capacity 관점에서 평가한다.",
    color: "amber",
  },
  {
    index: "12",
    weeks: "35-36주",
    title: "LLM·메모리·시스템 co-design",
    question: "MoE, long context, agent workload는 다음 시스템과 메모리 요구사항을 어떻게 바꾸는가?",
    topics: ["MoE", "long context", "retrieval/agent workload", "disaggregated serving", "memory-compute co-design"],
    lab: "AI 서비스 하나를 골라 compute, HBM, DRAM, CXL, network 요구사항을 제안한다.",
    outcome: "workload에서 시스템 요구사항과 메모리 제품 관점까지 이어지는 기술 글을 쓴다.",
    color: "red",
  },
];

const makeLesson = (
  ref: string,
  week: string,
  title: string,
  coreQuestion: string,
  concepts: string[],
  practice: string,
  artifact: string,
  postType: PostType,
  postSections: string[],
  sourceHints: string[],
  theme: BlogTheme = themeForLesson(ref),
): DailyLesson => ({ ref, week, title, coreQuestion, concepts, practice, artifact, theme, postType, postSections, sourceHints });

function themeForLesson(ref: string): BlogTheme {
  if (ref.startsWith("M01-")) return "LLM";
  if (ref.startsWith("M02-W03-")) return "System";
  if (ref === "M02-W04-D1" || ref === "M02-W04-D2") return "Memory";
  if (ref === "M02-W04-D7") return "System";
  return "LLM";
}

export const dailyLessons: DailyLesson[] = [
  makeLesson("M01-W01-D1", "1", "LLM은 무엇이고 왜 필요한가", "검색, 규칙 기반 프로그램, LLM은 무엇이 다르고 LLM은 어디에 잘 맞는가?", ["generative AI", "LLM", "model", "training", "inference"], "익숙한 업무 하나를 골라 규칙 기반 처리와 LLM 처리를 비교한다.", "LLM input-output overview", "Foundation Explainer", ["문제", "핵심 용어", "작은 예시", "Q&A"], ["https://arxiv.org/abs/2005.14165"]),
  makeLesson("M01-W01-D2", "1", "다음 token 예측이라는 한 문장", "LLM은 왜 다음 token 예측으로 문장, 코드, 요약을 만들 수 있는가?", ["token", "next-token prediction", "probability", "generation"], "짧은 문장의 다음 단어 후보 세 개를 확률이라는 말로 설명한다.", "next-token probability sketch", "Foundation Explainer", ["한 문장 결론", "직관", "예시", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W01-D3", "1", "token은 단어와 어떻게 다른가", "LLM은 문장을 어떤 작은 조각으로 나누고, 그 차이가 왜 중요한가?", ["tokenizer", "vocabulary", "token length", "context"], "한국어 문장 하나를 token 수가 달라질 수 있다는 관점에서 관찰한다.", "text-to-token example table", "Foundation Explainer", ["용어", "예시", "오해", "Q&A"], ["https://huggingface.co/docs/transformers/tokenizer_summary"]),
  makeLesson("M01-W01-D4", "1", "확률, logit, sampling의 역할", "LLM은 후보 중 하나를 어떻게 고르며 매번 같은 답을 하지 않을 수 있는가?", ["logit", "softmax", "temperature", "sampling"], "날씨 예측 확률처럼 세 후보를 놓고 temperature의 직관을 설명한다.", "candidate probability table", "Mechanism Walkthrough", ["입력", "후보 점수", "선택", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W01-D5", "1", "prompt와 context window", "질문을 잘 쓰는 일과 context window는 LLM의 답변에 어떤 영향을 주는가?", ["prompt", "system prompt", "context window", "instruction"], "좋지 않은 질문과 개선한 질문을 한 쌍 만든다.", "prompt-to-response flow", "Foundation Explainer", ["개념", "전후 예시", "제약", "Q&A"], ["https://platform.openai.com/docs/guides/text"]),
  makeLesson("M01-W01-D6", "1", "LLM 답변은 왜 틀릴 수 있는가", "그럴듯한 문장이 사실과 다를 수 있는 이유와 검증 방법은 무엇인가?", ["hallucination", "grounding", "source", "verification"], "답변 하나에서 사실, 해석, 확인이 필요한 문장을 나눈다.", "fact-check checklist", "Foundation Explainer", ["왜 틀리는가", "검증 절차", "Q&A"], ["https://arxiv.org/abs/2309.07864"]),
  makeLesson("M01-W01-D7", "1", "1주차 복습: LLM에게 질문이 들어가면", "이번 주 개념만으로 질문에서 답변까지의 흐름을 설명할 수 있는가?", ["prompt", "token", "probability", "sampling", "verification"], "A4 한 장에 질문-토큰-후보-답변-검증 흐름을 정리한다.", "week-one concept map", "Mechanism Walkthrough", ["흐름", "용어 복습", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D1", "2", "embedding: token을 숫자로 바꾸는 법", "단어를 숫자 벡터로 바꾸면 LLM은 무엇을 할 수 있게 되는가?", ["embedding", "vector", "dimension", "similarity"], "세 단어를 2차원 점으로 가정하고 가까움의 의미를 설명한다.", "toy vector map", "Foundation Explainer", ["직관", "작은 예시", "한계", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D2", "2", "attention의 직관", "문장 안에서 지금 필요한 단어를 찾는 attention은 무엇을 하는가?", ["query", "key", "value", "attention weight"], "대명사가 가리키는 대상을 찾는 문장 예시를 만든다.", "attention lookup sketch", "Mechanism Walkthrough", ["문제", "Q/K/V 직관", "예시", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D3", "2", "multi-head attention과 여러 관점", "attention head가 여러 개면 무엇이 달라지고, 무엇을 과장하면 안 되는가?", ["head", "representation", "projection", "parallel views"], "문장 하나에서 문법과 의미라는 두 관점을 구분한다.", "multi-head concept diagram", "Foundation Explainer", ["직관", "역할", "오해", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D4", "2", "MLP, residual, layer norm의 큰 그림", "attention 외의 구성 요소는 Transformer block에서 어떤 역할을 하는가?", ["MLP", "residual connection", "layer normalization", "Transformer block"], "block을 attention, MLP, 연결선 세 부분으로 나누어 설명한다.", "Transformer block overview", "Mechanism Walkthrough", ["부품", "순서", "왜 필요한가", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D5", "2", "학습과 추론은 무엇이 다른가", "모델이 배울 때와 사용자가 답을 받을 때는 데이터와 비용이 어떻게 다른가?", ["dataset", "loss", "gradient", "training", "inference"], "시험 공부와 시험 문제 풀이의 비유로 두 단계를 구분한다.", "training-vs-inference table", "Interface Comparison", ["목적", "입력/출력", "비용", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M01-W02-D6", "2", "fine-tuning과 RAG의 차이", "지식을 바꾸는 방법과 문서를 찾아 답하게 하는 방법은 언제 각각 적합한가?", ["fine-tuning", "retrieval", "RAG", "knowledge"], "사내 규정 검색이라는 가상 사례의 선택 기준을 쓴다.", "adaptation options table", "Interface Comparison", ["문제", "두 방법", "선택 기준", "Q&A"], ["https://arxiv.org/abs/2005.11401"]),
  makeLesson("M01-W02-D7", "2", "2주차 복습: 작은 Transformer 설명하기", "embedding부터 다음 token 선택까지를 큰 그림으로 설명할 수 있는가?", ["embedding", "attention", "MLP", "training", "inference"], "새로 배운 사람에게 5분 설명을 한다고 가정해 개요를 쓴다.", "Transformer learning map", "Mechanism Walkthrough", ["큰 그림", "용어", "Q&A"], ["https://arxiv.org/abs/1706.03762"]),
  makeLesson("M02-W03-D1", "3", "bit, byte, 주소: 데이터의 기본 단위", "컴퓨터는 데이터를 어떤 단위와 주소로 다루는가?", ["bit", "byte", "KB/MB/GB", "address"], "1 GiB와 1 GB의 차이를 포함한 단위 표를 만든다.", "data-unit ladder", "Foundation Explainer", ["단위", "주소", "예시", "Q&A"], ["https://en.wikipedia.org/wiki/Byte"]),
  makeLesson("M02-W03-D2", "3", "CPU, GPU, accelerator는 무엇이 다른가", "서로 다른 연산 장치는 어떤 종류의 일을 잘하는가?", ["CPU", "GPU", "parallelism", "accelerator"], "문서 편집, 이미지 처리, 행렬 곱을 각 장치 관점에서 비교한다.", "processor-role comparison", "Foundation Explainer", ["역할", "병렬성", "선택", "Q&A"], ["https://developer.nvidia.com/blog/what-is-gpu-accelerated-computing/"]),
  makeLesson("M02-W03-D3", "3", "저장 계층: register부터 SSD까지", "빠르고 작은 기억장치와 느리고 큰 기억장치는 왜 함께 필요한가?", ["register", "cache", "DRAM", "SSD", "memory hierarchy"], "자주 쓰는 물건을 책상, 서랍, 창고에 두는 비유의 한계를 함께 적는다.", "memory hierarchy diagram", "Foundation Explainer", ["계층", "속성", "비유와 한계", "Q&A"], ["https://www.kernel.org/doc/html/latest/admin-guide/mm/index.html"]),
  makeLesson("M02-W03-D4", "3", "latency, bandwidth, capacity를 구분하기", "빠르다는 말은 지연 시간, 대역폭, 용량 중 무엇을 말하는가?", ["latency", "bandwidth", "capacity", "throughput"], "수도관과 배달 시간 비유로 세 축을 비교한다.", "three-metrics comparison table", "Foundation Explainer", ["세 축", "비유", "예시", "Q&A"], ["https://people.inf.ethz.ch/omutlu/pub/Memory-Scaling-Problem_isca12.pdf"]),
  makeLesson("M02-W03-D5", "3", "cache와 locality", "가까운 데이터를 다시 쓰면 왜 빨라지고, 어떤 접근은 왜 느려지는가?", ["cache hit", "cache miss", "temporal locality", "spatial locality"], "순차 배열 접근과 랜덤 접근을 말로 비교한다.", "locality examples", "Mechanism Walkthrough", ["cache 흐름", "두 접근", "Q&A"], ["https://www.kernel.org/doc/html/latest/admin-guide/mm/index.html"]),
  makeLesson("M02-W03-D6", "3", "virtual memory의 큰 그림", "프로그램이 보는 주소와 실제 DRAM 주소는 왜 다를 수 있는가?", ["virtual address", "page", "page table", "TLB"], "방 번호와 실제 건물 위치라는 비유로 주소 변환을 설명한다.", "address translation sketch", "Mechanism Walkthrough", ["문제", "변환", "왜 필요한가", "Q&A"], ["https://www.kernel.org/doc/html/latest/admin-guide/mm/index.html"]),
  makeLesson("M02-W03-D7", "3", "3주차 복습: 데이터는 어디에 머무는가", "LLM의 한 token이 만들기까지 어떤 저장 계층을 지나갈 수 있는가?", ["CPU", "GPU", "cache", "DRAM", "storage"], "질문 입력부터 accelerator까지의 개념적 경로를 그린다.", "data location map", "System Path", ["구성 요소", "경로", "Q&A"], ["https://www.kernel.org/doc/html/latest/admin-guide/mm/index.html"]),
  makeLesson("M02-W04-D1", "4", "DRAM은 무엇을 하는가", "DRAM은 저장 계층에서 어떤 역할을 하고, 왜 cache나 SSD를 대체하지 않는가?", ["DRAM", "volatile memory", "capacity", "main memory"], "cache, DRAM, SSD의 역할을 한 표에 정리한다.", "cache-dram-ssd table", "Foundation Explainer", ["역할", "비교", "Q&A"], ["https://www.jedec.org/standards-documents/dictionary/terms/dynamic-random-access-memory-dram"]),
  makeLesson("M02-W04-D2", "4", "DDR, GDDR, HBM은 왜 다른가", "서버, GPU, 모바일은 왜 서로 다른 메모리 인터페이스를 쓰는가?", ["DDR", "GDDR", "HBM", "bus width", "bandwidth"], "세 인터페이스를 사용 환경과 큰 특징으로만 비교한다.", "memory-interface overview", "Interface Comparison", ["사용 환경", "비교 축", "선택", "Q&A"], ["https://www.jedec.org/standards-documents/technology-focus-areas/hbm"]),
  makeLesson("M02-W04-D3", "4", "LLM 모델은 메모리에 무엇을 올리는가", "응답을 만들기 전에 모델은 어떤 데이터 구조를 메모리에 두는가?", ["parameter", "weight", "activation", "KV cache"], "책, 메모장, 작업 중 종이에 비유하되 비유의 한계를 쓴다.", "LLM memory residents", "Foundation Explainer", ["구성 요소", "역할", "Q&A"], ["https://arxiv.org/abs/2309.06180"]),
  makeLesson("M02-W04-D4", "4", "prefill과 decode: LLM 응답의 두 단계", "질문을 읽는 단계와 한 token씩 생성하는 단계는 어떤 차이가 있는가?", ["prefill", "decode", "TTFT", "TPOT"], "짧은 prompt와 긴 prompt의 사용자 체감 차이를 시간축으로 설명한다.", "prefill-decode timeline", "Mechanism Walkthrough", ["두 단계", "사용자 체감", "Q&A"], ["https://arxiv.org/abs/2309.06180"]),
  makeLesson("M02-W04-D5", "4", "weight와 KV cache의 역할", "weight와 KV cache는 모두 메모리를 쓰지만 무엇이 다르고 무엇이 context에 따라 변하는가?", ["weight", "KV cache", "context length", "batch"], "고정된 가방과 대화 중 쌓이는 메모라는 비유를 비교한다.", "weight-versus-kv table", "Interface Comparison", ["두 데이터", "언제 커지는가", "Q&A"], ["https://arxiv.org/abs/2309.06180"]),
  makeLesson("M02-W04-D6", "4", "첫 KV cache 용량 계산", "아주 작은 가정으로 context와 batch가 메모리에 미치는 영향을 어떻게 계산할 수 있는가?", ["layer", "head", "head dimension", "dtype", "batch"], "toy model의 KV cache 크기를 단계별로 계산하고 가정을 명시한다.", "KV cache calculation table", "Quantitative Note", ["질문", "가정", "계산", "해석", "Q&A"], ["https://arxiv.org/abs/2309.06180"]),
  makeLesson("M02-W04-D7", "4", "4주차 종합: LLM, 메모리, 시스템을 처음 연결하기", "지금까지 배운 기초만으로 LLM 응답 생성의 데이터와 메모리 경로를 어떻게 설명할 수 있는가?", ["LLM", "Transformer", "memory hierarchy", "DRAM", "weight", "KV cache"], "한 장의 시스템 지도로 개념과 아직 모르는 부분을 구분한다.", "beginner LLM-memory-system map", "System Path", ["구성 요소", "경로", "조건", "Q&A"], ["https://arxiv.org/abs/1706.03762", "https://arxiv.org/abs/2309.06180"]),
];

export const studyRhythm = [
  ["Foundation", "새 개념의 목적과 큰 그림을 먼저 잡는다."],
  ["Mechanism", "입력에서 출력까지의 작동 흐름을 따라간다."],
  ["Vocabulary", "핵심 용어와 구분 기준을 자기 말로 정리한다."],
  ["Connection", "앞서 배운 개념 두 개를 연결한다."],
  ["Comparison", "비슷한 개념이나 설계 선택지를 비교한다."],
  ["Practice", "필요할 때만 작은 계산, 표, 실험, 다이어그램으로 감각을 만든다."],
  ["Synthesis", "앞선 개념을 질문과 답변 중심으로 복습한다."],
];
