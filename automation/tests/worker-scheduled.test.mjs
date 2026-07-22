import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../telegram/worker.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0002_claim_ledger.sql"), "utf8"),
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
  let openAIRequests;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    db = new NodeD1Database(schema);
    telegramMessages = [];
    openAIRequests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/responses")) {
        openAIRequests.push({ url, body });
        return jsonResponse({
          output_text: JSON.stringify({
            content: "# Daily draft\n\nA memory-systems learning draft.",
            changeSummary: "Created scheduled research draft",
            claims: [{
              claimKey: "attention-paper",
              statement: "Transformer attention uses query, key, and value projections.",
              sourceUrl: "https://arxiv.org/abs/1706.03762",
              sourceTitle: "Attention Is All You Need",
              sourceType: "paper",
              evidenceLocator: "Section 3.2",
              confidence: "high",
              verificationStatus: "verified",
              checkedAt: "2026-07-22T00:00:00.000Z",
            }],
          }),
        });
      }
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

  test("creates a lesson, research draft, claim ledger, and Telegram notification", async () => {
    const result = await worker.scheduled({
      cron: "30 23 * * *",
      scheduledTime: "2026-07-21T23:30:00.000Z",
    }, {
      DB: db,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_ALLOWED_CHAT_ID: "5678",
      DAILY_CURRICULUM_REF: "M07-W18-D1",
      OPENAI_API_KEY: "sk-test",
      AI_MODEL: "gpt-5.6",
    });

    assert.equal(result.lessonDate, "2026-07-22");
    assert.equal(result.research.lesson.state, "draft_ready");
    assert.equal(result.research.ledger.claims.length, 1);
    assert.equal(openAIRequests[0].body.metadata.workflow, "daily_research_draft");
    assert.match(telegramMessages[0].text, /revision 1/);
  });
});
