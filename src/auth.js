// 认证：PBKDF2 密码散列 + D1 会话令牌（Cookie 记录原始令牌，库里只存 SHA-256）。
// 免费版 Workers 有 10ms CPU 限额，PBKDF2 迭代次数在安全性与限额间取 30000。
const PBKDF2_ITERATIONS = 30000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_NAME = 'fm_session';

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
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStoredPassword(password, stored) {
  const [scheme, iterStr, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const bits = await pbkdf2Bits(password, fromBase64(saltB64), iterations);
  return constantTimeEqual(toBase64(new Uint8Array(bits)), hashB64);
}

// 环境变量明文密码的比较：先散列再做常数时间对比
export async function constantTimeEqualText(a, b) {
  return constantTimeEqual(await sha256Hex(String(a ?? '')), await sha256Hex(String(b ?? '')));
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      cookies[name] = part.slice(idx + 1).trim();
    }
  }
  return cookies;
}

export async function createSession(db) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  await db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(tokenHash, expiresAt).run();
  // 顺手清理过期会话（约 5% 概率触发，避免堆积）
  if (Math.random() < 0.05) {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  }
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export function sessionCookie(token, maxAge, secure) {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  return `${COOKIE_NAME}=${token}; ${flags}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function isAuthenticated(db, request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return false;
  }
  return true;
}

export async function destroySession(db, request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}
