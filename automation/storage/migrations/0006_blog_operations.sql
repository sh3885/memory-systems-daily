CREATE TABLE IF NOT EXISTS blog_page_stats (
  path TEXT PRIMARY KEY,
  total_views INTEGER NOT NULL DEFAULT 0 CHECK (total_views >= 0),
  unique_visitors INTEGER NOT NULL DEFAULT 0 CHECK (unique_visitors >= 0),
  first_visited_at TEXT NOT NULL,
  last_visited_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_daily_stats (
  path TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  unique_visitors INTEGER NOT NULL DEFAULT 0 CHECK (unique_visitors >= 0),
  PRIMARY KEY (path, visit_date),
  CHECK (length(visit_date) = 10)
);

CREATE TABLE IF NOT EXISTS blog_visit_keys (
  path TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 1 CHECK (views >= 1),
  PRIMARY KEY (path, visitor_key)
);

CREATE TABLE IF NOT EXISTS blog_admin_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('LLM', 'Memory', 'System')),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
  position INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'admin',
  file_path TEXT,
  commit_sha TEXT,
  pull_request_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS blog_admin_posts_order
  ON blog_admin_posts(status, pinned DESC, position ASC, created_at DESC);
