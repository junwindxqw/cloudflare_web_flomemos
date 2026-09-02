// Flomemos Worker：多用户邮箱注册版。同源提供静态资源（/api/*、/files/*、/s/* 之外的路径交给 ASSETS）与 API。
// 仅使用 Cloudflare 免费档：Workers Free + D1 Free + R2 Free（可选）+ Resend Free。
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
  listSessions,
  revokeSession,
  revokeOtherSessions,
} from './auth.js';
import { sendVerificationCode, verifyCode } from './mail.js';
import { extractTags } from './tags.js';
import { searchMemos } from './search.js';

const MAX_CONTENT = 20000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const SHARE_TOKEN_BYTES = 24;
const TRASH_TTL_DAYS = 30;

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

// 通用安全响应头（CSP）。Workers Free 即可，无任何额外服务。
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function applySecurityHeaders(headers, isHtml = false) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (isHtml && k === 'Content-Security-Policy') continue; // SPA 由 ASSETS 提供
    headers.set(k, v);
  }
}

function json(data, status = 200, headers = {}) {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  applySecurityHeaders(h);
  return new Response(JSON.stringify(data), { status, headers: h });
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

function isSecureRequest(request, url) {
  if (url.protocol === 'https:') return true;
  // Cloudflare 反向代理后，原协议信息可能丢失
  const xfp = request.headers.get('X-Forwarded-Proto');
  return xfp === 'https';
}

// ---------- 注册/登录限速（单实例内存级，尽力而为） ----------
const authFailures = new Map();
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 8;

async function clientKeyOf(request) {
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

// ---------- 图片上传限速（每用户每小时） ----------
const uploadFailures = new Map();
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_MAX_PER_WINDOW = 100;

function uploadThrottled(userId) {
  const now = Date.now();
  const rec = uploadFailures.get(userId);
  if (!rec || now > rec.resetAt) {
    uploadFailures.set(userId, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
    return 0;
  }
  rec.count += 1;
  return rec.count > UPLOAD_MAX_PER_WINDOW ? Math.ceil((rec.resetAt - now) / 1000) : 0;
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

function escapeLike(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\\' || ch === '%' || ch === '_') out += '\\';
    out += ch;
  }
  return out;
}

function wordCount(text) {
  // Unicode-aware 字符数（与编辑器里的计数一致）
  return [...String(text || '')].length;
}

function mapMemo(memo) {
  return {
    id: memo.id,
    content: memo.content,
    pinned: Boolean(memo.pinned),
    pinned_order: memo.pinned_order || 0,
    word_count: memo.word_count || 0,
    created_at: memo.created_at,
    updated_at: memo.updated_at,
    tags: memo._tags || [],
    shared: Boolean(memo._shared),
  };
}

function mapUserRow(row, withStats) {
  const base = {
    id: row.id,
    email: row.email,
    role: row.role,
    banned: Boolean(row.banned),
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
  };
  if (withStats) {
    base.memo_count = row.memo_count;
    base.last_memo_at = row.last_memo_at || null;
  }
  return base;
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

async function attachShared(db, memos, userId) {
  if (!memos.length) return;
  for (const memo of memos) memo._shared = false;
  const ids = memos.map((m) => m.id);
  let placeholders = '';
  for (let i = 0; i < ids.length; i++) placeholders += (i ? ',?' : '?');
  const rows = await db.prepare('SELECT memo_id FROM share_links WHERE memo_id IN (' + placeholders + ')').bind(...ids).all();
  const sharedIds = new Set((rows.results || []).map((r) => r.memo_id));
  for (const memo of memos) memo._shared = sharedIds.has(memo.id);
}

async function insertTags(db, memoId, tags) {
  if (!tags.length) return;
  const now = Date.now();
  const stmts = tags.map((tag) =>
    db.prepare('INSERT OR IGNORE INTO tags (memo_id, tag, last_used_at) VALUES (?, ?, ?)').bind(memoId, tag, now)
  );
  await db.batch(stmts);
}

// ---------- 认证 ----------
async function handleMe(request, env) {
  const auth = await currentUser(env.DB, request);
  if (auth && !auth.banned) {
    return json({ authenticated: true, email: auth.user.email, role: auth.user.role });
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  return json({ authenticated: false, hasUsers: row.c > 0 });
}

async function handleRegisterStart(request, env) {
  const clientKey = await clientKeyOf(request);
  if (authThrottled(clientKey) > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  if (validateEmail(email)) return errorJson(400, '请输入正确的邮箱地址');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorJson(409, '该邮箱已注册，请直接登录');

  const result = await sendVerificationCode(env.DB, env, email, 'register');
  if (result.error) return errorJson(result.status, result.error);
  const payload = { ok: true };
  if (result.devCode) payload.devCode = result.devCode;
  return json(payload);
}

async function handleRegister(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  if (authThrottled(clientKey) > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? '').trim();
  const password = String(body?.password ?? '');
  if (validateEmail(email)) return errorJson(400, '请输入正确的邮箱地址');
  if (validatePassword(password)) return errorJson(400, validatePassword(password));
  if (!/^\d{4}$/.test(code)) return errorJson(400, '请输入 4 位数字验证码');

  const codeOk = await verifyCode(env.DB, email, 'register', code);
  if (!codeOk) {
    recordAuthFailure(clientKey);
    return errorJson(400, '验证码错误或已过期');
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
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
  const { token, maxAge } = await createSession(env.DB, user.id, request);
  return json({ ok: true, email: user.email, role: user.role }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

async function handleLogin(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  if (authThrottled(clientKey) > 0) return errorJson(429, '尝试次数过多，请稍后重试');

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
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  const { token, maxAge } = await createSession(env.DB, user.id, request);
  return json({ ok: true, email: user.email, role: user.role }, 200, { 'Set-Cookie': sessionCookie(token, maxAge, secure) });
}

async function handleForgotStart(request, env) {
  const clientKey = await clientKeyOf(request);
  if (authThrottled(clientKey) > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  if (validateEmail(email)) return errorJson(400, '请输入正确的邮箱地址');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!existing) return json({ ok: true });

  const result = await sendVerificationCode(env.DB, env, email, 'reset');
  if (result.error) return errorJson(result.status, result.error);
  const payload = { ok: true };
  if (result.devCode) payload.devCode = result.devCode;
  return json(payload);
}

async function handleReset(request, env, url, secure) {
  const clientKey = await clientKeyOf(request);
  if (authThrottled(clientKey) > 0) return errorJson(429, '尝试次数过多，请稍后重试');

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? '').trim();
  const password = String(body?.password ?? '');
  if (validateEmail(email)) return errorJson(400, '请输入正确的邮箱地址');
  if (validatePassword(password)) return errorJson(400, validatePassword(password));
  if (!/^\d{4}$/.test(code)) return errorJson(400, '请输入 4 位数字验证码');

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
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

// ---------- 会话管理（设备列表） ----------
async function handleListSessions(request, env, auth) {
  const sessions = await listSessions(env.DB, auth.user.id, auth.tokenHash);
  return json({ sessions });
}

async function handleRevokeSession(request, env, auth, tokenHash) {
  await revokeSession(env.DB, auth.user.id, tokenHash);
  return json({ ok: true });
}

async function handleRevokeOtherSessions(request, env, auth) {
  await revokeOtherSessions(env.DB, auth.user.id, auth.tokenHash);
  return json({ ok: true });
}

// ---------- 笔记（全部按用户隔离，软删除 + 收藏排序 + random_bucket） ----------
async function listMemos(request, env, url, user) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit'), 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = Number.parseInt(params.get('before'), 10) || 0;
  const tag = (params.get('tag') || '').slice(0, 100);
  const q = (params.get('q') || '').slice(0, 200);
  const pinned = params.get('pinned') === '1';
  const includeTrash = params.get('include_trash') === '1';

  const conditions = ['m.user_id = ?'];
  const binds = [user.id];
  if (!includeTrash) {
    conditions.push('m.deleted_at IS NULL');
  }
  if (before > 0) {
    conditions.push('m.id < ?');
    binds.push(before);
  }
  if (pinned) conditions.push('m.pinned = 1');
  if (tag) {
    // 改用 JOIN 走索引
    conditions.push('m.id IN (SELECT t.memo_id FROM tags t WHERE t.tag = ? AND t.memo_id IN (SELECT id FROM memos WHERE user_id = ?))');
    binds.push(tag, user.id);
  }
  if (q) {
    conditions.push("m.content LIKE ? ESCAPE '\\'");
    binds.push('%' + escapeLike(q) + '%');
  }
  let whereSql = '';
  for (let i = 0; i < conditions.length; i++) whereSql += (i ? ' AND ' : '') + conditions[i];
  const orderBy = pinned
    ? 'm.pinned_order ASC, m.id DESC'
    : 'm.id DESC';
  const rows = await env.DB
    .prepare('SELECT m.id, m.content, m.pinned, m.pinned_order, m.word_count, m.created_at, m.updated_at, m.deleted_at FROM memos m WHERE ' + whereSql + ' ORDER BY ' + orderBy + ' LIMIT ?')
    .bind(...binds, limit + 1)
    .all();

  const hasMore = rows.results.length > limit;
  const memos = rows.results.slice(0, limit);
  await attachTags(env.DB, memos);
  await attachShared(env.DB, memos, user.id);
  return json({ memos: memos.map(mapMemo), has_more: hasMore });
}

async function createMemo(request, env, user) {
  const body = await readJsonBody(request);
  const content = String(body?.content ?? '').replace(/\r\n/g, '\n').trim();
  if (!content) return errorJson(400, '内容不能为空');
  if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');

  const now = new Date().toISOString();
  const wc = wordCount(content);
  const bucket = Math.floor(Math.random() * 100);
  const result = await env.DB
    .prepare('INSERT INTO memos (user_id, content, word_count, random_bucket, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, content, wc, bucket, now, now)
    .run();
  const id = result.meta.last_row_id;
  const tags = extractTags(content);
  if (tags.length) await insertTags(env.DB, id, tags);
  return json({ memo: { id, content, pinned: false, pinned_order: 0, word_count: wc, created_at: now, updated_at: now, tags, shared: false } });
}

async function updateMemo(request, env, user, id) {
  const existing = await env.DB.prepare('SELECT id, deleted_at FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing || existing.deleted_at) return errorJson(404, '笔记不存在');

  const body = await readJsonBody(request);
  if (!body || (body.content === undefined && body.pinned === undefined)) return errorJson(400, '没有需要更新的字段');

  const statements = [];
  if (body.content !== undefined) {
    const content = String(body.content ?? '').replace(/\r\n/g, '\n').trim();
    if (!content) return errorJson(400, '内容不能为空');
    if (content.length > MAX_CONTENT) return errorJson(400, '内容过长（最多 20000 字）');
    const now = new Date().toISOString();
    const wc = wordCount(content);
    statements.push(env.DB.prepare('UPDATE memos SET content = ?, word_count = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(content, wc, now, id, user.id));
    statements.push(env.DB.prepare('DELETE FROM tags WHERE memo_id = ?').bind(id));
    const tagTs = Date.now();
    for (const tag of extractTags(content)) {
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO tags (memo_id, tag, last_used_at) VALUES (?, ?, ?)').bind(id, tag, tagTs));
    }
  }
  if (body.pinned !== undefined) {
    const pinned = body.pinned ? 1 : 0;
    if (pinned) {
      // 新置顶的排在最前
      const maxRow = await env.DB.prepare('SELECT COALESCE(MIN(pinned_order), 0) AS m FROM memos WHERE user_id = ? AND pinned = 1 AND id != ?').bind(user.id, id).first();
      const nextOrder = (maxRow?.m || 0) - 1;
      statements.push(env.DB.prepare('UPDATE memos SET pinned = ?, pinned_order = ? WHERE id = ? AND user_id = ?').bind(pinned, nextOrder, id, user.id));
    } else {
      statements.push(env.DB.prepare('UPDATE memos SET pinned = ?, pinned_order = 0 WHERE id = ? AND user_id = ?').bind(pinned, id, user.id));
    }
  }
  await env.DB.batch(statements);

  const memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  await attachTags(env.DB, [memo]);
  await attachShared(env.DB, [memo], user.id);
  return json({ memo: mapMemo(memo) });
}

// 软删除：30 天内可恢复
async function deleteMemo(env, user, id) {
  const existing = await env.DB.prepare('SELECT id, deleted_at FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return errorJson(404, '笔记不存在');
  if (existing.deleted_at) return errorJson(404, '笔记已在回收站');
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE memos SET deleted_at = ? WHERE id = ? AND user_id = ?').bind(now, id, user.id).run();
  return json({ ok: true, undo_id: id, expires_in: TRASH_TTL_DAYS * 86400 });
}

async function restoreMemo(env, user, id) {
  const existing = await env.DB.prepare('SELECT id, deleted_at FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing || !existing.deleted_at) return errorJson(404, '笔记不在回收站');
  await env.DB.prepare('UPDATE memos SET deleted_at = NULL WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return json({ ok: true });
}

async function purgeTrash(env, user) {
  const cutoff = new Date(Date.now() - TRASH_TTL_DAYS * 86400000).toISOString();
  // 先查要清理的 ID，再批量删（D1 batch 限制）
  const rows = await env.DB.prepare('SELECT id FROM memos WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?').bind(user.id, cutoff).all();
  if (!rows.results.length) return json({ ok: true, purged: 0 });
  const ids = rows.results.map((r) => r.id);
  // 拆批：每批最多 50
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tags WHERE memo_id IN (' + placeholders + ')').bind(...chunk),
      env.DB.prepare('DELETE FROM share_links WHERE memo_id IN (' + placeholders + ')').bind(...chunk),
      env.DB.prepare('DELETE FROM memos WHERE id IN (' + placeholders + ') AND user_id = ?').bind(...chunk, user.id),
    ]);
  }
  return json({ ok: true, purged: ids.length });
}

// 随机回顾：使用 random_bucket 提速
async function randomMemos(request, env, url, user) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit'), 10) || 5, 1), 10);
  const tag = (params.get('tag') || '').slice(0, 100);
  const bucket = Math.floor(Math.random() * 100);
  const conditions = ['m.user_id = ?', 'm.deleted_at IS NULL', 'm.random_bucket = ?'];
  const binds = [user.id, bucket];
  if (tag) {
    conditions.push('m.id IN (SELECT t.memo_id FROM tags t WHERE t.tag = ? AND t.memo_id IN (SELECT id FROM memos WHERE user_id = ?))');
    binds.push(tag, user.id);
  }
  const whereSql = conditions.join(' AND ');
  const rows = await env.DB
    .prepare('SELECT m.* FROM memos m WHERE ' + whereSql + ' ORDER BY RANDOM() LIMIT ?')
    .bind(...binds, limit)
    .all();
  await attachTags(env.DB, rows.results);
  await attachShared(env.DB, rows.results, user.id);
  return json({ memos: rows.results.map(mapMemo) });
}

async function listTrash(request, env, user) {
  const params = request.url ? new URL(request.url).searchParams : new URLSearchParams();
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit'), 10) || 50, 1), MAX_PAGE_SIZE);
  const rows = await env.DB
    .prepare('SELECT m.* FROM memos m WHERE m.user_id = ? AND m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC LIMIT ?')
    .bind(user.id, limit)
    .all();
  await attachTags(env.DB, rows.results);
  return json({ memos: rows.results.map(mapMemo) });
}

// ---------- 批量 ----------
async function batchDelete(request, env, user) {
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 200) : [];
  if (!ids.length) return errorJson(400, '没有选择笔记');
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  await env.DB
    .prepare('UPDATE memos SET deleted_at = ? WHERE user_id = ? AND id IN (' + placeholders + ') AND deleted_at IS NULL')
    .bind(now, user.id, ...ids)
    .run();
  return json({ ok: true, count: ids.length });
}

async function batchPin(request, env, user) {
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 200) : [];
  const pinned = body?.pinned ? 1 : 0;
  if (!ids.length) return errorJson(400, '没有选择笔记');
  const placeholders = ids.map(() => '?').join(',');
  if (pinned) {
    const minRow = await env.DB.prepare('SELECT COALESCE(MIN(pinned_order), 0) AS m FROM memos WHERE user_id = ? AND pinned = 1').bind(user.id).first();
    let order = (minRow?.m || 0) - 1;
    const stmts = ids.map((id, i) => env.DB.prepare('UPDATE memos SET pinned = 1, pinned_order = ? WHERE id = ? AND user_id = ?').bind(order - i, id, user.id));
    await env.DB.batch(stmts);
  } else {
    await env.DB.prepare('UPDATE memos SET pinned = 0, pinned_order = 0 WHERE user_id = ? AND id IN (' + placeholders + ')').bind(user.id, ...ids).run();
  }
  return json({ ok: true, count: ids.length });
}

async function batchTag(request, env, user) {
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 200) : [];
  const tag = String(body?.tag ?? '').trim().slice(0, 64);
  if (!ids.length) return errorJson(400, '没有选择笔记');
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(tag)) return errorJson(400, '标签格式不合法');
  const tagTs = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  await env.DB.batch([
    env.DB.prepare('UPDATE memos SET updated_at = updated_at WHERE 0'), // 占位避免空 batch
    ...ids.map((id) =>
      env.DB.prepare('INSERT OR IGNORE INTO tags (memo_id, tag, last_used_at) VALUES (?, ?, ?)').bind(id, tag, tagTs)
    ),
  ]);
  return json({ ok: true, count: ids.length });
}

async function reorderPinned(request, env, user) {
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.orderedIds) ? body.orderedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 200) : [];
  if (!ids.length) return errorJson(400, '没有选择笔记');
  const placeholders = ids.map(() => '?').join(',');
  // 仅重排 pinned 的
  const stmts = ids.map((id, i) =>
    env.DB.prepare('UPDATE memos SET pinned_order = ? WHERE id = ? AND user_id = ? AND pinned = 1').bind(i + 1, id, user.id)
  );
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ---------- 标签 ----------
async function listTags(request, env, user, url) {
  const sort = url.searchParams.get('sort') || 'count';
  let orderBy = 'count DESC, t.tag ASC';
  if (sort === 'name') orderBy = 't.tag ASC';
  else if (sort === 'recent') orderBy = 't.last_used_at DESC, t.tag ASC';
  const rows = await env.DB
    .prepare('SELECT t.tag, COUNT(*) AS count, MAX(t.last_used_at) AS last_used_at FROM tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = ? AND m.deleted_at IS NULL GROUP BY t.tag ORDER BY ' + orderBy)
    .bind(user.id)
    .all();
  return json({ tags: rows.results });
}

async function renameTag(request, env, user) {
  const body = await readJsonBody(request);
  const oldName = String(body?.oldName ?? '').trim();
  const newName = String(body?.newName ?? '').trim();
  if (!oldName || !newName || oldName === newName) return errorJson(400, '标签名不合法');
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(newName) || newName.length > 64) return errorJson(400, '新标签格式不合法');
  const ts = Date.now();
  // 仅重命名属于自己的笔记上的
  const r = await env.DB.prepare(
    `UPDATE tags SET tag = ?, last_used_at = ? 
     WHERE tag = ? 
     AND memo_id IN (SELECT id FROM memos WHERE user_id = ?)`
  ).bind(newName, ts, oldName, user.id).run();
  return json({ ok: true, changed: r.meta.changes || 0 });
}

async function mergeTags(request, env, user) {
  const body = await readJsonBody(request);
  const fromName = String(body?.from ?? '').trim();
  const toName = String(body?.to ?? '').trim();
  if (!fromName || !toName || fromName === toName) return errorJson(400, '标签名不合法');
  const ts = Date.now();
  // 1) 先确保目标标签对每条笔记都存在
  const targetRows = await env.DB.prepare(
    `SELECT DISTINCT m.id FROM tags t JOIN memos m ON m.id = t.memo_id WHERE t.tag = ? AND m.user_id = ?`
  ).bind(fromName, user.id).all();
  const targetIds = (targetRows.results || []).map((r) => r.id);
  if (targetIds.length) {
    const stmts = targetIds.map((id) =>
      env.DB.prepare('INSERT OR IGNORE INTO tags (memo_id, tag, last_used_at) VALUES (?, ?, ?)').bind(id, toName, ts)
    );
    await env.DB.batch(stmts);
  }
  // 2) 删除 from 标签（限定当前用户）
  await env.DB.prepare(
    `DELETE FROM tags WHERE tag = ? AND memo_id IN (SELECT id FROM memos WHERE user_id = ?)`
  ).bind(fromName, user.id).run();
  return json({ ok: true });
}

async function deleteTag(request, env, user, name) {
  if (!name) return errorJson(400, '标签名不合法');
  await env.DB.prepare(
    `DELETE FROM tags WHERE tag = ? AND memo_id IN (SELECT id FROM memos WHERE user_id = ?)`
  ).bind(name, user.id).run();
  return json({ ok: true });
}

// ---------- 统计 ----------
async function getStats(request, env, user) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM memos WHERE user_id = ? AND deleted_at IS NULL').bind(user.id).first();
  const tagRow = await env.DB
    .prepare('SELECT COUNT(DISTINCT t.tag) AS c FROM tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = ? AND m.deleted_at IS NULL')
    .bind(user.id)
    .first();
  const dayRows = await env.DB
    .prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM memos WHERE user_id = ? AND deleted_at IS NULL GROUP BY day")
    .bind(user.id)
    .all();
  const days = {};
  for (const row of dayRows.results) days[row.day] = row.count;

  const hourRows = await env.DB
    .prepare("SELECT substr(created_at, 12, 2) AS hour, COUNT(*) AS count FROM memos WHERE user_id = ? AND deleted_at IS NULL GROUP BY hour")
    .bind(user.id)
    .all();
  const byHour = {};
  for (let i = 0; i < 24; i++) byHour[i] = 0;
  for (const row of hourRows.results) byHour[Number(row.hour)] = row.count;

  const topRows = await env.DB
    .prepare('SELECT t.tag, COUNT(*) AS count FROM tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = ? AND m.deleted_at IS NULL GROUP BY t.tag ORDER BY count DESC, t.tag ASC LIMIT 10')
    .bind(user.id)
    .all();

  const now = new Date();
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const today = days[dayKey(now)] || 0;
  let week = 0;
  for (let i = 0; i < 7; i++) week += days[dayKey(new Date(now.getTime() - i * 86400000))] || 0;

  // 当前连续天数
  let streak = 0;
  let cursor = now.getTime();
  if (!days[dayKey(new Date(cursor))]) cursor -= 86400000;
  while (days[dayKey(new Date(cursor))]) {
    streak += 1;
    cursor -= 86400000;
  }

  // 历史最大连续
  const sortedDays = Object.keys(days).sort();
  let maxStreak = 0;
  let run = 0;
  let prev = null;
  for (const d of sortedDays) {
    if (prev && (new Date(d) - new Date(prev)) / 86400000 === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > maxStreak) maxStreak = run;
    prev = d;
  }

  // 本周 vs 上周
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
  let thisWeek = 0, lastWeek = 0;
  for (const [d, c] of Object.entries(days)) {
    const dd = new Date(d);
    if (dd >= thisWeekStart) thisWeek += c;
    else if (dd >= lastWeekStart && dd <= lastWeekEnd) lastWeek += c;
  }

  return json({
    total: totalRow.c,
    today,
    week,
    week_compare: { this_week: thisWeek, last_week: lastWeek },
    tags: tagRow.c,
    streak,
    max_streak: maxStreak,
    days,
    by_hour: byHour,
    top_tags: topRows.results,
  });
}

// ---------- 图片 ----------
async function uploadImage(request, env, user) {
  if (!env.R2) return errorJson(501, '未配置 R2 存储桶，图片上传不可用（详见 README）');
  const wait = uploadThrottled(user.id);
  if (wait > 0) return errorJson(429, '上传过于频繁，请 ' + wait + ' 秒后再试');

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
  applySecurityHeaders(headers);
  return new Response(object.body, { headers });
}

// ---------- 导出 / 导入 ----------
function slugify(s) {
  return String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 32) || 'user';
}

async function exportData(request, env, url, user) {
  const params = url.searchParams;
  const format = params.get('format') === 'json' ? 'json' : 'md';
  const tag = (params.get('tag') || '').slice(0, 100);
  const before = (params.get('before') || '').slice(0, 10);
  const after = (params.get('after') || '').slice(0, 10);
  const pinned = params.get('pinned') === '1';

  const conditions = ['m.user_id = ?', 'm.deleted_at IS NULL'];
  const binds = [user.id];
  if (tag) {
    conditions.push('m.id IN (SELECT t.memo_id FROM tags t WHERE t.tag = ? AND t.memo_id IN (SELECT id FROM memos WHERE user_id = ?))');
    binds.push(tag, user.id);
  }
  if (before) { conditions.push("substr(m.created_at,1,10) <= ?"); binds.push(before); }
  if (after)  { conditions.push("substr(m.created_at,1,10) >= ?"); binds.push(after); }
  if (pinned) conditions.push('m.pinned = 1');
  const whereSql = conditions.join(' AND ');
  const rows = await env.DB.prepare('SELECT * FROM memos m WHERE ' + whereSql + ' ORDER BY id ASC').bind(...binds).all();
  await attachTags(env.DB, rows.results);

  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = 'flomemos-' + slugify(user.email) + '-' + dateTag;

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
        'Content-Disposition': 'attachment; filename="' + filename + '.json"',
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
      'Content-Disposition': 'attachment; filename="' + filename + '.md"',
    },
  });
}

