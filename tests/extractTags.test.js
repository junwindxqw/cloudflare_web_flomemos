import { describe, it, expect } from 'vitest';
import { extractTags } from '../src/tags.js';

describe('extractTags', () => {
  it('extracts simple Chinese tags', () => {
    expect(extractTags('今天读了 #读书 的第3章')).toEqual(['读书']);
  });
  it('extracts nested tags', () => {
    expect(extractTags('项目A 子任务 #工作/项目A 进行中')).toEqual(['工作/项目A']);
  });
  it('ignores Markdown headings (# must be followed by space)', () => {
    expect(extractTags('# 标题\n内容 #tag')).toEqual(['tag']);
  });
  it('does not match URLs or anchors', () => {
    expect(extractTags('看 https://example.com#section 完了 #读书')).toEqual(['读书']);
  });
  it('dedupes multiple same tags', () => {
    expect(extractTags('#读书 第1本 #读书 第2本')).toEqual(['读书']);
  });
  it('handles mixed languages and digits', () => {
    expect(extractTags('会议 #meeting-2026 准备 #会议/Q4')).toEqual(['meeting-2026', '会议/Q4']);
  });
  it('drops tags longer than 64 chars', () => {
    const long = 'a'.repeat(65);
    expect(extractTags('#' + long + ' #ok')).toEqual(['ok']);
  });
  it('returns empty array when no tags', () => {
    expect(extractTags('一段没有任何标签的文字')).toEqual([]);
  });
});