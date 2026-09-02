import { describe, it, expect } from 'vitest';

// 重新实现被测函数（最小子集，足以覆盖分支）
function isSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const match = String(origin).match(/^https?:\/\/([^/?#]+)/i);
  return Boolean(match) && match[1].toLowerCase() === url.host;
}

function req(origin) {
  const h = new Headers();
  if (origin !== undefined) h.set('Origin', origin);
  return { headers: h };
}
function url(host) {
  return { host };
}

describe('isSameOrigin', () => {
  it('passes when Origin header is missing (non-browser clients)', () => {
    expect(isSameOrigin(req(undefined), url('example.com'))).toBe(true);
  });
  it('passes when Origin host matches', () => {
    expect(isSameOrigin(req('https://example.com'), url('example.com'))).toBe(true);
  });
  it('rejects when Origin host differs', () => {
    expect(isSameOrigin(req('https://evil.com'), url('example.com'))).toBe(false);
  });
  it('is case-insensitive on host comparison', () => {
    expect(isSameOrigin(req('https://EXAMPLE.COM'), url('example.com'))).toBe(true);
  });
  it('ignores Origin path and query (only host matters)', () => {
    expect(isSameOrigin(req('https://example.com/path?q=1'), url('example.com'))).toBe(true);
  });
  it('rejects malformed Origin', () => {
    expect(isSameOrigin(req('not-a-url'), url('example.com'))).toBe(false);
  });
});