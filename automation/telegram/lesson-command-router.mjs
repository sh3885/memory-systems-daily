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
  "/today - 오늘 학습 상태와 초안을 확인",
  "/revise 수정 내용 - 현재 초안을 수정 revision으로 저장",
  "/review - 현재 revision을 검토 준비 상태로 바꾸고 승인 버튼을 요청",
  "/help - 명령 보기",
  "",
  "명령이 아닌 문장은 현재 학습 내용에 대한 질문으로 처리한다.",
].join("\n");

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new LessonRouterError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function getMessageText(update) {
  return String(update?.message?.text ?? "").trim();
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

function approvalKeyboard({ challengeId, token }) {
  const callbackData = `approve:${requireText(challengeId, "challengeId")}:${requireText(token, "token")}`;
  if (new TextEncoder().encode(callbackData).length > 64) {
    throw new LessonRouterError("CALLBACK_DATA_TOO_LONG", "Approval callback data exceeds Telegram's 64-byte limit", {
      challengeId,
    });
  }
  return {
    inline_keyboard: [[
      { text: "승인하고 배포 준비", callback_data: callbackData },
    ]],
  };
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

async function transitionToReviewReady(store, lesson) {
  const latest = await store.getLesson(lesson.id);
  if (!latest.currentRevisionId) {
    throw new LessonRouterError("NO_REVISION", "No current revision exists for review", { lessonId: latest.id });
  }
  if (latest.state === "review_ready") return latest;
  if (latest.state === "draft_ready" || latest.state === "discussing") {
    return store.transitionLesson(latest.id, "review_ready", latest.stateVersion);
  }
  throw new LessonRouterError("NOT_REVIEWABLE", "Lesson is not ready to enter review", {
    lessonId: latest.id,
    state: latest.state,
  });
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
    answer: `아직 LLM 답변 provider가 연결되지 않았어. 질문은 받았고, 다음 단계에서 이 부분에 OpenAI/search provider를 붙일 예정이야.\n\n질문: ${question}`,
  }),
  revisionProvider = async ({ instruction, currentContent }) => ({
    content: `${currentContent.trim()}\n\n## Revision request\n\n${instruction}`,
    changeSummary: "Applied Telegram revision instruction",
  }),
  approvalPrompt,
  now = () => new Date().toISOString(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  if (!store?.getLessonByDate || !store?.appendRevision) throw new LessonRouterError("MISCONFIGURED", "store is required");
  if (!telegram?.sendMessage) throw new LessonRouterError("MISCONFIGURED", "telegram client is required");

  async function send(chatId, text, options = {}) {
    return telegram.sendMessage({ chatId, text, ...options });
  }

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
    else lines.push("", "아직 초안 revision이 없어. research pipeline 실행이 필요해.");
    await send(actor.chatId, lines.join("\n"));
    return { action: "today_sent", lessonId: lesson.id };
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

  async function handleReview({ update, actor }) {
    const { lesson } = await currentLesson(store, now, timeZone);
    if (!lesson) {
      await send(actor.chatId, "검토할 오늘 학습 세션이 아직 없어.");
      return { action: "review_missing_lesson" };
    }
    const reviewReady = await transitionToReviewReady(store, lesson);
    if (!approvalPrompt) {
      await send(actor.chatId, "현재 revision을 review_ready로 전환했어. 승인 버튼 생성은 다음 연결 단계에서 켤게.");
      return { action: "review_ready", lessonId: reviewReady.id };
    }
    const prompt = await approvalPrompt({
      lesson: reviewReady,
      actor,
      operationKey: `telegram:challenge:${update.update_id}`,
    });
    await send(actor.chatId, "검토 준비가 끝났어. 내용을 확인한 뒤 승인 버튼을 눌러줘.", {
      replyMarkup: approvalKeyboard({ challengeId: prompt.challenge.id, token: prompt.token }),
    });
    return { action: "review_ready_with_approval", challengeId: prompt.challenge.id };
  }

  return {
    async onMessage({ update, actor }) {
      const text = getMessageText(update);
      if (!text) {
        await send(actor.chatId, "텍스트 메시지만 처리할 수 있어.");
        return { action: "unsupported_message" };
      }
      const command = extractCommand(text);
      if (!command) return handleQuestion({ update, actor, question: text });
      if (command.command === "/start" || command.command === "/help") {
        await send(actor.chatId, HELP_TEXT);
        return { action: "help_sent" };
      }
      if (command.command === "/today") return handleToday({ update, actor });
      if (command.command === "/revise") {
        if (!command.argument) {
          await send(actor.chatId, "사용법: /revise 수정하고 싶은 내용을 적어줘.");
          return { action: "revise_usage" };
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
      await send(actor.chatId, "처리할 수 없는 버튼이야. /today로 현재 상태를 확인해줘.");
      return { action: "unknown_callback" };
    },
  };
}
