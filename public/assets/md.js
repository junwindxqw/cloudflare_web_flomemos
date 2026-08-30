// Markdown 渲染：marked（GFM）+ DOMPurify 消毒 + #标签 链接化。
// 渲染结果只用于展示；笔记原文始终以纯文本存储与编辑。

const TAG_SPLIT_RE = /#([\p{L}\p{N}_\-/]+)/gu;

function sanitizeHtml(rawHtml) {
  return window.DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form'],
  });
}

// 把文本节点中的 #标签 替换为可点击的标签链接（跳过代码块、链接、已有标签内）
function linkifyTags(rootEl) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('pre, code, a, .fm-tag')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue.includes('#') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const textNode of targets) {
    const text = textNode.nodeValue;
    const matches = [...text.matchAll(TAG_SPLIT_RE)];
    if (!matches.length) continue;

    const frag = document.createDocumentFragment();
    let last = 0;
    for (const match of matches) {
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      const anchor = document.createElement('a');
      anchor.href = '#';
      anchor.className = 'fm-tag';
      anchor.dataset.tag = match[1];
      anchor.append('#', match[1]);
      frag.appendChild(anchor);
      last = match.index + match[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

export function renderMemoHtml(markdownText) {
  const raw = window.marked.parse(markdownText ?? '', { gfm: true, breaks: true });
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(raw);

  // 外链新标签打开
  for (const a of container.querySelectorAll('a[href^="http"]')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  linkifyTags(container);
  return container.innerHTML;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
