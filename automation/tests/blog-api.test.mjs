import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createBlogApi } from "../blog/blog-api.mjs";
import { D1BlogStore } from "../blog/blog-store.mjs";
import { renderAdminMarkdownPost } from "../publishing/admin-post.mjs";
import { NodeD1Database } from "./node-d1-adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "../storage/migrations/0006_blog_operations.sql"), "utf8");

function request(path, init = {}) {
  return new Request(`https://worker.test${path}`, init);
}

describe("blog API", () => {
  test("records page visits with total, daily, and unique counters", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, {
      now: () => "2026-07-23T03:00:00.000Z",
      id: (prefix) => `${prefix}_1`,
    });
    const api = createBlogApi({ env: { PUBLIC_SITE_URL: "https://example.com" }, store });

    let response = await api(request("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ path: "/posts/test/", visitorKey: "browser-a" }),
    }));
    let body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.stats.totalViews, 1);
    assert.equal(body.stats.uniqueVisitors, 1);

    response = await api(request("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ path: "/posts/test/", visitorKey: "browser-a" }),
    }));
    body = await response.json();
    assert.equal(body.stats.totalViews, 2);
    assert.equal(body.stats.uniqueVisitors, 1);
    assert.equal(body.stats.todayViews, 2);
    db.close();
  });

  test("accepts the fixed admin password for the web admin API", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, { now: () => "2026-07-23T03:00:00.000Z" });
    const api = createBlogApi({ env: { PUBLIC_SITE_URL: "https://example.com" }, store });
    const response = await api(request("/api/admin/posts", {
      headers: { "x-admin-password": "tmdghks123" },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    db.close();
  });

  test("publishes admin markdown through an injected GitHub publisher", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, {
      now: () => "2026-07-23T03:00:00.000Z",
      id: (prefix) => `${prefix}_1`,
    });
    const calls = [];
    const api = createBlogApi({
      env: {
        PUBLIC_SITE_URL: "https://example.com",
        ADMIN_API_TOKEN: "secret",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_INSTALLATION_ID: "2",
        GITHUB_OWNER: "owner",
        GITHUB_REPOSITORY: "repo",
        GITHUB_CONTENT_BRANCH: "content/daily",
      },
      store,
      publisher: {
        async publishPost(input) {
          calls.push(input);
          return {
            provider: "github",
            branch: "content/daily",
            filePath: input.path,
            commitSha: "commit-sha",
            pullRequestUrl: "https://github.test/pr/7",
          };
        },
      },
    });

    const response = await api(request("/api/admin/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
        origin: "https://example.com",
      },
      body: JSON.stringify({
        title: "KV Cache memory pressure",
        slug: "kv-cache-memory-pressure",
        category: "LLM",
        tags: "LLM, KV Cache, Bandwidth",
        markdown: "# KV Cache memory pressure\n\nDecode keeps reading session state.",
      }),
    }));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.post.url, "/posts/kv-cache-memory-pressure/");
    assert.equal(calls[0].path, "src/pages/posts/kv-cache-memory-pressure.md");
    assert.match(calls[0].content, /category: "LLM"/);
    assert.equal((await store.listAdminPosts()).length, 1);
    db.close();
  });

  test("renders admin markdown frontmatter", () => {
    const post = renderAdminMarkdownPost({
      title: "HBM bandwidth note",
      category: "Memory",
      tags: ["HBM", "Bandwidth"],
      markdown: "# HBM bandwidth note\n\nMemory traffic dominates.",
    });
    assert.equal(post.slug, "hbm-bandwidth-note");
    assert.equal(post.category, "Memory");
    assert.match(post.content, /tags: \["HBM", "Bandwidth"\]/);
  });

  test("loads and updates an existing published Markdown file at the same path", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, {
      now: () => "2026-07-24T03:00:00.000Z",
      id: (prefix) => `${prefix}_2`,
    });
    const calls = [];
    const api = createBlogApi({
      env: {
        PUBLIC_SITE_URL: "https://example.com",
        ADMIN_API_TOKEN: "secret",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_INSTALLATION_ID: "2",
        GITHUB_OWNER: "owner",
        GITHUB_REPOSITORY: "repo",
        GITHUB_CONTENT_BRANCH: "main",
      },
      store,
      publisher: {
        async getFile({ path }) {
          assert.equal(path, "src/pages/posts/existing-note.md");
          return {
            path,
            content: [
              "---",
              'title: "Existing note"',
              'description: "Old description"',
              'category: "Memory"',
              'tags: ["DRAM"]',
              "---",
              "",
              "# Existing note",
              "",
              "Old body.",
            ].join("\n"),
          };
        },
        async publishPost(input) {
          calls.push(input);
          return { commitSha: "updated-sha", pullRequestUrl: null };
        },
      },
    });

    let response = await api(request("/api/admin/posts/existing-note", {
      headers: { authorization: "Bearer secret" },
    }));
    let body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.post.title, "Existing note");
    assert.equal(body.post.markdown, "# Existing note\n\nOld body.");

    response = await api(request("/api/admin/posts/existing-note", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({
        title: "Updated note",
        description: "New description",
        category: "System",
        tags: ["CXL", "Latency"],
        markdown: "# Updated note\n\nNew body.",
      }),
    }));
    body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.post.slug, "existing-note");
    assert.equal(calls[0].path, "src/pages/posts/existing-note.md");
    assert.match(calls[0].content, /title: "Updated note"/);
    assert.match(calls[0].content, /# Updated note/);
    db.close();
  });

  test("deletes an admin post through the injected GitHub publisher and store", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, {
      now: () => "2026-07-25T03:00:00.000Z",
      id: (prefix) => `${prefix}_3`,
    });
    await store.upsertAdminPost({
      slug: "old-note",
      title: "Old note",
      description: "desc",
      category: "System",
      tags: ["Latency"],
      url: "/posts/old-note/",
      status: "published",
      filePath: "src/pages/posts/old-note.md",
    });

    const deleteCalls = [];
    const api = createBlogApi({
      env: {
        PUBLIC_SITE_URL: "https://example.com",
        ADMIN_API_TOKEN: "secret",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_INSTALLATION_ID: "2",
        GITHUB_OWNER: "owner",
        GITHUB_REPOSITORY: "repo",
        GITHUB_CONTENT_BRANCH: "main",
      },
      store,
      publisher: {
        async getFile({ path }) {
          assert.equal(path, "src/pages/posts/old-note.md");
          return { path, content: "---\ntitle: \"Old note\"\n---\n\n# Old note\n" };
        },
        async deleteFile(input) {
          deleteCalls.push(input);
          return { deleted: true };
        },
      },
    });

    const response = await api(request("/api/admin/posts/old-note", {
      method: "DELETE",
      headers: { authorization: "Bearer secret" },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.slug, "old-note");
    assert.equal(deleteCalls[0].path, "src/pages/posts/old-note.md");
    assert.equal((await store.listAdminPosts()).length, 0);
    db.close();
  });

  test("retracts the publication so scheduling rewinds to the deleted lesson", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, { now: () => "2026-08-04T03:00:00.000Z" });
    const retractions = [];
    const api = createBlogApi({
      env: {
        PUBLIC_SITE_URL: "https://example.com",
        ADMIN_API_TOKEN: "secret",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_INSTALLATION_ID: "2",
        GITHUB_OWNER: "owner",
        GITHUB_REPOSITORY: "repo",
        GITHUB_CONTENT_BRANCH: "main",
      },
      store,
      lessonStore: {
        async retractPublicationsByFilePath(filePath, reason) {
          retractions.push({ filePath, reason });
          return { retracted: 1 };
        },
      },
      publisher: {
        async getFile({ path }) { return { path, content: "# Wrong topic\n" }; },
        async deleteFile() { return { deleted: true }; },
      },
    });

    const response = await api(request("/api/admin/posts/2026-07-31-m01-w02-d1-r1", {
      method: "DELETE",
      headers: { authorization: "Bearer secret" },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.retracted, 1);
    assert.deepEqual(retractions, [{
      filePath: "src/pages/posts/2026-07-31-m01-w02-d1-r1.md",
      reason: "post_deleted",
    }]);
    db.close();
  });

  test("returns 404 when deleting a post that does not exist", async () => {
    const db = new NodeD1Database(schema);
    const store = new D1BlogStore(db, { now: () => "2026-07-25T03:00:00.000Z" });
    const api = createBlogApi({
      env: {
        PUBLIC_SITE_URL: "https://example.com",
        ADMIN_API_TOKEN: "secret",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_INSTALLATION_ID: "2",
        GITHUB_OWNER: "owner",
        GITHUB_REPOSITORY: "repo",
        GITHUB_CONTENT_BRANCH: "main",
      },
      store,
      publisher: {
        async getFile() { return null; },
        async deleteFile() { throw new Error("should not be called"); },
      },
    });
    const response = await api(request("/api/admin/posts/missing-note", {
      method: "DELETE",
      headers: { authorization: "Bearer secret" },
    }));
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error, "POST_NOT_FOUND");
    db.close();
  });
});
