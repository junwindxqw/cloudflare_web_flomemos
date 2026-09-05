// 编辑器纯函数：与 DOM 无关，便于单元测试。

// ---------- TOC：解析 Markdown 标题 ----------
// 返回 [{ level, text, line }]；line 为 0 起始行号。跳过围栏代码块（``` / ~~~）内的 # 行。
export function parseHeadings(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let inFence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+\S.*$/);
    if (m) {
      const level = line.match(/^#+/)[0].length;
      out.push({ level, text: line.replace(/^#+\s+/, '').replace(/\s+#+\s*$/, '').trim(), line: i });
    }
  }
  return out;
}

// ---------- 工具栏行前缀变换 ----------
// 识别行首块级标记：标题 / 引用 / 任务 / 无序 / 有序；缩进单独剥离，保持嵌套结构。
const MARKER_RE = /^(#{1,6}\s+|>\s+|- \[[xX ]\]\s+|-\s+|\d+\.\s+)/;

function splitMarker(line) {
  const ws = line.match(/^\s*/)[0];
  const m = line.slice(ws.length).match(MARKER_RE);
  return {
    indent: ws,
    marker: m ? m[0] : '',
    rest: m ? line.slice(ws.length + m[0].length) : line.slice(ws.length),
  };
}

/**
 * 对一组行应用块级前缀（标题/引用/列表/任务），返回新行数组。
 * 规则：
 *  - 空行保持不变；
 *  - 所有非空行已带「等价标记」时视为切换：移除标记（再点一次取消）；
 *  - 否则移除旧标记后应用新标记（H2 点在 H1 行上会替换层级，任务点在无序列表上会转换）。
 * 等价标记：有序列表之间 `1. ` 与 `2. ` 等价；任务 `- [ ] ` 与 `- [x] ` 等价。
 * @param {string[]} lines
 * @param {string} prefix 目标标记，如 '# '、'> '、'- '、'- [ ] '
 */
export function transformBlockLines(lines, prefix) {
  const split = lines.map(splitMarker);
  const sameKind = (marker) => {
    if (marker === prefix) return true;
    if (/^\d+\.\s$/.test(marker) && /^\d+\.\s$/.test(prefix)) return true; // 有序列表编号不敏感
    if (/^- \[[xX ]\]\s$/.test(marker) && /^- \[[xX ]\]\s$/.test(prefix)) return true; // 任务勾选态不敏感
    return false;
  };
  const allHave = split.every((s, i) => lines[i].trim() === '' || sameKind(s.marker));
  return lines.map((line, i) => {
    if (line.trim() === '') return line;
    const { indent, marker, rest } = split[i];
    if (allHave) return indent + rest;
    return indent + prefix + rest;
  });
}

// 单行、无选中场景下的列表续写标记。返回 null 表示不续写。
// 返回值即为下一行行首应插入的文本（不含换行与缩进）。
export function nextListMarker(line) {
  const m = line.match(/^(\s*)(- \[[xX ]\] |- |\d+[.] |> )?(.*)$/);
  if (!m) return null;
  const indent = m[1];
  const marker = m[2] || '';
  const content = m[3];
  // 空列表项回车 => 由调用方结束列表
  if (!marker) return null;
  if (content.trim() === '') return { endList: true, indent };
  let next;
  if (marker === '> ') next = '> ';
  else if (/^- \[[xX ]\] $/.test(marker)) next = '- [ ] ';
  else if (/^\d+[.]$/.test(marker.trim())) next = (parseInt(marker.trim(), 10) + 1) + '. ';
  else next = marker;
  return { indent, marker: next };
}
