-- Flomemos 数据库结构（Cloudflare D1 / SQLite）
-- 应用启动时自动跑版本化迁移；本文件用于手动初始化与参考。
-- 注意：邮箱制改版会清空旧数据（旧 username 结构与新结构不兼容）。

-- ===== 用户 =====
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- ===== 笔记 =====
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  random_bucket INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,                     -- 软删除：30 天内可恢复
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_memos_user_pinned ON memos (user_id, pinned, pinned_order, id DESC);
CREATE INDEX IF NOT EXISTS idx_memos_user_bucket ON memos (user_id, random_bucket);
CREATE INDEX IF NOT EXISTS idx_memos_user_deleted ON memos (user_id, deleted_at);

-- ===== 标签 =====
CREATE TABLE IF NOT EXISTS tags (
  memo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (memo_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);
CREATE INDEX IF NOT EXISTS idx_tags_recent ON tags (tag, last_used_at DESC);

-- ===== 会话 =====
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  ip_prefix TEXT                      -- 仅保留 IP 前 16 位（/3 段），用于设备识别
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at);

-- ===== 附件 =====
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 0,
  filename TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ===== 邮箱验证码 =====
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (email, purpose)
);

-- ===== 公开分享 =====
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  memo_id INTEGER NOT NULL,
  expires_at INTEGER,                 -- NULL = 永不过期
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_links_memo ON share_links (memo_id);

-- ===== 迁移版本表 =====
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- ===== FTS5 全文搜索 =====
-- trigram 分词器对中文/连续字母都能做模糊匹配（Free 档内可行）
CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(
  content,
  content='memos',
  content_rowid='id',
  tokenize='trigram'
);

-- 触发器：memos 增/改/删 自动同步到 memos_fts
CREATE TRIGGER IF NOT EXISTS memos_ai AFTER INSERT ON memos BEGIN
  INSERT INTO memos_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memos_ad AFTER DELETE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memos_au AFTER UPDATE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO memos_fts(rowid, content) VALUES (new.id, new.content);
END;