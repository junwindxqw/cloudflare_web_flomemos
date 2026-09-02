// FTS5 全文搜索（D1/SQLite trigram 分词器）
// 走 memos_fts 虚拟表，按 user_id 隔离 + 软删除过滤 + 高亮 snippet

export async function searchMemos(db, userId, query, opts = {}) {
  const limit = Math.min(Math.max(opts.limit || 30, 1), 50);
  const q = String(query || '').trim();
  if (!q) return { memos: [], total: 0 };

  // 转义 FTS5 特殊字符；trigram 分词器会把整段视为 n-gram，不需要引号
  const safe = q.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);

  // 总数
  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM memos_fts f
     JOIN memos m ON m.id = f.rowid
     WHERE memos_fts MATCH ? AND m.user_id = ? AND m.deleted_at IS NULL`
  ).bind(safe, userId).first();

  // 结果（高亮 + 时间倒序）
  const rows = await db.prepare(
    `SELECT m.id, m.content, m.pinned, m.pinned_order, m.word_count, m.created_at, m.updated_at,
            snippet(memos_fts, 0, '<<', '>>', '…', 16) AS snippet
     FROM memos_fts f
     JOIN memos m ON m.id = f.rowid
     WHERE memos_fts MATCH ? AND m.user_id = ? AND m.deleted_at IS NULL
     ORDER BY rank, m.id DESC
     LIMIT ?`
  ).bind(safe, userId, limit).all();

  // 标签（一次拉全部关联）
  const memos = rows.results || [];
  if (memos.length) {
    const ids = memos.map((m) => m.id);
    let placeholders = '';
    for (let i = 0; i < ids.length; i++) placeholders += (i ? ',?' : '?');
    const tagRows = await db.prepare(`SELECT memo_id, tag FROM tags WHERE memo_id IN (${placeholders})`).bind(...ids).all();
    const byId = new Map(memos.map((m) => [m.id, m]));
    for (const m of memos) m._tags = [];
    for (const r of tagRows.results || []) byId.get(r.memo_id)?._tags.push(r.tag);

    const shareRows = await db.prepare(`SELECT memo_id FROM share_links WHERE memo_id IN (${placeholders})`).bind(...ids).all();
    const sharedIds = new Set((shareRows.results || []).map((r) => r.memo_id));
    for (const m of memos) m._shared = sharedIds.has(m.id);
  }

  return {
    total: totalRow?.c || 0,
    memos: memos.map((m) => ({
      id: m.id,
      content: m.content,
      pinned: Boolean(m.pinned),
      pinned_order: m.pinned_order || 0,
      word_count: m.word_count || 0,
      created_at: m.created_at,
      updated_at: m.updated_at,
      tags: m._tags || [],
      shared: Boolean(m._shared),
      snippet: m.snippet || '',
    })),
  };
}