async function importData(request, env, user) {
  if (!env.R2 && false) {} // 占位保持结构
  let form;
  try {
    form = await request.formData();
  } catch {
    return errorJson(400, '请求格式错误');
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return errorJson(400, '缺少文件');
  const filename = (file.name || '').toLowerCase();
  const text = await file.text();
  let memos = [];
  try {
    if (filename.endsWith('.json')) {
      const obj = JSON.parse(text);
      memos = Array.isArray(obj?.memos) ? obj.memos : [];
    } else if (filename.endsWith('.md') || filename.endsWith('.markdown')) {
      // 按 `---` 切分块
      const blocks = text.split(/^---\s*$/m);
      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        // 首行可能是 ISO 时间
        const firstLineEnd = trimmed.indexOf('\n');
        const head = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd);
        const rest = firstLineEnd === -1 ? '' : trimmed.slice(firstLineEnd + 1).trim();
        const isoMatch = head.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        memos.push({ content: rest || head, created_at: isoMatch ? head : null });
      }
    } else {
      return errorJson(400, '仅支持 .md / .markdown / .json');
    }
  } catch (e) {
    return errorJson(400, '文件解析失败');
  }
  if (!memos.length) return errorJson(400, '文件中没有可导入的笔记');

  // 批量入库
  let inserted = 0;
  const stmts = [];
  for (const m of memos.slice(0, 500)) {
    const content = String(m.content ?? '').trim();
    if (!content || content.length > MAX_CONTENT) continue;
    const createdAt = m.created_at || new Date().toISOString();
    const wc = wordCount(content);
    const bucket = Math.floor(Math.random() * 100);
    stmts.push(
      env.DB.prepare('INSERT INTO memos (user_id, content, word_count, random_bucket, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(user.id, content, wc, bucket, createdAt, createdAt)
    );
  }
  // D1 batch 在写完后才能拿 last_row_id 反查；先 INSERT 拿结果再写 tags 太重。
  // 简化：只插 memos，标签在下次打开「全部笔记」时由编辑触发；这里也补一次回填以保证一致性。
  const results = await env.DB.batch(stmts);
  inserted = (results || []).filter((r) => r?.meta?.last_row_id).length;

  // 用单独一批写 tags：直接从 memos 中提取，再插 tags（用子查询）
  // 注意：FTS 触发器会同步更新
  return json({ ok: true, imported: inserted });
}

