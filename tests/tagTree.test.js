import { describe, it, expect } from 'vitest';
import {
  buildTagTree,
  sortedChildren,
  lastSegment,
  nodeMatches,
  hasMatchingDescendant,
  collectExpandedAncestors,
} from '../public/assets/tagTree.js';

describe('buildTagTree', () => {
  it('builds single-level tree', () => {
    const tree = buildTagTree([
      { tag: '工作', count: 3, last_used_at: 100 },
      { tag: '生活', count: 2, last_used_at: 200 },
    ]);
    expect(tree.children.size).toBe(2);
    const work = tree.children.get('工作');
    expect(work.tag).toBe('工作');
    expect(work.count).toBe(3);
    expect(work.last_used_at).toBe(100);
    expect(work.children.size).toBe(0);
  });

  it('accumulates parent count from descendants', () => {
    const tree = buildTagTree([
      { tag: '工作', count: 1, last_used_at: 100 },
      { tag: '工作/项目A', count: 5, last_used_at: 300 },
      { tag: '工作/项目B', count: 4, last_used_at: 200 },
    ]);
    const work = tree.children.get('工作');
    expect(work.tag).toBe('工作');
    // 父级 count 是自身 + 所有后代之和
    expect(work.count).toBe(1 + 5 + 4);
    expect(work.children.size).toBe(2);
    const a = work.children.get('项目A');
    expect(a.tag).toBe('工作/项目A');
    expect(a.count).toBe(5);
  });

  it('preserves deep nesting (3+ levels)', () => {
    const tree = buildTagTree([
      { tag: 'A/B/C/D', count: 7, last_used_at: 100 },
    ]);
    let node = tree;
    expect(node.children.get('A').tag).toBe('A');
    node = node.children.get('A');
    expect(node.children.get('B').tag).toBe('A/B');
    node = node.children.get('B');
    expect(node.children.get('C').tag).toBe('A/B/C');
    node = node.children.get('C');
    expect(node.children.get('D').tag).toBe('A/B/C/D');
    expect(node.children.get('D').count).toBe(7);
  });

  it('handles duplicate segments in same path', () => {
    const tree = buildTagTree([
      { tag: '生活/生活/购物', count: 2, last_used_at: 100 },
    ]);
    const a = tree.children.get('生活');
    const b = a.children.get('生活');
    const c = b.children.get('购物');
    expect(c.tag).toBe('生活/生活/购物');
    expect(c.count).toBe(2);
  });

  it('ignores empty segments from leading/trailing/double slashes', () => {
    const tree = buildTagTree([
      { tag: '/工作/项目A/', count: 1, last_used_at: 100 },
      { tag: '', count: 5, last_used_at: 100 },
    ]);
    expect(tree.children.size).toBe(1);
    expect(tree.children.get('工作').children.get('项目A').count).toBe(1);
  });

  it('keeps newest last_used_at on intermediate nodes', () => {
    const tree = buildTagTree([
      { tag: '工作/项目A', count: 1, last_used_at: 50 },
      { tag: '工作/项目B', count: 1, last_used_at: 500 },
    ]);
    const work = tree.children.get('工作');
    expect(work.last_used_at).toBe(500);
  });

  it('treats malformed entries safely', () => {
    const tree = buildTagTree([
      null,
      undefined,
      { tag: undefined, count: 5 },
      { tag: '有效', count: 1, last_used_at: 0 },
    ]);
    expect(tree.children.size).toBe(1);
    expect(tree.children.get('有效').count).toBe(1);
  });

  it('returns empty root for empty input', () => {
    const tree = buildTagTree([]);
    expect(tree.tag).toBe('');
    expect(tree.count).toBe(0);
    expect(tree.children.size).toBe(0);
  });
});

