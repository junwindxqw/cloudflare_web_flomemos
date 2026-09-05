import { describe, it, expect } from 'vitest';
import {
  buildFolderTree,
  flattenFolders,
  collectDescendantIds,
  isSelfOrDescendant,
  findFolderNode,
} from '../public/assets/folderTree.js';

describe('buildFolderTree', () => {
  it('按 parent_id 构建层级树并计算 path / depth', () => {
    const tree = buildFolderTree([
      { id: 1, parent_id: null, name: '工作', count: 2 },
      { id: 2, parent_id: 1, name: '项目A', count: 3 },
      { id: 3, parent_id: 2, name: '2026', count: 1 },
      { id: 4, parent_id: null, name: '生活', count: 5 },
    ]);
    expect(tree.children.length).toBe(2);
    // zh locale 按拼音排序：gong(工) < sheng(生)，「工作」在前
    expect(tree.children[0].name).toBe('工作');
    const found = tree.children[0];
    expect(found.path).toBe('工作');
    expect(found.depth).toBe(0);
    const proj = found.children.find((n) => n.name === '项目A');
    expect(proj.path).toBe('工作 / 项目A');
    expect(proj.depth).toBe(1);
    const year = proj.children[0];
    expect(year.path).toBe('工作 / 项目A / 2026');
    expect(year.depth).toBe(2);
  });

  it('同名按 id 升序，保证稳定排序', () => {
    const tree = buildFolderTree([
      { id: 9, parent_id: null, name: 'A', count: 0 },
      { id: 2, parent_id: null, name: 'A', count: 0 },
    ]);
    expect(tree.children.map((n) => n.id)).toEqual([2, 9]);
  });

  it('孤儿节点（parent 不存在）按顶级处理，不丢失', () => {
    const tree = buildFolderTree([
      { id: 1, parent_id: null, name: '根', count: 0 },
      { id: 5, parent_id: 99, name: '孤儿', count: 1 },
    ]);
    expect(tree.children.length).toBe(2);
    const orphan = tree.children.find((n) => n.name === '孤儿');
    expect(orphan.depth).toBe(0);
    expect(orphan.path).toBe('孤儿');
  });

  it('空输入返回空树', () => {
    expect(buildFolderTree([]).children).toEqual([]);
    expect(buildFolderTree(null).children).toEqual([]);
  });
});

describe('flattenFolders', () => {
  it('深度优先平铺，附带 depth 与 path', () => {
    const tree = buildFolderTree([
      { id: 1, parent_id: null, name: '工作', count: 0 },
      { id: 2, parent_id: 1, name: '项目A', count: 0 },
      { id: 3, parent_id: null, name: '生活', count: 0 },
    ]);
    const flat = flattenFolders(tree);
    const names = flat.map((f) => f.name);
    expect(names).toContain('工作');
    expect(names).toContain('项目A');
    expect(names).toContain('生活');
    const proj = flat.find((f) => f.name === '项目A');
    expect(proj.depth).toBe(1);
    expect(proj.path).toBe('工作 / 项目A');
  });
});

describe('collectDescendantIds / isSelfOrDescendant', () => {
  const tree = () => buildFolderTree([
    { id: 1, parent_id: null, name: 'A', count: 0 },
    { id: 2, parent_id: 1, name: 'B', count: 0 },
    { id: 3, parent_id: 2, name: 'C', count: 0 },
    { id: 4, parent_id: null, name: 'D', count: 0 },
  ]);

  it('收集自身 + 全部后代', () => {
    expect(collectDescendantIds(tree(), 1).sort()).toEqual([1, 2, 3]);
  });

  it('叶子目录只含自身', () => {
    expect(collectDescendantIds(tree(), 3)).toEqual([3]);
  });

  it('不把兄弟子树误收进来（回归）', () => {
    expect(collectDescendantIds(tree(), 4)).toEqual([4]);
  });

  it('不存在的目录返回空', () => {
    expect(collectDescendantIds(tree(), 999)).toEqual([]);
  });

  it('isSelfOrDescendant 用于环检测', () => {
    expect(isSelfOrDescendant(tree(), 1, 3)).toBe(true);
    expect(isSelfOrDescendant(tree(), 1, 1)).toBe(true);
    expect(isSelfOrDescendant(tree(), 1, 4)).toBe(false);
  });
});

describe('findFolderNode', () => {
  it('按 id 查找节点', () => {
    const tree = buildFolderTree([
      { id: 1, parent_id: null, name: 'A', count: 4 },
      { id: 2, parent_id: 1, name: 'B', count: 0 },
    ]);
    expect(findFolderNode(tree, 2).name).toBe('B');
    expect(findFolderNode(tree, 999)).toBeNull();
  });
});