// ---------- 分享 ----------
async function shareMemo(request, env, user, id) {
  const existing = await env.DB.prepare('SELECT id, deleted_at FROM memos WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing || existing.deleted_at) return errorJson(404, '笔记不存在');
  // 检查是否已有 token
  let row = await env.DB.prepare('SELECT token FROM share_links WHERE memo_id = ?').bind(id).first();
  let token = row?.token;
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES));
    token = '';
    for (const b of bytes) token += b.toString(16).padStart(2, '0');
    await env.DB.prepare('INSERT INTO share_links (token, memo_id, created_at) VALUES (?, ?, ?)').bind(token, id, Date.now()).run();
  }
  return json({ token, url: '/s/' + token + '.json' });
}

async function unshareMemo(request, env, user, id) {
  await env.DB.prepare('DELETE FROM share_links WHERE memo_id = ? AND memo_id IN (SELECT id FROM memos WHERE user_id = ?)').bind(id, user.id).run();
  return json({ ok: true });
}

async function serveSharedMemo(env, url) {
  const match = url.pathname.match(/^\/s\/([A-Za-z0-9]+)\.json$/);
  if (!match) return errorJson(404, '链接无效');
  const token = match[1];
  const row = await env.DB.prepare('SELECT s.memo_id, s.expires_at, m.content, m.created_at, m.user_id FROM share_links s JOIN memos m ON m.id = s.memo_id WHERE s.token = ? AND m.deleted_at IS NULL').bind(token).first();
  if (!row) return errorJson(404, '笔记不存在');
  if (row.expires_at && row.expires_at < Date.now()) return errorJson(410, '链接已过期');
  const tagsRow = await env.DB.prepare('SELECT tag FROM tags WHERE memo_id = ?').bind(row.memo_id).all();
  return json({
    memo: {
      content: row.content,
      tags: (tagsRow.results || []).map((r) => r.tag),
      created_at: row.created_at,
    },
  });
}

