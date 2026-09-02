import { describe, it, expect } from 'vitest';
import { searchMemos } from '../src/search.js';

function makeDb(memos, ftsRows) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (/SELECT COUNT/i.test(sql)) return { c: ftsRows.length };
              return null;
            },
            async all() {
              if (/FROM memos_fts f[\s\S]+snippet/i.test(sql)) return { results: ftsRows };
              return { results: memos };
            },
          };
        },
      };
    },
  };
}

describe('searchMemos', () => {
  it('returns empty result for empty query without hitting DB', async () => {
    const db = makeDb([], []);
    const res = await searchMemos(db, 1, '', { limit: 10 });
    expect(res).toEqual({ memos: [], total: 0 });
  });

  it('attaches tags and shared flag to results', async () => {
    const db = {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (/COUNT/i.test(sql)) return { c: 1 };
                return null;
              },
              async all() {
                if (/FROM memos_fts f/i.test(sql)) {
                  return { results: [{
                    id: 1, content: 'hello world', pinned: 0, pinned_order: 0,
                    word_count: 11,
                    created_at: '2026-09-01T00:00:00Z',
                    updated_at: '2026-09-01T00:00:00Z',
                    snippet: '<<hello>> world',
                  }] };
                }
                if (/FROM tags/i.test(sql)) {
                  return { results: [{ memo_id: 1, tag: 'demo' }] };
                }
                if (/FROM share_links/i.test(sql)) {
                  return { results: [{ memo_id: 1 }] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    };
    const res = await searchMemos(db, 7, 'hello', { limit: 10 });
    expect(res.total).toBe(1);
    expect(res.memos).toHaveLength(1);
    expect(res.memos[0].tags).toEqual(['demo']);
    expect(res.memos[0].shared).toBe(true);
    expect(res.memos[0].snippet).toContain('hello');
  });

  it('clamps limit between 1 and 50', async () => {
    const calls = [];
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            calls.push(args);
            return {
              async first() { return { c: 0 }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    };
    await searchMemos(db, 1, 'q', { limit: 9999 });
    // 第二次调用是结果查询（带 LIMIT），最后一个 bind 参数应是 50
    expect(calls[1][calls[1].length - 1]).toBe(50);
  });

  it('strips control chars from query', async () => {
    const captured = [];
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            captured.push({ sql, args });
            return {
              async first() { return { c: 0 }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    };
    await searchMemos(db, 1, 'q\u0000\u001f', { limit: 10 });
    const allSql = captured.map((c) => c.sql).join(' ');
    expect(allSql.includes('\u0000')).toBe(false);
  });
});