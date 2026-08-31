-- Flomemos 数据库结构（Cloudflare D1 / SQLite）—— 邮箱注册版
-- 应用启动时自动建表；本文件用于手动初始化与参考。
-- 注意：邮箱制改版会清空旧数据（旧 username 结构与新结构不兼容）。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',   -- 'admin'（唯一管理员，首个注册者）| 'user'
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, id DESC);

CREATE TABLE IF NOT EXISTS tags (
  memo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memo_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 0,
  filename TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 邮箱验证码（注册 / 找回密码），同一邮箱同一用途仅保留最新一条
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,               -- 'register' | 'reset'
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, -- 校验失败次数，最多 5 次
  expires_at INTEGER NOT NULL,         -- 10 分钟有效期
  last_sent_at INTEGER NOT NULL,       -- 60 秒发送间隔限制
  PRIMARY KEY (email, purpose)
);
