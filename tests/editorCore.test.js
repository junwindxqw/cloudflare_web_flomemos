import { describe, it, expect } from 'vitest';
import { parseHeadings, transformBlockLines } from '../public/assets/editorCore.js';

describe('parseHeadings', () => {
  it('解析 H1-H3 并记录行号（0 起始）', () => {
    const text = '前言\n# 标题一\n正文\n## 标题二\n### 标题三\n尾';
    expect(parseHeadings(text)).toEqual([
      { level: 1, text: '标题一', line: 1 },
      { level: 2, text: '标题二', line: 3 },
      { level: 3, text: '标题三', line: 4 },
    ]);
  });

  it('跳过围栏代码块内的 # 行', () => {
    const text = '# 真标题\n```\n# 假标题\n```\n~~~\n## 假标题2\n~~~\n## 真标题2';
    const items = parseHeadings(text);
    expect(items.map((h) => h.text)).toEqual(['真标题', '真标题2']);
  });

  it('#标签（无空格）不是标题，不误收', () => {
    expect(parseHeadings('#标签 正文')).toEqual([]);
  });

  it('行尾的闭合标签序列被去掉（ATX 关闭样式）', () => {
    expect(parseHeadings('# 标题 ##')[0].text).toBe('标题');
  });

  it('空文本返回空数组', () => {
    expect(parseHeadings('')).toEqual([]);
    expect(parseHeadings(null)).toEqual([]);
  });
});

describe('transformBlockLines', () => {
  it('无序列表：普通行加 "- "（回归：此前 UL 按钮无效）', () => {
    expect(transformBlockLines(['hello', 'world'], '- ')).toEqual(['- hello', '- world']);
  });

  it('无序列表：再次点击切换取消', () => {
    expect(transformBlockLines(['- hello', '- world'], '- ')).toEqual(['hello', 'world']);
  });

  it('标题层级替换：H1 点在 H2 行上替换为 H1', () => {
    expect(transformBlockLines(['## 旧标题'], '# ')).toEqual(['# 旧标题']);
  });

  it('标题切换：同层级再点一次取消', () => {
    expect(transformBlockLines(['# 标题'], '# ')).toEqual(['标题']);
  });

  it('引用切换', () => {
    expect(transformBlockLines(['abc'], '> ')).toEqual(['> abc']);
    expect(transformBlockLines(['> abc'], '> ')).toEqual(['abc']);
  });

  it('任务列表：转换无序列表为任务；已是任务行（含勾选态）再点则取消', () => {
    expect(transformBlockLines(['- 待办'], '- [ ] ')).toEqual(['- [ ] 待办']);
    expect(transformBlockLines(['- [x] 已完成'], '- [ ] ')).toEqual(['已完成']);
  });

  it('保留原始缩进', () => {
    expect(transformBlockLines(['  子项'], '- ')).toEqual(['  - 子项']);
  });

  it('空行保持不变（多行块中）', () => {
    expect(transformBlockLines(['a', '', 'b'], '- ')).toEqual(['- a', '', '- b']);
  });

  it('任务列表中的 #标签 行不被误认为标题标记', () => {
    // "#标签" 后没有空格，不是标题标记，应用标题时整行作为标题文本
    expect(transformBlockLines(['#标签 内容'], '# ')).toEqual(['# #标签 内容']);
  });
});
