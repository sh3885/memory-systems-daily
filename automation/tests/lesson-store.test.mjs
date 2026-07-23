import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertTransition,
  canTransition,
  canonicalizeContent,
  DomainError,
  LESSON_STATES,
  sha256Hex,
} from "../domain/lesson-state.mjs";
import { D1LessonStore, StoreError } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8");
const expectedTransitions = new Set([
  "scheduled->researching",
  "researching->draft_ready",
  "researching->research_failed",
  "research_failed->researching",
  "draft_ready->discussing",
  "draft_ready->review_ready",
  "discussing->review_ready",
  "review_ready->discussing",
  "review_ready->approved",
  "approved->discussing",
  "approved->publishing",
  "publishing->published",
  "publishing->publish_failed",
  "publish_failed->discussing",
  "publish_failed->publishing",
]);

describe("lesson domain", () => {
  test("defines every allowed and rejected transition", () => {
    for (const from of LESSON_STATES) {
      for (const to of LESSON_STATES) {
        assert.equal(canTransition(from, to), expectedTransitions.has(`${from}->${to}`), `${from} -> ${to}`);
      }
    }
    assert.throws(() => assertTransition("scheduled", "approved"), (error) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal(error.code, "ILLEGAL_TRANSITION");
      return true;
    });
  });

  test("canonicalizes Unicode and line endings before SHA-256", async () => {
    const decomposed = "me\u0301moire\r\nline two\r";
    const composed = "m\u00e9moire\nline two\n";
    assert.equal(canonicalizeContent(decomposed), composed);
    assert.equal(await sha256Hex(decomposed), await sha256Hex(composed));
    assert.equal(
      await sha256Hex("memory"),
      "c064fbca9d9de8dd9bb0624984403b28d0da807a69365d4f7fb09123ecb0c405",
    );
  });
});

