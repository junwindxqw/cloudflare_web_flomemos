// 增强型 Markdown 编辑器
// 工具栏 / 实时预览 / 快捷键 / 列表自动续写 / 粘贴与拖拽上传图片 / #标签 自动补全

import { renderMemoHtml } from './md.js';

const SVG = {
  quote: '<svg viewBox="0 0 16 16"><path d="M3 5.5h3v3H4.5A1.5 1.5 0 0 0 3 10v.5A1.5 1.5 0 0 1 1.5 9V7z" fill="currentColor" stroke="none" opacity=".9"/><path d="M3.2 5.2h2.6v3.3H3.9A1.4 1.4 0 0 0 2.5 9.9v1.4H1.2V7.3c0-1.2.9-2.1 2-2.1z" fill="currentColor" stroke="none"/></svg>',
  ul: '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="3" cy="4.3" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="3" cy="11.7" r="1"/><path d="M6 3.5h8v1.6H6zM6 7.2h8v1.6H6zM6 10.9h8v1.6H6z"/></svg>',
  ol: '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><text x="1" y="5.6" font-size="5.2" font-weight="600">1.</text><text x="1" y="13" font-size="5.2" font-weight="600">2.</text><path d="M6.5 3.5h7.5v1.6H6.5zM6.5 11h7.5v1.6H6.5z"/></svg>',
  task: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="5.5" height="5.5" rx="1.2"/><path d="M3.5 5.2l1.2 1.2 2-2.3"/><path d="M10.5 4h4M10.5 11.5h4M2.5 11.5h5.5"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"/></svg>',
  codeblock: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6.2 6L4.2 8l2 2M9.8 6l2 2-2 2"/></svg>',
  link: '<svg viewBox="0 0 16 16"><path d="M6.7 9.3a2.9 2.9 0 0 1 0-4.1l1.7-1.7a2.9 2.9 0 0 1 4.1 4.1l-1 1"/><path d="M9.3 6.7a2.9 2.9 0 0 1 0 4.1l-1.7 1.7a2.9 2.9 0 0 1-4.1-4.1l1-1"/></svg>',
  image: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="M13.5 10.6l-3-3-5.6 5"/></svg>',
  table: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M2 6.3h12M2 9.6h12M6.7 6.3V13M10.7 6.3V13"/></svg>',
  hr: '<svg viewBox="0 0 16 16"><path d="M2.5 8h11"/><path d="M4 11h8" opacity=".4"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/></svg>',
};

function icon(name) {
  const span = document.createElement('span');
  span.className = 'md-ic';
  span.innerHTML = SVG[name];
  return span;
}

function btn(cmd, title, content, shortcut) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'md-tbtn';
  b.dataset.cmd = cmd;
  b.title = shortcut ? title + '（' + shortcut + '）' : title;
  if (typeof content === 'string') {
    b.innerHTML = content.startsWith('<') ? content : '<span class="md-tx">' + content + '</span>';
  } else {
    b.appendChild(content);
  }
  return b;
}

