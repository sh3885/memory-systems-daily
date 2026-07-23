import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createApprovalPromptService,
  createLessonCommandRouter,
} from "../telegram/lesson-command-router.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0003_conversation_ledger.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0004_conversation_provider_metadata.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0005_publications.sql"), "utf8"),
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

function documentUpdate(updateId, document, caption = "") {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 1234 },
      chat: { id: 5678, type: "private" },
      caption,
      document,
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
      downloadDocumentText: async () => "# File draft\n\nLong Markdown body",
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

  async function createDraftReadyLesson(curriculumRef = "M01-W01-D1") {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content: "# 오늘 초안\n\nLLM attention과 memory traffic을 연결한다.",
      createdBy: "research-pipeline",
      changeSummary: "Initial research draft",
      operationKey: `revision:initial:${curriculumRef}`,
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
    assert.match(telegram.messages[0].text, /\/status/);
    assert.match(telegram.messages[0].text, /\/publish-retry/);
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
    assert.match(telegram.messages[0].text, /M01-W01-D1/);
    assert.match(telegram.messages[0].text, /LLM attention/);
  });

  test("reports the current lesson status", async () => {
    await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({ update: messageUpdate(30, "/status"), actor });
    assert.equal(result.action, "status_sent");
    assert.match(telegram.messages[0].text, /현재 상태/);
    assert.match(telegram.messages[0].text, /lesson: draft_ready/);
    assert.match(telegram.messages[0].text, /revision: 1/);
    assert.match(telegram.messages[0].text, /다음 행동: \/review/);
  });

  test("includes daily artifact requirements in manual prompts", async () => {
    await createDraftReadyLesson("M01-W01-D1");
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    assert.equal((await router.onMessage({ update: messageUpdate(20, "/prompt"), actor })).action, "manual_prompt_sent");
    const prompt = telegram.messages.at(-1).text;
    assert.match(prompt, /다음 token 예측을 데이터 경로로 보기/);
    assert.match(prompt, /Markdown 계산표/);
    assert.match(prompt, /inline SVG 다이어그램/);
    assert.match(prompt, /<svg viewBox="0 0 960 420"/);
    assert.match(prompt, /claim ledger/);
  });

  test("answers questions through an injected provider and can create a revision", async () => {
    const { lesson } = await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      aiMode: "api",
      now: () => "2026-07-22T08:30:00+09:00",
      answerProvider: async ({ question, revision }) => ({
        answer: `답변: ${question}`,
        revisedContent: `${revision.content}\n\n## Q&A 반영\n\n${question}`,
        changeSummary: "Added Q&A clarification",
        provider: {
          id: "anthropic",
          model: "claude-sonnet-5",
          attempts: [],
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
    assert.equal(turns[0].providerId, "anthropic");
  });

  test("sends manual revision prompts with artifact requirements and saves pasted drafts", async () => {
    const { lesson } = await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    assert.equal((await router.onMessage({ update: messageUpdate(21, "KV cache가 뭐야?"), actor })).action, "manual_question_prompt_sent");
    assert.match(telegram.messages.at(-1).text, /질문:/);
    assert.equal((await router.onMessage({ update: messageUpdate(22, "/revise bandwidth 관점 추가"), actor })).action, "manual_revision_prompt_sent");
    assert.match(telegram.messages.at(-1).text, /수정 요구사항:/);
    assert.match(telegram.messages.at(-1).text, /inline SVG 다이어그램/);

    const saved = await router.onMessage({ update: messageUpdate(23, "/draft # Claude 초안\n\n복사한 본문"), actor });
    assert.equal(saved.action, "manual_draft_saved");
    const updated = await store.getLesson(lesson.id);
    assert.equal(updated.currentRevisionNumber, 2);
    assert.equal(updated.state, "discussing");
  });

  test("creates a revision from /revise instructions in api mode", async () => {
    const { lesson } = await createDraftReadyLesson();
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      aiMode: "api",
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

  test("uses Claude API only for explicit /ask-api in manual mode", async () => {
    await createDraftReadyLesson();
    let calls = 0;
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
      answerProvider: async ({ question }) => {
        calls += 1;
        return {
          answer: `Claude API 답변: ${question}`,
          provider: { id: "anthropic", model: "claude-sonnet-5", attempts: [] },
        };
      },
    });

    const result = await router.onMessage({ update: messageUpdate(24, "/ask-api KV cache 설명"), actor });
    assert.equal(result.action, "question_answered");
    assert.equal(calls, 1);
    assert.match(telegram.messages.at(-1).text, /Claude API 답변/);
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
    assert.equal(telegram.messages[0].replyMarkup.inline_keyboard[0][0].callback_data, "approve:tok123");
  });

  test("invalidates older pending approval prompts when review is requested again", async () => {
    const { lesson } = await createDraftReadyLesson();
    let tokenIndex = 0;
    const approvalPrompt = createApprovalPromptService({
      store,
      now: () => "2026-07-22T00:00:00.000Z",
      tokenFactory: () => `tok${++tokenIndex}`,
    });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      approvalPrompt,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const first = await router.onMessage({ update: messageUpdate(40, "/review"), actor });
    const second = await router.onMessage({ update: messageUpdate(41, "/review"), actor });

    assert.equal(first.action, "review_ready_with_approval");
    assert.equal(second.action, "review_ready_with_approval");
    assert.equal((await store.getChallenge(first.challengeId)).status, "invalidated");
    assert.equal((await store.getChallenge(first.challengeId)).invalidationReason, "new_approval_prompt");
    assert.equal((await store.getChallenge(second.challengeId)).status, "pending");
    assert.equal(telegram.messages.at(-1).replyMarkup.inline_keyboard[0][0].callback_data, "approve:tok2");
    assert.equal((await store.getLesson(lesson.id)).state, "review_ready");
  });

  test("guides the user when /review is sent before any draft exists", async () => {
    await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M01-W01-D1" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
      approvalPrompt: createApprovalPromptService({
        store,
        now: () => "2026-07-22T00:00:00.000Z",
        tokenFactory: () => "tok123",
      }),
    });

    const result = await router.onMessage({ update: messageUpdate(32, "/review"), actor });
    assert.equal(result.action, "review_missing_revision");
    assert.match(telegram.messages[0].text, /\/draft/);
    assert.match(telegram.messages[0].text, /\/review/);
  });

  test("promotes a manually drafted scheduled lesson before review", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M01-W01-D1" });
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

    assert.equal(
      (await router.onMessage({ update: messageUpdate(33, "/draft # Manual draft\n\nBody"), actor })).action,
      "manual_draft_saved",
    );
    assert.equal((await store.getLesson(lesson.id)).state, "draft_ready");

    const result = await router.onMessage({ update: messageUpdate(34, "/review"), actor });
    assert.equal(result.action, "review_ready_with_approval");
    assert.equal((await store.getLesson(lesson.id)).state, "review_ready");
    assert.equal(telegram.messages.at(-1).replyMarkup.inline_keyboard[0][0].callback_data, "approve:tok123");
  });

  test("saves an uploaded markdown document as the current draft", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M01-W01-D1" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({
      update: documentUpdate(35, {
        file_id: "file_md_1",
        file_name: "claude-draft.md",
        mime_type: "text/markdown",
        file_size: 1234,
      }),
      actor,
    });

    assert.equal(result.action, "manual_draft_saved");
    const updated = await store.getLesson(lesson.id);
    assert.equal(updated.state, "draft_ready");
    assert.equal(updated.currentRevisionNumber, 1);
    const revision = await store.getRevision(updated.currentRevisionId);
    assert.match(revision.content, /File draft/);
  });

  test("uses an uploaded markdown document when caption is /draft", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M01-W01-D1" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({
      update: documentUpdate(36, {
        file_id: "file_md_2",
        file_name: "claude-draft.md",
        mime_type: "text/markdown",
        file_size: 1234,
      }, "/draft"),
      actor,
    });

    assert.equal(result.action, "manual_draft_saved");
    assert.equal((await store.getLesson(lesson.id)).currentRevisionNumber, 1);
  });

  test("rejects non-markdown draft uploads with guidance", async () => {
    await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M01-W01-D1" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({
      update: documentUpdate(37, {
        file_id: "file_docx_1",
        file_name: "draft.docx",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size: 1234,
      }, "/draft"),
      actor,
    });

    assert.equal(result.action, "draft_document_invalid_type");
    assert.match(telegram.messages[0].text, /\.md/);
  });

  test("retries a failed publication through an injected publisher callback", async () => {
    const { lesson } = await createDraftReadyLesson();
    await store.transitionLesson(lesson.id, "review_ready", 2);
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: actor.userId,
      telegramChatId: actor.chatId,
      nonce: "retry-token",
      expiresAt: "2026-07-23T00:00:00.000Z",
      operationKey: "challenge:retry",
    });
    const approval = await store.consumeApprovalChallenge({
      challengeId: challenge.id,
      telegramUserId: actor.userId,
      telegramChatId: actor.chatId,
      nonce: "retry-token",
      operationKey: "approval:retry",
    });
    await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    await store.recordPublicationFailure({
      lessonId: lesson.id,
      revisionId: approval.revisionId,
      approvalId: approval.id,
      operationKey: "publication:failure:retry",
      provider: "github",
      errorMessage: "temporary GitHub failure",
    });

    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      now: () => "2026-07-22T08:30:00+09:00",
      publicationRetry: async ({ lesson: retryLesson }) => ({
        id: "publication_retry_1",
        lessonId: retryLesson.id,
        status: "published",
        filePath: "src/pages/posts/2026-07-22-m01-w01-d1-r1.md",
        pullRequestUrl: "https://github.test/pr/1",
        deploymentUrl: "https://memory-systems-daily.pages.dev/posts/2026-07-22-m01-w01-d1-r1/",
      }),
    });

    const result = await router.onMessage({ update: messageUpdate(31, "/publish-retry"), actor });
    assert.equal(result.action, "publish_retry_succeeded");
    assert.match(telegram.messages[0].text, /게시 재시도 완료/);
    assert.match(telegram.messages[0].text, /github.test\/pr\/1/);
  });

  test("keeps approval callback data short even with long challenge ids", async () => {
    await createDraftReadyLesson();
    const approvalPrompt = async () => ({ challenge: { id: "challenge_" + "x".repeat(60) }, token: "tok123" });
    const router = createLessonCommandRouter({
      store,
      telegram: telegram.client,
      approvalPrompt,
      now: () => "2026-07-22T08:30:00+09:00",
    });

    const result = await router.onMessage({ update: messageUpdate(7, "/review"), actor });
    assert.equal(result.action, "review_ready_with_approval");
    assert.equal(telegram.messages[0].replyMarkup.inline_keyboard[0][0].callback_data, "approve:tok123");
  });
});