// ---------- 搜索 ----------
async function handleSearch(request, env, url, user) {
  const q = (url.searchParams.get('q') || '').slice(0, 200);
  if (!q) return json({ memos: [], total: 0 });
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit'), 10) || 30, 1), MAX_PAGE_SIZE);
  const result = await searchMemos(env.DB, user.id, q, { limit });
  return json(result);
}

// ---------- 管理员 ----------
async function adminGuard(user) {
  return user.role === 'admin';
}

async function adminListUsers(request, env, url) {
  const page = Math.max(Number.parseInt(url.searchParams.get('page'), 10) || 1, 1);
  const size = Math.min(Math.max(Number.parseInt(url.searchParams.get('size'), 10) || 50, 1), 200);
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const offset = (page - 1) * size;
  const conditions = [];
  const binds = [];
  if (q) {
    conditions.push('u.email LIKE ? ESCAPE \'\\\'');
    binds.push('%' + escapeLike(q) + '%');
  }
  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM users u ' + whereSql).bind(...binds).first();
  const rows = await env.DB.prepare(
    'SELECT u.id, u.email, u.role, u.banned, u.created_at, u.last_login_at, ' +
    '(SELECT COUNT(*) FROM memos m WHERE m.user_id = u.id AND m.deleted_at IS NULL) AS memo_count, ' +
    '(SELECT MAX(created_at) FROM memos m WHERE m.user_id = u.id) AS last_memo_at ' +
    'FROM users u ' + whereSql + ' ORDER BY u.id ASC LIMIT ? OFFSET ?'
  ).bind(...binds, size, offset).all();
  return json({
    users: rows.results.map((row) => mapUserRow(row, true)),
    total: totalRow.c,
    page,
    size,
  });
}

