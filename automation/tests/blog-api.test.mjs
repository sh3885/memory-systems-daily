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
});
