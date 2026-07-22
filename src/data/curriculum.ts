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

export const curriculum: CurriculumModule[] = [
  {
    index: "01",
    weeks: "1-2주",
    title: "컴퓨터 시스템의 언어",
    question: "프로그램의 한 줄은 하드웨어에서 어떻게 실행되는가?",
    topics: ["ISA와 명령 실행", "파이프라인과 병렬성", "Linux 관측 도구", "성능·전력·비용의 균형"],
    lab: "lscpu, /proc, perf로 내 시스템의 실행 경로 그리기",
    outcome: "CPU에서 DRAM까지의 데이터 경로를 설명한다.",
    color: "green",
  },
  {
    index: "02",
    weeks: "3-5주",
    title: "캐시·가상메모리·NUMA",
    question: "같은 DRAM인데 접근 시간은 왜 달라지는가?",
    topics: ["캐시 계층과 지역성", "TLB와 페이지 테이블", "Prefetch", "NUMA와 메모리 배치"],
    lab: "배열 크기·stride·스레드 수를 바꿔 latency cliff 측정",
    outcome: "Latency와 bandwidth 병목을 실험으로 구분한다.",
    color: "blue",
  },
  {
    index: "03",
    weeks: "6-8주",
    title: "DRAM과 메모리 컨트롤러",
    question: "요청은 Channel·Rank·Bank·Row에 어떻게 배치되는가?",
    topics: ["DRAM cell과 array", "Row buffer", "Address mapping", "Scheduling·Refresh·ECC·RAS"],
    lab: "순차·랜덤·bank conflict 접근의 처리량 비교",
    outcome: "워크로드 패턴을 DRAM 명령과 타이밍으로 번역한다.",
    color: "amber",
  },
  {
    index: "04",
    weeks: "9-11주",
    title: "DDR·LPDDR·GDDR·HBM",
    question: "서버·모바일·GPU는 왜 서로 다른 메모리를 선택하는가?",
    topics: ["Interface와 signaling", "채널 폭과 속도", "전력·용량·대역폭", "패키징과 열"],
    lab: "공개 사양으로 플랫폼별 capacity·bandwidth·power 예산표 작성",
    outcome: "규격표가 아닌 시스템 trade-off로 제품을 비교한다.",
    color: "red",
  },
  {
    index: "05",
    weeks: "12-14주",
    title: "LLM 기초와 Transformer",
    question: "문장은 어떻게 token과 tensor를 거쳐 다음 단어가 되는가?",
    topics: ["Tokenizer·Embedding", "Logit·Softmax·Sampling", "Q/K/V와 Attention", "FFN·Residual·RMSNorm·RoPE"],
    lab: "작은 tokenizer와 single-head attention을 직접 계산하고 구현",
    outcome: "Transformer의 각 tensor shape와 메모리 사용량을 계산한다.",
    color: "green",
  },
  {
    index: "06",
    weeks: "15-17주",
    title: "LLM 학습·정렬·평가",
    question: "데이터와 compute budget은 모델 성능을 어떻게 결정하는가?",
    topics: ["Pretraining과 scaling law", "Optimizer와 precision", "SFT·RLHF·DPO", "평가·Hallucination·Safety"],
    lab: "소형 모델 fine-tuning 결과와 학습 메모리 구성요소 분석",
    outcome: "Weight·gradient·optimizer state·activation 비용을 분해한다.",
    color: "blue",
  },
  {
    index: "07",
    weeks: "18-20주",
    title: "LLM 추론과 서빙",
    question: "왜 decode는 계산보다 메모리 이동에 민감한가?",
    topics: ["Prefill·Decode", "KV Cache", "Batching·TTFT·TPOT", "Quantization·PagedAttention·FlashAttention"],
    lab: "모델·context·batch별 KV Cache와 요구 bandwidth 계산",
    outcome: "LLM latency와 throughput을 capacity·bandwidth 모델로 설명한다.",
    color: "amber",
  },
  {
    index: "08",
    weeks: "21-23주",
    title: "GPU·가속기·분산 AI",
    question: "수천 개의 연산기에 데이터를 어떻게 공급하는가?",
    topics: ["GPU memory hierarchy", "Roofline", "Tensor·Pipeline·Expert Parallel", "Scale-up·Scale-out fabric"],
    lab: "Matmul과 element-wise kernel의 arithmetic intensity 비교",
    outcome: "Compute·HBM·interconnect 병목을 하나의 모델로 분석한다.",
    color: "red",
  },
  {
    index: "09",
    weeks: "24-26주",
    title: "네트워크·스토리지·데이터 이동",
    question: "NIC와 SSD의 데이터는 DRAM을 몇 번 통과하는가?",
    topics: ["DMA와 IOMMU", "Queue·Interrupt", "Page cache·Direct I/O", "RDMA·GPUDirect"],
    lab: "fio·iperf로 queue depth, block size, CPU 비용 관측",
    outcome: "I/O 요청의 복사와 대기 비용을 데이터 경로로 찾는다.",
    color: "green",
  },
  {
    index: "10",
    weeks: "27-29주",
    title: "CXL·메모리 계층화·Chiplet",
    question: "메모리를 CPU 밖에 놓으면 누가 배치와 일관성을 책임지는가?",
    topics: ["CXL.io·cache·mem", "Expansion·Pooling·Sharing", "Tiering과 hot/cold data", "UCIe와 die-to-die"],
    lab: "NUMA로 원격 메모리를 근사하고 tiering 정책 비교",
    outcome: "용량 확장과 지연 증가의 손익분기점을 계산한다.",
    color: "blue",
  },
  {
    index: "11",
    weeks: "30-32주",
    title: "차세대 메모리와 Near-Data Compute",
    question: "새 메모리는 어떤 데이터 이동을 없애야 가치가 있는가?",
    topics: ["Persistent·Storage-class memory", "PIM·CIM", "MRAM·ReRAM·PCM", "내구성·일관성·복구"],
    lab: "후보 기술을 latency·BW·density·energy·endurance 축으로 평가",
    outcome: "기술 특성을 시스템 요구사항과 연결한다.",
    color: "amber",
  },
  {
    index: "12",
    weeks: "33-36주",
    title: "최신 트렌드와 시스템 종합",
    question: "다음 병목은 메모리, 연결망, 소프트웨어 중 어디에 생기는가?",
    topics: ["MoE·MLA·Reasoning", "Long context·Agent", "Disaggregated serving", "Memory-compute co-design"],
    lab: "AI·서버·모바일 중 하나의 차세대 메모리 아키텍처 제안",
    outcome: "워크로드에서 제품 요구사항까지 일관된 설계 논리를 만든다.",
    color: "red",
  },
];

export const weeklyRhythm = [
  ["MON", "LLM 개념", "원리와 용어를 정확히 익힌다"],
  ["TUE", "Memory Systems", "CPU에서 DRAM까지의 경로를 추적한다"],
  ["WED", "수식·코드", "Tensor shape 또는 작은 구현을 만든다"],
  ["THU", "Interface", "DDR·HBM·CXL을 시스템 선택으로 읽는다"],
  ["FRI", "Trend Radar", "최신 논문을 검증 상태와 함께 읽는다"],
  ["SAT", "실험", "측정 조건과 결과를 재현 가능하게 남긴다"],
  ["SUN", "Synthesis", "한 주의 개념을 하나의 데이터 경로로 연결한다"],
];
