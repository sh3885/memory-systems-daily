const dailyLessons = [
  {
    ref: "M01-W01-D1",
    title: "LLM은 무엇이고 왜 필요한가",
    coreQuestion: "검색, 규칙 기반 프로그램, LLM은 무엇이 다르고 LLM은 어디에 잘 맞는가?",
    concepts: ["generative AI", "LLM", "model", "training", "inference"],
    practice: "익숙한 업무 하나를 골라 규칙 기반 처리와 LLM 처리를 비교한다.",
    artifact: "LLM input-output overview",
    theme: "LLM",
    postType: "Foundation Explainer",
    postSections: ["왜 필요한가", "핵심 용어", "작은 예시", "질문과 답변"],
    sourceHints: ["https://arxiv.org/abs/2005.14165"],
  },
  {
    ref: "M01-W01-D2",
    title: "다음 token 예측이라는 한 문장",
    coreQuestion: "LLM은 왜 다음 token 예측으로 문장, 코드, 요약을 만들 수 있는가?",
    concepts: ["token", "next-token prediction", "probability", "generation"],
    practice: "짧은 문장의 다음 단어 후보 세 개를 확률이라는 말로 설명한다.",
    artifact: "next-token probability sketch",
    theme: "LLM",
    postType: "Foundation Explainer",
    postSections: ["한 문장 결론", "직관", "예시", "질문과 답변"],
    sourceHints: ["https://arxiv.org/abs/1706.03762"],
  },
  {
    ref: "M01-W01-D3",
    title: "token은 단어와 어떻게 다른가",
    coreQuestion: "LLM은 문장을 어떤 작은 조각으로 나누고, 그 차이가 왜 중요한가?",
    concepts: ["tokenizer", "vocabulary", "token length", "context"],
    practice: "한국어 문장 하나를 token 수가 달라질 수 있다는 관점에서 관찰한다.",
    artifact: "text-to-token example table",
    theme: "LLM",
    postType: "Foundation Explainer",
    postSections: ["용어", "예시", "오해", "질문과 답변"],
    sourceHints: ["https://huggingface.co/docs/transformers/tokenizer_summary"],
  },
  {
    ref: "M01-W01-D4",
    title: "확률, logit, sampling의 역할",
    coreQuestion: "LLM은 후보 중 하나를 어떻게 고르며 매번 같은 답을 하지 않을 수 있는가?",
    concepts: ["logit", "softmax", "temperature", "sampling"],
    practice: "날씨 예측 확률처럼 세 후보를 놓고 temperature의 직관을 설명한다.",
    artifact: "candidate probability table",
    theme: "LLM",
    postType: "Mechanism Walkthrough",
    postSections: ["입력", "후보 점수", "선택", "질문과 답변"],
    sourceHints: ["https://arxiv.org/abs/1706.03762"],
  },
  {
    ref: "M01-W01-D5",
    title: "prompt와 context window",
    coreQuestion: "질문을 잘 쓰는 일과 context window는 LLM의 답변에 어떤 영향을 주는가?",
    concepts: ["prompt", "system prompt", "context window", "instruction"],
    practice: "좋지 않은 질문과 개선한 질문을 한 쌍 만든다.",
    artifact: "prompt-to-response flow",
    theme: "LLM",
    postType: "Foundation Explainer",
    postSections: ["개념", "전후 예시", "제약", "질문과 답변"],
    sourceHints: ["https://platform.openai.com/docs/guides/text"],
  },
  {
    ref: "M01-W01-D6",
    title: "LLM 답변은 왜 틀릴 수 있는가",
    coreQuestion: "그럴듯한 문장이 사실과 다를 수 있는 이유와 검증 방법은 무엇인가?",
    concepts: ["hallucination", "grounding", "source", "verification"],
    practice: "답변 하나에서 사실, 해석, 확인이 필요한 문장을 나눈다.",
    artifact: "fact-check checklist",
    theme: "LLM",
    postType: "Foundation Explainer",
    postSections: ["왜 틀리는가", "검증 절차", "질문과 답변"],
    sourceHints: ["https://arxiv.org/abs/2309.07864"],
  },
  {
    ref: "M01-W01-D7",
    title: "1주차 복습: LLM에게 질문이 들어가면",
    coreQuestion: "이번 주 개념만으로 질문에서 답변까지의 흐름을 설명할 수 있는가?",
    concepts: ["prompt", "token", "probability", "sampling", "verification"],
    practice: "A4 한 장에 질문-토큰-후보-답변-검증 흐름을 정리한다.",
    artifact: "week-one concept map",
    theme: "LLM",
    postType: "Mechanism Walkthrough",
    postSections: ["흐름", "용어 복습", "질문과 답변"],
    sourceHints: ["https://arxiv.org/abs/1706.03762"],
  },
];

