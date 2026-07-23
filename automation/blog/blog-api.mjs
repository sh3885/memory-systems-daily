import { renderAdminMarkdownPost } from "../publishing/admin-post.mjs";

export class BlogApiError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "BlogApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") ?? "";
  const publicSite = String(env.PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/g, "");
  const isLocalDev = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
  const allowed = new Set([
    publicSite,
    "http://127.0.0.1:4321",
    "http://localhost:4321",
  ]);
  const allowOrigin = allowed.has(origin) || isLocalDev ? origin : publicSite || "*";
  return {
    "access-control-allow-origin": allowOrigin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-admin-token",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new BlogApiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
}

async function digestText(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenMatches(supplied, expected) {
  const left = String(supplied ?? "");
  const right = String(expected ?? "");
  if (!right) return false;
  const [leftHash, rightHash] = await Promise.all([digestText(left), digestText(right)]);
  let diff = left.length ^ right.length;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return diff === 0;
}

async function requireAdmin(request, env) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const supplied = bearer || request.headers.get("x-admin-token") || "";
  if (!(await tokenMatches(supplied, env.ADMIN_API_TOKEN))) {
    throw new BlogApiError("UNAUTHORIZED", "Admin token is missing or invalid", 401);
  }
}

function configured(value) {
  return String(value ?? "").trim();
}

function githubPublishingConfigured(env) {
  return [
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_INSTALLATION_ID,
    env.GITHUB_OWNER,
    env.GITHUB_REPOSITORY,
    env.GITHUB_CONTENT_BRANCH,
  ].every(configured);
}

function visitorKeyFromRequest(request, body = {}) {
  const supplied = String(body.visitorKey ?? request.headers.get("x-visitor-key") ?? "").trim();
  if (supplied) return supplied.slice(0, 120);
  return "";
}

function publicPostUrl(env, path) {
  const base = String(env.PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/g, "");
  return base ? `${base}${path}` : path;
}

function normalizeList(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  return source.map((entry) => String(entry).trim()).filter(Boolean);
}

function renderBlogSettings(input = {}) {
  const categoryOrder = normalizeList(input.categoryOrder)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => ["llm", "memory", "system"].includes(entry));
  const settings = {
    blogTitle: String(input.blogTitle ?? "Memory Systems Daily").trim() || "Memory Systems Daily",
    tagline: String(input.tagline ?? "LLM, Memory, System architecture notes").trim(),
    description: String(input.description ?? "").trim() ||
      "LLM과 메모리 시스템을 데이터 이동, 병목, 아키텍처 관점에서 매일 정리하는 기술 블로그입니다.",
    categoryOrder: categoryOrder.length === 3 ? categoryOrder : ["llm", "memory", "system"],
    featuredTags: normalizeList(input.featuredTags).slice(0, 12),
    sidebarLinks: Array.isArray(input.sidebarLinks) ? input.sidebarLinks : [
      { label: "전체 글", href: "/" },
      { label: "태그", href: "/tags/" },
      { label: "관리", href: "/admin/" },
    ],
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function createBlogApi({ env, store, publisher = null } = {}) {
  if (!store?.recordVisit || !store?.listAdminPosts) {
    throw new BlogApiError("MISCONFIGURED", "blog store is required", 500);
  }

  return async function handleBlogApi(request) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          service: "memory-systems-daily-blog-api",
          publishingConfigured: Boolean(publisher && githubPublishingConfigured(env)),
        }, 200, headers);
      }

      if (url.pathname === "/api/visits" && request.method === "GET") {
        return json({ ok: true, stats: await store.getVisitStats(url.searchParams.get("path") || "/") }, 200, headers);
      }

      if (url.pathname === "/api/visits" && request.method === "POST") {
        const body = await readJson(request);
        return json({
          ok: true,
          stats: await store.recordVisit({
            path: body.path || url.searchParams.get("path") || "/",
            visitorKey: visitorKeyFromRequest(request, body),
          }),
        }, 200, headers);
      }

      if (url.pathname === "/api/stats/view" && request.method === "POST") {
        const body = await readJson(request);
        const stats = await store.recordVisit({
          path: body.path || "/",
          visitorKey: visitorKeyFromRequest(request, body) ||
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            "",
        });
        return json({ ok: true, ...stats }, 200, headers);
      }

      if (url.pathname === "/api/stats/summary" && request.method === "GET") {
        const path = url.searchParams.get("path") || "/";
        return json({ ok: true, stats: await store.getVisitStats(path) }, 200, headers);
      }

      if (url.pathname === "/api/blog/config" && request.method === "GET") {
        const adminPosts = await store.listAdminPosts();
        return json({
          ok: true,
          posts: adminPosts.filter((post) => post.status === "published"),
          order: adminPosts.filter((post) => post.status === "published").map((post) => post.url),
        }, 200, headers);
      }

      if (url.pathname === "/api/admin/posts" && request.method === "GET") {
        await requireAdmin(request, env);
        return json({ ok: true, posts: await store.listAdminPosts() }, 200, headers);
      }

      if (url.pathname === "/api/admin/posts" && request.method === "POST") {
        await requireAdmin(request, env);
        if (!publisher || !githubPublishingConfigured(env)) {
          throw new BlogApiError("PUBLISHING_NOT_CONFIGURED", "GitHub publishing is not configured", 503);
        }
        const body = await readJson(request);
        const post = renderAdminMarkdownPost(body);
        const result = await publisher.publishPost({
          path: post.filePath,
          content: post.content,
          message: `Admin publish ${post.title}`,
          title: `Admin publish ${post.title}`,
          body: [
            "Created from /admin web publishing.",
            `Category: ${post.category}`,
            `URL: ${post.url}`,
          ].join("\n"),
        });
        const saved = await store.upsertAdminPost({
          slug: post.slug,
          title: post.title,
          description: post.description,
          category: post.category,
          tags: post.tags,
          url: post.url,
          status: "published",
          filePath: post.filePath,
          commitSha: result.commitSha,
          pullRequestUrl: result.pullRequestUrl,
        });
        return json({
          ok: true,
          post: saved,
          publication: result,
          slug: post.slug,
          title: post.title,
          postUrl: publicPostUrl(env, post.url),
        }, 201, headers);
      }

      if (url.pathname === "/api/admin/settings" && request.method === "POST") {
        await requireAdmin(request, env);
        if (!publisher || !githubPublishingConfigured(env)) {
          throw new BlogApiError("PUBLISHING_NOT_CONFIGURED", "GitHub publishing is not configured", 503);
        }
        const body = await readJson(request);
        const result = await publisher.publishPost({
          path: "src/data/blog-settings.json",
          content: renderBlogSettings(body),
          message: "Update blog settings",
          title: "Update blog settings",
          body: "Updated from /admin web settings.",
        });
        return json({ ok: true, publication: result }, 200, headers);
      }

      const patchMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
      if (patchMatch && request.method === "PATCH") {
        await requireAdmin(request, env);
        const body = await readJson(request);
        return json({ ok: true, post: await store.updateAdminPost(decodeURIComponent(patchMatch[1]), body) }, 200, headers);
      }

      return json({ ok: false, error: "NOT_FOUND" }, 404, headers);
    } catch (error) {
      if (error instanceof BlogApiError) {
        return json({ ok: false, error: error.code, message: error.message }, error.status, headers);
      }
      return json({ ok: false, error: "BLOG_API_ERROR", message: error?.message ?? String(error) }, 500, headers);
    }
  };
}
