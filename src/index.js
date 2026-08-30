// Flomemos Worker：同源提供静态资源（/api/*、/files/* 之外的路径交给 ASSETS）与 API。
// 本应用不做任何服务端对外请求，仅读写 D1 / R2 绑定与返回静态资源。
import { ensureSchema } from './migrate.js';
import {
  createSession,
  destroySession,
  isAuthenticated,
  sessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyStoredPassword,
  constantTimeEqualText,
} from './auth.js';
import { extractTags } from './tags.js';

const MAX_CONTENT = 20000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const errorJson = (status, message) => json({ error: message }, status);

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 同源校验：浏览器为跨站请求附带 Origin 头，与请求目标 host（含端口）不一致即拒绝。
function originHostOf(originHeader) {
  const match = String(originHeader).match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

// ---------- 登录限速（单实例内存级，尽力而为） ----------
const loginFailures = new Map(); // clientKey -> { count, resetAt }
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

async function clientKeyOf(request) {
  // 对来源标识做散列，内存里不保存原始客户端信息
  const raw = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function loginThrottled(clientKey) {
  const now = Date.now();
  const record = loginFailures.get(clientKey);
  if (!record || now > record.resetAt) {
    loginFailures.set(clientKey, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    if (loginFailures.size > 1000) loginFailures.clear();
    return 0;
  }
  return record.count >= LOGIN_MAX_FAILURES ? Math.ceil((record.resetAt - now) / 1000) : 0;
}

function recordLoginFailure(clientKey) {
  const record = loginFailures.get(clientKey);
  if (record) record.count += 1;
}

// ---------- 账号状态 ----------
function envAuthConfigured(env) {
  return Boolean(env.AUTH_USERNAME && env.AUTH_PASSWORD);
}

async function getAccount(env) {
  return env.DB.prepare('SELECT username, password_hash FROM account WHERE id = 1').first();
}

async function verifyLogin(env, username, password) {
  if (envAuthConfigured(env)) {
    const userOk = await constantTimeEqualText(username, env.AUTH_USERNAME);
    const passOk = await constantTimeEqualText(password, env.AUTH_PASSWORD);
    return userOk && passOk;
  }
  const account = await getAccount(env);
  if (!account) return null; // 尚未初始化账号
  return username === account.username && (await verifyStoredPassword(password, account.password_hash));
}

// ---------- 处理器（secure 由入口统一计算后以布尔值传入） ----------
async function handleMe(request, env) {
  if (await isAuthenticated(env.DB, request)) {
    const account = await getAccount(env);
    const username = envAuthConfigured(env) ? env.AUTH_USERNAME : account?.username;
    return json({ authenticated: true, username });
  }
  const needsSetup = !envAuthConfigured(env) && !(await getAccount(env));
  return json({ authenticated: false, needsSetup });
}

async function handleSetup(request, env, secure) {
  if (envAuthConfigured(env)) return errorJson(403, '已通过环境变量配置账号，无需初始化');
  if (await getAccount(env)) return errorJson(403, '账号已初始化，请直接登录');
  const body = await readJsonBody(request);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!username || username.length > 32) return errorJson(400, '用户名需为 1-32 个字符');
  if (password.length < 6 || password.length > 128) return errorJson(400, '密码长度需在 6-128 位之间');
  const passwordHash = await hashPassword(password);
  await env.DB
    .prepare('INSERT INTO account (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)')
    .bind(username, passwordHash, new Date().toISOString())
    .run();
  const { token, maxAge } = await createSession(env.DB);
  return json({ ok: true, username }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

async function handleLogin(request, env, secure) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = loginThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '失败次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!username || !password) return errorJson(400, '请输入账号和密码');

  const result = await verifyLogin(env, username, password);
  if (result === null) return errorJson(409, '账号尚未初始化，请先完成初始化');
  if (!result) {
    recordLoginFailure(clientKey);
    return errorJson(401, '账号或密码不正确');
  }
  loginFailures.delete(clientKey);
  const { token, maxAge } = await createSession(env.DB);
  return json({ ok: true, username }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

async function handleLogout(request, env, secure) {
  await destroySession(env.DB, request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
}

// ---------- 笔记 ----------
function escapeLike(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\\' || ch === '%' || ch === '_') out += '\\';
    out += ch;
  }
  return out;
}

async function listMemos(request, env, url) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit'), 10) || DEFAULT_PAGE_SIZE, 1), 50);
  const before = Number.parseInt(params.get('before'), 10) || 0;
  const tag = (params.get('tag') || '').slice(0, 100);
  const q = (params.get('q') || '').slice(0, 200);
  const pinned = params.get('pinned') === '1';

  const conditions = [];
  const binds = [];
  if (before > 0) {
    conditions.push('m.id < ?');
    binds.push(before);
  }
  if (pinned) conditions.push('m.pinned = 1');
  if (tag) {
    conditions.push('m.id IN (SELECT memo_id FROM tags WHERE tag = ?)');
    binds.push(tag);
  }
  if (q) {
    conditions.push("m.content LIKE ? ESCAPE '\\'");
    binds.push('%' + escapeLike(q) + '%');
  }
  let whereSql = '';
  for (let i = 0; i < conditions.length; i++) whereSql += (i ? ' AND ' : '') + conditions[i];
  const rows = await env.DB
    .prepare('SELECT m.id, m.content, m.pinned, m.created_at, m.updated_at FROM memos m ' + (whereSql ? 'WHERE ' + whereSql : '') + ' ORDER BY m.id DESC LIMIT ?')
    .bind(...binds, limit + 1)
    .all();

  const hasMore = rows.results.length > limit;
  const memos = rows.results.slice(0, limit);
  await attachTags(env.DB, memos);
  return json({ memos: memos.map(mapMemo), has_more: hasMore });
}

function mapMemo(memo) {
  return {
    id: memo.id,
    content: memo.content,
    pinned: Boolean(memo.pinned),
    created_at: memo.created_at,
    updated_at: memo.updated_at,
    tags: memo._tags || [],
  };
}

async function attachTags(db, memos) {
  if (!memos.length) return;
  const ids = memos.map((m) => m.id);
  for (const memo of memos) memo._tags = [];
  let placeholders = '';
  for (let i = 0; i < ids.length; i++) placeholders += (i ? ',?' : '?');
  const rows = await db.prepare('SELECT memo_id, tag FROM tags WHERE memo_id IN (' + placeholders + ')').bind(...ids).all();
  const byId = new Map(memos.map((m) => [m.id, m]));
  for (const row of rows.results) byId.get(row.memo_id)?._tags.push(row.tag);
}

async function insertTags(db, memoId, tags) {
  await db.batch(tags.map((tag) => db.prepare('INSERT OR IGNORE INTO tags (memo_id, tag) VALUES (?, ?)').bind(memoId, tag)));
}

async function createMemo(request, env) {
  const body = await readJsonBody(request);
  const content = String(body?.content ?? '').replace(/\r\n/g, '\n').trim();
  if (!content) return errorJson(400, '内容不能为空');
  if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');

  const now = new Date().toISOString();
  const result = await env.DB.prepare('INSERT INTO memos (content, created_at, updated_at) VALUES (?, ?, ?)').bind(content, now, now).run();
  const id = result.meta.last_row_id;
  const tags = extractTags(content);
  if (tags.length) await insertTags(env.DB, id, tags);
  return json({ memo: { id, content, pinned: false, created_at: now, updated_at: now, tags } });
}

async function updateMemo(request, env, id) {
  const existing = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first();
  if (!existing) return errorJson(404, '笔记不存在');

  const body = await readJsonBody(request);
  if (!body || (body.content === undefined && body.pinned === undefined)) return errorJson(400, '没有需要更新的字段');

  const statements = [];
  if (body.content !== undefined) {
    const content = String(body.content ?? '').replace(/\r\n/g, '\n').trim();
    if (!content) return errorJson(400, '内容不能为空');
    if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');
    const now = new Date().toISOString();
    statements.push(env.DB.prepare('UPDATE memos SET content = ?, updated_at = ? WHERE id = ?').bind(content, now, id));
    statements.push(env.DB.prepare('DELETE FROM tags WHERE memo_id = ?').bind(id));
    for (const tag of extractTags(content)) {
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO tags (memo_id, tag) VALUES (?, ?)').bind(id, tag));
    }
  }
  if (body.pinned !== undefined) {
    statements.push(env.DB.prepare('UPDATE memos SET pinned = ? WHERE id = ?').bind(body.pinned ? 1 : 0, id));
  }
  await env.DB.batch(statements);

  const memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first();
  await attachTags(env.DB, [memo]);
  return json({ memo: mapMemo(memo) });
}

async function deleteMemo(env, id) {
  const existing = await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(id).first();
  if (!existing) return errorJson(404, '笔记不存在');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memos WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM tags WHERE memo_id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function randomMemos(request, env, url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit'), 10) || 5, 1), 10);
  const rows = await env.DB.prepare('SELECT * FROM memos ORDER BY RANDOM() LIMIT ?').bind(limit).all();
  await attachTags(env.DB, rows.results);
  return json({ memos: rows.results.map(mapMemo) });
}

async function listTags(request, env) {
  const rows = await env.DB.prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC').all();
  return json({ tags: rows.results });
}

async function getStats(request, env) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM memos').first();
  const tagRow = await env.DB.prepare('SELECT COUNT(DISTINCT tag) AS c FROM tags').first();
  const dayRows = await env.DB.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM memos GROUP BY day').all();
  const days = {};
  for (const row of dayRows.results) days[row.day] = row.count;

  const now = new Date();
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const today = days[dayKey(now)] || 0;
  let week = 0;
  for (let i = 0; i < 7; i++) week += days[dayKey(new Date(now.getTime() - i * 86400000))] || 0;

  // 连续记录天数：从今天（若今天未记录则从昨天）往前数
  let streak = 0;
  let cursor = now.getTime();
  if (!days[dayKey(new Date(cursor))]) cursor -= 86400000;
  while (days[dayKey(new Date(cursor))]) {
    streak += 1;
    cursor -= 86400000;
  }

  return json({ total: totalRow.c, today, week, tags: tagRow.c, streak, days });
}

// ---------- 图片上传 / 读取 ----------
async function uploadImage(request, env) {
  if (!env.R2) return errorJson(501, '未配置 R2 存储桶，图片上传不可用（详见 README）');
  let form;
  try {
    form = await request.formData();
  } catch {
    return errorJson(400, '请求格式错误');
  }
  const file = form.get('file');
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') return errorJson(400, '缺少图片文件');
  const filename = file.name || 'image';
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const contentType = IMAGE_TYPES[ext];
  if (!contentType) return errorJson(400, '仅支持 png / jpg / jpeg / gif / webp / avif 格式');
  if (file.size > MAX_FILE_SIZE) return errorJson(400, '图片大小不能超过 10MB');

  const key = crypto.randomUUID() + '.' + ext;
  const buffer = await file.arrayBuffer();
  await env.R2.put(key, buffer, { httpMetadata: { contentType } });
  await env.DB
    .prepare('INSERT INTO attachments (id, filename, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(key, filename, contentType, buffer.byteLength, new Date().toISOString())
    .run();
  return json({ url: '/files/' + key, key });
}

async function serveFile(request, env, url) {
  // 图片仅在登录后可见（<img> 同源请求会自动携带 Cookie）
  if (!(await isAuthenticated(env.DB, request))) return errorJson(401, '未登录或登录已过期');
  const key = decodeURIComponent(url.pathname.slice('/files/'.length));
  if (!key || key.includes('..')) return errorJson(400, '无效的文件路径');
  if (!env.R2) return errorJson(501, '未配置 R2 存储桶');
  const object = await env.R2.get(key);
  if (!object) return errorJson(404, '文件不存在');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

// ---------- 导出 ----------
async function exportData(request, env, url) {
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'md';
  const rows = await env.DB.prepare('SELECT * FROM memos ORDER BY id ASC').all();
  await attachTags(env.DB, rows.results);
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (format === 'json') {
    const data = rows.results.map((m) => ({
      content: m.content,
      tags: m._tags,
      pinned: m.pinned === 1,
      created_at: m.created_at,
      updated_at: m.updated_at,
    }));
    return new Response(JSON.stringify({ app: 'flomemos', exported_at: new Date().toISOString(), memos: data }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="flomemos-' + dateTag + '.json"',
      },
    });
  }

  let markdown = '# Flomemos 导出\n\n共 ' + rows.results.length + ' 条笔记，导出于 ' + new Date().toISOString() + '\n\n';
  for (const m of rows.results) {
    markdown += '---\n' + m.created_at;
    if (m._tags.length) {
      markdown += '\n\n';
      for (const t of m._tags) markdown += '#' + t + ' ';
    }
    markdown += '\n\n' + m.content + '\n\n';
  }
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="flomemos-' + dateTag + '.md"',
    },
  });
}

// ---------- 路由 ----------
async function handleApi(request, env, url, secure) {
  const { method } = request;
  const { pathname } = url;

  if (method === 'GET' && pathname === '/api/me') return handleMe(request, env);
  if (method === 'POST' && pathname === '/api/auth/setup') return handleSetup(request, env, secure);
  if (method === 'POST' && pathname === '/api/auth/login') return handleLogin(request, env, secure);

  // 写操作做同源校验
  if (method !== 'GET' && originHostOf(request.headers.get('Origin') || '') !== url.host) {
    return errorJson(403, '跨站请求被拒绝');
  }
  if (!(await isAuthenticated(env.DB, request))) return errorJson(401, '未登录或登录已过期');

  if (method === 'POST' && pathname === '/api/auth/logout') return handleLogout(request, env, secure);
  if (method === 'GET' && pathname === '/api/memos') return listMemos(request, env, url);
  if (method === 'POST' && pathname === '/api/memos') return createMemo(request, env);
  if (method === 'GET' && pathname === '/api/memos/random') return randomMemos(request, env, url);
  const memoMatch = pathname.match(/^\/api\/memos\/(\d+)$/);
  if (memoMatch) {
    const id = Number(memoMatch[1]);
    if (method === 'PUT') return updateMemo(request, env, id);
    if (method === 'DELETE') return deleteMemo(env, id);
  }
  if (method === 'GET' && pathname === '/api/tags') return listTags(request, env);
  if (method === 'GET' && pathname === '/api/stats') return getStats(request, env);
  if (method === 'POST' && pathname === '/api/upload') return uploadImage(request, env);
  if (method === 'GET' && pathname === '/api/export') return exportData(request, env, url);
  return errorJson(404, '接口不存在');
}

// 入口：/api/*、/files/* 由本 Worker 处理，其余路径全部交给静态资源绑定
// （未命中时按 SPA 规则回退到 index.html）。
export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env.DB);
      const url = new URL(request.url);
      const secure = url.protocol === 'https:';
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url, secure);
      if (url.pathname.startsWith('/files/')) return await serveFile(request, env, url);
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorJson(500, '服务器内部错误');
    }
  },
};
