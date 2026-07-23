import { buildDailyLessonPromptContext, nextCurriculumRef } from "../content/daily-lesson-prompts.mjs";
import { assertDraftContent, DraftQualityError } from "../content/draft-quality.mjs";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "../scheduler/daily-lesson-scheduler.mjs";
import { StoreError } from "../storage/d1-lesson-store.mjs";

export class LessonRouterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LessonRouterError";
    this.code = code;
    this.details = details;
  }
}

const HELP_TEXT = [
  "사용 가능한 명령:",
  "/today - 오늘 lesson과 현재 초안 미리보기",
  "/lessons - 오늘 열어 둔 lesson 목록과 현재 선택 확인",
  "/next - 다음 커리큘럼 주제를 오늘의 추가 lesson으로 열기",
  "/use <ref> - 오늘 열린 특정 lesson을 현재 작업 대상으로 선택",
  "/status - 글 작성, 승인, 웹 반영 상태 확인",
  "/prompt - 오늘 lesson 기반 Claude 웹용 초안 프롬프트 생성",
  "/draft <Markdown> - Claude 웹 결과를 현재 lesson의 새 revision으로 저장",
  "/revise <요청> - 현재 draft를 고치기 위한 Claude 웹용 수정 프롬프트 생성",
  "/review - 최신 revision을 검토 상태로 바꾸고 승인 버튼 받기",
  "/publish-retry - GitHub 글 생성, Pages 배포 확인, 웹 반영 재시도",
  "/deploy-retry - /publish-retry와 동일",
  "/verify-url - /publish-retry와 동일. 실제 URL 본문 검증까지 수행",
  "/ask-api <질문> - 이번 질문만 Claude API로 답변",
  "/revise-api <요청> - 이번 수정만 Claude API로 revision 저장",
  "/help 또는 /commands - 이 도움말 보기",
  "",
  "기본은 manual mode야. /prompt -> Claude 웹 -> /draft -> /review -> 승인 버튼 순서로 쓰면 돼.",
].join("\n");

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new LessonRouterError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function getMessageText(update) {
  return String(update?.message?.text ?? update?.message?.caption ?? "").trim();
}

