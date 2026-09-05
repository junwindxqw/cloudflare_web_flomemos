// 把扁平目录数组（id/parent_id 结构）构造为层级树。
// 输入：`[{ id: 3, parent_id: 1, name: '子目录', count: 2 }, ...]`
// 输出：根节点 `{ id: 0, name: '', count, children: Node[] }`
// 每个节点 `{ id, parentId, name, count, children }`，
//   - `count` 是直接放入该目录的笔记数（不含子目录）。
//   - 节点附带 `path`（从根到自身的名称路径，用 ' / ' 连接）与 `depth`。
// 孤儿节点（parent_id 指向不存在的目录）按顶级目录处理，避免丢失。

export function buildFolderTree(folders) {
  const byId = new Map();
  const root = { id: 0, parentId: null, name: '', count: 0, depth: -1, path: '', children: [] };

  for (const f of folders || []) {
    if (!f || typeof f.id !== 'number') continue;
    byId.set(f.id, {
      id: f.id,
      parentId: f.parent_id ?? null,
      name: String(f.name ?? ''),
      count: Number(f.count) || 0,
      depth: 0,
      path: '',
      children: [],
    });
  }

  // 挂树：parent 不在集合里的节点挂到根（孤儿兜底）
  for (const node of byId.values()) {
    const parent = (node.parentId && byId.get(node.parentId)) || root;
    parent.children.push(node);
  }

  const orderChildren = (node, depth, path) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.id - b.id);
    for (const child of node.children) {
      child.depth = depth;
      child.path = path ? path + ' / ' + child.name : child.name;
      orderChildren(child, depth + 1, child.path);
    }
  };
  orderChildren(root, 0, '');

  return root;
}

// 深度优先展开为平铺列表，用于 <select> 选项与「移动到…」菜单。
// 返回 [{ id, name, path, depth }]
export function flattenFolders(tree) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      out.push({ id: child.id, name: child.name, path: child.path, depth: child.depth });
      walk(child);
    }
  };
  walk(tree);
  return out;
}

// 收集目录 id 及其全部后代 id（含自身）；目录不存在时返回空数组。
export function collectDescendantIds(tree, folderId) {
  const ids = [];
  const walk = (node, collecting) => {
    for (const child of node.children) {
      const nowCollecting = collecting || child.id === folderId;
      if (nowCollecting) ids.push(child.id);
      walk(child, nowCollecting);
    }
  };
  walk(tree, false);
  return ids;
}

// 判断 targetId 是否为 folderId 自身或其后代（「移动到…」时要排除的项）。
export function isSelfOrDescendant(tree, folderId, targetId) {
  return collectDescendantIds(tree, folderId).includes(targetId);
}

// 按 id 找节点（含根查找）。
export function findFolderNode(tree, folderId) {
  if (folderId === 0 || folderId === null) return tree;
  const walk = (node) => {
    for (const child of node.children) {
      if (child.id === folderId) return child;
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree);
}
