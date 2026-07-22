import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createApprovalPromptService,
  createLessonCommandRouter,
  LessonRouterError,
} from "../telegram/lesson-command-router.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0003_conversation_ledger.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0004_conversation_provider_metadata.sql"), "utf8"),
].join("\n");

const actor = { userId: "1234", chatId: "5678", chatType: "private" };

function messageUpdate(updateId, text) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 1234 },
      chat: { id: 5678, type: "private" },
      text,
    },
  };
}

function captureTelegram() {
  const messages = [];
  const callbacks = [];
  return {
    messages,
    callbacks,
    client: {
      sendMessage: async (message) => {
        messages.push(message);
        return { message_id: messages.length };
      },
      answerCallbackQuery: async (callback) => {
        callbacks.push(callback);
        return true;
      },
    },
  };
}

describe("lesson command router", () => {
  let db;
  let store;
  let idIndex;
  let telegram;

  beforeEach(() => {
    db = new NodeD1Database(schema);
    idIndex = 0;
    store = new D1LessonStore(db, {
      now: () => "2026-07-22T00:00:00.000Z",
      id: (prefix) => `${prefix}_${++idIndex}`,
    });
    telegram = captureTelegram();
  });

  afterEach(() => db.close());

  async function createDraftReadyLesson() {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M05-W12-D1" });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content: "# 오늘 초안\n\nLLM attention과 memory traffic을 연결한다.",
      createdBy: "research-pipeline",
      changeSummary: "Initial research draft",
      operationKey: "revision:initial",
    });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    return { lesson: await store.getLesson(lesson.id), revision };
  }

  test("sends help and missing-today messages", async () => {
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    assert.equal((await router.onMessage({ update: messageUpdate(1, "/help"), actor })).action, "help_sent");
    assert.match(telegram.messages[0].text, /\/today/);
    assert.equal((await router.onMessage({ update: messageUpdate(2, "/today"), actor })).action, "today_missing");
    assert.match(telegram.messages[1].text, /학습 세션이 아직 생성/);
  });

  test("sends the current lesson and revision preview", async () => {
    await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({ update: messageUpdate(3, "/today"), actor });
    assert.equal(result.action, "today_sent");
    assert.match(telegram.messages[0].text, /M05-W12-D1/);
    assert.match(telegram.messages[0].text, /LLM attention/);
  });

  test("answers questions through an injected provider and can create a revision", async () => {
    const { lesson } = await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
      answerProvider: async ({ question, revision }) => ({
        answer: `답변: ${question}`,
        revisedContent: `${revision.content}\n\n## Q&A 반영\n\n${question}`,
        changeSummary: "Added Q&A clarification",
        provider: {
          id: "openai",
          model: "gpt-5.6",
          attempts: [{ providerId: "anthropic", model: "claude-sonnet-5", reason: "rate_limit", code: "ANTHROPIC_HTTP_ERROR", status: 429 }],
        },
      }),
    });

    const result = await router.onMessage({ update: messageUpdate(4, "KV cache가 왜 bandwidth 병목이야?"), actor });
    assert.equal(result.action, "question_answered_and_revised");
    assert.match(telegram.messages[0].text, /답변:/);
    const updated = await store.getLesson(lesson.id);
    assert.equal(updated.state, "discussing");
    assert.equal(updated.currentRevisionNumber, 2);
    const turns = await store.getConversationTurnsForLesson(lesson.id);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].status, "revised");
    assert.equal(turns[0].appliedRevisionId, updated.currentRevisionId);
    assert.equal(turns[0].providerId, "openai");
    assert.equal(turns[0].providerAttempts[0].providerId, "anthropic");
  });

  test("creates a revision from /revise instructions", async () => {
    const { lesson } = await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
      revisionProvider: async ({ instruction, currentContent }) => ({
        content: `${currentContent}\n\n## 보완\n\n${instruction}`,
        changeSummary: "Manual Telegram revision",
      }),
    });

    const result = await router.onMessage({ update: messageUpdate(5, "/revise DRAM bandwidth 관점 추가"), actor });
    assert.equal(result.action, "revision_created");
    assert.match(telegram.messages[0].text, /revision 2/);
    const updated = await store.getLesson(lesson.id);
    assert.equal(updated.state, "discussing");
  });

  test("moves a draft to review_ready and sends an approval button", async () => {
    const { lesson } = await createDraftReadyLesson();
    const approvalPrompt = createApprovalPromptService({
      store,
      now: () => "2026-07-22T00:00:00.000Z",
      tokenFactory: () => "tok123",
    });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      approvalPrompt,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({ update: messageUpdate(6, "/review"), actor });
    assert.equal(result.action, "review_ready_with_approval");
    assert.equal((await store.getLesson(lesson.id)).state, "review_ready");
    assert.equal(telegram.messages[0].replyMarkup.inline_keyboard[0][0].callback_data, "approve:challenge_3:tok123");
  });

  test("rejects too-long approval callback data before sending a button", async () => {
    await createDraftReadyLesson();
    const approvalPrompt = async () => ({ challenge: { id: "challenge_" + "x".repeat(60) }, token: "tok123" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      approvalPrompt,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    await assert.rejects(
      () => router.onMessage({ update: messageUpdate(7, "/review"), actor }),
      (error) => error instanceof LessonRouterError && error.code === "CALLBACK_DATA_TOO_LONG",
    );
  });
});
