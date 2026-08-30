// 数据库结构（Cloudflare D1 / SQLite）。
// 首次请求时自动建表；并对旧版单用户结构自动升级：
//   account 表（单账号）→ users 表（多用户，原账号成为管理员）
//   memos / sessions / attachments 补 user_id 列，存量数据归属给管理员。
// 顺序很重要：先建表 → 再迁移补列 → 最后建索引（索引依赖新列）。
const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
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
];

const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)`,
];

// 唯一管理员的 id 子查询（id 最小的 admin）
const ADMIN_ID_SQL = "(SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)";

let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(TABLE_DDL.map((sql) => db.prepare(sql)));
  await migrateLegacy(db);
  await db.batch(INDEX_DDL.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

async function tableExists(db, name) {
  const row = await db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').bind('table', name).first();
  return Boolean(row);
}

async function columnExists(db, table, column) {
  const rows = await db.prepare('PRAGMA table_info(' + table + ')').all();
  return rows.results.some((col) => col.name === column);
}

async function migrateLegacy(db) {
  // 旧版单用户账号表迁移为 users 表中的管理员（幂等；保留原 account 表不删，避免误伤）
  if (await tableExists(db, 'account')) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at) SELECT id, username, password_hash, 'admin', created_at FROM account"),
    ]);
  }

  // 为旧表补充 user_id 列（新装的库在 TABLE_DDL 中已包含，此处跳过）
  if (!(await columnExists(db, 'memos', 'user_id'))) {
    await db.prepare('ALTER TABLE memos ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!(await columnExists(db, 'sessions', 'user_id'))) {
    await db.prepare('ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!(await columnExists(db, 'attachments', 'user_id'))) {
    await db.prepare('ALTER TABLE attachments ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0').run();
  }

  // 存量数据归属给管理员（user_id = 0 表示尚未归属）
  await db.batch([
    db.prepare('UPDATE memos SET user_id = ' + ADMIN_ID_SQL + ' WHERE user_id = 0'),
    db.prepare('UPDATE sessions SET user_id = ' + ADMIN_ID_SQL + ' WHERE user_id = 0'),
    db.prepare('UPDATE attachments SET user_id = ' + ADMIN_ID_SQL + ' WHERE user_id = 0'),
  ]);
}
