import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { createTelegramWebhook } from "../telegram/telegram-webhook.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8");

const env = {
  TELEGRAM_BOT_ID: "study-bot",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_ALLOWED_USER_ID: "1234",
  TELEGRAM_ALLOWED_CHAT_ID: "5678",
};

function messageUpdate(updateId, overrides = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 1234 },
      chat: { id: 5678, type: "private" },
      text: "오늘 학습 내용을 설명해줘",
      ...overrides,
    },
  };
}

function callbackUpdate(updateId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: 1234 },
      data,
      message: { message_id: updateId, chat: { id: 5678, type: "private" } },
    },
  };
}

function request(body, secret = env.TELEGRAM_WEBHOOK_SECRET, method = "POST") {
  return new Request("https://example.test/telegram/webhook", {
    method,
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function requestAtPath(pathname, body) {
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify(body),
  });
}

describe("Telegram webhook", () => {
  let db;
  let store;

  beforeEach(() => {
    db = new NodeD1Database(schema);
    store = new D1LessonStore(db, { now: () => "2026-07-22T00:00:00.000Z", id: (prefix) => `${prefix}_test` });
  });

  afterEach(() => db.close());

  function createHandler(options = {}) {
    return createTelegramWebhook({
      env,
      store,
      onMessage: async ({ update }) => ({ action: "message_received", text: update.message?.text }),
      ...options,
    });
  }

  test("rejects non-POST requests and invalid webhook secrets before parsing", async () => {
    const handler = createHandler();
    assert.equal((await handler(request({}, env.TELEGRAM_WEBHOOK_SECRET, "GET"))).status, 405);
    assert.equal((await handler(requestAtPath("/wrong-path", messageUpdate(99)))).status, 404);
    const response = await handler(request("not used", "wrong-secret"));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "UNAUTHORIZED_WEBHOOK");
  });

  test("rejects malformed JSON and malformed update IDs", async () => {
    const handler = createHandler();
    const invalidJson = await handler(new Request("https://example.test/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: "{",
    }));
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).error, "INVALID_JSON");

    const invalidUpdate = await handler(request({ update_id: "42" }));
    assert.equal(invalidUpdate.status, 400);
    assert.equal((await invalidUpdate.json()).error, "MALFORMED_UPDATE");
  });

  test("enforces both Telegram user and chat allowlists", async () => {
    const handler = createHandler();
    const unauthorizedUser = await handler(request({
      update_id: 1,
      message: { from: { id: 9999 }, chat: { id: 5678 }, text: "x" },
    }));
    assert.equal(unauthorizedUser.status, 403);

    const unauthorizedChat = await handler(request({
      update_id: 2,
      message: { from: { id: 1234 }, chat: { id: 9999 }, text: "x" },
    }));
    assert.equal(unauthorizedChat.status, 403);

    const groupChat = await handler(request({
      update_id: 3,
      message: { from: { id: 1234 }, chat: { id: 5678, type: "group" }, text: "x" },
    }));
    assert.equal(groupChat.status, 403);
  });

  test("claims, handles, and deduplicates an allowed message update", async () => {
    let calls = 0;
    const handler = createHandler({
      onMessage: async () => {
        calls += 1;
        return { action: "message_received" };
      },
    });
    const first = await handler(request(messageUpdate(10)));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).handled, true);
    const replay = await handler(request(messageUpdate(10)));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).duplicate, true);
    assert.equal(calls, 1);
  });

  test("processes concurrent delivery of one update only once", async () => {
    let calls = 0;
    const handler = createHandler({
      onMessage: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { action: "message_received" };
      },
    });
    const responses = await Promise.all([
      handler(request(messageUpdate(11))),
      handler(request(messageUpdate(11))),
      handler(request(messageUpdate(11))),
    ]);
    assert.equal(calls, 1);
    assert.equal(responses.every((response) => response.status === 200), true);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.equal(bodies.filter((body) => body.handled === true).length, 1);
    assert.equal(bodies.filter((body) => body.inProgress === true).length, 2);
  });

  test("routes an approval callback through the bound store contract", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    await store.appendRevision({
      lessonId: lesson.id,
      content: "# Review me",
      createdBy: "writer",
      changeSummary: "Initial draft",
      operationKey: "revision:telegram",
    });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    await store.transitionLesson(lesson.id, "review_ready", 2);
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-nonce",
      expiresAt: "2026-07-23T01:00:00.000Z",
      operationKey: "challenge:telegram",
    });
    const handler = createHandler({
      resolveApprovalCallback: async ({ callback }) => {
        assert.equal(callback.challengeId, challenge.id);
        return { nonce: "server-nonce" };
      },
    });
    const response = await handler(request(callbackUpdate(20, `approve:${challenge.id}:opaque-token`)));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, "approval_recorded");
    assert.equal((await store.getLesson(lesson.id)).state, "approved");
  });

  test("routes a short approval callback token through the pending challenge lookup", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    await store.appendRevision({
      lessonId: lesson.id,
      content: "# Review me",
      createdBy: "writer",
      changeSummary: "Initial draft",
      operationKey: "revision:telegram-short",
    });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    await store.transitionLesson(lesson.id, "review_ready", 2);
    await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "short-token",
      expiresAt: "2026-07-23T01:00:00.000Z",
      operationKey: "challenge:telegram-short",
    });
    const handler = createHandler({
      resolveApprovalCallback: async ({ callback }) => {
        assert.equal(callback.challengeId, null);
        assert.equal(callback.token, "short-token");
        return { nonce: callback.token };
      },
    });

    const response = await handler(request(callbackUpdate(22, "approve:short-token")));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, "approval_recorded");
    assert.equal((await store.getLesson(lesson.id)).state, "approved");
  });

  test("records deterministic approval rejection without retrying the update", async () => {
    const handler = createHandler({
      resolveApprovalCallback: async () => ({ nonce: "wrong-nonce" }),
    });
    const response = await handler(request(callbackUpdate(21, "approve:challenge_missing:opaque-token")));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rejected, "CHALLENGE_NOT_FOUND");
    const replay = await handler(request(callbackUpdate(21, "approve:challenge_missing:opaque-token")));
    assert.equal((await replay.json()).duplicate, true);
  });

  test("completes failed message updates even when rejection notification fails", async () => {
    const handler = createHandler({
      onMessage: async () => {
        throw new Error("sendMessage failed");
      },
      onApprovalRejected: async () => {
        throw new Error("rejection notification failed");
      },
    });

    const response = await handler(request(messageUpdate(23, { text: "/review" })));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).failed, "WEBHOOK_ERROR");

    const replay = await handler(request(messageUpdate(23, { text: "/review" })));
    assert.equal((await replay.json()).duplicate, true);
  });
});
