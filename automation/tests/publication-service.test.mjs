import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { publicationPath, renderAstroMarkdownPost, taxonomyForPost } from "../publishing/astro-post.mjs";
import { createGitHubAppPublisher } from "../publishing/github-app-publisher.mjs";
import { createPublicationService, PublicationServiceError } from "../publishing/publication-service.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = [
  readFileSync(join(here, "../storage/migrations/0001_lesson_store.sql"), "utf8"),
  readFileSync(join(here, "../storage/migrations/0005_publications.sql"), "utf8"),
].join("\n");

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("publication rendering and service", () => {
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

  async function approvedLesson() {
    const lesson = await store.createLesson({ lessonDate: "2026-07-22", curriculumRef: "M05-W12-D1" });
    const revision = await store.appendRevision({
      lessonId: lesson.id,
      content: "# LLM memory bottleneck\n\nToken generation reads model weights and KV cache.",
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
    return { lesson, revision, approval };
  }

  test("renders an Astro markdown post path and frontmatter", async () => {
    const { lesson, revision } = await approvedLesson();
    assert.equal(
      publicationPath({ lesson, revision, directory: "src/pages/posts" }),
      "src/pages/posts/2026-07-22-m05-w12-d1-r1.md",
    );
    const content = renderAstroMarkdownPost({ lesson, revision });
    assert.match(content, /layout: \.\.\/\.\.\/layouts\/PostLayout\.astro/);
    assert.match(content, /title: "LLM memory bottleneck"/);
    assert.match(content, /category: "LLM"/);
    assert.match(content, /tags: \["LLM", "Transformer", "KV Cache", "Token"\]/);
    assert.match(content, /# LLM memory bottleneck/);
  });

  test("classifies generated posts into blog categories", () => {
    assert.deepEqual(
      taxonomyForPost({
        lesson: { curriculumRef: "M02-W04-D2" },
        content: "# HBM bandwidth\n\nDRAM interface width changes bandwidth.",
      }),
      { category: "Memory", tags: ["Memory", "DRAM", "Bandwidth", "HBM"] },
    );
    assert.equal(
      taxonomyForPost({
        lesson: { curriculumRef: "M05-W12-D1" },
        content: "# Roofline model\n\nGPU kernels can become memory-bound.",
      }).category,
      "System",
    );
  });

  test("publishes through an injected publisher and records success", async () => {
    const { approval } = await approvedLesson();
    const calls = [];
    const service = createPublicationService({
      store,
      publicSiteUrl: "https://example.com",
      publisher: {
        async publishPost(input) {
          calls.push(input);
          return {
            provider: "github",
            branch: "content/daily",
            filePath: input.path,
            commitSha: "commit123",
            pullRequestUrl: "https://github.test/pr/1",
          };
        },
      },
    });

    const publication = await service.publishApprovedRevision({ approval });
    assert.equal(publication.status, "published");
    assert.equal(publication.deploymentUrl, "https://example.com/posts/2026-07-22-m05-w12-d1-r1/");
    assert.equal(calls[0].path, "src/pages/posts/2026-07-22-m05-w12-d1-r1.md");
    assert.equal((await store.getLesson(approval.lessonId)).state, "published");
  });

  test("resumes publication when the lesson is already in publishing state", async () => {
    const { approval } = await approvedLesson();
    await store.startPublishing({ lessonId: approval.lessonId, approvalId: approval.id });
    const service = createPublicationService({
      store,
      publisher: {
        async publishPost(input) {
          return {
            provider: "github",
            branch: "content/daily",
            filePath: input.path,
            commitSha: "commit-resumed",
            pullRequestUrl: "https://github.test/pr/resumed",
          };
        },
      },
    });

    const publication = await service.publishApprovedRevision({ approval });
    assert.equal(publication.status, "published");
    assert.equal(publication.commitSha, "commit-resumed");
    assert.equal((await store.getLesson(approval.lessonId)).state, "published");
  });

  test("records publish failure and surfaces a service error", async () => {
    const { approval } = await approvedLesson();
    const service = createPublicationService({
      store,
      publisher: {
        async publishPost() {
          throw new Error("GitHub rejected the commit");
        },
      },
    });

    await assert.rejects(
      () => service.publishApprovedRevision({ approval }),
      (error) => error instanceof PublicationServiceError && error.code === "PUBLISH_FAILED",
    );
    assert.equal((await store.getLesson(approval.lessonId)).state, "publish_failed");
    const failure = db.database.prepare("SELECT status FROM publications WHERE operation_key LIKE ?1").get(`publication:failure:${approval.id}:%`);
    assert.equal(failure.status, "failed");
  });
});

describe("GitHub App publisher", () => {
  test("creates a branch, writes a file, and opens a pull request", async () => {
    const requests = [];
    const fetchFn = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      requests.push({ path, method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
      if (path === "/app/installations/42/access_tokens") return json({ token: "installation-token" });
      if (path === "/repos/acme/memory") return json({ default_branch: "main" });
      if (path === "/repos/acme/memory/git/ref/heads/content/daily") return json({ message: "Not Found" }, 404);
      if (path === "/repos/acme/memory/git/ref/heads/main") return json({ object: { sha: "base-sha" } });
      if (path === "/repos/acme/memory/git/refs") return json({ object: { sha: "base-sha" } }, 201);
      if (path === "/repos/acme/memory/contents/src/pages/posts/post.md" && method === "GET") {
        return json({ message: "Not Found" }, 404);
      }
      if (path === "/repos/acme/memory/contents/src/pages/posts/post.md" && method === "PUT") {
        return json({ commit: { sha: "commit-sha" }, content: { html_url: "https://github.test/file" } });
      }
      if (path === "/repos/acme/memory/pulls" && method === "GET") return json([]);
      if (path === "/repos/acme/memory/pulls" && method === "POST") {
        return json({ html_url: "https://github.test/pr/1", number: 1 }, 201);
      }
      throw new Error(`unexpected request ${method} ${path}`);
    };
    const publisher = createGitHubAppPublisher({
      appId: "1",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      installationId: "42",
      owner: "acme",
      repo: "memory",
      branch: "content/daily",
      fetchFn,
      jwtFactory: async () => "jwt",
    });

    const result = await publisher.publishPost({
      path: "src/pages/posts/post.md",
      content: "# Post",
      message: "Publish post",
      title: "Publish post",
      body: "Approved",
    });

    assert.equal(result.commitSha, "commit-sha");
    assert.equal(result.pullRequestUrl, "https://github.test/pr/1");
    assert.equal(requests.find((request) => request.method === "PUT").body.branch, "content/daily");
    assert.equal(requests.every((request) => request.headers["user-agent"] === "memory-systems-daily-bot"), true);
  });

  test("surfaces non-JSON GitHub API responses with status and body text", async () => {
    const publisher = createGitHubAppPublisher({
      appId: "1",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      installationId: "42",
      owner: "acme",
      repo: "memory",
      branch: "content/daily",
      fetchFn: async () => new Response("Request forbidden by administrative rules", { status: 403 }),
      jwtFactory: async () => "jwt",
    });

    await assert.rejects(
      () => publisher.publishPost({
        path: "src/pages/posts/post.md",
        content: "# Post",
        message: "Publish post",
        title: "Publish post",
        body: "Approved",
      }),
      (error) => error instanceof Error &&
        error.name === "GitHubPublishError" &&
        error.code === "GITHUB_NON_JSON_RESPONSE" &&
        error.details.status === 403 &&
        error.details.bodyText.includes("Request forbidden"),
    );
  });
});