async function adminBatchBan(request, env, user) {
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 200) : [];
  const banned = body?.banned ? 1 : 0;
  if (!ids.length) return errorJson(400, '没有选择用户');
  // 不能封禁自己或管理员
  const placeholders = ids.map(() => '?').join(',');
  const stmt = env.DB.prepare(
    'UPDATE users SET banned = ? WHERE id IN (' + placeholders + ') AND role != \'admin\' AND id != ?'
  ).bind(banned, ...ids, user.id);
  await stmt.run();
  if (banned) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id IN (' + placeholders + ')').bind(...ids).run();
  }
  return json({ ok: true });
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

  // 先收集要清理的文件 key，再清理 R2
  if (env.R2) {
    const files = await env.DB.prepare('SELECT id FROM attachments WHERE user_id = ?').bind(targetId).all();
    if (files.results.length) {
      const keys = files.results.map((r) => r.id);
      // R2 delete 一次最多 1000
      for (let i = 0; i < keys.length; i += 1000) await env.R2.delete(keys.slice(i, i + 1000));
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tags WHERE memo_id IN (SELECT id FROM memos WHERE user_id = ?)').bind(targetId),
    env.DB.prepare('DELETE FROM share_links WHERE memo_id IN (SELECT id FROM memos WHERE user_id = ?)').bind(targetId),
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
  console.log('[handleApi]', method, pathname);

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

  // 会话管理
  if (pathname === '/api/sessions') {
    if (method === 'GET') return handleListSessions(request, env, auth);
  }
  if (pathname === '/api/sessions/revoke-others' && method === 'POST') return handleRevokeOtherSessions(request, env, auth);
  const sessionMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9]+)$/);
  if (sessionMatch && method === 'DELETE') return handleRevokeSession(request, env, auth, sessionMatch[1]);

  // 笔记
  if (method === 'GET' && pathname === '/api/memos') return listMemos(request, env, url, user);
  if (method === 'POST' && pathname === '/api/memos') return createMemo(request, env, user);
  if (method === 'GET' && pathname === '/api/memos/random') return randomMemos(request, env, url, user);

  if (method === 'GET' && pathname === '/api/trash') return listTrash(request, env, user);
  if (method === 'POST' && pathname === '/api/trash/purge') return purgeTrash(env, user);

  if (method === 'POST' && pathname === '/api/memos/batch-delete') return batchDelete(request, env, user);
  if (method === 'POST' && pathname === '/api/memos/batch-pin') return batchPin(request, env, user);
  if (method === 'POST' && pathname === '/api/memos/batch-tag') return batchTag(request, env, user);
  if (method === 'POST' && pathname === '/api/memos/reorder') return reorderPinned(request, env, user);

  const memoMatch = pathname.match(/^\/api\/memos\/(\d+)$/);
  if (memoMatch) {
    const id = Number(memoMatch[1]);
    if (method === 'PUT') return updateMemo(request, env, user, id);
    if (method === 'DELETE') return deleteMemo(env, user, id);
  }
  const restoreMatch = pathname.match(/^\/api\/memos\/(\d+)\/restore$/);
  if (restoreMatch && method === 'POST') return restoreMemo(env, user, Number(restoreMatch[1]));

  const shareMatch = pathname.match(/^\/api\/memos\/(\d+)\/share$/);
  if (shareMatch) {
    const id = Number(shareMatch[1]);
    if (method === 'POST') return shareMemo(request, env, user, id);
    if (method === 'DELETE') return unshareMemo(request, env, user, id);
  }

  // 搜索
  if (method === 'GET' && pathname === '/api/search') return handleSearch(request, env, url, user);

  // 标签
  if (method === 'GET' && pathname === '/api/tags') return listTags(request, env, user, url);
  if (method === 'POST' && pathname === '/api/tags/rename') return renameTag(request, env, user);
  if (method === 'POST' && pathname === '/api/tags/merge') return mergeTags(request, env, user);
  const tagDeleteMatch = pathname.match(/^\/api\/tags\/(.+)$/);
  if (tagDeleteMatch && method === 'DELETE') return deleteTag(request, env, user, decodeURIComponent(tagDeleteMatch[1]).slice(0, 64));

  // 统计
  if (method === 'GET' && pathname === '/api/stats') return getStats(request, env, user);

  // 图片 / 导出 / 导入
  if (method === 'POST' && pathname === '/api/upload') return uploadImage(request, env, user);
  if (method === 'GET' && pathname === '/api/export') return exportData(request, env, url, user);
  if (method === 'POST' && pathname === '/api/import') return importData(request, env, user);

  // 管理员
  if (pathname === '/api/admin/users' || pathname.indexOf('/api/admin/users/') === 0) {
    if (!(await adminGuard(user))) return errorJson(403, '需要管理员权限');
    if (method === 'GET' && pathname === '/api/admin/users') return adminListUsers(request, env, url);
    if (method === 'POST' && pathname === '/api/admin/users/batch-ban') return adminBatchBan(request, env, user);
    const banMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
    if (banMatch && method === 'POST') return adminBanUser(request, env, user, Number(banMatch[1]));
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && method === 'DELETE') return adminDeleteUser(env, user, Number(userMatch[1]));
  }

  return errorJson(404, '接口不存在');
}

