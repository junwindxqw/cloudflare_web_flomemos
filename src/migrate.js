// 数据库结构（Cloudflare D1 / SQLite）—— 邮箱注册版。
// 应用启动时自动建表。本版本起认证改为邮箱制，旧版（username / account 表）结构
// 由部署前的一次性清空脚本处理（DROP 后由本模块重建），不再做兼容迁移。
const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    memo_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (memo_id, tag)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    filename TEXT,
    content_type TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_codes (
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    last_sent_at INTEGER NOT NULL,
    PRIMARY KEY (email, purpose)
  )`,
];

const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)`,
];

let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(TABLE_DDL.map((sql) => db.prepare(sql)));
  await db.batch(INDEX_DDL.map((sql) => db.prepare(sql)));
  schemaReady = true;
}
