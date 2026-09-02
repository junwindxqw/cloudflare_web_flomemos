import { describe, it, expect } from 'vitest';
import { hashPassword, verifyStoredPassword, parseCookies } from '../src/auth.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('pbkdf2$20000$')).toBe(true);
    expect(await verifyStoredPassword('correct horse battery staple', stored)).toBe(true);
  });
  it('rejects wrong password', async () => {
    const stored = await hashPassword('foo');
    expect(await verifyStoredPassword('bar', stored)).toBe(false);
  });
  it('verifies legacy 30000-iteration hash for backward compatibility', async () => {
    // 模拟旧 hash：用 hashPassword 在 30000 次手动跑一次
    const stored30000 = await hashPasswordLegacy('legacy', 30000);
    expect(await verifyStoredPassword('legacy', stored30000)).toBe(true);
    expect(await verifyStoredPassword('wrong', stored30000)).toBe(false);
  });
  it('rejects malformed stored hash', async () => {
    expect(await verifyStoredPassword('x', 'not-a-valid-hash')).toBe(false);
    expect(await verifyStoredPassword('x', '')).toBe(false);
  });
});

describe('parseCookies', () => {
  function buildRequest(header) {
    return { headers: new Headers({ Cookie: header }) };
  }
  it('parses simple key=value', () => {
    expect(parseCookies(buildRequest('a=1; b=2'))).toEqual({ a: '1', b: '2' });
  });
  it('handles URL encoded values', () => {
    expect(parseCookies(buildRequest('a=hello%20world'))).toEqual({ a: 'hello world' });
  });
  it('handles missing or malformed entries gracefully', () => {
    expect(parseCookies(buildRequest(';a=1;; =2; b=3'))).toEqual({ a: '1', b: '3' });
  });
});

// 在测试里复现 PBKDF2 旧迭代 hash 的逻辑，仅用于验证 verifyStoredPassword 的兼容性
async function hashPasswordLegacy(password, iterations) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, km, 256);
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  return 'pbkdf2$' + iterations + '$' + b64(salt) + '$' + b64(new Uint8Array(bits));
}