const curriculumSequence = [
  "M01-W01-D1", "M01-W01-D2", "M01-W01-D3", "M01-W01-D4", "M01-W01-D5", "M01-W01-D6", "M01-W01-D7",
  "M01-W02-D1", "M01-W02-D2", "M01-W02-D3", "M01-W02-D4", "M01-W02-D5", "M01-W02-D6", "M01-W02-D7",
  "M02-W03-D1", "M02-W03-D2", "M02-W03-D3", "M02-W03-D4", "M02-W03-D5", "M02-W03-D6", "M02-W03-D7",
  "M02-W04-D1", "M02-W04-D2", "M02-W04-D3", "M02-W04-D4", "M02-W04-D5", "M02-W04-D6", "M02-W04-D7",
];

const qualityGate = [
  "독자가 실제로 궁금해할 질문 하나에 답한다.",
  "새 용어는 처음 등장할 때 쉬운 말로 짧게 정의한다.",
  "계산, 표, 실험, 다이어그램은 설명을 더 좋게 할 때만 선택한다.",
  "표준, 제품, 논문, 벤치마크에 관한 중요한 사실은 public source 후보와 연결한다.",
  "확정 사실, 개인 해석, 추정을 구분한다.",
  "마지막에 자주 나올 질문과 답변을 최소 두 개 넣는다.",
];

export function findDailyLesson(curriculumRef) {
  const normalized = String(curriculumRef ?? "").trim();
  return dailyLessons.find((lesson) => lesson.ref === normalized) ?? null;
}

export function nextCurriculumRef(curriculumRef) {
  const index = curriculumSequence.indexOf(String(curriculumRef ?? "").trim());
  return curriculumSequence[index + 1] ?? null;
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildArtifactScaffold(lesson) {
  const postType = lesson?.postType ?? "Foundation Explainer";
  const artifact = lesson?.artifact ?? "the smallest helpful example, table, or diagram";
  return [
    "글 구성 원칙:",
    "",
    `- 권장 글 유형: ${postType}`,
    `- 도움이 될 수 있는 산출물: ${artifact}`,
    "- 이 산출물은 의무가 아니다. 글의 핵심을 더 분명하게 만들 때만 사용한다.",
    "- 계산을 넣는다면 가정, 단위, 식, 결과, 적용 한계를 함께 쓴다.",
    "- 다이어그램을 넣는다면 독자가 글만으로 이해하기 어려운 흐름이나 관계를 보여 줄 때만 넣는다.",
    "- 마지막에는 '자주 나올 질문과 답변'을 두 개 이상 넣는다.",
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
        "- 상세 lesson은 아직 자동 프롬프트 목록에 없다. 아래 품질 원칙을 따르되, 주제를 처음 배우는 사람이 이해할 수 있는 글로 작성한다.",
        "",
        "품질 원칙:",
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
      `- 주제 축(category): ${lesson.theme}`,
      `- 핵심 질문: ${lesson.coreQuestion}`,
      "- 핵심 개념:",
      markdownList(lesson.concepts),
      `- 작은 연습: ${lesson.practice}`,
      "- 권장 글 섹션:",
      markdownList(lesson.postSections),
      "- public source 후보:",
      markdownList(lesson.sourceHints),
      "",
      "품질 원칙:",
      markdownList(qualityGate),
      "- 글 frontmatter의 category는 위 주제 축 하나를 그대로 사용한다. 다른 축은 tags로 연결한다.",
      "",
      buildArtifactScaffold(lesson),
    ].join("\n"),
  };
}
