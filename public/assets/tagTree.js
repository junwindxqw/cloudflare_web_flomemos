// 把扁平标签数组构造为层级树。
// 输入：`[{ tag: '工作/项目A', count: 3, last_used_at: 1700000000 }, ...]`
// 输出：根节点 `{ tag: '', count, children: Map<name, Node> }`
// 每个非根节点 `{ tag, count, last_used_at, children }`，
//   - `tag` 是从根到自身的完整路径（用 / 连接）。
//   - `count` 是自身计数；中间节点的 `count` = 后代计数之和。
//   - `last_used_at` 是后代中最新的时间戳。
export function buildTagTree(tags) {
  const root = { tag: '', count: 0, last_used_at: 0, children: new Map() };
  for (const t of tags) {
    if (!t || typeof t.tag !== 'string') continue;
    const parts = t.tag.split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    let path = '';
    for (const p of parts) {
      path = path ? path + '/' + p : p;
      let child = node.children.get(p);
      if (!child) {
        child = { tag: path, count: 0, last_used_at: 0, children: new Map() };
        node.children.set(p, child);
      }
      if (path === t.tag) {
        child.count = Number(t.count) || 0;
        child.last_used_at = Number(t.last_used_at) || 0;
      } else {
        child.count += Number(t.count) || 0;
        const ts = Number(t.last_used_at) || 0;
        if (ts > child.last_used_at) child.last_used_at = ts;
      }
      node = child;
    }
  }
  for (const child of root.children.values()) {
    root.count += child.count;
    if (child.last_used_at > root.last_used_at) root.last_used_at = child.last_used_at;
  }
  return root;
}

export function compareTagNodes(a, b, sort) {
  if (sort === 'name') return a.tag.localeCompare(b.tag, 'zh-Hans-CN');
  if (sort === 'recent') {
    return (b.last_used_at - a.last_used_at) || a.tag.localeCompare(b.tag, 'zh-Hans-CN');
  }
  return (b.count - a.count) || a.tag.localeCompare(b.tag, 'zh-Hans-CN');
}

export function sortedChildren(node, sort) {
  return [...node.children.values()].sort((a, b) => compareTagNodes(a, b, sort));
}

export function lastSegment(tag) {
  if (!tag) return '';
  const i = tag.lastIndexOf('/');
  return i === -1 ? tag : tag.slice(i + 1);
}

// 判断节点本身是否命中过滤词（不递归）。
export function nodeMatches(node, filter) {
  if (!filter) return true;
  const last = lastSegment(node.tag).toLowerCase();
  const full = node.tag.toLowerCase();
  const f = filter.toLowerCase();
  return last.includes(f) || full.includes(f);
}

// 递归判断节点或其任意后代是否命中过滤词。
export function hasMatchingDescendant(node, filter) {
  const f = filter.toLowerCase();
  for (const child of node.children.values()) {
    if (nodeMatches(child, filter)) return true;
    if (hasMatchingDescendant(child, filter)) return true;
  }
  return false;
}

// 把命中节点的所有祖先加入 `expanded` Set，以便渲染时自动展开。
export function collectExpandedAncestors(node, filter, expanded) {
  const f = filter.toLowerCase();
  for (const child of node.children.values()) {
    if (lastSegment(child.tag).toLowerCase().includes(f) || child.tag.toLowerCase().includes(f)) {
      const pathParts = child.tag.split('/');
      let p = '';
      for (let i = 0; i < pathParts.length - 1; i++) {
        p = p ? p + '/' + pathParts[i] : pathParts[i];
        expanded.add(p);
      }
    }
    collectExpandedAncestors(child, filter, expanded);
  }
}