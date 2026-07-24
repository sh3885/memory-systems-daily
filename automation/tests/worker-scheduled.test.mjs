import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../telegram/worker.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0002_claim_ledger.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0005_publications.sql"), "utf8"),
].join("\n");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Worker scheduled lesson flow", () => {
  let originalFetch;
  let db;
  let telegramMessages;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    db = new NodeD1Database(schema);
    telegramMessages = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).includes("/sendMessage")) {
        telegramMessages.push(body);
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });

  test("creates a lesson and sends a manual Claude prompt notification", async () => {
    const result = await worker.scheduled({
      cron: "30 23 * * *",
      scheduledTime: "2026-07-21T23:30:00.000Z",
    }, {
      DB: db,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_ALLOWED_CHAT_ID: "5678",
      DAILY_CURRICULUM_REF: "M07-W18-D1",
      AI_MODE: "manual",
    });

    assert.equal(result.lessonDate, "2026-07-22");
    assert.equal(result.lesson.state, "scheduled");
    assert.match(telegramMessages[0].text, /\/prompt/);
  });

  test("continues from the most recently published curriculum item", async () => {
    let id = 0;
    const store = new D1LessonStore(db, {
      now: () => "2026-07-23T01:00:00.000Z",
      id: (prefix) => `${prefix}_${++id}`,
    });
    const published = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01-D3" });
    const revision = await store.appendRevision({
      lessonId: published.id,
      content: "# D3",
      createdBy: "writer",
      changeSummary: "initial",
      operationKey: "revision:d3",
    });
    await store.transitionLesson(published.id, "researching", 0);
    await store.transitionLesson(published.id, "draft_ready", 1);
    await store.transitionLesson(published.id, "review_ready", 2);
    const challenge = await store.issueApprovalChallenge({
      lessonId: published.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "d3-nonce",
      expiresAt: "2026-07-24T01:00:00.000Z",
      operationKey: "challenge:d3",
    });
    const approval = await store.consumeApprovalChallenge({
      challengeId: challenge.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "d3-nonce",
      operationKey: "approval:d3",
    });
    await store.startPublishing({ lessonId: published.id, approvalId: approval.id });
    await store.recordPublicationSuccess({
      lessonId: published.id,
      revisionId: revision.id,
      approvalId: approval.id,
      operationKey: "publication:d3",
      provider: "github",
      branch: "main",
      filePath: "post.md",
      commitSha: "sha",
      deploymentUrl: "https://example.test/d3",
    });

    const result = await worker.scheduled({
      cron: "30 23 * * *",
      scheduledTime: "2026-07-23T23:30:00.000Z",
    }, {
      DB: db,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_ALLOWED_CHAT_ID: "5678",
      DAILY_CURRICULUM_REF: "M01-W01-D1",
      AI_MODE: "manual",
    });

    assert.equal(result.lessonDate, "2026-07-24");
    assert.equal(result.curriculumRef, "M01-W01-D4");
  });
});

describe("Worker Telegram manual/api hybrid flow", () => {
  let originalFetch;
  let db;
  let requests;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    db = new NodeD1Database([
      readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
      readFileSync(join(here, "../storage/migrations/0003_conversation_ledger.sql"), "utf8"),
      readFileSync(join(here, "../storage/migrations/0004_conversation_provider_metadata.sql"), "utf8"),
    ].join("\n"));
    requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url: String(url), body });
      if (String(url).endsWith("/messages")) {
        return jsonResponse({
          content: [{ type: "text", text: "Claude API 답변" }],
          model: "claude-sonnet-5",
        });
      }
      if (String(url).includes("/sendMessage")) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });

  test("uses manual prompt by default and Claude API only for /ask-api", async () => {
    db.exec(`
      INSERT INTO lessons (id, lesson_date, curriculum_ref, state, state_version, created_at, updated_at)
      VALUES ('lesson_1', '2026-07-22', 'M07-W18-D1', 'scheduled', 0, 't0', 't0')
    `);
    db.exec(`
      INSERT INTO revisions (
        id, lesson_id, revision_number, content, content_hash, created_by, change_summary, operation_key, created_at
      ) VALUES (
        'revision_1', 'lesson_1', 1, '# draft', '${"a".repeat(64)}', 'researcher', 'initial', 'revision:initial', 't1'
      )
    `);
    db.exec("UPDATE lessons SET state = 'researching', state_version = 1, updated_at = 't2' WHERE id = 'lesson_1'");
    db.exec("UPDATE lessons SET state = 'draft_ready', state_version = 2, updated_at = 't3' WHERE id = 'lesson_1'");

    const request = new Request("https://example.test/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "secret",
      },
      body: JSON.stringify({
        update_id: 100,
        message: {
          message_id: 100,
          from: { id: 1234 },
          chat: { id: 5678, type: "private" },
          text: "KV cache 설명해줘",
        },
      }),
    });

    const response = await worker.fetch(request, {
      DB: db,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_BOT_ID: "study-bot",
      TELEGRAM_WEBHOOK_SECRET: "secret",
      TELEGRAM_ALLOWED_USER_ID: "1234",
      TELEGRAM_ALLOWED_CHAT_ID: "5678",
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_MODEL: "claude-sonnet-5",
      AI_MODE: "manual",
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, "manual_question_prompt_sent");
    assert.equal(requests.some((requestLog) => requestLog.url.endsWith("/messages")), false);
    const telegram = requests.find((requestLog) => requestLog.url.includes("/sendMessage"));
    assert.match(telegram.body.text, /아래 질문에 답해줘/);
    assert.doesNotMatch(telegram.body.text, /Claude 웹/);

    requests = [];
    const apiRequest = new Request("https://example.test/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "secret",
      },
      body: JSON.stringify({
        update_id: 101,
        message: {
          message_id: 101,
          from: { id: 1234 },
          chat: { id: 5678, type: "private" },
          text: "/ask-api KV cache 설명해줘",
        },
      }),
    });
    const apiResponse = await worker.fetch(apiRequest, {
      DB: db,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_BOT_ID: "study-bot",
      TELEGRAM_WEBHOOK_SECRET: "secret",
      TELEGRAM_ALLOWED_USER_ID: "1234",
      TELEGRAM_ALLOWED_CHAT_ID: "5678",
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_MODEL: "claude-sonnet-5",
      AI_MODE: "manual",
    });

    assert.equal(apiResponse.status, 200);
    assert.equal((await apiResponse.json()).action, "question_answered");
    assert.equal(requests.some((requestLog) => requestLog.url.endsWith("/messages")), true);
    const apiTelegram = requests.find((requestLog) => requestLog.url.includes("/sendMessage"));
    assert.match(apiTelegram.body.text, /Claude API 답변/);
    const turn = db.database.prepare("SELECT provider_id, provider_model FROM conversation_turns").get();
    assert.equal(turn.provider_id, "anthropic");
    assert.equal(turn.provider_model, "claude-sonnet-5");
  });
});
