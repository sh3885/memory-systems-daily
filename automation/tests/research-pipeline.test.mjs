import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ClaimLedgerError } from "../research/claim-ledger.mjs";
import { createResearchPipeline, ResearchPipelineError } from "../research/research-pipeline.mjs";
import { D1LessonStore, StoreError } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0002_claim_ledger.sql"), "utf8"),
].join("\n");

function sampleClaims(checkedAt = "2026-07-22T00:00:00.000Z") {
  return [
    {
      claimKey: "transformer-attention",
      statement: "Transformer attention uses queries, keys, and values to compute token-to-token weighting.",
      sourceUrl: "https://arxiv.org/abs/1706.03762",
      sourceTitle: "Attention Is All You Need",
      sourceType: "paper",
      evidenceLocator: "Section 3.2",
      confidence: "high",
      verificationStatus: "verified",
      checkedAt,
    },
    {
      claimKey: "hbm-bandwidth",
      statement: "HBM exposes high aggregate bandwidth through a wide, stack-local interface.",
      sourceUrl: "https://www.jedec.org/standards-documents/docs/jesd235",
      sourceTitle: "JEDEC JESD235",
      sourceType: "standard",
      evidenceLocator: "HBM standard landing page",
      confidence: "medium",
      verificationStatus: "needs_review",
      checkedAt,
    },
  ];
}

describe("research pipeline", () => {
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

  test("creates a draft revision and primary-source claim ledger for a curriculum topic", async () => {
    let providerCalls = 0;
    const pipeline = createResearchPipeline({
      store,
      now: () => currentTime,
      researchProvider: async ({ lessonDate, curriculumRef, checkedAt }) => {
        providerCalls += 1;
        assert.equal(lessonDate, "2026-07-23");
        assert.equal(curriculumRef, "M05-W12-D1");
        assert.equal(checkedAt, currentTime);
        return {
          content: "# LLM attention and memory traffic\n\nA first draft.",
          changeSummary: "Drafted from primary sources",
          claims: sampleClaims(checkedAt),
        };
      },
    });

    const result = await pipeline.runLessonResearch({
      lessonDate: "2026-07-23",
      curriculumRef: "M05-W12-D1",
      topic: { title: "LLM 기초와 Transformer" },
      operationKey: "daily:2026-07-23",
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.lesson.state, "draft_ready");
    assert.equal(result.revision.revisionNumber, 1);
    assert.equal(result.ledger.revisionId, result.revision.id);
    assert.equal(result.ledger.claims.length, 2);
    assert.equal(result.ledger.claims[0].claimKey, "hbm-bandwidth");
    assert.equal(result.ledger.claims[1].sourceType, "paper");
    assert.match(result.ledger.claimsHash, /^[a-f0-9]{64}$/);

    const events = db.database.prepare("SELECT event_type FROM lesson_events ORDER BY sequence").all();
    assert.deepEqual(events.map((event) => event.event_type), [
      "state_transition",
      "revision_created",
      "claim_ledger_created",
      "state_transition",
    ]);
  });

  test("replays an already completed research operation without calling the provider", async () => {
    let providerCalls = 0;
    const pipeline = createResearchPipeline({
      store,
      now: () => currentTime,
      researchProvider: async () => {
        providerCalls += 1;
        return {
          content: "# Replay-safe draft",
          changeSummary: "Initial draft",
          claims: sampleClaims(),
        };
      },
    });

    const first = await pipeline.runLessonResearch({
      lessonDate: "2026-07-23",
      curriculumRef: "M05-W12-D1",
      operationKey: "daily:2026-07-23",
    });
    const replay = await pipeline.runLessonResearch({
      lessonDate: "2026-07-23",
      curriculumRef: "M05-W12-D1",
      operationKey: "daily:2026-07-23",
    });

    assert.equal(providerCalls, 1);
    assert.equal(replay.replayed, true);
    assert.equal(replay.revision.id, first.revision.id);
    assert.equal(replay.ledger.id, first.ledger.id);
    assert.equal(replay.lesson.state, "draft_ready");
  });

  test("moves the lesson to research_failed when the provider returns no claims", async () => {
    const pipeline = createResearchPipeline({
      store,
      now: () => currentTime,
      researchProvider: async () => ({
        content: "# Unsupported draft",
        changeSummary: "Missing claim ledger",
        claims: [],
      }),
    });

    await assert.rejects(
      () => pipeline.runLessonResearch({
        lessonDate: "2026-07-23",
        curriculumRef: "M05-W12-D1",
        operationKey: "daily:2026-07-23",
      }),
      (error) => error instanceof ClaimLedgerError && error.code === "NO_CLAIMS",
    );
    const lesson = await store.getLessonByDate("2026-07-23");
    assert.equal(lesson.state, "research_failed");
  });

  test("rejects lessons that are already outside the research window", async () => {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M05-W12-D1" });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    const pipeline = createResearchPipeline({
      store,
      researchProvider: async () => {
        throw new Error("should not be called");
      },
    });

    await assert.rejects(
      () => pipeline.runLessonResearch({
        lessonDate: "2026-07-23",
        curriculumRef: "M05-W12-D1",
        operationKey: "new-operation",
      }),
      (error) => error instanceof ResearchPipelineError && error.code === "LESSON_NOT_RESEARCHABLE",
    );
  });
});

describe("claim ledger store", () => {
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

  async function createRevision() {
    const lesson = await store.createLesson({ lessonDate: "2026-07-23", curriculumRef: "M05-W12-D1" });
    return store.appendRevision({
      lessonId: lesson.id,
      content: "# Claim test",
      createdBy: "researcher",
      changeSummary: "Initial",
      operationKey: "revision:claim-test",
    });
  }

  test("keeps a revision claim ledger immutable and idempotent by operation key", async () => {
    const revision = await createRevision();
    const input = {
      revisionId: revision.id,
      claims: sampleClaims(),
      createdBy: "researcher",
      operationKey: "claims:claim-test",
    };
    const ledger = await store.recordClaimLedger(input);
    const replay = await store.recordClaimLedger(input);
    assert.equal(replay.id, ledger.id);
    assert.equal((await store.getClaimsForRevision(revision.id)).length, 2);
    assert.throws(() => db.exec(`UPDATE claims SET statement = 'changed' WHERE revision_id = '${revision.id}'`), /immutable/);
    assert.throws(() => db.exec(`DELETE FROM claim_ledgers WHERE id = '${ledger.id}'`), /immutable/);
  });

  test("rejects operation-key reuse and multiple ledgers for one revision", async () => {
    const revision = await createRevision();
    await store.recordClaimLedger({
      revisionId: revision.id,
      claims: sampleClaims(),
      createdBy: "researcher",
      operationKey: "claims:claim-test",
    });

    await assert.rejects(
      () => store.recordClaimLedger({
        revisionId: revision.id,
        claims: [sampleClaims()[0]],
        createdBy: "researcher",
        operationKey: "claims:claim-test",
      }),
      (error) => error instanceof StoreError && error.code === "OPERATION_KEY_CONFLICT",
    );
    await assert.rejects(
      () => store.recordClaimLedger({
        revisionId: revision.id,
        claims: sampleClaims(),
        createdBy: "researcher",
        operationKey: "claims:second-key",
      }),
      (error) => error instanceof StoreError && error.code === "CLAIM_LEDGER_CONFLICT",
    );
  });
});
