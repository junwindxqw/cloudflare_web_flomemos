// 认证：PBKDF2 密码散列 + D1 会话令牌（Cookie 记录原始令牌，库里只存 SHA-256）。
// PBKDF2 迭代在新写入时使用 20000（旧 30000 哈希仍可被 verifyStoredPassword 校验）；
// Workers Free CPU 上限 10ms，20000 在登录路径留出余量。
const PBKDF2_ITERATIONS = 20000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_NAME = 'fm_session';

// 用于"用户不存在"时消耗等量计算，避免登录接口的时序侧信道
const DUMMY_PASSWORD_HASH = 'pbkdf2$30000$c3BlbmQtbWVtbXMtZHVtbHktc2FsdA==$4uYc9QpQWZCRL3YeG8jmFZPz5vPKJDWaUzYfRzOCHoQ=';

const encoder = new TextEncoder();

function toBase64(bytes) {
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str);
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Bits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, keyMaterial, 256);
}

// 生成格式：pbkdf2$iterations$saltB64$hashB64
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + toBase64(salt) + '$' + toBase64(new Uint8Array(bits));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStoredPassword(password, stored) {
  const parts = String(stored || '').split('$');
  const scheme = parts[0];
  const iterStr = parts[1];
  const saltB64 = parts[2];
  const hashB64 = parts[3];
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const bits = await pbkdf2Bits(password, fromBase64(saltB64), iterations);
  return constantTimeEqual(toBase64(new Uint8Array(bits)), hashB64);
}

// 用户不存在时也做一次等价校验，抹平响应时间差
export async function dummyVerify(password) {
  await verifyStoredPassword(password, DUMMY_PASSWORD_HASH);
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue; // 跳过空名或无 '=' 的段
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      cookies[name] = part.slice(idx + 1).trim();
    }
  }
  return cookies;
}

// 从请求中提取最小化的设备指纹：IP 前 16 位 + UA 首 80 字符
export function extractDeviceFingerprint(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '';
  const ipPrefix = ip.split('.').slice(0, 3).join('.');
  const ua = (request.headers.get('User-Agent') || '').slice(0, 80);
  return { ipPrefix, userAgent: ua };
}

export async function createSession(db, userId, request) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  const fp = extractDeviceFingerprint(request || { headers: new Headers() });
  await db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at, user_agent, ip_prefix) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(tokenHash, userId, expiresAt, now, now, fp.userAgent, fp.ipPrefix).run();
  // 顺手清理过期会话（约 5% 概率触发，避免堆积）
  if (Math.random() < 0.05) {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  }
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export function sessionCookie(token, maxAge, secure) {
  const flags = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
  return COOKIE_NAME + '=' + token + '; ' + flags + (secure ? '; Secure' : '');
}

export function clearSessionCookie(secure) {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

// 返回：null（无会话/会话失效）| { banned: true }（已封禁）| { user: {id, email, role}, sessionId }
export async function currentUser(db, request) {
  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT u.id, u.email, u.role, u.banned, s.token_hash, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  // 更新 last_used_at（节流：> 5 分钟才写一次，避免高频写）
  const now = Date.now();
  if (!row.last_used_at || now - (row.last_used_at || 0) > 5 * 60 * 1000) {
    await db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  }
  if (row.banned) return { banned: true };
  return { user: { id: row.id, email: row.email, role: row.role }, tokenHash };
}

export async function destroySession(db, request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

// 列出当前用户的所有活跃会话（设备列表）
export async function listSessions(db, userId, currentTokenHash) {
  const rows = await db
    .prepare('SELECT token_hash, created_at, last_used_at, user_agent, ip_prefix FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC')
    .bind(userId, Date.now())
    .all();
  return (rows.results || []).map((r) => ({
    id: r.token_hash,
    is_current: r.token_hash === currentTokenHash,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    user_agent: r.user_agent || '',
    ip_prefix: r.ip_prefix || '',
  }));
}

// 删除单个会话（仅能删自己的）
export async function revokeSession(db, userId, tokenHash) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?').bind(tokenHash, userId).run();
}

// 删除当前用户除传入 token 之外的全部会话
export async function revokeOtherSessions(db, userId, keepTokenHash) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(userId, keepTokenHash).run();
}