export class MarkdownEditor {
  /**
   * @param {HTMLElement} mount 挂载容器
   * @param {object} opts
   *   placeholder / initial / submitText / compact
   *   onSubmit(text) -> Promise<boolean>  返回 true 表示提交成功，可清空编辑器
   *   onCancel()                          可选，编辑态的取消回调
   *   getTags() -> string[]               标签自动补全候选
   *   uploadImage(file) -> Promise<url>   可选，图片上传
   */
  constructor(mount, opts = {}) {
    this.opts = opts;
    this.previewOn = false;
    this.suggest = { open: false, items: [], active: 0, from: 0 };

    const root = document.createElement('div');
    root.className = 'md-editor' + (opts.compact ? ' md-compact' : '');

    // ----- 工具栏 -----
    const bar = document.createElement('div');
    bar.className = 'md-toolbar';
    bar.appendChild(btn('bold', '加粗', '<span class="md-tx md-b">B</span>', 'Ctrl+B'));
    bar.appendChild(btn('italic', '斜体', '<span class="md-tx md-i">I</span>', 'Ctrl+I'));
    bar.appendChild(btn('strike', '删除线', '<span class="md-tx md-s">S</span>'));
    bar.appendChild(this.sep());
    bar.appendChild(btn('h1', '一级标题', 'H1'));
    bar.appendChild(btn('h2', '二级标题', 'H2'));
    bar.appendChild(btn('h3', '三级标题', 'H3'));
    bar.appendChild(this.sep());
    bar.appendChild(btn('quote', '引用', icon('quote')));
    bar.appendChild(btn('ul', '无序列表', icon('ul')));
    bar.appendChild(btn('ol', '有序列表', icon('ol')));
    bar.appendChild(btn('task', '任务列表', icon('task')));
    bar.appendChild(this.sep());
    bar.appendChild(btn('code', '行内代码', icon('code')));
    bar.appendChild(btn('codeblock', '代码块', icon('codeblock')));
    bar.appendChild(btn('link', '链接', icon('link'), 'Ctrl+K'));
    bar.appendChild(btn('image', '图片', icon('image')));
    bar.appendChild(btn('table', '表格', icon('table')));
    bar.appendChild(btn('hr', '分割线', icon('hr')));

    const right = document.createElement('div');
    right.className = 'md-toolbar-right';
    this.previewBtn = btn('preview', '预览', icon('eye'));
    this.previewBtn.classList.add('md-preview-toggle');
    right.appendChild(this.previewBtn);
    bar.appendChild(right);
    root.appendChild(bar);

    // ----- 编辑 / 预览区 -----
    const wrap = document.createElement('div');
    wrap.className = 'md-wrap';

    this.input = document.createElement('textarea');
    this.input.className = 'md-input';
    this.input.placeholder = opts.placeholder ?? '记录想法… #标签';
    this.input.rows = opts.compact ? 3 : 5;
    wrap.appendChild(this.input);

    this.preview = document.createElement('div');
    this.preview.className = 'md-preview md-body hidden';
    wrap.appendChild(this.preview);
    root.appendChild(wrap);

    // ----- 底栏 -----
    const footer = document.createElement('div');
    footer.className = 'md-footer';
    this.hint = document.createElement('span');
    this.hint.className = 'md-hint';
    this.hint.textContent = opts.compact ? '' : 'Markdown · 粘贴图片可直接上传 · Ctrl+Enter 发送';
    footer.appendChild(this.hint);

    this.counter = document.createElement('span');
    this.counter.className = 'md-count';
    this.counter.textContent = '0 字';
    footer.appendChild(this.counter);

    if (opts.onCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost btn-sm';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => opts.onCancel());
      footer.appendChild(cancelBtn);
    }

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.className = 'btn btn-primary btn-sm';
    this.submitBtn.textContent = opts.submitText ?? '记录';
    this.submitBtn.addEventListener('click', () => this.submit());
    footer.appendChild(this.submitBtn);
    root.appendChild(footer);

    // 标签补全下拉
    this.suggestBox = document.createElement('div');
    this.suggestBox.className = 'md-suggest hidden';
    root.appendChild(this.suggestBox);

    // 隐藏的图片选择器
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files && this.fileInput.files[0];
      if (file) this.handleImage(file);
      this.fileInput.value = '';
    });
    root.appendChild(this.fileInput);

    mount.appendChild(root);
    this.root = root;

    if (opts.initial) this.input.value = opts.initial;
    this.updateCount();

    this.bindEvents();
  }

  sep() {
    const s = document.createElement('span');
    s.className = 'md-sep';
    return s;
  }

  bindEvents() {
    const input = this.input;

    this.root.querySelector('.md-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      this.runCmd(b.dataset.cmd);
    });

    input.addEventListener('keydown', (e) => this.onKeydown(e));
    input.addEventListener('input', () => {
      this.updateCount();
      this.updateSuggest();
      if (this.opts.onChange) this.opts.onChange(this.input.value);
      if (this.previewOn) this.renderPreviewSoon();
    });
    input.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this.handleImage(file);
          }
          return;
        }
      }
    });
    input.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const file = files[0];
      if (file.type && file.type.startsWith('image/')) {
        e.preventDefault();
        this.handleImage(file);
      }
    });
    input.addEventListener('blur', () => {
      // 延迟关闭，给点击补全项留时间
      setTimeout(() => this.closeSuggest(), 180);
    });

    this.suggestBox.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('[data-tag]');
      if (!item) return;
      e.preventDefault();
      this.acceptSuggest(item.dataset.tag);
    });

    // 预览按钮由工具栏的事件委托统一处理（data-cmd="preview"），不再单独绑定
  }

  // ---------- 提交 ----------
  async submit() {
    const text = this.input.value.trim();
    if (!text) {
      this.input.focus();
      return;
    }
    if (!this.opts.onSubmit) return;
    this.setBusy(true);
    try {
      const ok = await this.opts.onSubmit(text);
      if (ok) {
        this.input.value = '';
        this.updateCount();
        if (this.previewOn) this.renderPreview();
      }
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    this.submitBtn.disabled = busy;
    this.submitBtn.textContent = busy ? '处理中…' : (this.opts.submitText ?? '记录');
  }

  updateCount() {
    const len = [...this.input.value].length;
    this.counter.textContent = len + ' 字';
    this.counter.classList.toggle('warn', len >= 18000 && len < 19500);
    this.counter.classList.toggle('danger', len >= 19500);
  }

  // ---------- 预览 ----------
  togglePreview() {
    this.previewOn = !this.previewOn;
    this.previewBtn.classList.toggle('active', this.previewOn);
    if (this.previewOn) {
      this.input.classList.add('hidden');
      this.preview.classList.remove('hidden');
      this.renderPreview();
    } else {
      this.preview.classList.add('hidden');
      this.input.classList.remove('hidden');
      this.input.focus();
    }
  }

  renderPreviewSoon() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), 250);
  }

  renderPreview() {
    this.preview.innerHTML = this.input.value.trim() ? renderMemoHtml(this.input.value) : '<p class="md-empty-tip">暂无内容</p>';
  }

  // ---------- 工具栏命令 ----------
  runCmd(cmd) {
    const input = this.input;
    input.focus();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const sel = value.slice(start, end);

    switch (cmd) {
      case 'bold': this.wrapSelection('**', '**', '加粗文字'); break;
      case 'italic': this.wrapSelection('*', '*', '斜体文字'); break;
      case 'strike': this.wrapSelection('~~', '~~', '删除文字'); break;
      case 'code': this.wrapSelection('`', '`', '代码'); break;
      case 'h1': this.prefixLines('# '); break;
      case 'h2': this.prefixLines('## '); break;
      case 'h3': this.prefixLines('### '); break;
      case 'quote': this.prefixLines('> '); break;
      case 'ul': this.prefixLines('- '); break;
      case 'task': this.prefixLines('- [ ] '); break;
      case 'ol': this.prefixOrdered(); break;
      case 'codeblock': this.insertBlock('```\n' + (sel || '代码') + '\n```'); break;
      case 'link': this.insertLink(); break;
      case 'image': this.opts.uploadImage ? this.fileInput.click() : this.insertAtCursor('![](图片地址)'); break;
      case 'table': this.insertBlock('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |'); break;
      case 'hr': this.insertBlock('---'); break;
      case 'preview': this.togglePreview(); break;
    }
  }

  wrapSelection(before, after, placeholder) {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const sel = value.slice(start, end) || placeholder;
    const insert = before + sel + after;
    input.setRangeText(insert, start, end, 'end');
    if (!value.slice(start, end)) {
      input.selectionStart = start + before.length;
      input.selectionEnd = start + before.length + sel.length;
    }
    input.focus();
    this.afterEdit();
  }

  prefixLines(prefix) {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allPrefixed = lines.every((l) => l.startsWith(prefix) || l.trim() === '');
    const mapped = lines.map((l, i) => {
      if (l.trim() === '' && lines.length > 1) return l;
      if (allPrefixed) return l.slice(prefix.length);
      const ordered = prefix === '- ';
      return (ordered ? '' : prefix) + l;
    });
    const newBlock = mapped.join('\n');
    input.setRangeText(newBlock, lineStart, lineEnd, 'end');
    input.selectionStart = lineStart;
    input.selectionEnd = lineStart + newBlock.length;
    input.focus();
    this.afterEdit();
  }

  prefixOrdered() {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    const lines = value.slice(lineStart, lineEnd).split('\n');
    let out = '';
    let idx = 1;
    for (const l of lines) {
      const m = l.match(/^(\s*)/);
      const indent = m ? m[1] : '';
      out += (idx > 1 ? '\n' : '') + indent + idx + '. ' + l.slice(indent.length);
      idx++;
    }
    input.setRangeText(out, lineStart, lineEnd, 'end');
    input.selectionStart = lineStart;
    input.selectionEnd = lineStart + out.length;
    input.focus();
    this.afterEdit();
  }

  insertBlock(text) {
    const input = this.input;
    const start = input.selectionStart;
    const value = input.value;
    const needsLeading = start > 0 && value[start - 1] !== '\n';
    const insert = (needsLeading ? '\n' : '') + text + '\n';
    input.setRangeText(insert, start, input.selectionEnd, 'end');
    input.focus();
    this.afterEdit();
  }

  insertLink() {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const sel = input.value.slice(start, end);
    const label = sel || '链接文字';
    input.setRangeText('[' + label + '](地址)', start, end, 'end');
    if (!sel) {
      input.selectionStart = start + 1;
      input.selectionEnd = start + 1 + label.length;
    } else {
      const addrStart = start + label.length + 3;
      input.selectionStart = addrStart;
      input.selectionEnd = addrStart + 2;
    }
    input.focus();
    this.afterEdit();
  }

  insertAtCursor(text) {
    const input = this.input;
    const start = input.selectionStart;
    input.setRangeText(text, start, input.selectionEnd, 'end');
    input.focus();
    this.afterEdit();
  }

  afterEdit() {
    this.updateCount();
    if (this.previewOn) this.renderPreviewSoon();
  }

  // ---------- 图片上传 ----------
  async handleImage(file) {
    if (!this.opts.uploadImage) {
      this.hint.textContent = '未启用图片上传';
      return;
    }
    this.hint.textContent = '正在处理图片…';
    let toUpload = file;
    try {
      toUpload = await compressImageIfNeeded(file);
    } catch (e) {
      // 压缩失败时直接上传原图
      toUpload = file;
    }
    this.hint.textContent = '正在上传图片…';
    try {
      const url = await this.opts.uploadImage(toUpload, (ratio) => {
        const pct = Math.round(ratio * 100);
        this.hint.textContent = '正在上传图片… ' + pct + '%';
      });
      this.hint.textContent = '';
      this.insertAtCursor('![' + (file.name || '图片') + '](' + url + ')');
    } catch (err) {
      this.hint.textContent = '';
      this.dispatchEvent('fm:toast', (err && err.message) || '图片上传失败');
    }
  }

  dispatchEvent(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---------- 键盘 ----------
  onKeydown(e) {
    // 标签补全优先
    if (this.suggest.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSuggest(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSuggest(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.acceptSuggest(this.suggest.items[this.suggest.active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.closeSuggest(); return; }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); this.runCmd('bold'); return; }
    if (mod && !e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); this.runCmd('italic'); return; }
    if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); this.runCmd('link'); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); this.submit(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      this.insertAtCursor('  ');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.continueList()) e.preventDefault();
    }
  }

  // 列表 / 引用自动续写；返回是否接管了本次回车
  continueList() {
    const input = this.input;
    const start = input.selectionStart;
    if (start !== input.selectionEnd) return false;
    const value = input.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const line = value.slice(lineStart, start);
    const m = line.match(/^(\s*)(- \[[ xX]\] |- |\d+[.] |> )?(.*)$/);
    if (!m) return false;

    const indent = m[1];
    const marker = m[2] || '';
    const content = m[3];

    // 空列表项上回车 => 结束列表
    if (marker && content.trim() === '') {
      input.setRangeText('\n', lineStart, start, 'end');
      input.focus();
      this.afterEdit();
      return true;
    }

    let nextMarker = '';
    if (marker) {
      if (marker === '> ') nextMarker = '> ';
      else if (marker === '- [ ] ' || marker === '- [X] ' || marker === '- [x] ') nextMarker = '- [ ] ';
      else if (/^\d+[.]$/.test(marker.trim())) {
        const num = parseInt(marker.trim(), 10);
        nextMarker = (num + 1) + '. ';
      } else nextMarker = marker;
    } else return false;

    const insert = '\n' + indent + nextMarker;
    input.setRangeText(insert, start, start, 'end');
    input.focus();
    this.afterEdit();
    return true;
  }

  // ---------- 标签补全 ----------
  currentTagWord() {
    const input = this.input;
    const caret = input.selectionStart;
    if (caret !== input.selectionEnd) return null;
    const before = input.value.slice(0, caret);
    const m = before.match(/(?:^|\s)#([\p{L}\p{N}_\-/]*)$/u);
    if (!m) return null;
    const wordStart = caret - m[1].length;
    return { word: m[1], from: wordStart, to: caret, allBefore: before.slice(0, wordStart - 1) };
  }

  updateSuggest() {
    const info = this.currentTagWord();
    if (!info || info.word.length === 0 || !this.opts.getTags) {
      this.closeSuggest();
      return;
    }
    const lower = info.word.toLowerCase();
    const all = this.opts.getTags();
    const starts = [];
    const includes = [];
    for (const t of all) {
      const tl = t.toLowerCase();
      if (tl === lower) continue;
      if (tl.startsWith(lower)) starts.push(t);
      else if (tl.includes(lower)) includes.push(t);
    }
    const items = starts.concat(includes).slice(0, 8);
    if (!items.length) {
      this.closeSuggest();
      return;
    }
    this.suggest = { open: true, items, active: 0, from: info.from, to: info.to };
    this.renderSuggest();
  }

  renderSuggest() {
    const box = this.suggestBox;
    box.innerHTML = '';
    this.suggest.items.forEach((tag, i) => {
      const item = document.createElement('div');
      item.className = 'md-suggest-item' + (i === this.suggest.active ? ' active' : '');
      item.dataset.tag = tag;
      item.textContent = '#' + tag;
      box.appendChild(item);
    });
    box.classList.remove('hidden');
  }

  moveSuggest(delta) {
    const n = this.suggest.items.length;
    if (!n) return;
    this.suggest.active = (this.suggest.active + delta + n) % n;
    this.renderSuggest();
  }

  acceptSuggest(tag) {
    if (!tag) return;
    const input = this.input;
    const to = this.suggest.to;
    const text = tag + ' ';
    input.setRangeText(text, this.suggest.from, to, 'end');
    this.closeSuggest();
    input.focus();
    this.afterEdit();
  }

  closeSuggest() {
    this.suggest.open = false;
    this.suggestBox.classList.add('hidden');
  }
}

// 客户端图片压缩：长边 > 1600 或体积 > 1MB 时压缩到 1600px / JPEG 0.85
async function compressImageIfNeeded(file) {
  if (!file.type || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file; // 保留动图
  if (file.size <= 1024 * 1024) return file; // <1MB 不压

  const img = await loadImage(file);
  const maxSide = 1600;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w <= maxSide && h <= maxSide && file.size <= 2 * 1024 * 1024) return file;

  const ratio = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.round(w * ratio);
  const th = Math.round(h * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);

  // 输出 JPEG；若原图带 alpha，则改 PNG
  const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? 0.85 : undefined));
  if (!blob || blob.size >= file.size) return file;
  const newName = (file.name || 'image').replace(/\.(png|jpg|jpeg|webp|avif)$/i, outType === 'image/jpeg' ? '.jpg' : '.png');
  return new File([blob], newName, { type: outType, lastModified: Date.now() });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
