// FTS5 全文搜索（D1/SQLite trigram 分词器）
// trigram 需要 >= 3 个字符才能形成索引项；2 字以内的中文词（如「读书」）
// 走 LIKE 回退（小数据集下无性能问题）。

function escapeLike(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\\' || ch === '%' || ch === '_') out += '\\';
    out += ch;
  }
  return out;
}

export async function searchMemos(db, userId, query, opts = {}) {
  const limit = Math.min(Math.max(opts.limit || 30, 1), 50);
  const q = String(query || '').trim();
  if (!q) return { memos: [], total: 0 };

  const safe = q.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
  const qLen = [...safe].length;

  let rows;
  let total;
  if (qLen >= 3) {
    // FTS5 MATCH：相关性排序 + snippet
    const totalRow = await db.prepare(
      `SELECT COUNT(*) AS c FROM memos_fts f
       JOIN memos m ON m.id = f.rowid
       WHERE memos_fts MATCH ? AND m.user_id = ? AND m.deleted_at IS NULL`
    ).bind(safe, userId).first();
    total = totalRow?.c || 0;
    if (total === 0) return { memos: [], total: 0 };

    rows = await db.prepare(
      `SELECT m.id, m.content, m.pinned, m.pinned_order, m.word_count, m.folder_id, m.created_at, m.updated_at,
              snippet(memos_fts, 0, '<<', '>>', '…', 16) AS snippet
       FROM memos_fts f
       JOIN memos m ON m.id = f.rowid
       WHERE memos_fts MATCH ? AND m.user_id = ? AND m.deleted_at IS NULL
       ORDER BY rank, m.id DESC
       LIMIT ?`
    ).bind(safe, userId, limit).all();
    rows = rows.results || [];
  } else {
    // LIKE 回退：< 3 字符的查询
    const like = '%' + escapeLike(safe) + '%';
    const totalRow = await db.prepare(
      `SELECT COUNT(*) AS c FROM memos m
       WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.content LIKE ? ESCAPE '\\'`
    ).bind(userId, like).first();
    total = totalRow?.c || 0;
    if (total === 0) return { memos: [], total: 0 };

    rows = await db.prepare(
      `SELECT m.id, m.content, m.pinned, m.pinned_order, m.word_count, m.folder_id, m.created_at, m.updated_at,
              '' AS snippet
       FROM memos m
       WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.content LIKE ? ESCAPE '\\'
       ORDER BY m.id DESC
       LIMIT ?`
    ).bind(userId, like, limit).all();
    rows = rows.results || [];
  }

  // 附加标签与分享状态（一次拉取）
  if (rows.length) {
    const ids = rows.map((m) => m.id);
    let placeholders = '';
    for (let i = 0; i < ids.length; i++) placeholders += (i ? ',?' : '?');
    const tagRows = await db.prepare(`SELECT memo_id, tag FROM tags WHERE memo_id IN (${placeholders})`).bind(...ids).all();
    const byId = new Map(rows.map((m) => [m.id, m]));
    for (const m of rows) m._tags = [];
    for (const r of tagRows.results || []) byId.get(r.memo_id)?._tags.push(r.tag);

    const shareRows = await db.prepare(`SELECT memo_id FROM share_links WHERE memo_id IN (${placeholders})`).bind(...ids).all();
    const sharedIds = new Set((shareRows.results || []).map((r) => r.memo_id));
    for (const m of rows) m._shared = sharedIds.has(m.id);
  }

  return {
    memos: rows.map((m) => ({
      id: m.id,
      content: m.content,
      pinned: Boolean(m.pinned),
      pinned_order: m.pinned_order || 0,
      word_count: m.word_count || 0,
      folder_id: m.folder_id ?? null,
      created_at: m.created_at,
      updated_at: m.updated_at,
      tags: m._tags || [],
      shared: Boolean(m._shared),
      snippet: m.snippet || '',
    })),
    total,
  };
}