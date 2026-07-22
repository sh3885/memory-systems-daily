import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0005_publications.sql"), "utf8"),
].join("\n");

describe("publication store", () => {
  let db;
  let store;
  let idIndex;
  let currentTime;

  beforeEach(() => {
    db = new NodeD1Database(schema);
    idIndex = 0;
    currentTime = "2026-07-22T00:00:00.000Z";
    store = new D1LessonStore(db, {
      now: () => currentTime,
      id: (prefix) => `${prefix}_${++idIndex}`,
    });
  });

  afterEach(() => db.close());

  async function approvedPublishingLesson() {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M05-W12-D1" });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content: "# Draft\n\nBody",
      createdBy: "writer",
      changeSummary: "initial",
      operationKey: "revision:initial",
    });
    await store.transitionLesson(lesson.id, "researching", 0);
    await store.transitionLesson(lesson.id, "draft_ready", 1);
    await store.transitionLesson(lesson.id, "review_ready", 2);
    const challenge = await store.issueApprovalChallenge({
      lessonId: lesson.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "nonce",
      expiresAt: "2026-07-23T00:00:00.000Z",
      operationKey: "challenge:initial",
    });
    const approval = await store.consumeApprovalChallenge({
      challengeId: challenge.id,
      telegramUserId: "1234",
      telegramChatId: "5678",
      nonce: "nonce",
      operationKey: "approval:initial",
    });
    await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    return { lesson: await store.getLesson(lesson.id), revision, approval };
  }

  test("records a successful publication and marks approval consumed", async () => {
    const { lesson, revision, approval } = await approvedPublishingLesson();
    currentTime = "2026-07-22T00:01:00.000Z";
    const publication = await store.recordPublicationSuccess({
      lessonId: lesson.id,
      revisionId: revision.id,
      approvalId: approval.id,
      operationKey: "publication:success",
      provider: "github",
      branch: "content/daily",
      filePath: "src/pages/posts/2026-07-22-m05-w12-d1-r1.md",
      commitSha: "abc123",
      pullRequestUrl: "https://github.test/pr/1",
      deploymentUrl: "https://github.test/pr/1",
    });

    assert.equal(publication.status, "published");
    assert.equal((await store.getLesson(lesson.id)).state, "published");
    assert.equal((await store.getApproval(approval.id)).status, "consumed");
    assert.equal((await store.findPublicationByOperationKey("publication:success")).id, publication.id);
  });

  test("records a failed publication and allows publishing retry state", async () => {
    const { lesson, revision, approval } = await approvedPublishingLesson();
    const publication = await store.recordPublicationFailure({
      lessonId: lesson.id,
      revisionId: revision.id,
      approvalId: approval.id,
      operationKey: "publication:failure",
      provider: "github",
      errorMessage: "GitHub API failed",
    });

    assert.equal(publication.status, "failed");
    assert.equal((await store.getLesson(lesson.id)).state, "publish_failed");
    assert.equal((await store.getApproval(approval.id)).status, "active");

    const retry = await store.startPublishing({ lessonId: lesson.id, approvalId: approval.id });
    assert.equal(retry.state, "publishing");
  });
});
