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
    title: "LLM과 메모리 시스템의 공통 언어",
    question: "다음 token을 만드는 일이 왜 곧 데이터 이동 문제가 되는가?",
    topics: ["Token/embedding/logit", "Transformer block", "Weight read", "Activation과 KV cache"],
    lab: "작은 문장을 token으로 나누고, single-head attention의 tensor shape와 byte traffic을 계산한다.",
    outcome: "LLM 추론을 compute, memory capacity, memory bandwidth 관점으로 분해한다.",
    color: "green",
  },
  {
    index: "02",
    weeks: "3-5주",
    title: "CPU에서 DRAM까지 가는 길",
    question: "프로그램의 load/store는 어떤 계층을 지나 DRAM 명령이 되는가?",
    topics: ["ISA와 load/store", "Cache hierarchy", "TLB와 page table", "NUMA와 memory latency"],
    lab: "lscpu, /proc, perf, stride benchmark로 latency cliff와 cache miss를 관찰한다.",
    outcome: "CPU core에서 DRAM channel까지의 요청 경로를 말로 그리고 측정값으로 설명한다.",
    color: "blue",
  },
  {
    index: "03",
    weeks: "6-8주",
    title: "DRAM 구조와 메모리 컨트롤러",
    question: "주소 하나는 channel, rank, bank, row, column으로 어떻게 펼쳐지는가?",
    topics: ["DRAM cell/array", "Row buffer", "Address mapping", "Scheduling, refresh, ECC/RAS"],
    lab: "stride, working set, bank conflict 패턴을 바꿔 row locality와 병렬성을 비교한다.",
    outcome: "소프트웨어 접근 패턴을 DRAM 내부 동작과 병목으로 번역한다.",
    color: "amber",
  },
  {
    index: "04",
    weeks: "9-11주",
    title: "DDR, LPDDR, GDDR, HBM 인터페이스",
    question: "서버, 모바일, GPU는 왜 서로 다른 DRAM 인터페이스를 쓰는가?",
    topics: ["Signaling과 channel width", "Bandwidth와 capacity", "Power와 form factor", "Package와 thermal limit"],
    lab: "공개 datasheet 수준의 수치로 capacity, bandwidth, power trade-off 표를 만든다.",
    outcome: "메모리 제품을 규격 나열이 아니라 시스템 선택지로 비교한다.",
    color: "red",
  },
  {
    index: "05",
    weeks: "12-14주",
    title: "GPU와 AI accelerator 메모리 계층",
    question: "수천 개 연산기에 데이터를 굶기지 않으려면 무엇이 필요한가?",
    topics: ["GPU memory hierarchy", "SM/CU와 warp/wavefront", "Tensor core dataflow", "Roofline model"],
    lab: "GEMM, element-wise, attention kernel의 arithmetic intensity를 계산하고 roofline에 찍는다.",
    outcome: "연산 병목과 HBM 병목을 같은 모델 위에서 구분한다.",
    color: "green",
  },
  {
    index: "06",
    weeks: "15-17주",
    title: "LLM 학습: 파라미터보다 큰 메모리",
    question: "학습에서는 weight 말고 어떤 tensor들이 메모리를 차지하는가?",
    topics: ["Pretraining과 scaling law", "Gradient/optimizer state", "Activation checkpointing", "Data/model/pipeline parallel"],
    lab: "모델 크기와 precision별로 weight, gradient, optimizer, activation 메모리를 추산한다.",
    outcome: "LLM 학습 메모리 요구량을 구성 요소별로 계산하고 절감 기법의 의미를 설명한다.",
    color: "blue",
  },
  {
    index: "07",
    weeks: "18-20주",
    title: "LLM 추론과 serving 병목",
    question: "decode 단계는 왜 batch, context, KV cache에 민감한가?",
    topics: ["Prefill과 decode", "KV cache", "TTFT/TPOT/throughput", "Quantization, FlashAttention, PagedAttention"],
    lab: "모델 크기, context length, batch별 KV cache 용량과 bandwidth 요구량을 계산한다.",
    outcome: "LLM latency와 throughput을 capacity, bandwidth, scheduling 관점으로 설명한다.",
    color: "amber",
  },
  {
    index: "08",
    weeks: "21-23주",
    title: "분산 AI 시스템과 interconnect",
    question: "GPU 여러 개를 묶으면 병목은 memory에서 fabric으로 어떻게 이동하는가?",
    topics: ["Tensor/expert/pipeline parallel", "All-reduce와 collective", "NVLink/PCIe/Ethernet", "Scale-up과 scale-out"],
    lab: "간단한 communication volume 모델로 tensor parallel과 expert parallel의 traffic을 비교한다.",
    outcome: "AI 시스템 병목을 HBM, PCIe, fabric, host memory 사이에서 위치시킨다.",
    color: "red",
  },
  {
    index: "09",
    weeks: "24-26주",
    title: "I/O, storage, network와 메모리",
    question: "NIC와 SSD의 데이터는 DRAM을 몇 번 통과하는가?",
    topics: ["DMA와 IOMMU", "Page cache와 direct I/O", "Queue와 interrupt", "RDMA와 GPUDirect"],
    lab: "fio와 iperf 결과를 queue depth, block size, CPU overhead, copy path로 해석한다.",
    outcome: "I/O 요청의 복사, 대기, interrupt 비용을 데이터 경로로 찾아낸다.",
    color: "green",
  },
  {
    index: "10",
    weeks: "27-29주",
    title: "CXL과 memory disaggregation",
    question: "메모리를 CPU 밖에 두면 capacity 이득과 latency 비용은 어떻게 균형 잡히는가?",
    topics: ["CXL.io/cache/mem", "Expansion, pooling, sharing", "Tiering과 hot/cold data", "UCIe와 chiplet"],
    lab: "NUMA 원격 메모리를 CXL tier처럼 가정하고 hit ratio별 평균 latency를 계산한다.",
    outcome: "CXL을 단순 확장 규격이 아니라 placement와 QoS 문제로 이해한다.",
    color: "blue",
  },
  {
    index: "11",
    weeks: "30-32주",
    title: "차세대 메모리와 near-data compute",
    question: "어떤 workload에서 데이터 이동을 줄이는 것이 셀 특성보다 중요한가?",
    topics: ["PIM과 near-memory computing", "CIM 개념", "MRAM/ReRAM/PCM", "Endurance, density, energy"],
    lab: "후보 기술을 latency, bandwidth, density, energy, endurance 축으로 비교 매트릭스화한다.",
    outcome: "새 메모리 기술을 workload 요구사항과 제품 제약으로 평가한다.",
    color: "amber",
  },
  {
    index: "12",
    weeks: "33-36주",
    title: "최신 LLM 트렌드와 memory-compute co-design",
    question: "MoE, long context, agent workload는 다음 메모리 요구사항을 어떻게 바꾸는가?",
    topics: ["MoE와 routing", "MLA/GQA/MQA", "Long context와 retrieval", "Disaggregated serving"],
    lab: "하나의 AI 서비스 시나리오를 골라 compute, HBM, DRAM, CXL, network 요구사항을 제안한다.",
    outcome: "workload에서 시스템 요구사항, 그리고 메모리 제품 관점까지 이어지는 설명을 만든다.",
    color: "red",
  },
];

export const weeklyRhythm = [
  ["MON", "LLM Core", "개념과 용어를 정리하고 작은 숫자 예제로 이해한다."],
  ["TUE", "Memory Path", "CPU/GPU에서 DRAM/HBM까지 데이터 이동 경로를 추적한다."],
  ["WED", "Math/Code", "tensor shape, byte traffic, latency/bandwidth 계산을 직접 해본다."],
  ["THU", "Interface", "DDR, HBM, CXL, PCIe, fabric을 시스템 선택지로 비교한다."],
  ["FRI", "Trend Radar", "최신 논문, 벤더 문서, 표준 문서를 public source 기준으로 읽는다."],
  ["SAT", "Experiment", "작은 측정이나 spreadsheet 모델을 만들고 재현 가능한 조건을 남긴다."],
  ["SUN", "Synthesis", "한 주의 내용을 하나의 데이터 경로와 병목 이야기로 연결한다."],
];