describe("D1 lesson store", () => {
  let db;
  let store;
  let currentTime;
  let idIndex;

  beforeEach(() => {
    db = new NodeD1Database(schema);
    currentTime = "2026-07-22T00:00:00.000Z";
    idIndex = 0;
    store = new D1LessonStore(db, {
      now: () => currentTime,
      id: (prefix) => `${prefix}_${++idIndex}`,
    });
  });

  afterEach(() => db.close());

  async function prepareReviewReady(content = "# Review me") {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content,
      createdBy: "content-writer",
      changeSummary: "Initial draft",
      operationKey: "revision:initial",
    });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    await store.transitionLesson(lesson.id, "review_ready", 2);
    return { lesson: await store.getLesson(lesson.id), revision };
  }

  async function approveLesson(lessonId, overrides = {}) {
    const challenge = await store.issueApprovalChallenge({
      lessonId,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-issued-nonce",
      expiresAt: "2026-07-23T01:00:00.000Z",
      operationKey: "challenge:initial",
      ...overrides.challenge,
    });
    const approval = await store.consumeApprovalChallenge({
      challengeId: challenge.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-issued-nonce",
      operationKey: "approval:initial",
      ...overrides.consume,
    });
    return { challenge, approval };
  }

  test("creates idempotent lessons per date and curriculum item", async () => {
    const first = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    const duplicate = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    assert.equal(duplicate.id, first.id);
    const second = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M02-W01" });
    assert.notEqual(second.id, first.id);
    assert.equal((await store.getLessonsByDate("2026-07-23")).length, 2);
  });

  test("keeps non-sensitive database transitions aligned with the domain matrix", () => {
    for (const from of LESSON_STATES) {
      for (const to of LESSON_STATES) {
        const sensitive = to === "approved" || to === "publishing";
        const pairDb = new NodeD1Database(schema);
        pairDb.exec(`
          INSERT INTO lessons (id, lesson_date, curriculum_ref, state, state_version, created_at, updated_at)
          VALUES ('pair', '2026-07-23', 'M01-W01', '${from}', 0, 't0', 't0')
        `);
        const update = () => pairDb.exec(`
          UPDATE lessons SET state = '${to}', state_version = 1, updated_at = 't1' WHERE id = 'pair'
        `);
        if (expectedTransitions.has(`${from}->${to}`) && !sensitive) assert.doesNotThrow(update, `${from} -> ${to}`);
        if (!expectedTransitions.has(`${from}->${to}`)) assert.throws(update, undefined, `${from} -> ${to}`);
        pairDb.close();
      }
    }
  });

  test("uses optimistic state versions", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    await store.transitionLesson(lesson.id, "researching", 0);
    await assert.rejects(
      () => store.transitionLesson(lesson.id, "draft_ready", 0),
      (error) => error instanceof StoreError && error.code === "VERSION_CONFLICT",
    );
  });

  test("keeps revisions immutable, monotonic, and idempotent by operation key", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    const input = {
      lessonId: lesson.id,
      content: "line one\r\nline two",
      createdBy: "writer",
      changeSummary: "v1",
      operationKey: "telegram:bot-a:10",
    };
    const revision = await store.appendRevision(input);
    const replay = await store.appendRevision(input);
    assert.equal(replay.id, revision.id);
    assert.equal(revision.content, "line one\nline two");
    assert.equal((await store.getLesson(lesson.id)).currentRevisionNumber, 1);
    await assert.rejects(
      () => store.appendRevision({ ...input, content: "different payload" }),
      (error) => error instanceof StoreError && error.code === "OPERATION_KEY_CONFLICT",
    );
    assert.throws(() => db.exec(`UPDATE revisions SET content = 'changed' WHERE id = '${revision.id}'`), /immutable/);
    assert.throws(() => db.exec(`DELETE FROM revisions WHERE id = '${revision.id}'`), /immutable/);
  });

  test("rejects concurrent operation-key reuse with a different revision payload", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    const base = {
      lessonId: lesson.id,
      createdBy: "writer",
      changeSummary: "concurrent",
      operationKey: "telegram:bot-a:11",
    };
    const results = await Promise.allSettled([
      store.appendRevision({ ...base, content: "payload A" }),
      store.appendRevision({ ...base, content: "payload B" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "OPERATION_KEY_CONFLICT");
  });

  test("protects the current revision pointer with a composite foreign key", async () => {
    const { lesson, revision } = await prepareReviewReady();
    assert.throws(() => db.exec(`
      UPDATE lesson_heads
      SET revision_id = 'missing', revision_number = 2, content_hash = '${"a".repeat(64)}'
      WHERE lesson_id = '${lesson.id}'
    `), /FOREIGN KEY constraint failed/);
    assert.throws(() => db.exec(`
      UPDATE lesson_heads
      SET revision_id = '${revision.id}', revision_number = 1, content_hash = '${revision.contentHash}'
      WHERE lesson_id = '${lesson.id}'
    `), /advance by one revision/);
    assert.throws(() => db.exec(`DELETE FROM lesson_heads WHERE lesson_id = '${lesson.id}'`), /cannot be deleted/);
  });

  test("cannot enter approved or publishing through the generic transition API or direct SQL", async () => {
    const { lesson } = await prepareReviewReady();
    await assert.rejects(
      () => store.transitionLesson(lesson.id, "approved", 3),
      (error) => error instanceof StoreError && error.code === "SENSITIVE_TRANSITION",
    );
    assert.throws(() => db.exec(`
      UPDATE lessons SET state = 'approved', state_version = 4, updated_at = '2026-07-22T00:01:00.000Z'
      WHERE id = '${lesson.id}'
    `), /current unexpired approval is required/);
  });

  test("binds a challenge to user, chat, nonce, revision, and hash", async () => {
    const { lesson, revision } = await prepareReviewReady();
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-issued-nonce",
      expiresAt: "2026-07-23T01:00:00+00:00",
      operationKey: "challenge:1",
    });
    assert.equal(challenge.revisionId, revision.id);
    assert.equal(challenge.contentHash, revision.contentHash);
    assert.equal(challenge.expiresAt, "2026-07-23T01:00:00.000Z");
    await assert.rejects(
      () => store.issueApprovalChallenge({
        lessonId: lesson.id,
        telegramUserId: "attacker",
        telegramChatId: "5678",
        nonce: "server-issued-nonce",
        expiresAt: "2026-07-23T01:00:00.000Z",
        operationKey: "challenge:1",
      }),
      (error) => error instanceof StoreError && error.code === "OPERATION_KEY_CONFLICT",
    );

    for (const mismatch of [
      { telegramUserId: "9999", telegramChatId: "5678", nonce: "server-issued-nonce" },
      { telegramUserId: "1234", telegramChatId: "9999", nonce: "server-issued-nonce" },
      { telegramUserId: "1234", telegramChatId: "5678", nonce: "wrong" },
    ]) {
      await assert.rejects(
        () => store.consumeApprovalChallenge({
          challengeId: challenge.id,
          operationKey: `approval:mismatch:${mismatch.telegramUserId}:${mismatch.telegramChatId}:${mismatch.nonce}`,
          ...mismatch,
        }),
        (error) => error instanceof StoreError && error.code === "APPROVAL_IDENTITY_MISMATCH",
      );
    }
    assert.equal((await store.getChallenge(challenge.id)).status, "pending");
  });

  test("finds and invalidates pending approval challenges", async () => {
    const { lesson } = await prepareReviewReady();
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-issued-nonce",
      expiresAt: "2026-07-23T01:00:00.000Z",
      operationKey: "challenge:find",
    });

    assert.equal((await store.findPendingChallengeByNonce({ nonce: "server-issued-nonce" })).id, challenge.id);
    assert.equal(await store.findPendingChallengeByNonce({ nonce: "wrong" }), null);

    const result = await store.invalidatePendingApprovalChallenges({ lessonId: lesson.id, reason: "test_reset" });
    assert.equal(result.invalidated, 1);
    assert.equal((await store.getChallenge(challenge.id)).status, "invalidated");
    assert.equal(await store.findPendingChallengeByNonce({ nonce: "server-issued-nonce" }), null);
  });

  test("rejects concurrent operation-key reuse with a different challenge binding", async () => {
    const { lesson } = await prepareReviewReady();
    const base = {
      lessonId: lesson.id,
      telegramChatId: "5678",
      nonce: "concurrent-nonce",
      expiresAt: "2026-07-23T01:00:00.000Z",
      operationKey: "challenge:concurrent",
    };
    const results = await Promise.allSettled([
      store.issueApprovalChallenge({ ...base, telegramUserId: "1234" }),
      store.issueApprovalChallenge({ ...base, telegramUserId: "9999" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "OPERATION_KEY_CONFLICT");
  });

  test("consumes a challenge atomically and makes replay idempotent", async () => {
    const { lesson } = await prepareReviewReady();
    const { challenge, approval } = await approveLesson(lesson.id);
    const replay = await store.consumeApprovalChallenge({
      challengeId: challenge.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "server-issued-nonce",
      operationKey: "approval:replay",
    });
    assert.equal(replay.id, approval.id);
    assert.equal((await store.getChallenge(challenge.id)).status, "consumed");
    assert.equal((await store.getLesson(lesson.id)).state, "approved");
  });

  test("expires an unconsumed challenge without changing the lesson", async () => {
    const { lesson } = await prepareReviewReady();
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "short-lived",
      expiresAt: "2026-07-22T00:01:00.000Z",
      operationKey: "challenge:short",
    });
    currentTime = "2026-07-22T00:02:00.000Z";
    await assert.rejects(
      () => store.consumeApprovalChallenge({
        challengeId: challenge.id,
        telegramUserId: "1234",
        telegramChatId: "5678",
        nonce: "short-lived",
        operationKey: "approval:expired",
      }),
      (error) => error instanceof StoreError && error.code === "APPROVAL_EXPIRED",
    );
    assert.equal((await store.getChallenge(challenge.id)).status, "expired");
    assert.equal((await store.getLesson(lesson.id)).state, "review_ready");
  });

  test("invalidates accepted approval and pending challenge when a new revision is created", async () => {
    const { lesson, revision: first } = await prepareReviewReady("same content");
    const { approval } = await approveLesson(lesson.id);
    const second = await store.appendRevision({
      lessonId: lesson.id,
      content: "same content",
      createdBy: "writer",
      changeSummary: "Q&A revision",
      operationKey: "revision:second",
    });
    assert.equal(first.contentHash, second.contentHash);
    assert.notEqual(first.id, second.id);
    assert.equal((await store.getApproval(approval.id)).status, "invalidated");
    assert.equal((await store.getLesson(lesson.id)).state, "discussing");
    await assert.rejects(
      () => store.startPublishing({ lessonId: lesson.id, approvalId: approval.id }),
      (error) => error instanceof StoreError && error.code === "STALE_APPROVAL",
    );
  });

  test("prevents stale approval fields from being reactivated or rewritten", async () => {
    const { lesson } = await prepareReviewReady();
    const { approval } = await approveLesson(lesson.id);
    assert.throws(() => db.exec(`UPDATE approvals SET telegram_user_id = 'attacker' WHERE id = '${approval.id}'`), /immutable/);
    db.exec(`UPDATE approvals SET status = 'invalidated', invalidated_at = 't1', invalidation_reason = 'test' WHERE id = '${approval.id}'`);
    assert.throws(() => db.exec(`UPDATE approvals SET status = 'active' WHERE id = '${approval.id}'`), /illegal approval transition/);
  });

  test("requires a current unexpired approval to start publishing", async () => {
    const { lesson } = await prepareReviewReady();
    const { approval } = await approveLesson(lesson.id);
    const publishing = await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    assert.equal(publishing.state, "publishing");
  });

  test("resumes publishing idempotently when the start step already committed", async () => {
    const { lesson } = await prepareReviewReady();
    const { approval } = await approveLesson(lesson.id);
    const first = await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    const retry = await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });

    assert.equal(first.state, "publishing");
    assert.equal(retry.state, "publishing");
    assert.equal(retry.stateVersion, first.stateVersion);
  });

  test("retries publishing after failure only through the approval-gated method", async () => {
    const { lesson } = await prepareReviewReady();
    const { approval } = await approveLesson(lesson.id);
    await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    const failed = await store.transitionLesson(lesson.id, "publish_failed", 5);
    assert.equal(failed.state, "publish_failed");
    await assert.rejects(
      () => store.transitionLesson(lesson.id, "publishing", 6),
      (error) => error instanceof StoreError && error.code === "SENSITIVE_TRANSITION",
    );
    const retry = await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    assert.equal(retry.state, "publishing");
    assert.equal(retry.stateVersion, 7);
  });

  test("blocks revisions while publishing and after publication", async () => {
    const { lesson } = await prepareReviewReady();
    const { approval } = await approveLesson(lesson.id);
    await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    await assert.rejects(
      () => store.appendRevision({
        lessonId: lesson.id,
        content: "late edit",
        createdBy: "writer",
        changeSummary: "late",
        operationKey: "revision:late-publishing",
      }),
      (error) => error instanceof StoreError && error.code === "REVISION_CONFLICT",
    );
    await store.transitionLesson(lesson.id, "published", 5);
    await assert.rejects(
      () => store.appendRevision({
        lessonId: lesson.id,
        content: "post-publish edit",
        createdBy: "writer",
        changeSummary: "late",
        operationKey: "revision:late-published",
      }),
      (error) => error instanceof StoreError && error.code === "REVISION_CONFLICT",
    );
  });

  test("keeps domain events append-only and Telegram updates unique", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M01-W01" });
    await store.transitionLesson(lesson.id, "researching", 0);
    assert.throws(() => db.exec("UPDATE lesson_events SET event_type = 'changed'"), /append-only/);
    assert.throws(() => db.exec("DELETE FROM lesson_events"), /append-only/);
    db.exec("INSERT INTO processed_telegram_updates VALUES ('bot-a', 10, 't0', NULL, NULL)");
    assert.throws(
      () => db.exec("INSERT INTO processed_telegram_updates VALUES ('bot-a', 10, 't1', NULL, NULL)"),
      /UNIQUE constraint failed/,
    );
  });
});
