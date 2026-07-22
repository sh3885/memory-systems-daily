import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { D1LessonStore, StoreError } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0003_conversation_ledger.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0004_conversation_provider_metadata.sql"), "utf8"),
].join("\n");

describe("conversation ledger store", () => {
  let db;
  let store;
  let idIndex;

  beforeEach(() => {
    db = new NodeD1Database(schema);
    idIndex = 0;
    store = new D1LessonStore(db, {
      now: () => "2026-07-22T00:00:00.000Z",
      id: (prefix) => `${prefix}_${++idIndex}`,
    });
  });

  afterEach(() => db.close());

  async function createLessonRevision() {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M07-W18-D1" });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content: "# draft",
      createdBy: "researcher",
      changeSummary: "Initial",
      operationKey: "revision:initial",
    });
    return { lesson, revision };
  }

  test("records immutable conversation turns idempotently", async () => {
    const { lesson, revision } = await createLessonRevision();
    const input = {
      lessonId: lesson.id,
      revisionId: revision.id,
      telegramUpdateId: 10,
      telegramUserId: "1234",
      telegramChatId: "5678",
      question: "KV cache가 뭐야?",
      answer: "KV cache는 decode 중 재사용되는 key/value tensor야.",
      status: "answered",
      provider: {
        id: "openai",
        model: "gpt-5.6",
        attempts: [{ providerId: "anthropic", model: "claude-sonnet-5", reason: "rate_limit", code: "ANTHROPIC_HTTP_ERROR", status: 429 }],
      },
      operationKey: "telegram:conversation:10",
    };
    const turn = await store.recordConversationTurn(input);
    const replay = await store.recordConversationTurn(input);
    assert.equal(replay.id, turn.id);
    assert.equal(turn.providerId, "openai");
    assert.equal(turn.providerModel, "gpt-5.6");
    assert.deepEqual(turn.providerAttempts, [{
      providerId: "anthropic",
      model: "claude-sonnet-5",
      reason: "rate_limit",
      code: "ANTHROPIC_HTTP_ERROR",
      status: 429,
    }]);
    assert.equal((await store.getConversationTurnsForLesson(lesson.id)).length, 1);
    assert.throws(() => db.exec(`UPDATE conversation_turns SET answer = 'changed' WHERE id = '${turn.id}'`), /immutable/);
    assert.throws(() => db.exec(`DELETE FROM conversation_turns WHERE id = '${turn.id}'`), /immutable/);
  });

  test("rejects operation key reuse with different content", async () => {
    const { lesson, revision } = await createLessonRevision();
    await store.recordConversationTurn({
      lessonId: lesson.id,
      revisionId: revision.id,
      telegramUpdateId: 10,
      telegramUserId: "1234",
      telegramChatId: "5678",
      question: "Q1",
      answer: "A1",
      status: "answered",
      provider: { id: "anthropic", model: "claude-sonnet-5", attempts: [] },
      operationKey: "telegram:conversation:10",
    });

    await assert.rejects(
      () => store.recordConversationTurn({
        lessonId: lesson.id,
        revisionId: revision.id,
        telegramUpdateId: 10,
        telegramUserId: "1234",
        telegramChatId: "5678",
        question: "Q2",
        answer: "A1",
        status: "answered",
        provider: { id: "anthropic", model: "claude-sonnet-5", attempts: [] },
        operationKey: "telegram:conversation:10",
      }),
      (error) => error instanceof StoreError && error.code === "OPERATION_KEY_CONFLICT",
    );
  });
});
