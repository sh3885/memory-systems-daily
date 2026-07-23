import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPublicationService } from "../publishing/publication-service.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { createApprovalPromptService, createLessonCommandRouter } from "../telegram/lesson-command-router.mjs";
import { createTelegramWebhook } from "../telegram/telegram-webhook.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0005_publications.sql"), "utf8"),
].join("\n");

const env = {
  TELEGRAM_BOT_ID: "study-bot",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_ALLOWED_USER_ID: "1234",
  TELEGRAM_ALLOWED_CHAT_ID: "5678",
};

function message(updateId, text) {
  return {
    update_id: updateId,
    message: { message_id: updateId, from: { id: 1234 }, chat: { id: 5678, type: "private" }, text },
  };
}

function callback(updateId, data) {
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

function request(update) {
  return new Request("https://example.test/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify(update),
  });
}

describe("publish workflow integration", () => {
  let db;

  beforeEach(() => { db = new NodeD1Database(schema); });
  afterEach(() => db.close());

  test("runs Markdown draft through review, approval, main publishing, and deployment verification", async () => {
    let id = 0;
    const store = new D1LessonStore(db, {
      now: () => "2026-07-23T00:00:00.000Z",
      id: (prefix) => `${prefix}_${++id}`,
    });
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01-D4" });
    const sent = [];
    const telegram = {
      sendMessage: async (value) => { sent.push(value); return { message_id: sent.length }; },
      answerCallbackQuery: async () => true,
    };
    const writes = [];
    const publicationService = createPublicationService({
      store,
      contentDirectory: "src/pages/posts",
      publicSiteUrl: "https://memory-systems-daily.pages.dev",
      publisher: {
        async publishPost(input) {
          writes.push(input);
          return { provider: "github", branch: "main", filePath: input.path, commitSha: "commit-test", pullRequestUrl: null };
        },
      },
      deploymentVerifier: async ({ postUrl, title, path }) => {
        assert.match(postUrl, /m01-w01-d4-r1/);
        assert.match(title, /^Workflow test/);
        assert.match(path, /m01-w01-d4-r1/);
        return { verified: true, postUrl };
      },
    });
    const router = createLessonCommandRouter({
      store,
      telegram,
      now: () => "2026-07-23T08:30:00+09:00",
      approvalPrompt: createApprovalPromptService({ store, now: () => "2026-07-23T00:00:00.000Z", tokenFactory: () => "approve-token" }),
      publicationRetry: async ({ lesson: current }) => publicationService.publishApprovedRevision({
        approval: await store.getActiveApprovalForLesson(current.id),
      }),
    });
    const handler = createTelegramWebhook({
      env,
      store,
      onMessage: router.onMessage,
      onCallback: router.onCallback,
      resolveApprovalCallback: async () => ({ nonce: "approve-token" }),
      onApprovalRecorded: async ({ approval }) => {
        const publication = await publicationService.publishApprovedRevision({ approval });
        return { action: "publication_published", publicationId: publication.id };
      },
    });

    assert.equal((await (await handler(request(message(1, "/draft # Workflow test\n\nA complete publishing workflow test.")))).json()).action, "manual_draft_saved");
    assert.equal((await (await handler(request(message(2, "/review")))).json()).action, "review_ready_with_approval");
    const callbackData = sent.at(-1).replyMarkup.inline_keyboard[0][0].callback_data;
    const result = await (await handler(request(callback(3, callbackData)))).json();

    assert.equal(result.action, "publication_published", JSON.stringify({ result, publication: await store.getLatestPublicationForLesson(lesson.id) }));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "src/pages/posts/2026-07-23-m01-w01-d4-r1.md");
    assert.match(writes[0].content, /title: "Workflow test/);
    assert.equal((await store.getLesson(lesson.id)).state, "published");
    assert.equal((await store.getLatestPublicationForLesson(lesson.id)).status, "published");
  });
});
