export class BlogStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BlogStoreError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new BlogStoreError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function normalizePath(value) {
  const raw = requireText(value, "path");
  let path;
  try {
    path = raw.startsWith("http") ? new URL(raw).pathname : raw;
  } catch {
    path = raw;
  }
  path = `/${path.replace(/^\/+/, "")}`;
  if (!path.endsWith("/") && !path.includes(".")) path += "/";
  if (path.length > 240) throw new BlogStoreError("INVALID_INPUT", "path is too long", { path });
  return path;
}

function normalizeDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseTags(row) {
  try {
    const tags = JSON.parse(row.tags_json ?? "[]");
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function mapAdminPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: parseTags(row),
    url: row.url,
    status: row.status,
    position: row.position,
    pinned: row.pinned === 1,
    source: row.source,
    filePath: row.file_path,
    commitSha: row.commit_sha,
    pullRequestUrl: row.pull_request_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function allRows(statement) {
  const response = await statement.all();
  return response?.results ?? [];
}

export class D1BlogStore {
  constructor(db, options = {}) {
    if (!db?.prepare || !db?.batch) {
      throw new BlogStoreError("INVALID_DATABASE", "A D1-compatible database binding is required");
    }
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`);
  }

  async recordVisit({ path, visitorKey = null }) {
    const normalizedPath = normalizePath(path);
    const timestamp = this.now();
    const visitDate = normalizeDate(timestamp);
    const normalizedVisitorKey = String(visitorKey ?? "").trim().slice(0, 120) || null;
    let isNewVisitor = false;

    if (normalizedVisitorKey) {
      const inserted = await this.db.prepare(`
        INSERT OR IGNORE INTO blog_visit_keys (
          path, visitor_key, first_seen_at, last_seen_at, views
        ) VALUES (?1, ?2, ?3, ?3, 1)
      `).bind(normalizedPath, normalizedVisitorKey, timestamp).run();
      isNewVisitor = (inserted?.meta?.changes ?? 0) === 1;
      if (!isNewVisitor) {
        await this.db.prepare(`
          UPDATE blog_visit_keys
          SET views = views + 1, last_seen_at = ?3
          WHERE path = ?1 AND visitor_key = ?2
        `).bind(normalizedPath, normalizedVisitorKey, timestamp).run();
      }
    }

    await this.db.batch([
      this.db.prepare(`
        INSERT INTO blog_page_stats (
          path, total_views, unique_visitors, first_visited_at, last_visited_at
        ) VALUES (?1, 0, 0, ?2, ?2)
        ON CONFLICT(path) DO NOTHING
      `).bind(normalizedPath, timestamp),
      this.db.prepare(`
        UPDATE blog_page_stats
        SET total_views = total_views + 1,
            unique_visitors = unique_visitors + ?2,
            last_visited_at = ?3
        WHERE path = ?1
      `).bind(normalizedPath, isNewVisitor ? 1 : 0, timestamp),
      this.db.prepare(`
        INSERT INTO blog_daily_stats (
          path, visit_date, views, unique_visitors
        ) VALUES (?1, ?2, 0, 0)
        ON CONFLICT(path, visit_date) DO NOTHING
      `).bind(normalizedPath, visitDate),
      this.db.prepare(`
        UPDATE blog_daily_stats
        SET views = views + 1,
            unique_visitors = unique_visitors + ?3
        WHERE path = ?1 AND visit_date = ?2
      `).bind(normalizedPath, visitDate, isNewVisitor ? 1 : 0),
    ]);
    return this.getVisitStats(normalizedPath);
  }

  async getVisitStats(path) {
    const normalizedPath = normalizePath(path);
    const row = await this.db.prepare(`
      SELECT path, total_views, unique_visitors, first_visited_at, last_visited_at
      FROM blog_page_stats
      WHERE path = ?1
    `).bind(normalizedPath).first();
    if (!row) {
      return {
        path: normalizedPath,
        totalViews: 0,
        uniqueVisitors: 0,
        todayViews: 0,
        lastVisitedAt: null,
      };
    }
    const today = normalizeDate(this.now());
    const daily = await this.db.prepare(`
      SELECT views, unique_visitors
      FROM blog_daily_stats
      WHERE path = ?1 AND visit_date = ?2
    `).bind(normalizedPath, today).first();
    return {
      path: row.path,
      totalViews: row.total_views,
      uniqueVisitors: row.unique_visitors,
      todayViews: daily?.views ?? 0,
      todayUniqueVisitors: daily?.unique_visitors ?? 0,
      firstVisitedAt: row.first_visited_at,
      lastVisitedAt: row.last_visited_at,
    };
  }

  async listAdminPosts() {
    const rows = await allRows(this.db.prepare(`
      SELECT *
      FROM blog_admin_posts
      ORDER BY pinned DESC, position ASC, created_at DESC
    `));
    return rows.map(mapAdminPost);
  }

  async upsertAdminPost({
    slug,
    title,
    description,
    category,
    tags,
    url,
    status = "published",
    filePath = null,
    commitSha = null,
    pullRequestUrl = null,
  }) {
    const timestamp = this.now();
    const normalizedSlug = requireText(slug, "slug");
    const normalizedTags = JSON.stringify(Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : []);
    await this.db.prepare(`
      INSERT INTO blog_admin_posts (
        id, slug, title, description, category, tags_json, url, status,
        position, pinned, source, file_path, commit_sha, pull_request_url,
        created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 'admin', ?9, ?10, ?11, ?12, ?12)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        category = excluded.category,
        tags_json = excluded.tags_json,
        url = excluded.url,
        status = excluded.status,
        file_path = excluded.file_path,
        commit_sha = excluded.commit_sha,
        pull_request_url = excluded.pull_request_url,
        updated_at = excluded.updated_at
    `).bind(
      this.id("admin_post"),
      normalizedSlug,
      requireText(title, "title"),
      String(description ?? "").trim(),
      requireText(category, "category"),
      normalizedTags,
      requireText(url, "url"),
      requireText(status, "status"),
      filePath,
      commitSha,
      pullRequestUrl,
      timestamp,
    ).run();
    const row = await this.db.prepare("SELECT * FROM blog_admin_posts WHERE slug = ?1").bind(normalizedSlug).first();
    return mapAdminPost(row);
  }

  async updateAdminPost(id, patch = {}) {
    const postId = requireText(id, "id");
    const existing = await this.db.prepare("SELECT * FROM blog_admin_posts WHERE id = ?1").bind(postId).first();
    if (!existing) throw new BlogStoreError("NOT_FOUND", `Admin post not found: ${postId}`, { id: postId });
    const next = {
      status: patch.status === undefined ? existing.status : requireText(patch.status, "status"),
      position: patch.position === undefined ? existing.position : Number(patch.position),
      pinned: patch.pinned === undefined ? existing.pinned : (patch.pinned ? 1 : 0),
    };
    if (!["draft", "published", "hidden"].includes(next.status)) {
      throw new BlogStoreError("INVALID_INPUT", "status is not allowed", { status: next.status });
    }
    if (!Number.isFinite(next.position)) {
      throw new BlogStoreError("INVALID_INPUT", "position must be numeric", { position: patch.position });
    }
    await this.db.prepare(`
      UPDATE blog_admin_posts
      SET status = ?1, position = ?2, pinned = ?3, updated_at = ?4
      WHERE id = ?5
    `).bind(next.status, Math.trunc(next.position), next.pinned, this.now(), postId).run();
    const row = await this.db.prepare("SELECT * FROM blog_admin_posts WHERE id = ?1").bind(postId).first();
    return mapAdminPost(row);
  }
}
