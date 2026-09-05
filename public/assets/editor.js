// 增强型 Markdown 编辑器
// 工具栏 / 实时预览 / 快捷键 / 列表自动续写 / 粘贴与拖拽上传图片 / #标签 自动补全
// 全屏编辑（Zen）：占满整个视口，右侧目录（TOC）在编辑与阅读模式下都可跳转

import { renderMemoHtml } from './md.js';
import { parseHeadings, transformBlockLines } from './editorCore.js';

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
  expand: '<svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>',
  compress: '<svg viewBox="0 0 16 16"><path d="M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4"/></svg>',
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
   *   onSubmit(text, folderId) -> Promise<boolean>  返回 true 表示提交成功，可清空编辑器
   *   onCancel()                                    可选，编辑态的取消回调
   *   getTags() -> string[]                         标签自动补全候选
   *   uploadImage(file) -> Promise<url>             可选，图片上传
   *   folders() -> [{id,name,depth}]                可选，目录选择器候选（path 已含缩进信息）
   *   getFolderId() -> number|null                  可选，新建笔记默认归档目录
   */
  constructor(mount, opts = {}) {
    this.opts = opts;
    this.previewOn = false;
    this.zen = false;
    this.suggest = { open: false, items: [], active: 0, from: 0 };
    this.tocItems = [];

    const root = document.createElement('div');
    root.className = 'md-editor' + (opts.compact ? ' md-compact' : '');

    // ----- 工具栏 -----
    const bar = document.createElement('div');
    bar.className = 'md-toolbar';
    bar.appendChild(btn('bold', '加粗', '<span class="md-tx md-b">B</span>', 'Ctrl+B'));
    bar.appendChild(btn('italic', '斜体', '<span class="md-tx md-i">I</span>', 'Ctrl+I'));
    bar.appendChild(btn('strike', '删除线', '<span class="md-tx md-s">S</span>', 'Ctrl+Shift+X'));
    bar.appendChild(this.sep());
    bar.appendChild(btn('h1', '一级标题', 'H1', 'Ctrl+Alt+1'));
    bar.appendChild(btn('h2', '二级标题', 'H2', 'Ctrl+Alt+2'));
    bar.appendChild(btn('h3', '三级标题', 'H3', 'Ctrl+Alt+3'));
    bar.appendChild(this.sep());
    bar.appendChild(btn('quote', '引用', icon('quote')));
    bar.appendChild(btn('ul', '无序列表', icon('ul'), 'Ctrl+Shift+8'));
    bar.appendChild(btn('ol', '有序列表', icon('ol'), 'Ctrl+Shift+7'));
    bar.appendChild(btn('task', '任务列表', icon('task'), 'Ctrl+Shift+9'));
    bar.appendChild(this.sep());
    bar.appendChild(btn('code', '行内代码', icon('code'), 'Ctrl+E'));
    bar.appendChild(btn('codeblock', '代码块', icon('codeblock')));
    bar.appendChild(btn('link', '链接', icon('link'), 'Ctrl+K'));
    bar.appendChild(btn('image', '图片', icon('image')));
    bar.appendChild(btn('table', '表格', icon('table')));
    bar.appendChild(btn('hr', '分割线', icon('hr')));

    const right = document.createElement('div');
    right.className = 'md-toolbar-right';
    this.previewBtn = btn('preview', '预览 / 阅读', icon('eye'));
    this.previewBtn.classList.add('md-preview-toggle');
    right.appendChild(this.previewBtn);
    this.zenBtn = btn('zen', '全屏编辑', icon('expand'));
    this.zenBtn.classList.add('md-zen-toggle');
    right.appendChild(this.zenBtn);
    bar.appendChild(right);
    root.appendChild(bar);

    // ----- 主体：编辑 / 预览区 + 全屏时的右侧目录 -----
    const main = document.createElement('div');
    main.className = 'md-main';

    const wrap = document.createElement('div');
    wrap.className = 'md-wrap';
    this.wrapEl = wrap;

    this.input = document.createElement('textarea');
    this.input.className = 'md-input';
    this.input.placeholder = opts.placeholder ?? '记录想法… #标签';
    this.input.rows = opts.compact ? 3 : 5;
    this.input.style.maxHeight = opts.compact ? '300px' : '460px';
    wrap.appendChild(this.input);

    this.preview = document.createElement('div');
    this.preview.className = 'md-preview md-body hidden';
    wrap.appendChild(this.preview);
    main.appendChild(wrap);

    // ----- TOC 侧栏（仅全屏模式显示） -----
    this.tocEl = document.createElement('aside');
    this.tocEl.className = 'md-toc';
    const tocTitle = document.createElement('div');
    tocTitle.className = 'md-toc-title';
    tocTitle.textContent = '目录';
    this.tocList = document.createElement('div');
    this.tocList.className = 'md-toc-list';
    this.tocEl.append(tocTitle, this.tocList);
    main.appendChild(this.tocEl);
    root.appendChild(main);

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

    if (opts.folders) {
      this.folderSel = document.createElement('select');
      this.folderSel.className = 'md-folder';
      this.folderSel.title = '归档到目录（可选）';
      this.refreshFolderOptions();
      footer.appendChild(this.folderSel);
    }

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
    this.autoResize();

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
      this.autoResize();
      this.updateSuggest();
      if (this.opts.onChange) this.opts.onChange(this.input.value);
      if (this.previewOn) this.renderPreviewSoon();
      if (this.zen) this.renderTocSoon();
    });
    // 光标移动时同步 TOC 高亮（编辑模式）
    input.addEventListener('keyup', () => this.updateTocActive());
    input.addEventListener('click', () => this.updateTocActive());
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

    // 预览模式下点击任务复选框 => 反写 Markdown 源码
    this.preview.addEventListener('click', (e) => {
      const box = e.target.closest('input[type="checkbox"]');
      if (!box) return;
      this.toggleTaskCheckbox(box);
    });

    // 阅读模式滚动时同步 TOC 高亮（滚动发生在 wrap 上：普通模式是 preview 自身、全屏是 wrap）
    this.wrapEl.addEventListener('scroll', () => {
      if (!this.zen || !this.previewOn) return;
      this.updateTocActive();
    }, true);

    this.tocList.addEventListener('click', (e) => {
      const item = e.target.closest('.md-toc-item');
      if (!item) return;
      this.jumpToHeading(Number(item.dataset.index));
    });
  }

  // ---------- 目录选择器 ----------
  refreshFolderOptions() {
    if (!this.folderSel) return;
    const prev = this.folderSel.value;
    const list = this.opts.folders ? this.opts.folders() : [];
    this.folderSel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '📁 未归类';
    this.folderSel.appendChild(none);
    for (const f of list) {
      const o = document.createElement('option');
      o.value = String(f.id);
      o.textContent = (f.depth > 0 ? '\u00A0\u00A0'.repeat(f.depth) + '└ ' : '📁 ') + f.name;
      this.folderSel.appendChild(o);
    }
    const hasPrev = prev !== '' && list.some((f) => String(f.id) === prev);
    const fallback = this.opts.getFolderId ? this.opts.getFolderId() : '';
    this.folderSel.value = hasPrev ? prev : (fallback === null || fallback === undefined ? '' : String(fallback));
  }

  currentFolderId() {
    if (!this.folderSel) return undefined;
    return this.folderSel.value === '' ? null : Number(this.folderSel.value);
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
      const ok = await this.opts.onSubmit(text, this.currentFolderId());
      if (ok) {
        this.input.value = '';
        this.updateCount();
        this.autoResize();
        if (this.previewOn) this.renderPreview();
        if (this.zen) this.exitZen();
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

  // 输入框随内容自动增高（上限由 inline max-height 控制，超出内部滚动；全屏下无上限）
  autoResize() {
    const el = this.input;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // ---------- 预览 ----------
  togglePreview() {
    this.previewOn = !this.previewOn;
    this.previewBtn.classList.toggle('active', this.previewOn);
    if (this.previewOn) {
      this.input.classList.add('hidden');
      this.preview.classList.remove('hidden');
      this.renderPreview();
      if (this.zen) this.updateTocActive();
    } else {
      this.preview.classList.add('hidden');
      this.input.classList.remove('hidden');
      this.autoResize();
      this.input.focus();
      if (this.zen) this.updateTocActive();
    }
  }

  renderPreviewSoon() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), 250);
  }

  renderPreview() {
    this.preview.innerHTML = this.input.value.trim() ? renderMemoHtml(this.input.value) : '<p class="md-empty-tip">暂无内容</p>';
    // 启用任务复选框，点击可反写源码
    this.preview.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      el.disabled = false;
    });
  }

  // 预览中第 idx 个复选框 <=> 源码中第 idx 个任务标记
  toggleTaskCheckbox(box) {
    const boxes = [...this.preview.querySelectorAll('input[type="checkbox"]')];
    const idx = boxes.indexOf(box);
    if (idx === -1) return;
    const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([xX ])(\])/gm;
    let n = 0;
    let changed = false;
    const text = this.input.value.replace(re, (full, head, state, tail) => {
      if (n++ !== idx) return full;
      changed = true;
      return head + (state === ' ' ? 'x' : ' ') + tail;
    });
    if (!changed) return;
    this.input.value = text;
    if (this.opts.onChange) this.opts.onChange(text);
    this.updateCount();
    const scroll = this.preview.scrollTop;
    this.renderPreview();
    this.preview.scrollTop = scroll;
    if (this.zen) this.renderTocSoon();
  }

  // ---------- 全屏（Zen） ----------
  enterZen() {
    if (this.zen) return;
    this.zen = true;
    this.root.classList.add('md-zen');
    document.body.classList.add('md-zen-active');
    this.zenBtn.innerHTML = SVG.compress;
    this.zenBtn.title = '退出全屏（Esc）';
    // 全屏下取消普通模式的自动增高上限，由布局撑满
    this.input.style.maxHeight = '';
    this.renderToc();
    setTimeout(() => this.input.focus(), 30);
    this.onDocKeydown = (e) => {
      if (e.key === 'Escape' && !this.suggest.open) {
        e.preventDefault();
        this.exitZen();
      }
    };
    document.addEventListener('keydown', this.onDocKeydown);
  }

  exitZen() {
    if (!this.zen) return;
    this.zen = false;
    this.root.classList.remove('md-zen');
    document.body.classList.remove('md-zen-active');
    this.zenBtn.innerHTML = SVG.expand;
    this.zenBtn.title = '全屏编辑';
    this.input.style.maxHeight = this.opts.compact ? '300px' : '460px';
    if (this.onDocKeydown) {
      document.removeEventListener('keydown', this.onDocKeydown);
      this.onDocKeydown = null;
    }
    this.autoResize();
  }

  // ---------- TOC ----------
  renderTocSoon() {
    if (this.tocTimer) clearTimeout(this.tocTimer);
    this.tocTimer = setTimeout(() => {
      this.renderToc();
      this.updateTocActive();
    }, 300);
  }

  renderToc() {
    this.tocItems = parseHeadings(this.input.value);
    this.tocList.innerHTML = '';
    if (!this.tocItems.length) {
      const tip = document.createElement('p');
      tip.className = 'md-toc-empty';
      tip.textContent = '暂无标题 · 在正文里用 “# 标题” 生成目录';
      this.tocList.appendChild(tip);
      return;
    }
    this.tocItems.forEach((h, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'md-toc-item toc-h' + h.level;
      item.textContent = h.text;
      item.dataset.index = String(i);
      item.title = h.text;
      this.tocList.appendChild(item);
    });
    this.updateTocActive();
  }

  updateTocActive() {
    if (!this.zen) return;
    const buttons = this.tocList.querySelectorAll('.md-toc-item');
    if (!buttons.length) return;
    let activeIdx = -1;
    if (this.previewOn) {
      // 阅读模式：以滚动容器（wrap）可见顶部为基准，判断滚过了哪些标题
      const scroller = this.zen ? this.wrapEl : this.preview;
      const hostTop = this.wrapEl.getBoundingClientRect().top;
      const hs = this.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].getBoundingClientRect().top - hostTop <= 90) activeIdx = i;
        else break;
      }
      // 已滚到底：最后一节通常较短，强制高亮最后一个标题
      if (scroller.scrollHeight > scroller.clientHeight + 4 &&
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        activeIdx = hs.length - 1;
      }
    } else {
      // 编辑模式：以光标所在行为准
      const caretLine = this.input.value.slice(0, this.input.selectionStart).split('\n').length - 1;
      for (let i = 0; i < this.tocItems.length; i++) {
        if (this.tocItems[i].line <= caretLine) activeIdx = i;
        else break;
      }
    }
    buttons.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    if (activeIdx >= 0 && buttons[activeIdx]) {
      buttons[activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  jumpToHeading(i) {
    const item = this.tocItems[i];
    if (!item) return;
    if (this.previewOn) {
      const hs = this.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (hs[i]) hs[i].scrollIntoView({ block: 'start' });
    } else {
      const lines = this.input.value.split('\n');
      const pos = lines.slice(0, item.line).join('\n').length + (item.line > 0 ? 1 : 0);
      this.input.setSelectionRange(pos, pos);
      // 重新聚焦让浏览器把光标滚入可视区
      if (document.activeElement === this.input) this.input.blur();
      this.input.focus();
    }
    setTimeout(() => this.updateTocActive(), 80);
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
      case 'zen': this.zen ? this.exitZen() : this.enterZen(); break;
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

    const lines = value.slice(lineStart, lineEnd).split('\n');
    const newBlock = transformBlockLines(lines, prefix).join('\n');
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
    // 已全部是有序列表 => 再点一次取消编号
    const allNumbered = lines.every((l) => l.trim() === '' || /^\s*\d+[.] /.test(l));
    let out;
    if (allNumbered) {
      out = lines.map((l) => l.replace(/^(\s*)\d+[.] /, '$1')).join('\n');
    } else {
      let idx = 1;
      out = lines.map((l) => {
        const m = l.match(/^(\s*)/);
        const indent = m ? m[1] : '';
        return indent + idx++ + '. ' + l.slice(indent.length);
      }).join('\n');
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
    this.autoResize();
    if (this.previewOn) this.renderPreviewSoon();
    if (this.zen) this.renderTocSoon();
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

  // ---------- 缩进（Tab / Shift+Tab） ----------
  // 列表/引用/标题行或多行选中时缩进整行，否则插入两个空格。
  indentSelection(outdent) {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const multiLine = block.includes('\n');
    const isStructured = /^(#{1,6}\s|>\s|- |\d+[.] )/.test(block);

    if (!outdent && !multiLine && !isStructured) {
      this.insertAtCursor('  ');
      return;
    }

    const lines = block.split('\n');
    const mapped = lines.map((l) => {
      if (outdent) {
        if (l.startsWith('  ')) return l.slice(2);
        if (l.startsWith(' ')) return l.slice(1);
        return l;
      }
      return l.trim() === '' && multiLine ? l : '  ' + l;
    });
    const newBlock = mapped.join('\n');
    input.setRangeText(newBlock, lineStart, lineEnd, 'end');
    input.selectionStart = lineStart;
    input.selectionEnd = lineStart + newBlock.length;
    input.focus();
    this.afterEdit();
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
    if (mod && !e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); this.runCmd('code'); return; }
    if (mod && e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); this.runCmd('strike'); return; }
    if (mod && e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      e.preventDefault(); this.runCmd('h' + e.key); return;
    }
    // Ctrl+Shift+7/8/9：有序 / 无序 / 任务列表（与常见编辑器一致）
    if (mod && e.shiftKey && (e.key === '7' || e.key === '&' || e.code === 'Digit7')) { e.preventDefault(); this.runCmd('ol'); return; }
    if (mod && e.shiftKey && (e.key === '8' || e.key === '*' || e.code === 'Digit8')) { e.preventDefault(); this.runCmd('ul'); return; }
    if (mod && e.shiftKey && (e.key === '9' || e.key === '(' || e.code === 'Digit9')) { e.preventDefault(); this.runCmd('task'); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); this.submit(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      this.indentSelection(e.shiftKey);
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