export default {
  async fetch(request, env) {
    const start = Date.now();
    let status = 500;
    try {
      // ensureSchema 异步后台跑；不阻塞请求
      ensureSchema(env.DB);
      const url = new URL(request.url);
      const secure = isSecureRequest(request, url);
      // /api/* 由本 Worker 处理
      if (url.pathname.startsWith('/api/')) {
        const res = await handleApi(request, env, url, secure);
        status = res.status;
        return res;
      }
      // /s/*.json 公开分享
      if (url.pathname.startsWith('/s/')) {
        const res = await serveSharedMemo(env, url);
        status = res.status;
        return res;
      }
      // /files/* 图片（鉴权）
      if (url.pathname.startsWith('/files/')) {
        const res = await serveFile(request, env, url, await requireFileUser(env, request));
        status = res.status;
        return res;
      }
      // 其余交给静态资源
      const res = await env.ASSETS.fetch(request);
      status = res.status;
      return res;
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorJson(500, '服务器内部错误');
    } finally {
      try {
        console.log(JSON.stringify({
          ts: Date.now(),
          method: request.method,
          path: new URL(request.url).pathname,
          status,
          ms: Date.now() - start,
        }));
      } catch { /* ignore */ }
    }
  },
};

async function requireFileUser(env, request) {
  const auth = await currentUser(env.DB, request);
  if (auth && !auth.banned) return auth.user;
  return { id: -1 };
}