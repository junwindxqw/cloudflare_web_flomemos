-- Flomemos 数据库结构（Cloudflare D1 / SQLite）
-- 首次部署时执行：npx wrangler d1 execute flomemos --remote --file=./schema.sql
-- （应用启动时也会自动建表，此文件用于手动初始化与参考）

CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_created ON memos (id DESC);

CREATE TABLE IF NOT EXISTS tags (
  memo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memo_id, tag),
  FOREIGN KEY (memo_id) REFERENCES memos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  filename TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
