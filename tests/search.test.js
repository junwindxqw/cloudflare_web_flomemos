import { describe, it, expect } from 'vitest';
import { searchMemos } from '../src/search.js';

// stub db：按 SQL 特征路由返回值
function makeStubDb({ total = 0, ftsRows = [], likeRows = [], tagRows = [], shareRows = [], captured = [] } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          captured.push({ sql, args });
          return {
            async first() {
              if (/COUNT\(\*\)/i.test(sql)) return { c: total };
              return null;
            },
            async all() {
              if (/FROM memos_fts f/i.test(sql)) return { results: ftsRows };
              if (/FROM tags/i.test(sql)) return { results: tagRows };
              if (/FROM share_links/i.test(sql)) return { results: shareRows };
              return { results: likeRows };
            },
          };
        },
      };
    },
  };
}

describe('searchMemos', () => {
  it('returns empty result for empty query without hitting DB', async () => {
    const captured = [];
    const db = makeStubDb({ captured });
    const res = await searchMemos(db, 1, '', { limit: 10 });
    expect(res).toEqual({ memos: [], total: 0 });
    expect(captured).toHaveLength(0);
  });

  it('routes 2-char CJK queries to the LIKE fallback', async () => {
    const captured = [];
    const likeRows = [{
      id: 5, content: '今天读书', pinned: 0, pinned_order: 0, word_count: 4,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', snippet: '',
    }];
    const db = makeStubDb({
      total: 1, likeRows,
      tagRows: [{ memo_id: 5, tag: '读书' }],
      shareRows: [{ memo_id: 5 }],
      captured,
    });
    const res = await searchMemos(db, 7, '读书', { limit: 10 });
    expect(captured[0].sql).not.toContain('memos_fts');
    expect(captured[0].args).toContain('%读书%');
    expect(res.total).toBe(1);
    expect(res.memos[0].tags).toEqual(['读书']);
    expect(res.memos[0].shared).toBe(true);
  });

  it('routes >=3-char queries to the FTS5 MATCH path', async () => {
    const captured = [];
    const ftsRows = [{
      id: 9, content: 'hello world', pinned: 0, pinned_order: 0, word_count: 11,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
      snippet: '<<hello>> world',
    }];
    const db = makeStubDb({ total: 1, ftsRows, captured });
    const res = await searchMemos(db, 7, 'hello world', { limit: 10 });
    expect(captured[0].sql).toContain('memos_fts MATCH');
    expect(res.total).toBe(1);
    expect(res.memos[0].snippet).toContain('hello');
  });

  it('returns early when total is 0', async () => {
    const captured = [];
    const db = makeStubDb({ total: 0, captured });
    const res = await searchMemos(db, 1, 'hello world', { limit: 10 });
    expect(res).toEqual({ memos: [], total: 0 });
    expect(captured).toHaveLength(1); // 只发了 COUNT 查询
  });

  it('clamps limit between 1 and 50', async () => {
    const captured = [];
    const db = makeStubDb({ total: 3, captured });
    await searchMemos(db, 1, 'query', { limit: 9999 });
    // 执行顺序固定：先 COUNT，后结果查询
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const resultQuery = captured[1];
    expect(resultQuery.args[resultQuery.args.length - 1]).toBe(50);
  });

  it('strips control chars and escapes LIKE wildcards', async () => {
    const captured = [];
    const db = makeStubDb({ total: 1, captured });
    await searchMemos(db, 1, '读\u0000书', { limit: 10 });
    const bound = captured[0].args[0];
    expect(bound).not.toContain('\u0000');
  });

  it('escapes LIKE wildcards in fallback query', async () => {
    const captured = [];
    const db = makeStubDb({ total: 0, captured });
    await searchMemos(db, 1, '100%', { limit: 10 });
    // '100%' 是 4 字符 → FTS 分支；用 2 字符 'a%' 验证转义
    await searchMemos(db, 1, 'a%', { limit: 10 });
    const likeCall = captured.find((c) => c.args.includes('%a\\%%'));
    expect(likeCall).toBeTruthy();
  });
});