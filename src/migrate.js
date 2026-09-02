// 数据库结构（Cloudflare D1 / SQLite）
// 应用启动时自动跑版本化迁移。
// 迁移顺序固定，每条幂等；旧 username 表与新结构不兼容，由一次性清空脚本处理。

const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    pinned_order INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    random_bucket INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    memo_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (memo_id, tag)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT,
    ip_prefix TEXT
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
  `CREATE TABLE IF NOT EXISTS share_links (
    token TEXT PRIMARY KEY,
    memo_id INTEGER NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,
];

// 索引（仅必要；Free D1 索引越多写入越慢，按需添加）
const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memos_user_pinned ON memos (user_id, pinned, pinned_order, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memos_user_bucket ON memos (user_id, random_bucket)`,
  `CREATE INDEX IF NOT EXISTS idx_memos_user_deleted ON memos (user_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_recent ON tags (tag, last_used_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_share_links_memo ON share_links (memo_id)`,
];

// 版本化增量迁移。每条只追加、不可修改；新增列请使用 ALTER TABLE 并处理重复列错误。
// 用 try/catch 包裹幂等 DDL，重复执行不报错。
const MIGRATIONS = [
  // v1：FTS5 全文搜索
  {
    version: 1,
    sql: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(content, content='memos', content_rowid='id', tokenize='trigram')`,
      `CREATE TRIGGER IF NOT EXISTS memos_ai AFTER INSERT ON memos BEGIN INSERT INTO memos_fts(rowid, content) VALUES (new.id, new.content); END`,
      `CREATE TRIGGER IF NOT EXISTS memos_ad AFTER DELETE ON memos BEGIN INSERT INTO memos_fts(memos_fts, rowid, content) VALUES('delete', old.id, old.content); END`,
      `CREATE TRIGGER IF NOT EXISTS memos_au AFTER UPDATE ON memos BEGIN INSERT INTO memos_fts(memos_fts, rowid, content) VALUES('delete', old.id, old.content); INSERT INTO memos_fts(rowid, content) VALUES (new.id, new.content); END`,
    ],
  },
  // v2：兼容老库加列（重复列错误需吞掉）
  {
    version: 2,
    sql: [
      `ALTER TABLE memos ADD COLUMN pinned_order INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memos ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memos ADD COLUMN random_bucket INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memos ADD COLUMN deleted_at TEXT`,
      `ALTER TABLE tags ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE sessions ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE sessions ADD COLUMN user_agent TEXT`,
      `ALTER TABLE sessions ADD COLUMN ip_prefix TEXT`,
      `ALTER TABLE users ADD COLUMN last_login_at TEXT`,
    ],
  },
  // v3：FTS5 回填（旧数据迁移进 FTS 索引）
  {
    version: 3,
    sql: [
      `INSERT INTO memos_fts(rowid, content) SELECT id, content FROM memos WHERE id NOT IN (SELECT rowid FROM memos_fts)`,
    ],
  },
];

let schemaReady = false;

function ignoreAlterError(err) {
  // SQLite 重复列错误格式："duplicate column name: xxx"，吞掉即可。
  return /duplicate column/i.test(String(err?.message || ''));
}

export async function ensureSchema(db) {
  if (schemaReady) return;
  // 1) 基础表与索引
  for (const sql of TABLE_DDL) {
    try { await db.prepare(sql).run(); } catch (e) { if (!ignoreAlterError(e)) throw e; }
  }
  for (const sql of INDEX_DDL) {
    try { await db.prepare(sql).run(); } catch { /* ignore */ }
  }
  // 2) 版本化迁移
  await runMigrations(db);
  schemaReady = true;
}

async function runMigrations(db) {
  // 先确保 migrations 表存在
  try { await db.prepare(`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`).run(); } catch { /* ignore */ }
  const applied = await db.prepare('SELECT version FROM migrations').all();
  const done = new Set((applied.results || []).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    for (const sql of m.sql) {
      try {
        await db.prepare(sql).run();
      } catch (e) {
        if (!ignoreAlterError(e)) throw e;
      }
    }
    await db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)').bind(m.version, Date.now()).run();
  }
}