describe('sortedChildren', () => {
  const tags = [
    { tag: '工作', count: 10, last_used_at: 100 },
    { tag: '工作/A', count: 5, last_used_at: 300 },
    { tag: '工作/B', count: 5, last_used_at: 200 },
    { tag: '生活', count: 8, last_used_at: 400 },
  ];
  const tree = buildTagTree(tags);

  it('sorts by count descending by default', () => {
    const top = sortedChildren(tree, 'count');
    expect(top.map((n) => n.tag)).toEqual(['工作', '生活']);
  });

  it('sorts by recent timestamp', () => {
    const top = sortedChildren(tree, 'recent');
    expect(top[0].tag).toBe('生活'); // 400
    expect(top[1].tag).toBe('工作'); // 100
  });

  it('sorts by name (Chinese collation)', () => {
    const top = sortedChildren(tree, 'name');
    const names = top.map((n) => n.tag);
    // 工作 < 生活 in pinyin
    expect(names.indexOf('工作')).toBeLessThan(names.indexOf('生活'));
  });

  it('sorts siblings within a parent', () => {
    const work = tree.children.get('工作');
    const kids = sortedChildren(work, 'recent');
    expect(kids.map((n) => n.tag)).toEqual(['工作/A', '工作/B']);
  });
});

describe('lastSegment', () => {
  it('returns whole tag when no slash', () => {
    expect(lastSegment('工作')).toBe('工作');
  });
  it('returns last part', () => {
    expect(lastSegment('工作/项目A')).toBe('项目A');
  });
  it('handles empty', () => {
    expect(lastSegment('')).toBe('');
  });
});

describe('nodeMatches', () => {
  it('returns true with no filter', () => {
    expect(nodeMatches({ tag: '工作/A' }, '')).toBe(true);
  });
  it('matches by last segment', () => {
    expect(nodeMatches({ tag: '工作/项目A' }, '项目')).toBe(true);
  });
  it('matches by full path', () => {
    expect(nodeMatches({ tag: '工作/项目A' }, '工作/项目A')).toBe(true);
  });
  it('is case insensitive', () => {
    expect(nodeMatches({ tag: 'meeting-2026' }, 'MEET')).toBe(true);
  });
  it('returns false for non-matching filter', () => {
    expect(nodeMatches({ tag: '工作/A' }, '生活')).toBe(false);
  });
});

describe('hasMatchingDescendant', () => {
  it('returns false when no descendant matches', () => {
    const tree = buildTagTree([
      { tag: '工作/A', count: 1, last_used_at: 0 },
      { tag: '工作/B', count: 1, last_used_at: 0 },
    ]);
    expect(hasMatchingDescendant(tree, '生活')).toBe(false);
  });
  it('returns true when deep descendant matches', () => {
    const tree = buildTagTree([
      { tag: 'A/B/C/匹配点', count: 1, last_used_at: 0 },
    ]);
    expect(hasMatchingDescendant(tree, '匹配')).toBe(true);
  });
});

describe('collectExpandedAncestors', () => {
  it('expands all ancestors of matching leaf', () => {
    const tree = buildTagTree([
      { tag: 'A/B/C/匹配点', count: 1, last_used_at: 0 },
    ]);
    const expanded = new Set();
    collectExpandedAncestors(tree, '匹配', expanded);
    expect(expanded.has('A')).toBe(true);
    expect(expanded.has('A/B')).toBe(true);
    expect(expanded.has('A/B/C')).toBe(true);
    // 命中节点自身不应被加入（它本来就不是父级）
    expect(expanded.has('A/B/C/匹配点')).toBe(false);
  });
  it('expands ancestors when an intermediate node matches', () => {
    const tree = buildTagTree([
      { tag: 'A/匹配段/B', count: 1, last_used_at: 0 },
    ]);
    const expanded = new Set();
    collectExpandedAncestors(tree, '匹配', expanded);
    // A 是被命中的中间节点的祖先
    expect(expanded.has('A')).toBe(true);
    // A/匹配段 自身命中，但同时也作为 B 的祖先被加入（用于展开整棵子树）
    expect(expanded.has('A/匹配段')).toBe(true);
  });
  it('does nothing when nothing matches', () => {
    const tree = buildTagTree([
      { tag: 'A/B', count: 1, last_used_at: 0 },
    ]);
    const expanded = new Set();
    collectExpandedAncestors(tree, 'xxx', expanded);
    expect(expanded.size).toBe(0);
  });
});