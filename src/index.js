// Flomemos Worker：多用户邮箱注册版。同源提供静态资源（/api/*、/files/* 之外的路径交给 ASSETS）与 API。
import { ensureSchema } from './migrate.js';
import {
  createSession,
  destroySession,
  currentUser,
  sessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyStoredPassword,
  dummyVerify,
} from './auth.js';
import { sendVerificationCode, verifyCode } from './mail.js';
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

function errorJson(status, message, code) {
  const body = { error: message };
  if (code) body.code = code;
  return json(body, status);
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 同源校验：浏览器为跨站请求附带 Origin 头，与请求目标 host（含端口）不一致即拒绝。
// Origin 缺失视为同源（curl 等非浏览器客户端不携带；跨站 Cookie 已被 SameSite=Lax 拦截）。
function isSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const match = String(origin).match(/^https?:\/\/([^/?#]+)/i);
  return Boolean(match) && match[1].toLowerCase() === url.host;
}

// ---------- 注册/登录限速（单实例内存级，尽力而为） ----------
const authFailures = new Map(); // clientKey -> { count, resetAt }
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 8;

async function clientKeyOf(request) {
  // 对来源标识做散列，内存里不保存原始客户端信息
  const raw = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function authThrottled(clientKey) {
  const now = Date.now();
  const record = authFailures.get(clientKey);
  if (!record || now > record.resetAt) {
    authFailures.set(clientKey, { count: 0, resetAt: now + AUTH_WINDOW_MS });
    if (authFailures.size > 1000) authFailures.clear();
    return 0;
  }
  return record.count >= AUTH_MAX_FAILURES ? Math.ceil((record.resetAt - now) / 1000) : 0;
}

function recordAuthFailure(clientKey) {
  const record = authFailures.get(clientKey);
  if (record) record.count += 1;
}

function clearAuthFailures(clientKey) {
  authFailures.delete(clientKey);
}

// ---------- 校验 ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function validateEmail(email) {
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return '请输入正确的邮箱地址';
  return '';
}

function validatePassword(password) {
  if (password.length < 6 || password.length > 128) return '密码长度需在 6-128 位之间';
  return '';
}

function mapUserRow(row, withStats) {
  const base = {
    id: row.id,
    email: row.email,
    role: row.role,
    banned: Boolean(row.banned),
    created_at: row.created_at,
  };
  if (withStats) base.memo_count = row.memo_count;
  return base;
}

// ---------- 认证处理器（secure 由入口统一计算后以布尔值传入） ----------
async function handleMe(request, env) {
  const auth = await currentUser(env.DB, request);
  if (auth && !auth.banned) {
    return json({ authenticated: true, email: auth.user.email, role: auth.user.role });
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  return json({ authenticated: false, hasUsers: row.c > 0 });
}

// 发送注册验证码
async function handleRegisterStart(request, env) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = authThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const invalid = validateEmail(email);
  if (invalid) return errorJson(400, invalid);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorJson(409, '该邮箱已注册，请直接登录');

  const result = await sendVerificationCode(env.DB, env, email, 'register');
  if (result.error) return errorJson(result.status, result.error);
  const payload = { ok: true };
  if (result.devCode) payload.devCode = result.devCode; // 仅开发环境
  return json(payload);
}

// 校验验证码并完成注册（第一个注册的用户自动成为唯一管理员）
async function handleRegister(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = authThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? '').trim();
  const password = String(body?.password ?? '');
  const invalid = validateEmail(email) || validatePassword(password);
  if (invalid) return errorJson(400, invalid);
  if (!/^\d{4}$/.test(code)) return errorJson(400, '请输入 4 位数字验证码');

  const codeOk = await verifyCode(env.DB, email, 'register', code);
  if (!codeOk) {
    recordAuthFailure(clientKey);
    return errorJson(400, '验证码错误或已过期');
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  // 单条 INSERT...SELECT 原子完成"首个注册用户成为管理员"
  const statement = env.DB.prepare(
    "INSERT INTO users (email, password_hash, role, created_at) SELECT ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE 'user' END, ?"
  );
  let result;
  try {
    result = await statement.bind(email, passwordHash, now).run();
  } catch {
    return errorJson(409, '该邮箱已注册，请直接登录');
  }
  clearAuthFailures(clientKey);
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(result.meta.last_row_id).first();
  const { token, maxAge } = await createSession(env.DB, user.id);
  return json({ ok: true, email: user.email, role: user.role }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

async function handleLogin(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = authThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password ?? '');
  if (!email || !password) return errorJson(400, '请输入邮箱和密码');

  const user = await env.DB.prepare('SELECT id, email, password_hash, role, banned FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    await dummyVerify(password);
    recordAuthFailure(clientKey);
    return errorJson(401, '邮箱或密码不正确');
  }
  if (user.banned) {
    recordAuthFailure(clientKey);
    return errorJson(403, '该账号已被封禁，请联系管理员', 'banned');
  }
  const passwordOk = await verifyStoredPassword(password, user.password_hash);
  if (!passwordOk) {
    recordAuthFailure(clientKey);
    return errorJson(401, '邮箱或密码不正确');
  }
  clearAuthFailures(clientKey);
  const { token, maxAge } = await createSession(env.DB, user.id);
  return json({ ok: true, email: user.email, role: user.role }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

// 发送找回密码验证码（不暴露邮箱是否存在）
async function handleForgotStart(request, env) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = authThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const invalid = validateEmail(email);
  if (invalid) return errorJson(400, invalid);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!existing) return json({ ok: true });

  const result = await sendVerificationCode(env.DB, env, email, 'reset');
  if (result.error) return errorJson(result.status, result.error);
  const payload = { ok: true };
  if (result.devCode) payload.devCode = result.devCode; // 仅开发环境
  return json(payload);
}

// 校验验证码并重置密码（同时销毁该用户所有会话）
async function handleReset(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  const retryAfter = authThrottled(clientKey);
  if (retryAfter > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? '').trim();
  const password = String(body?.password ?? '');
  const invalid = validateEmail(email) || validatePassword(password);
  if (invalid) return errorJson(400, invalid);
  if (!/^\d{4}$/.test(code)) return errorJson(400, '请输入 4 位数字验证码');

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  // 统一响应，避免暴露邮箱是否存在
  if (!user) {
    await dummyVerify(password);
    return errorJson(400, '验证码错误或已过期');
  }
  const codeOk = await verifyCode(env.DB, email, 'reset', code);
  if (!codeOk) {
    recordAuthFailure(clientKey);
    return errorJson(400, '验证码错误或已过期');
  }

  const passwordHash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  clearAuthFailures(clientKey);
  return json({ ok: true });
}

async function handleLogout(request, env, url, secure) {
  await destroySession(env.DB, request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) });
}

// ---------- 笔记（全部按用户隔离） ----------
function escapeLike(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\\' || ch === '%' || ch === '_') out += '\\';
    out += ch;
  }
  return out;
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

async function listMemos(request, env, url, user) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit'), 10) || DEFAULT_PAGE_SIZE, 1), 50);
  const before = Number.parseInt(params.get('before'), 10) || 0;
  const tag = (params.get('tag') || '').slice(0, 100);
  const q = (params.get('q') || '').slice(0, 200);
  const pinned = params.get('pinned') === '1';

  const conditions = ['m.user_id = ?'];
  const binds = [user.id];
  if (before > 0) {
    conditions.push('m.id < ?');
    binds.push(before);
  }
  if (pinned) conditions.push('m.pinned = 1');
  if (tag) {
    conditions.push('m.id IN (SELECT t.memo_id FROM tags t JOIN memos mm ON mm.id = t.memo_id WHERE t.tag = ? AND mm.user_id = ?)');
    binds.push(tag, user.id);
  }
  if (q) {
    conditions.push("m.content LIKE ? ESCAPE '\\'");
    binds.push('%' + escapeLike(q) + '%');
  }
  let whereSql = '';
  for (let i = 0; i < conditions.length; i++) whereSql += (i ? ' AND ' : '') + conditions[i];
  const rows = await env.DB
    .prepare('SELECT m.id, m.content, m.pinned, m.created_at, m.updated_at FROM memos m WHERE ' + whereSql + ' ORDER BY m.id DESC LIMIT ?')
    .bind(...binds, limit + 1)
    .all();

  const hasMore = rows.results.length > limit;
  const memos = rows.results.slice(0, limit);
  await attachTags(env.DB, memos);
  return json({ memos: memos.map(mapMemo), has_more: hasMore });
}

async function createMemo(request, env, user) {
  const body = await readJsonBody(request);
  const content = String(body?.content ?? '').replace(/\r\n/g, '\n').trim();
  if (!content) return errorJson(400, '内容不能为空');
  if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');

  const now = new Date().toISOString();
  const result = await env.DB
    .prepare('INSERT INTO memos (user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, content, now, now)
    .run();
  const id = result.meta.last_row_id;
  const tags = extractTags(content);
  if (tags.length) await insertTags(env.DB, id, tags);
  return json({ memo: { id, content, pinned: false, created_at: now, updated_at: now, tags } });
}

async function updateMemo(request, env, user, id) {
  const existing = await env.DB.prepare('SELECT * FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return errorJson(404, '笔记不存在');

  const body = await readJsonBody(request);
  if (!body || (body.content === undefined && body.pinned === undefined)) return errorJson(400, '没有需要更新的字段');

  const statements = [];
  if (body.content !== undefined) {
    const content = String(body.content ?? '').replace(/\r\n/g, '\n').trim();
    if (!content) return errorJson(400, '内容不能为空');
    if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');
    const now = new Date().toISOString();
    statements.push(env.DB.prepare('UPDATE memos SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(content, now, id, user.id));
    statements.push(env.DB.prepare('DELETE FROM tags WHERE memo_id = ?').bind(id));
    for (const tag of extractTags(content)) {
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO tags (memo_id, tag) VALUES (?, ?)').bind(id, tag));
    }
  }
  if (body.pinned !== undefined) {
    statements.push(env.DB.prepare('UPDATE memos SET pinned = ? WHERE id = ? AND user_id = ?').bind(body.pinned ? 1 : 0, id, user.id));
  }
  await env.DB.batch(statements);

  const memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  await attachTags(env.DB, [memo]);
  return json({ memo: mapMemo(memo) });
}

async function deleteMemo(env, user, id) {
  const existing = await env.DB.prepare('SELECT id FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return errorJson(404, '笔记不存在');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id),
    env.DB.prepare('DELETE FROM tags WHERE memo_id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function randomMemos(request, env, url, user) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit'), 10) || 5, 1), 10);
  const rows = await env.DB.prepare('SELECT * FROM memos WHERE user_id = ? ORDER BY RANDOM() LIMIT ?').bind(user.id, limit).all();
  await attachTags(env.DB, rows.results);
  return json({ memos: rows.results.map(mapMemo) });
}

async function listTags(request, env, user) {
  const rows = await env.DB
    .prepare('SELECT t.tag, COUNT(*) AS count FROM tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = ? GROUP BY t.tag ORDER BY count DESC, t.tag ASC')
    .bind(user.id)
    .all();
  return json({ tags: rows.results });
}

async function getStats(request, env, user) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM memos WHERE user_id = ?').bind(user.id).first();
  const tagRow = await env.DB
    .prepare('SELECT COUNT(DISTINCT t.tag) AS c FROM tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = ?')
    .bind(user.id)
    .first();
  const dayRows = await env.DB
    .prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM memos WHERE user_id = ? GROUP BY day")
    .bind(user.id)
    .all();
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
async function uploadImage(request, env, user) {
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
    .prepare('INSERT INTO attachments (id, user_id, filename, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(key, user.id, filename, contentType, buffer.byteLength, new Date().toISOString())
    .run();
  return json({ url: '/files/' + key, key });
}

// 图片仅所有者可见（<img> 同源请求会自动携带 Cookie）
async function serveFile(request, env, url, user) {
  const key = decodeURIComponent(url.pathname.slice('/files/'.length));
  if (!key || key.includes('..')) return errorJson(400, '无效的文件路径');
  if (!env.R2) return errorJson(501, '未配置 R2 存储桶');
  const attachment = await env.DB.prepare('SELECT user_id FROM attachments WHERE id = ?').bind(key).first();
  if (!attachment || attachment.user_id !== user.id) return errorJson(404, '文件不存在');
  const object = await env.R2.get(key);
  if (!object) return errorJson(404, '文件不存在');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

// ---------- 导出（按用户） ----------
async function exportData(request, env, url, user) {
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'md';
  const rows = await env.DB.prepare('SELECT * FROM memos WHERE user_id = ? ORDER BY id ASC').bind(user.id).all();
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

// ---------- 管理员：用户管理 ----------
async function adminListUsers(request, env) {
  const rows = await env.DB
    .prepare('SELECT u.id, u.email, u.role, u.banned, u.created_at, COUNT(m.id) AS memo_count FROM users u LEFT JOIN memos m ON m.user_id = u.id GROUP BY u.id ORDER BY u.id ASC')
    .all();
  return json({ users: rows.results.map((row) => mapUserRow(row, true)) });
}

async function adminGuard(user) {
  return user.role === 'admin';
}

async function adminBanUser(request, env, user, targetId) {
  const target = await env.DB.prepare('SELECT id, email, role, banned FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return errorJson(404, '用户不存在');
  if (target.role === 'admin' || target.id === user.id) return errorJson(403, '不能封禁管理员账号');

  const body = await readJsonBody(request);
  const banned = body?.banned ? 1 : 0;
  const statements = [env.DB.prepare('UPDATE users SET banned = ? WHERE id = ?').bind(banned, targetId)];
  if (banned) statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId));
  await env.DB.batch(statements);
  return json({ ok: true, banned: Boolean(banned) });
}

async function adminDeleteUser(env, user, targetId) {
  const target = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return errorJson(404, '用户不存在');
  if (target.role === 'admin' || target.id === user.id) return errorJson(403, '不能删除管理员账号');

  // 先清理 R2 中的图片文件
  if (env.R2) {
    const files = await env.DB.prepare('SELECT id FROM attachments WHERE user_id = ?').bind(targetId).all();
    if (files.results.length) {
      const keys = [];
      for (const row of files.results) keys.push(row.id);
      await env.R2.delete(keys);
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tags WHERE memo_id IN (SELECT id FROM memos WHERE user_id = ?)').bind(targetId),
    env.DB.prepare('DELETE FROM memos WHERE user_id = ?').bind(targetId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId),
    env.DB.prepare('DELETE FROM attachments WHERE user_id = ?').bind(targetId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId),
  ]);
  return json({ ok: true });
}

// ---------- 路由 ----------
async function handleApi(request, env, url, secure) {
  const { method } = request;
  const { pathname } = url;

  // 公开接口
  if (method === 'GET' && pathname === '/api/me') return handleMe(request, env);
  if (method === 'POST' && pathname === '/api/auth/register-start') return handleRegisterStart(request, env);
  if (method === 'POST' && pathname === '/api/auth/register') return handleRegister(request, env, url, secure);
  if (method === 'POST' && pathname === '/api/auth/login') return handleLogin(request, env, url, secure);
  if (method === 'POST' && pathname === '/api/auth/forgot-start') return handleForgotStart(request, env);
  if (method === 'POST' && pathname === '/api/auth/reset') return handleReset(request, env, url, secure);

  // 写操作做同源校验
  if (method !== 'GET' && !isSameOrigin(request, url)) {
    return errorJson(403, '跨站请求被拒绝');
  }

  // 以下接口需要登录
  const auth = await currentUser(env.DB, request);
  if (!auth) return errorJson(401, '未登录或登录已过期');
  if (auth.banned) return errorJson(403, '该账号已被封禁，请联系管理员', 'banned');
  const user = auth.user;

  if (method === 'POST' && pathname === '/api/auth/logout') return handleLogout(request, env, url, secure);
  if (method === 'GET' && pathname === '/api/memos') return listMemos(request, env, url, user);
  if (method === 'POST' && pathname === '/api/memos') return createMemo(request, env, user);
  if (method === 'GET' && pathname === '/api/memos/random') return randomMemos(request, env, url, user);
  const memoMatch = pathname.match(/^\/api\/memos\/(\d+)$/);
  if (memoMatch) {
    const id = Number(memoMatch[1]);
    if (method === 'PUT') return updateMemo(request, env, user, id);
    if (method === 'DELETE') return deleteMemo(env, user, id);
  }
  if (method === 'GET' && pathname === '/api/tags') return listTags(request, env, user);
  if (method === 'GET' && pathname === '/api/stats') return getStats(request, env, user);
  if (method === 'POST' && pathname === '/api/upload') return uploadImage(request, env, user);
  if (method === 'GET' && pathname === '/api/export') return exportData(request, env, url, user);

  // 管理员接口
  if (pathname === '/api/admin/users' || pathname.indexOf('/api/admin/users/') === 0) {
    if (!(await adminGuard(user))) return errorJson(403, '需要管理员权限');
    if (method === 'GET' && pathname === '/api/admin/users') return adminListUsers(request, env);
    const banMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
    if (banMatch && method === 'POST') return adminBanUser(request, env, user, Number(banMatch[1]));
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && method === 'DELETE') return adminDeleteUser(env, user, Number(userMatch[1]));
  }

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
      if (url.pathname.startsWith('/files/')) return await serveFile(request, env, url, await requireFileUser(env, request));
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorJson(500, '服务器内部错误');
    }
  },
};

async function requireFileUser(env, request) {
  const auth = await currentUser(env.DB, request);
  if (auth && !auth.banned) return auth.user;
  return { id: -1 }; // 未登录/被封禁时使用不可能匹配的 id，使文件路径统一返回 404
}