function preview(text, maxLength = 1800) {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 20).trimEnd()}\n\n...[truncated]`;
}

function extractCommand(text) {
  if (!text.startsWith("/")) return null;
  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();
  return { command, argument: rest.join(" ").trim() };
}

function getMessageDocument(update) {
  return update?.message?.document ?? null;
}

function isMarkdownDocument(document) {
  const fileName = String(document?.file_name ?? "").trim().toLowerCase();
  const mimeType = String(document?.mime_type ?? "").trim().toLowerCase();
  return fileName.endsWith(".md") || fileName.endsWith(".markdown") || mimeType === "text/markdown" || mimeType === "text/plain";
}

function normalizeMode(value) {
  const normalized = String(value ?? "manual").trim().toLowerCase();
  if (!["manual", "hybrid", "api"].includes(normalized)) {
    throw new LessonRouterError("INVALID_MODE", "aiMode must be manual, hybrid, or api", { aiMode: value });
  }
  return normalized;
}

function approvalKeyboard({ challengeId, token }) {
  requireText(challengeId, "challengeId");
  const callbackData = `approve:${requireText(token, "token")}`;
  if (new TextEncoder().encode(callbackData).length > 64) {
    throw new LessonRouterError("CALLBACK_DATA_TOO_LONG", "Approval callback data exceeds Telegram's 64-byte limit", {
      challengeId,
    });
  }
  return {
    inline_keyboard: [[
      { text: "승인하고 게시", callback_data: callbackData },
    ]],
  };
}

function lessonPromptContext(lesson) {
  return buildDailyLessonPromptContext({ curriculumRef: lesson?.curriculumRef });
}

function buildDraftPrompt({ lessonDate, lesson }) {
  const context = lessonPromptContext(lesson);
  return [
    "아래 지시를 따라 오늘 블로그 초안을 작성해줘.",
    "",
    "[복사 시작]",
    "너는 LLM, 메모리, 컴퓨터 시스템을 공개 출처 기반으로 설명하는 한국어 기술 튜터다.",
    "나는 메모리 시스템을 깊게 이해하려는 엔지니어이고, 공개 출처 기반의 학습 블로그를 작성하려고 한다.",
    "",
    `오늘 날짜: ${lessonDate}`,
    `커리큘럼 ref: ${lesson?.curriculumRef ?? "아직 미정"}`,
    "",
    context.text,
    "",
    "작성 규칙:",
    "1. 한국어 Markdown 블로그 초안을 작성한다.",
    "2. 오늘의 주제 축(category)을 하나만 frontmatter에 넣고, 다른 축은 tags로 연결한다. 오늘 권장 글 유형과 섹션을 따른다. 관련 없는 memory 병목이나 시스템 설명을 억지로 넣지 않는다.",
    "3. 계산, 표, 실험, 다이어그램은 위의 산출물 선택 기준을 통과할 때만 넣는다.",
    "4. 확정 사실, 해석, 추정을 분리한다.",
    "5. public source 후보와 내 해석을 구분해서 쓴다.",
    "6. 마지막에 자주 나올 질문과 답변을 최소 두 개 넣고, 중요한 사실은 claim ledger에 정리한다.",
    "7. 완성된 결과는 반드시 draft.md 파일 하나로 제공한다. 채팅 본문에는 파일 내용의 요약이나 코드블록을 반복하지 않는다.",
    "",
    "출력 형식:",
    "# 제목",
    "## 오늘의 질문",
    "## 먼저 답하기",
    "## 선택한 글 유형의 핵심 섹션",
    "## 자주 나올 질문과 답변",
    "## 확정 사실 / 해석 / 추정",
    "## Claim ledger",
    "## 다음 질문",
    "[복사 끝]",
  ].join("\n");
}

function buildQuestionPrompt({ question, lessonDate, lesson, revision }) {
  const context = lessonPromptContext(lesson);
  return [
    "아래 질문에 답해줘.",
    "",
    "[복사 시작]",
    "너는 LLM, 메모리, 컴퓨터 시스템을 공개 출처 기반으로 설명하는 한국어 튜터다.",
    "답변은 한국어로 하고, 확정된 사실과 해석을 구분하라.",
    "public source 후보와 내 해석을 구분해서 답하라.",
    "답변은 반드시 answer.md 파일 하나로 제공한다. 채팅 본문에는 파일 내용의 요약이나 코드블록을 반복하지 않는다.",
    "",
    `오늘 날짜: ${lessonDate}`,
    `커리큘럼 ref: ${lesson?.curriculumRef ?? "아직 미정"}`,
    "",
    context.text,
    "",
    "현재 초안:",
    revision?.content ?? "(현재 초안 없음)",
    "",
    "질문:",
    question,
    "[복사 끝]",
  ].join("\n");
}

function buildRevisionPrompt({ instruction, lesson, revision }) {
  const context = lessonPromptContext(lesson);
  return [
    "아래 지시와 현재 초안을 바탕으로 수정본을 작성해줘.",
    "",
    "[복사 시작]",
    "너는 한국어 기술 블로그 편집자다.",
    "아래 현재 초안을 수정 요구사항에 맞게 고쳐라.",
    "수정한 전체 Markdown 문서는 반드시 revised-draft.md 파일 하나로 제공한다. 채팅 본문에는 파일 내용의 요약이나 코드블록을 반복하지 않는다.",
    "새로운 factual claim을 추가할 때는 public source 후보를 함께 남겨라.",
    "기존 계산, 표, 실험, 다이어그램은 설명에 도움이 될 때만 유지하거나 고친다. 없는 산출물을 억지로 추가하지 않는다.",
    "",
    `커리큘럼 ref: ${lesson?.curriculumRef ?? "아직 미정"}`,
    "",
    context.text,
    "",
    "수정 요구사항:",
    instruction,
    "",
    "현재 초안:",
    revision?.content ?? "(현재 초안 없음)",
    "[복사 끝]",
  ].join("\n");
}

async function currentLesson(store, now, timeZone) {
  const lessonDate = dateInTimeZone(now(), timeZone);
  try {
    return { lessonDate, lesson: await store.getLessonByDate(lessonDate) };
  } catch (error) {
    if (error instanceof StoreError && error.code === "LESSON_NOT_FOUND") return { lessonDate, lesson: null };
    throw error;
  }
}

async function currentRevision(store, lesson) {
  if (!lesson?.currentRevisionId) return null;
  return store.getRevision(lesson.currentRevisionId);
}

async function transitionToDiscussionIfNeeded(store, lesson) {
  const latest = await store.getLesson(lesson.id);
  if (latest.state === "draft_ready") return store.transitionLesson(latest.id, "discussing", latest.stateVersion);
  return latest;
}

async function transitionAfterManualDraft(store, lesson) {
  const latest = await store.getLesson(lesson.id);
  if (latest.state === "scheduled") {
    const researching = await store.transitionLesson(latest.id, "researching", latest.stateVersion);
    return store.transitionLesson(researching.id, "draft_ready", researching.stateVersion);
  }
  if (latest.state === "researching") {
    return store.transitionLesson(latest.id, "draft_ready", latest.stateVersion);
  }
  return transitionToDiscussionIfNeeded(store, latest);
}

async function transitionToReviewReady(store, lesson) {
  const latest = await store.getLesson(lesson.id);
  if (!latest.currentRevisionId) {
    throw new LessonRouterError("NO_REVISION", "No current revision exists for review", { lessonId: latest.id });
  }
  if (latest.state === "review_ready") return latest;
  if (latest.state === "scheduled") {
    const researching = await store.transitionLesson(latest.id, "researching", latest.stateVersion);
    const draftReady = await store.transitionLesson(researching.id, "draft_ready", researching.stateVersion);
    return store.transitionLesson(draftReady.id, "review_ready", draftReady.stateVersion);
  }
  if (latest.state === "researching") {
    const draftReady = await store.transitionLesson(latest.id, "draft_ready", latest.stateVersion);
    return store.transitionLesson(draftReady.id, "review_ready", draftReady.stateVersion);
  }
  if (latest.state === "draft_ready" || latest.state === "discussing") {
    return store.transitionLesson(latest.id, "review_ready", latest.stateVersion);
  }
  throw new LessonRouterError("NOT_REVIEWABLE", "Lesson is not ready to enter review", {
    lessonId: latest.id,
    state: latest.state,
  });
}

function nextActionFor({ lesson, revision, publication }) {
  if (!lesson) return "08:30 KST 스케줄러가 lesson을 만들었는지 확인하거나 /today를 다시 확인";
  if (!revision) return "/prompt로 Claude 웹용 초안 프롬프트를 만들고 결과를 /draft로 저장";
  if (lesson.state === "draft_ready" || lesson.state === "discussing") return "/review로 승인 버튼 생성";
  if (lesson.state === "review_ready") return "텔레그램 승인 버튼을 눌러 웹 반영 진행";
  if (lesson.state === "approved" || lesson.state === "publishing" || lesson.state === "publish_failed") return "/publish-retry로 글 생성, Pages 배포 확인, URL 검증 재시도";
  if (lesson.state === "published" || publication?.status === "published") return "오늘 포스팅 완료. URL 본문 검증까지 끝난 상태";
  return "/today로 초안 내용을 확인하고 필요한 질문이나 수정을 진행";
}

function publicationLines(publication) {
  if (!publication) return ["publication: 없음"];
  return [
    `web: ${publication.status === "published" ? "반영 완료" : "반영 실패"}`,
    publication.filePath ? `file: ${publication.filePath}` : null,
    publication.pullRequestUrl ? `PR: ${publication.pullRequestUrl}` : null,
    publication.deploymentUrl ? `URL: ${publication.deploymentUrl}` : null,
    publication.errorMessage ? `error: ${publication.errorMessage}` : null,
  ].filter(Boolean);
}

export function createApprovalPromptService({
  store,
  now = () => new Date().toISOString(),
  tokenFactory = () => crypto.randomUUID().replace(/-/g, ""),
  expiresInMs = 24 * 60 * 60 * 1000,
} = {}) {
  if (!store?.issueApprovalChallenge) throw new LessonRouterError("MISCONFIGURED", "store is required");

  return async function createApprovalPrompt({ lesson, actor, operationKey }) {
    const token = requireText(tokenFactory(), "token");
    const issuedAt = new Date(now());
    const expiresAt = new Date(issuedAt.getTime() + expiresInMs).toISOString();
    if (store.invalidatePendingApprovalChallenges) {
      await store.invalidatePendingApprovalChallenges({ lessonId: lesson.id, reason: "new_approval_prompt" });
    }
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: actor.userId,
      telegramChatId: actor.chatId,
      nonce: token,
      expiresAt,
      operationKey,
    });
    return { challenge, token, expiresAt };
  };
}

export function createLessonCommandRouter({
  store,
  telegram,
  answerProvider = async ({ question }) => ({
    answer: `Claude API provider가 연결되지 않았어. API를 쓰지 않는 manual mode에서는 /prompt 또는 /revise로 Claude 웹용 프롬프트를 받아 사용해줘.\n\n질문: ${question}`,
  }),
  revisionProvider = async ({ instruction, currentContent }) => ({
    content: `${currentContent.trim()}\n\n## Revision request\n\n${instruction}`,
    changeSummary: "Applied Telegram revision instruction",
  }),
  approvalPrompt,
  publicationRetry = null,
  aiMode = "manual",
  maxDraftFileBytes = 512_000,
  now = () => new Date().toISOString(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  if (!store?.getLessonByDate || !store?.appendRevision) throw new LessonRouterError("MISCONFIGURED", "store is required");
  if (!telegram?.sendMessage) throw new LessonRouterError("MISCONFIGURED", "telegram client is required");

  async function send(chatId, text, options = {}) {
    return telegram.sendMessage({ chatId, text, ...options });
  }
  const mode = normalizeMode(aiMode);

  async function handleToday({ actor }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, `${lessonDate} 학습 세션이 아직 생성되지 않았어. 08:30 KST 스케줄러 상태를 확인해볼게.`);
      return { action: "today_missing" };
    }
    const revision = await currentRevision(store, lesson);
    const lines = [
      `오늘 학습 세션: ${lessonDate}`,
      `커리큘럼: ${lesson.curriculumRef}`,
      `상태: ${lesson.state}`,
      `Revision: ${lesson.currentRevisionNumber || 0}`,
    ];
    if (revision) lines.push("", preview(revision.content));
    else lines.push("", "아직 초안 revision이 없어. /prompt로 Claude 웹용 초안 프롬프트를 만들 수 있어.");
    await send(actor.chatId, lines.join("\n"));
    return { action: "today_sent", lessonId: lesson.id };
  }

  async function handleStatus({ actor }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, [
        "현재 상태",
        `날짜: ${lessonDate}`,
        "lesson: 없음",
        "다음 행동: 08:30 KST 스케줄러가 실행됐는지 확인하거나 /today를 다시 보내줘.",
      ].join("\n"));
      return { action: "status_missing" };
    }

    const [revision, approval, publication] = await Promise.all([
      currentRevision(store, lesson),
      store.getActiveApprovalForLesson ? store.getActiveApprovalForLesson(lesson.id) : null,
      store.getLatestPublicationForLesson ? store.getLatestPublicationForLesson(lesson.id) : null,
    ]);

    await send(actor.chatId, [
      "현재 상태",
      `날짜: ${lessonDate}`,
      `커리큘럼: ${lesson.curriculumRef}`,
      `lesson: ${lesson.state} (v${lesson.stateVersion})`,
      `revision: ${lesson.currentRevisionNumber || 0}${revision ? ` / ${revision.id}` : ""}`,
      `approval: ${approval ? `${approval.status} / ${approval.id}` : "없음"}`,
      ...publicationLines(publication),
      `다음 행동: ${nextActionFor({ lesson, revision, publication })}`,
    ].join("\n"));
    return { action: "status_sent", lessonId: lesson.id };
  }

  async function handlePrompt({ actor }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    await send(actor.chatId, buildDraftPrompt({ lessonDate, lesson }));
    return { action: "manual_prompt_sent", lessonId: lesson?.id ?? null };
  }

  async function handleNext({ actor }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    const nextRef = nextCurriculumRef(lesson?.curriculumRef);
    if (!nextRef) {
      await send(actor.chatId, "현재 커리큘럼의 다음 주제가 없어. /today로 현재 lesson을 확인해줘.");
      return { action: "next_unavailable" };
    }
    const nextLesson = await store.createLesson({ lessonDate, curriculumRef: nextRef });
    await send(actor.chatId, [
      "다음 학습 주제를 열었어.",
      "커리큘럼: " + nextLesson.curriculumRef,
      "상태: " + nextLesson.state,
      "이제 /prompt를 보내면 이 주제의 Claude 웹용 초안을 받을 수 있어.",
    ].join("\n"));
    return { action: "next_lesson_created", lessonId: nextLesson.id, curriculumRef: nextLesson.curriculumRef };
  }

  async function handleLessons({ actor }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    if (!store.getLessonsByDate) {
      await send(actor.chatId, "오늘 lesson 목록 기능이 아직 Worker에 연결되지 않았어.");
      return { action: "lessons_unavailable" };
    }
    const lessons = await store.getLessonsByDate(lessonDate);
    if (!lessons.length) {
      await send(actor.chatId, "오늘 열어 둔 lesson이 아직 없어.");
      return { action: "lessons_empty" };
    }
    await send(actor.chatId, [
      `오늘 lesson 목록: ${lessonDate}`,
      ...lessons.map((item) => `${item.id === lesson?.id ? "현재" : "대기"} | ${item.curriculumRef} | ${item.state}`),
      "",
      "다른 주제로 돌아가려면 /use <커리큘럼 ref>를 보내면 돼.",
    ].join("\n"));
    return { action: "lessons_sent", lessonId: lesson?.id ?? null };
  }

  async function handleUse({ actor, curriculumRef }) {
    const ref = requireText(curriculumRef, "curriculumRef");
    if (!store.selectLessonByDateAndCurriculumRef) {
      await send(actor.chatId, "lesson 선택 기능이 아직 Worker에 연결되지 않았어.");
      return { action: "use_unavailable" };
    }
    const lessonDate = dateInTimeZone(now(), timeZone);
    try {
      const lesson = await store.selectLessonByDateAndCurriculumRef(lessonDate, ref);
      await send(actor.chatId, [
        "현재 lesson을 바꿨어.",
        `커리큘럼: ${lesson.curriculumRef}`,
        `상태: ${lesson.state}`,
        "이제 /prompt, /draft, /review는 이 lesson을 대상으로 동작해.",
      ].join("\n"));
      return { action: "lesson_selected", lessonId: lesson.id };
    } catch (error) {
      if (error instanceof StoreError && error.code === "LESSON_NOT_FOUND") {
        await send(actor.chatId, `오늘 열린 lesson 중 ${ref}를 찾지 못했어. /lessons로 목록을 확인해줘.`);
        return { action: "lesson_not_found" };
      }
      throw error;
    }
  }

  async function handleManualQuestion({ actor, question }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    const revision = lesson ? await currentRevision(store, lesson) : null;
    await send(actor.chatId, buildQuestionPrompt({ question, lessonDate, lesson, revision }));
    return { action: "manual_question_prompt_sent", lessonId: lesson?.id ?? null };
  }

  async function handleQuestion({ update, actor, question }) {
    const { lessonDate, lesson } = await currentLesson(store, now, timeZone);
    const revision = lesson ? await currentRevision(store, lesson) : null;
    const response = await answerProvider({ question, lessonDate, lesson, revision, update, actor });
    const answer = requireText(response?.answer, "answer");
    let updatedRevision = null;
    if (lesson && response?.revisedContent) {
      updatedRevision = await store.appendRevision({
        lessonId: lesson.id,
        content: response.revisedContent,
        createdBy: "telegram-qna",
        changeSummary: response.changeSummary ?? "Updated from Telegram Q&A",
        operationKey: `telegram:qna-revision:${update.update_id}`,
      });
      await transitionToDiscussionIfNeeded(store, lesson);
    }
    if (store.recordConversationTurn) {
      await store.recordConversationTurn({
        lessonId: lesson?.id ?? null,
        revisionId: revision?.id ?? null,
        appliedRevisionId: updatedRevision?.id ?? null,
        telegramUpdateId: update.update_id,
        telegramUserId: actor.userId,
        telegramChatId: actor.chatId,
        question,
        answer,
        status: updatedRevision ? "revised" : "answered",
        provider: response.provider,
        operationKey: `telegram:conversation:${update.update_id}`,
      });
    }
    await send(actor.chatId, answer);
    return { action: updatedRevision ? "question_answered_and_revised" : "question_answered" };
  }

  async function handleRevise({ update, actor, instruction }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "수정할 오늘 학습 세션이 아직 없어.");
      return { action: "revise_missing_lesson" };
    }
    const revision = await currentRevision(store, lesson);
    if (!revision) {
      await send(actor.chatId, "수정할 현재 revision이 아직 없어.");
      return { action: "revise_missing_revision" };
    }
    const result = await revisionProvider({ instruction, lesson, revision, currentContent: revision.content, update, actor });
    const nextRevision = await store.appendRevision({
      lessonId: lesson.id,
      content: requireText(result?.content, "content"),
      createdBy: "telegram-revision",
      changeSummary: result?.changeSummary ?? "Updated from Telegram revision command",
      operationKey: `telegram:revise:${update.update_id}`,
    });
    await transitionToDiscussionIfNeeded(store, lesson);
    await send(actor.chatId, `수정 revision ${nextRevision.revisionNumber}을 저장했어. /today로 확인하거나 /review로 검토 단계로 넘길 수 있어.`);
    return { action: "revision_created", revisionId: nextRevision.id };
  }

  async function handleManualRevise({ actor, instruction }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "수정할 오늘 학습 세션이 아직 없어. 먼저 /today 상태를 확인해줘.");
      return { action: "manual_revise_missing_lesson" };
    }
    const revision = await currentRevision(store, lesson);
    if (!revision) {
      await send(actor.chatId, "수정할 현재 revision이 아직 없어. /prompt로 초안 프롬프트를 받고, Claude 웹 결과를 /draft로 저장해줘.");
      return { action: "manual_revise_missing_revision" };
    }
    await send(actor.chatId, buildRevisionPrompt({ instruction, lesson, revision }));
    return { action: "manual_revision_prompt_sent", lessonId: lesson.id };
  }

  async function handleDraft({ update, actor, content }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "저장할 오늘 학습 세션이 아직 없어. 스케줄러가 lesson을 만들었는지 확인해줘.");
      return { action: "draft_missing_lesson" };
    }
    try {
      assertDraftContent(content);
    } catch (error) {
      if (error instanceof DraftQualityError) {
        await send(actor.chatId, [
          "초안 품질 검사에서 막혔어. 저장하지 않았어.",
          `문제: ${error.details?.errors?.join(", ") ?? error.code}`,
          "Claude 결과가 깨졌거나, H1 제목 또는 Claim ledger가 빠졌는지 확인해줘.",
        ].join("\n"));
        return { action: "draft_quality_failed", errors: error.details?.errors ?? [] };
      }
      throw error;
    }
    const nextRevision = await store.appendRevision({
      lessonId: lesson.id,
      content: requireText(content, "content"),
      createdBy: "manual-claude-web",
      changeSummary: "Saved manual Claude web draft from Telegram",
      operationKey: `telegram:manual-draft:${update.update_id}`,
    });
    await transitionAfterManualDraft(store, lesson);
    await send(actor.chatId, `Claude 웹 결과를 revision ${nextRevision.revisionNumber}로 저장했어. /today로 확인하거나 /review로 검토 단계로 넘길 수 있어.`);
    return { action: "manual_draft_saved", revisionId: nextRevision.id };
  }

  async function handleDraftDocument({ update, actor, document }) {
    if (!telegram.downloadDocumentText) {
      await send(actor.chatId, "현재 Worker가 파일 다운로드 기능을 아직 지원하지 않아. 우선 /draft 뒤에 Markdown 본문을 붙여넣어줘.");
      return { action: "draft_document_unsupported" };
    }
    if (!isMarkdownDocument(document)) {
      await send(actor.chatId, "초안 파일은 .md 또는 .markdown 파일로 보내줘. Telegram에서 파일 첨부 후 caption에 /draft를 적으면 돼.");
      return { action: "draft_document_invalid_type" };
    }
    if (Number(document.file_size) > maxDraftFileBytes) {
      await send(actor.chatId, `파일이 너무 커. 초안 .md 파일은 ${Math.floor(maxDraftFileBytes / 1024)}KB 이하로 보내줘.`);
      return { action: "draft_document_too_large" };
    }
    let content;
    try {
      content = await telegram.downloadDocumentText({ fileId: document.file_id, maxBytes: maxDraftFileBytes });
    } catch (error) {
      await send(actor.chatId, `파일을 읽지 못했어. .md 파일로 다시 보내줘. error=${error?.code ?? error?.message ?? "download_failed"}`);
      return { action: "draft_document_download_failed" };
    }
    return handleDraft({ update, actor, content });
  }

  async function handleReview({ update, actor }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "검토할 오늘 학습 세션이 아직 없어.");
      return { action: "review_missing_lesson" };
    }
    let reviewReady;
    try {
      reviewReady = await transitionToReviewReady(store, lesson);
    } catch (error) {
      if (error instanceof LessonRouterError && error.code === "NO_REVISION") {
        await send(actor.chatId, "아직 저장된 draft가 없어. 먼저 /prompt로 Claude용 프롬프트를 받고, Claude가 만든 Markdown을 /draft 뒤에 붙여넣어줘. 그 다음 /review를 누르면 승인 버튼이 나와.");
        return { action: "review_missing_revision" };
      }
      if (error instanceof LessonRouterError && error.code === "NOT_REVIEWABLE") {
        await send(actor.chatId, `현재 lesson 상태는 ${error.details?.state ?? lesson.state}라서 바로 review로 넘길 수 없어. /status로 상태를 확인하고 필요한 경우 새 /draft를 저장해줘.`);
        return { action: "review_not_ready" };
      }
      throw error;
    }
    if (!approvalPrompt) {
      await send(actor.chatId, "현재 revision을 review_ready로 전환했어. 승인 버튼 생성은 다음 연결 단계에서 켤게.");
      return { action: "review_ready", lessonId: reviewReady.id };
    }
    const prompt = await approvalPrompt({
      lesson: reviewReady,
      actor,
      operationKey: `telegram:challenge:${update.update_id}`,
    });
    await send(actor.chatId, "검토 준비가 끝났어. 내용을 확인했다면 승인 버튼을 눌러줘.", {
      replyMarkup: approvalKeyboard({ challengeId: prompt.challenge.id, token: prompt.token }),
    });
    return { action: "review_ready_with_approval", challengeId: prompt.challenge.id };
  }

  async function handlePublishRetry({ actor }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "게시를 재시도할 오늘 학습 세션이 아직 없어.");
      return { action: "publish_retry_missing_lesson" };
    }
    if (!["approved", "publishing", "publish_failed"].includes(lesson.state)) {
      await send(actor.chatId, `현재 상태는 ${lesson.state}야. 게시 재시도는 approved, publishing, publish_failed 상태에서만 가능해.`);
      return { action: "publish_retry_not_ready", state: lesson.state };
    }
    if (!publicationRetry) {
      await send(actor.chatId, "게시 재시도 기능이 Worker에 아직 설정되지 않았어. GitHub App 설정을 확인해야 해.");
      return { action: "publish_retry_unconfigured" };
    }

    try {
      const publication = await publicationRetry({ lesson, actor });
      await send(actor.chatId, [
        "웹 반영 확인 완료.",
        `publication=${publication.id}`,
        publication.filePath ? `file=${publication.filePath}` : null,
        publication.pullRequestUrl ? `PR=${publication.pullRequestUrl}` : null,
        publication.deploymentUrl ? `URL=${publication.deploymentUrl}` : null,
      ].filter(Boolean).join("\n"));
      return { action: "publish_retry_succeeded", publicationId: publication.id };
    } catch (error) {
      await send(actor.chatId, [
        "웹 반영 확인 실패.",
        `error=${error?.message ?? String(error)}`,
        "원인을 고친 뒤 /publish-retry 또는 /verify-url을 다시 보내면 돼.",
      ].join("\n"));
      return { action: "publish_retry_failed", error: error?.message ?? String(error) };
    }
  }

  return {
    async onMessage({ update, actor }) {
      const text = getMessageText(update);
      const document = getMessageDocument(update);
      if (!text && document) return handleDraftDocument({ update, actor, document });
      if (!text) {
        await send(actor.chatId, "텍스트 메시지만 처리할 수 있어.");
        return { action: "unsupported_message" };
      }
      const command = extractCommand(text);
      if (document && (!command || command.command === "/draft")) return handleDraftDocument({ update, actor, document });
      if (!command) {
        if (mode === "api") return handleQuestion({ update, actor, question: text });
        return handleManualQuestion({ update, actor, question: text });
      }
      if (command.command === "/start" || command.command === "/help" || command.command === "/commands") {
        await send(actor.chatId, HELP_TEXT);
        return { action: "help_sent" };
      }
      if (command.command === "/today") return handleToday({ update, actor });
      if (command.command === "/lessons") return handleLessons({ update, actor });
      if (command.command === "/next") return handleNext({ update, actor });
      if (command.command === "/use") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /use M01-W01-D1");
          return { action: "use_usage" };
        }
        return handleUse({ actor, curriculumRef: command.argument });
      }
      if (command.command === "/status") return handleStatus({ update, actor });
      if (command.command === "/prompt") return handlePrompt({ update, actor });
      if (command.command === "/publish-retry" || command.command === "/deploy-retry" || command.command === "/verify-url") {
        return handlePublishRetry({ update, actor });
      }
      if (command.command === "/draft") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /draft Claude 웹에서 받은 Markdown 초안을 붙여넣어줘. 글이 길면 .md 파일을 첨부하고 caption에 /draft를 적어서 보내면 돼.");
          return { action: "draft_usage" };
        }
        return handleDraft({ update, actor, content: command.argument });
      }
      if (command.command === "/ask-api") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /ask-api Claude API로 물어볼 질문을 적어줘.");
          return { action: "ask_api_usage" };
        }
        return handleQuestion({ update, actor, question: command.argument });
      }
      if (command.command === "/revise") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /revise 수정하고 싶은 내용을 적어줘.");
          return { action: "revise_usage" };
        }
        if (mode === "api") return handleRevise({ update, actor, instruction: command.argument });
        return handleManualRevise({ update, actor, instruction: command.argument });
      }
      if (command.command === "/revise-api") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /revise-api Claude API로 수정할 내용을 적어줘.");
          return { action: "revise_api_usage" };
        }
        return handleRevise({ update, actor, instruction: command.argument });
      }
      if (command.command === "/review") return handleReview({ update, actor });
      await send(actor.chatId, "알 수 없는 명령이야. /help로 가능한 명령을 확인해줘.");
      return { action: "unknown_command" };
    },

    async onCallback({ update, actor }) {
      if (telegram.answerCallbackQuery && update.callback_query?.id) {
        await telegram.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "처리할 수 없는 버튼이야.",
          showAlert: false,
        });
      }
      await send(actor.chatId, "처리할 수 없는 버튼이야. /status로 현재 상태를 확인해줘.");
      return { action: "unknown_callback" };
    },
  };
}
