// Flomemos 前端入口：登录注册 / 笔记列表 / 编辑器 / 标签 / 搜索 / 统计 / 回顾 / 用户管理 / 分享 / 回收站 / 撤销

import { api, ApiError } from './api.js';
import { renderMemoHtml, escapeHtml } from './md.js';
import { MarkdownEditor } from './editor.js';
import { t, setLocale, getLocale, supportedLocales } from './i18n.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  email: '',
  role: 'user',
  view: 'all', // all | pinned | tag | trash
  tag: '',
  tagsFilter: '',
  tagsSort: localStorage.getItem('fm-tags-sort') || 'count',
  q: '',
  batchMode: false,
  memos: [],
  hasMore: false,
  nextBefore: 0,
  loading: false,
  tags: [],
  selected: new Set(), // 多选
  previewOpen: false,
};

// ---------------- 工具 ----------------
function toast(message, type = 'info', action) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  if (action) el.classList.add('toast-action');
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      el.remove();
    });
    el.appendChild(btn);
  }
  $('#toast-wrap').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  if (action && action.duration) {
    setTimeout(() => el.remove(), action.duration);
  } else {
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }
}

document.addEventListener('fm:toast', (e) => toast(e.detail, 'error'));

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm;
}

function fmtFull(iso) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function fmtRelative(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + ' 天前';
  return fmtTime(iso);
}

function dayInfo(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let label;
  if (diffDays === 0) label = '今天';
  else if (diffDays === 1) label = '昨天';
  else if (diffDays > 1 && diffDays < 7) label = diffDays + ' 天前 · ' + '周' + weekdays[d.getDay()];
  else {
    label = (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '年' : '') +
      (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + weekdays[d.getDay()];
  }
  const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  return { label, key };
}

function handleActionError(err) {
  if (err instanceof ApiError && (err.status === 401 || err.code === 'banned')) return;
  toast(err.message, 'error');
}

// 自动保存草稿
const DRAFT_KEY = () => 'fm-draft:' + (state.email || 'anon');
let draftTimer = null;
function saveDraft(text) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { localStorage.setItem(DRAFT_KEY(), text); } catch {}
  }, 400);
}
function loadDraft() {
  try { return localStorage.getItem(DRAFT_KEY()) || ''; } catch { return ''; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY()); } catch {}
}

// ---------------- 视图切换 ----------------
const AUTH_FORMS = { login: 'login-form', register: 'register-form', reset: 'reset-form' };

function setAuthTab(mode) {
  document.querySelectorAll('.auth-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === mode);
  });
  for (const [tab, formId] of Object.entries(AUTH_FORMS)) {
    $('#' + formId).classList.toggle('hidden', tab !== mode);
  }
}

function showAuth(opts = {}) {
  const mode = opts.mode || 'login';
  $('#auth-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
  $('#auth-tabs').classList.toggle('hidden', opts.hideTabs);
  setAuthTab(mode);
  $('#register-hint').classList.toggle('hidden', !opts.showAdminHint);
  for (const id of ['login-error', 'register-error', 'reset-error']) $('#' + id).classList.add('hidden');
  if (opts.message) {
    const errSel = mode === 'login' ? '#login-error' : mode === 'register' ? '#register-error' : '#reset-error';
    $(errSel).textContent = opts.message;
    $(errSel).classList.remove('hidden');
  }
  $(mode === 'login' ? '#login-email' : mode === 'register' ? '#register-email' : '#reset-email').focus();
}

function showMain() {
  $('#auth-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
  closeSidebar();
}

function enterApp(user) {
  state.email = user.email;
  state.role = user.role || 'user';
  $('#nav-admin').classList.toggle('hidden', state.role !== 'admin');
  $('#nav-trash').classList.remove('hidden');
  $('#nav-batch').classList.remove('hidden');
  renderSideUser();
  showMain();
  mountEditor();
  refreshTags();
  reloadMemos();
  updateTotalCount();
}

function renderSideUser() {
  const el = $('#side-user');
  el.innerHTML = '';
  const icon = document.createElement('span');
  icon.textContent = state.role === 'admin' ? '👑' : '👤';
  const name = document.createElement('span');
  name.className = 'side-user-name';
  name.textContent = state.email;
  name.title = state.email;
  const badge = document.createElement('span');
  badge.className = 'role-badge' + (state.role === 'admin' ? ' role-admin' : '');
  badge.textContent = state.role === 'admin' ? '管理员' : '成员';
  el.append(icon, name, badge);
}

document.addEventListener('fm:unauthorized', () => {
  if (!$('#auth-view').classList.contains('hidden')) return;
  showAuth({ mode: 'login' });
  toast('登录已过期，请重新登录', 'error');
});

document.addEventListener('fm:banned', (e) => {
  showAuth({ mode: 'login', message: e.detail || '该账号已被封禁，请联系管理员' });
});

// ---------------- 启动 ----------------
async function boot() {
  applyTheme(localStorage.getItem('fm-theme') || 'auto');
  await setLocale(localStorage.getItem('fm-locale') || navigator.language || 'zh-CN');
  try {
    const me = await api('/api/me');
    if (me.authenticated) enterApp({ email: me.email, role: me.role });
    else showAuth({ mode: me.hasUsers ? 'login' : 'register', hideTabs: !me.hasUsers, showAdminHint: !me.hasUsers });
  } catch (err) {
    showAuth({ mode: 'login' });
    toast(err.message || '加载失败', 'error');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/assets/sw.js').catch(() => {});
  }
}

// ---------------- 登录 / 注册 / 找回密码 ----------------
function showAuthError(form, message) {
  const errEl = $('#' + form + '-error');
  errEl.textContent = message;
  errEl.classList.remove('hidden');
}

function startCountdown(btn) {
  let left = 60;
  btn.disabled = true;
  btn.textContent = left + ' 秒';
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = '发送验证码';
    } else {
      btn.textContent = left + ' 秒';
    }
  }, 1000);
}

async function sendAuthCode(kind) {
  const btn = $('#' + kind + '-send');
  const email = $('#' + kind + '-email').value.trim();
  if (btn.disabled) return;
  if (!email || email.indexOf('@') === -1) {
    toast('请输入正确的邮箱地址', 'error');
    return;
  }
  btn.disabled = true;
  try {
    const path = kind === 'register' ? '/api/auth/register-start' : '/api/auth/forgot-start';
    const res = await api(path, { method: 'POST', body: { email } });
    startCountdown(btn);
    if (res.devCode) {
      $('#' + kind + '-code').value = res.devCode;
      toast('开发模式：验证码 ' + res.devCode);
    } else {
      toast('验证码已发送，请查收邮箱（也检查一下垃圾邮件）');
    }
  } catch (err) {
    btn.disabled = false;
    toast(err.message, 'error');
  }
}

function bindAuthForms() {
  document.querySelectorAll('.auth-tab').forEach((b) => {
    b.addEventListener('click', () => {
      const hintShown = !$('#register-hint').classList.contains('hidden');
      showAuth({ mode: b.dataset.tab, showAdminHint: hintShown });
    });
  });

  $('#register-send').addEventListener('click', () => sendAuthCode('register'));
  $('#reset-send').addEventListener('click', () => sendAuthCode('reset'));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: { email: $('#login-email').value.trim(), password: $('#login-password').value },
      });
      enterApp({ email: res.email, role: res.role });
    } catch (err) {
      showAuthError('login', err.message);
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#register-password').value;
    if (password !== $('#register-password2').value) {
      showAuthError('register', '两次输入的密码不一致');
      return;
    }
    try {
      const res = await api('/api/auth/register', {
        method: 'POST',
        body: {
          email: $('#register-email').value.trim(),
          code: $('#register-code').value.trim(),
          password,
        },
      });
      enterApp({ email: res.email, role: res.role });
      toast(res.role === 'admin' ? '欢迎，管理员 🎉' : '注册成功，开始记录吧 ✨');
    } catch (err) {
      showAuthError('register', err.message);
    }
  });

  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/reset', {
        method: 'POST',
        body: {
          email: $('#reset-email').value.trim(),
          code: $('#reset-code').value.trim(),
          password: $('#reset-password').value,
        },
      });
      showAuth({ mode: 'login', message: '密码已重置，请使用新密码登录' });
      toast('密码已重置 ✅');
    } catch (err) {
      showAuthError('reset', err.message);
    }
  });
}

// ---------------- 编辑器 ----------------
let mainEditor = null;

function mountEditor() {
  if (mainEditor) return;
  const draft = loadDraft();
  mainEditor = new MarkdownEditor($('#editor-mount'), {
    placeholder: '记录想法… 用 #标签 归类',
    submitText: '记录',
    getTags: () => state.tags.map((t) => t.tag),
    uploadImage: uploadImage,
    initial: draft,
    onChange: (text) => saveDraft(text),
    onSubmit: async (text) => {
      const res = await api('/api/memos', { method: 'POST', body: { content: text } });
      clearDraft();
      await refreshTags();
      updateTotalCount();
      if (state.view === 'trash') {
        // 切回全部
        state.view = 'all';
        setNavActive('all');
      }
      if (isFreshList()) {
        state.memos.unshift(res.memo);
        renderMemoList();
      } else {
        await reloadMemos();
      }
      toast('已记录 ✅');
      return true;
    },
  });
}

async function uploadImage(file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  const res = await api('/api/upload', { method: 'POST', body: form, onProgress });
  return res.url;
}

function isFreshList() {
  return state.view === 'all' && !state.q && state.nextBefore === 0;
}

// ---------------- 列表 ----------------
async function reloadMemos() {
  state.memos = [];
  state.nextBefore = 0;
  state.hasMore = false;
  state.selected.clear();
  renderSelectedBar();
  renderMemoList();
  await loadMore();
}

async function loadMore() {
  if (state.loading) return;
  state.loading = true;
  $('#sentinel').classList.remove('hidden');
  try {
    if (state.view === 'trash') {
      const res = await api('/api/trash?limit=50');
      state.memos = state.memos.concat(res.memos);
      state.hasMore = false;
      state.nextBefore = 0;
      renderMemoList();
      return;
    }
    // 搜索走 FTS5 专用端点（相关性排序 + 服务端 snippet）
    if (state.q) {
      const res = await api('/api/search?q=' + encodeURIComponent(state.q) + '&limit=50');
      state.memos = res.memos;
      state.hasMore = false;
      state.nextBefore = 0;
      renderMemoList();
      return;
    }
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (state.nextBefore) params.set('before', String(state.nextBefore));
    if (state.view === 'pinned') params.set('pinned', '1');
    if (state.view === 'tag' && state.tag) params.set('tag', state.tag);

    const res = await api('/api/memos?' + params.toString());
    state.memos = state.memos.concat(res.memos);
    state.hasMore = res.has_more;
    state.nextBefore = res.memos.length ? res.memos[res.memos.length - 1].id : state.nextBefore;
    renderMemoList();
  } catch (err) {
    handleActionError(err);
  } finally {
    state.loading = false;
    $('#sentinel').classList.add('hidden');
    $('#list-end').classList.toggle('hidden', state.hasMore || !state.memos.length);
  }
}

function updateFilterBar() {
  const bar = $('#filter-bar');
  const chip = $('#filter-text');
  if (state.view === 'tag' && state.tag) {
    chip.textContent = '标签：#' + state.tag;
    bar.classList.remove('hidden');
  } else if (state.view === 'trash') {
    chip.textContent = '回收站（30 天内可恢复）';
    bar.classList.remove('hidden');
  } else if (state.q) {
    chip.textContent = '搜索：' + state.q;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function renderMemoList() {
  updateFilterBar();
  const list = $('#memo-list');
  list.innerHTML = '';

  if (!state.memos.length) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    if (state.view === 'trash') {
      empty.innerHTML = '<p>回收站是空的</p>';
    } else if (state.q) {
      empty.innerHTML = '<p>没有找到与「' + escapeHtml(state.q) + '」相关的笔记</p><button class="btn btn-ghost btn-sm" id="empty-clear-search">清除搜索</button>';
    } else {
      empty.innerHTML = '<p class="list-empty-main">还没有笔记</p><p>在上方写下第一条想法吧，用 #标签 归类 ✨</p>';
    }
    list.appendChild(empty);
    const btn = list.querySelector('#empty-clear-search');
    if (btn) btn.addEventListener('click', () => doSearch(''));
    return;
  }

  let lastKey = '';
  for (const memo of state.memos) {
    const info = dayInfo(memo.created_at);
    if (info.key !== lastKey) {
      lastKey = info.key;
      const head = document.createElement('div');
      head.className = 'day-head';
      head.textContent = info.label;
      list.appendChild(head);
    }
    list.appendChild(renderMemoCard(memo));
  }
  $('#sentinel').classList.toggle('hidden', !state.hasMore || state.view === 'trash');
}

function renderMemoCard(memo) {
  const card = document.createElement('article');
  card.className = 'memo-card';
  card.dataset.id = memo.id;

  if (state.batchMode) {
    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.className = 'memo-check';
    sel.checked = state.selected.has(memo.id);
    sel.addEventListener('change', () => {
      if (sel.checked) state.selected.add(memo.id);
      else state.selected.delete(memo.id);
      renderSelectedBar();
    });
    card.appendChild(sel);
  }

  const body = document.createElement('div');
  body.className = 'memo-content md-body';
  body.innerHTML = renderMemoHtml(memo.content);
  if (state.q) highlightMatches(body, state.q);
  card.appendChild(body);

  const meta = document.createElement('div');
  meta.className = 'memo-meta';

  const tags = document.createElement('span');
  tags.className = 'memo-tags';
  for (const tag of memo.tags) {
    const a = document.createElement('a');
    a.className = 'tag-chip';
    a.href = '#';
    a.textContent = '#' + tag;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      filterByTag(tag);
    });
    tags.appendChild(a);
  }
  meta.appendChild(tags);

  const right = document.createElement('span');
  right.className = 'memo-right';

  if (memo.shared) {
    const s = document.createElement('span');
    s.className = 'memo-shared';
    s.textContent = '🔗';
    s.title = '已生成分享链接';
    right.appendChild(s);
  }

  if (state.view !== 'trash') {
    const actions = document.createElement('span');
    actions.className = 'memo-actions';
    actions.appendChild(actionBtn('⭐', memo.pinned ? '取消收藏' : '收藏', () => togglePin(memo)));
    actions.appendChild(actionBtn('🔗', '分享', () => shareMemo(memo)));
    actions.appendChild(actionBtn('✏️', '编辑', () => editMemo(card, memo)));
    actions.appendChild(actionBtn('📋', '复制', () => copyMemo(memo)));
    actions.appendChild(actionBtn('🗑', '删除', () => deleteMemo(memo)));
    right.appendChild(actions);
  } else {
    const actions = document.createElement('span');
    actions.className = 'memo-actions';
    actions.appendChild(actionBtn('♻️', '恢复', () => restoreMemo(memo)));
    actions.appendChild(actionBtn('❌', '永久删除', () => purgeMemo(memo)));
    right.appendChild(actions);
  }

  const time = document.createElement('span');
  time.className = 'memo-time';
  time.textContent = fmtTime(memo.created_at);
  time.title = fmtFull(memo.created_at) + ' · ' + fmtRelative(memo.created_at);
  right.appendChild(time);

  meta.appendChild(right);
  card.appendChild(meta);
  return card;
}

function actionBtn(icon, title, onClick) {
  const b = document.createElement('button');
  b.className = 'memo-act icon-btn';
  b.textContent = icon;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

// 搜索命中高亮：遍历文本节点，把 q 的出现处包上 <mark>（跳过代码/链接/已有标记）
function highlightMatches(rootEl, q) {
  const needle = q.toLowerCase();
  if (!needle) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('pre, code, a, .fm-tag, mark')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue.toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const textNode of targets) {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let idx = text.toLowerCase().indexOf(needle);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      last = idx + needle.length;
      idx = text.toLowerCase().indexOf(needle, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

// ---------------- 笔记操作 ----------------
async function togglePin(memo) {
  try {
    const res = await api('/api/memos/' + memo.id, { method: 'PUT', body: { pinned: !memo.pinned } });
    Object.assign(memo, res.memo);
    if (state.view === 'pinned' && !memo.pinned) {
      state.memos = state.memos.filter((m) => m.id !== memo.id);
    }
    renderMemoList();
    toast(memo.pinned ? '已收藏 ⭐' : '已取消收藏');
  } catch (err) {
    handleActionError(err);
  }
}

async function deleteMemo(memo) {
  if (!confirm('确定删除这条笔记吗？30 天内可在回收站恢复。')) return;
  try {
    await api('/api/memos/' + memo.id, { method: 'DELETE' });
    state.memos = state.memos.filter((m) => m.id !== memo.id);
    renderMemoList();
    await refreshTags();
    updateTotalCount();
    toast('已移到回收站', 'info', {
      label: '撤销',
      duration: 5000,
      onClick: async () => {
        try {
          await api('/api/memos/' + memo.id + '/restore', { method: 'POST' });
          toast('已恢复');
          await reloadMemos();
        } catch (err) { handleActionError(err); }
      },
    });
  } catch (err) {
    handleActionError(err);
  }
}

async function restoreMemo(memo) {
  try {
    await api('/api/memos/' + memo.id + '/restore', { method: 'POST' });
    state.memos = state.memos.filter((m) => m.id !== memo.id);
    renderMemoList();
    toast('已恢复 ✅');
  } catch (err) {
    handleActionError(err);
  }
}

async function purgeMemo(memo) {
  if (!confirm('永久删除这条笔记？此操作不可恢复。')) return;
  try {
    await api('/api/memos/' + memo.id, { method: 'DELETE' });
    state.memos = state.memos.filter((m) => m.id !== memo.id);
    renderMemoList();
    toast('已永久删除');
  } catch (err) {
    handleActionError(err);
  }
}

async function shareMemo(memo) {
  try {
    const res = await api('/api/memos/' + memo.id + '/share', { method: 'POST' });
    // /s/<token> 是可读 HTML 页；.json 后缀留给 API 调用方
    const url = location.origin + res.url.replace(/\.json$/, '');
    try { await navigator.clipboard.writeText(url); } catch {}
    memo.shared = true;
    renderMemoList();
    toast('分享链接已复制到剪贴板 🔗');
  } catch (err) {
    handleActionError(err);
  }
}

async function copyMemo(memo) {
  try {
    await navigator.clipboard.writeText(memo.content);
    toast('已复制到剪贴板 📋');
  } catch {
    toast('复制失败，请手动选择文本', 'error');
  }
}

function editMemo(card, memo) {
  const original = card;
  const holder = document.createElement('article');
  holder.className = 'memo-card memo-editing';
  original.replaceWith(holder);

  const editor = new MarkdownEditor(holder, {
    placeholder: '编辑笔记…',
    initial: memo.content,
    submitText: '保存',
    compact: true,
    getTags: () => state.tags.map((t) => t.tag),
    uploadImage: uploadImage,
    onSubmit: async (text) => {
      const res = await api('/api/memos/' + memo.id, { method: 'PUT', body: { content: text } });
      Object.assign(memo, res.memo);
      await refreshTags();
      renderMemoList();
      toast('已保存 ✅');
      return true;
    },
    onCancel: () => {
      holder.replaceWith(original);
    },
  });
  editor.input.focus();
}

// ---------------- 标签 ----------------
async function refreshTags() {
  try {
    const res = await api('/api/tags?sort=' + encodeURIComponent(state.tagsSort));
    state.tags = res.tags;
    renderTagList();
  } catch {
    // 忽略
  }
}

function renderTagList() {
  const wrap = $('#tag-list');
  wrap.innerHTML = '';
  // 搜索框
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索标签…';
  search.className = 'tag-search';
  search.value = state.tagsFilter;
  search.addEventListener('input', () => {
    state.tagsFilter = search.value.trim();
    renderTagItems();
  });
  wrap.appendChild(search);

  // 排序选择
  const sortSel = document.createElement('select');
  sortSel.className = 'tag-sort';
  for (const [val, lab] of [['count', '使用频率'], ['name', '名称'], ['recent', '最近使用']]) {
    const o = document.createElement('option');
    o.value = val; o.textContent = lab;
    if (state.tagsSort === val) o.selected = true;
    sortSel.appendChild(o);
  }
  sortSel.addEventListener('change', () => {
    state.tagsSort = sortSel.value;
    localStorage.setItem('fm-tags-sort', state.tagsSort);
    refreshTags();
  });
  wrap.appendChild(sortSel);

  const list = document.createElement('div');
  list.id = 'tag-items';
  wrap.appendChild(list);

  if (!state.tags.length) {
    const p = document.createElement('p');
    p.className = 'tag-empty';
    p.textContent = '暂无标签，在笔记里用 #标签 即可创建';
    list.appendChild(p);
    return;
  }
  renderTagItems();

  function renderTagItems() {
    list.innerHTML = '';
    const filter = state.tagsFilter.toLowerCase();
    for (const t of state.tags) {
      if (filter && !t.tag.toLowerCase().includes(filter)) continue;
      const depth = (t.tag.match(/\//g) || []).length;
      const item = document.createElement('button');
      item.className = 'tag-item' + (state.view === 'tag' && state.tag === t.tag ? ' active' : '');
      item.style.paddingLeft = 6 + depth * 14 + 'px';
      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = '#' + t.tag;
      item.appendChild(name);
      const count = document.createElement('span');
      count.className = 'tag-count';
      count.textContent = t.count;
      item.appendChild(count);
      item.addEventListener('click', () => filterByTag(t.tag));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openTagMenu(t.tag, e.clientX, e.clientY);
      });
      list.appendChild(item);
    }
  }
}

function openTagMenu(tag, x, y) {
  closeTagMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'tag-ctx-menu';
  const items = [
    { label: '重命名', onClick: () => renameTagPrompt(tag) },
    { label: '合并到…', onClick: () => mergeTagPrompt(tag) },
    { label: '删除标签', onClick: () => deleteTagPrompt(tag), danger: true },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.addEventListener('click', () => { it.onClick(); closeTagMenu(); });
    menu.appendChild(b);
  }
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeTagMenu, { once: true }), 0);
}
function closeTagMenu() {
  const m = $('#tag-ctx-menu');
  if (m) m.remove();
}

async function renameTagPrompt(oldName) {
  const newName = prompt('把标签「' + oldName + '」重命名为：', oldName);
  if (!newName || newName.trim() === oldName) return;
  try {
    await api('/api/tags/rename', { method: 'POST', body: { oldName, newName: newName.trim() } });
    await refreshTags();
    if (state.tag === oldName) state.tag = newName.trim();
    reloadMemos();
    toast('已重命名');
  } catch (err) { handleActionError(err); }
}

async function mergeTagPrompt(fromName) {
  const toName = prompt('把标签「' + fromName + '」合并到：');
  if (!toName || toName.trim() === fromName) return;
  try {
    await api('/api/tags/merge', { method: 'POST', body: { from: fromName, to: toName.trim() } });
    await refreshTags();
    reloadMemos();
    toast('已合并');
  } catch (err) { handleActionError(err); }
}

async function deleteTagPrompt(tag) {
  if (!confirm('删除标签「' + tag + '」？（不会删除笔记）')) return;
  try {
    await api('/api/tags/' + encodeURIComponent(tag), { method: 'DELETE' });
    await refreshTags();
    reloadMemos();
    toast('已删除标签');
  } catch (err) { handleActionError(err); }
}

function filterByTag(tag) {
  state.view = 'tag';
  state.tag = tag;
  state.q = '';
  $('#search-input').value = '';
  $('#search-clear').classList.add('hidden');
  setNavActive(null);
  closeSidebar();
  renderTagList();
  reloadMemos();
}

function updateTotalCount() {
  api('/api/stats').then((s) => {
    $('#count-total').textContent = s.total || '';
  }).catch(() => {});
}

// ---------------- 搜索 ----------------
function bindSearch() {
  const input = $('#search-input');
  let timer = null;
  input.addEventListener('input', () => {
    $('#search-clear').classList.toggle('hidden', !input.value);
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value.trim()), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      doSearch(input.value.trim());
    }
  });
  $('#search-clear').addEventListener('click', () => {
    input.value = '';
    $('#search-clear').classList.add('hidden');
    doSearch('');
    input.focus();
  });
}

function doSearch(q) {
  state.q = q;
  if (q) {
    state.view = 'all';
    setNavActive('all');
  }
  reloadMemos();
}

// ---------------- 批量操作栏 ----------------
function renderSelectedBar() {
  const bar = $('#selected-bar');
  const n = state.selected.size;
  bar.classList.toggle('hidden', n === 0);
  bar.innerHTML = '';
  if (n === 0) return;

  const info = document.createElement('span');
  info.textContent = '已选 ' + n + ' 条';
  bar.appendChild(info);

  bar.appendChild(batchBtn('收藏', async () => {
    await api('/api/memos/batch-pin', { method: 'POST', body: { ids: [...state.selected], pinned: true } });
    toast('已收藏'); state.selected.clear(); reloadMemos();
  }));
  bar.appendChild(batchBtn('取消收藏', async () => {
    await api('/api/memos/batch-pin', { method: 'POST', body: { ids: [...state.selected], pinned: false } });
    toast('已取消收藏'); state.selected.clear(); reloadMemos();
  }));
  bar.appendChild(batchBtn('打标签…', async () => {
    const tag = prompt('给选中的笔记添加标签：');
    if (!tag) return;
    await api('/api/memos/batch-tag', { method: 'POST', body: { ids: [...state.selected], tag: tag.trim() } });
    toast('已添加标签'); state.selected.clear(); reloadMemos();
  }));
  bar.appendChild(batchBtn('删除', async () => {
    if (!confirm('删除选中的 ' + n + ' 条笔记？')) return;
    await api('/api/memos/batch-delete', { method: 'POST', body: { ids: [...state.selected] } });
    toast('已移到回收站', 'info', {
      label: '撤销', duration: 5000,
      onClick: async () => {
        for (const id of [...state.selected]) {
          try { await api('/api/memos/' + id + '/restore', { method: 'POST' }); } catch {}
        }
        toast('已恢复'); reloadMemos();
      },
    });
    state.selected.clear(); reloadMemos();
  }, 'danger'));
  bar.appendChild(batchBtn('取消', () => { state.batchMode = false; state.selected.clear(); renderSelectedBar(); renderMemoList(); }));
}
function batchBtn(label, onClick, kind) {
  const b = document.createElement('button');
  b.className = 'btn btn-sm ' + (kind === 'danger' ? 'btn-danger' : 'btn-ghost');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ---------------- 侧栏导航 ----------------
function setNavActive(name) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === name);
  });
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => {
      const nav = b.dataset.nav;
      closeSidebar();
      if (nav === 'all') {
        state.view = 'all'; state.tag = ''; state.q = '';
        $('#search-input').value = '';
        $('#search-clear').classList.add('hidden');
        setNavActive('all'); renderTagList(); reloadMemos();
      } else if (nav === 'pinned') {
        state.view = 'pinned'; state.tag = '';
        setNavActive('pinned'); renderTagList(); reloadMemos();
      } else if (nav === 'trash') {
        state.view = 'trash'; state.tag = ''; state.q = '';
        setNavActive('trash'); reloadMemos();
      } else if (nav === 'review') {
        openReview();
      } else if (nav === 'stats') {
        openStats();
      } else if (nav === 'admin') {
        openAdmin();
      } else if (nav === 'batch') {
        // 切换批量模式：开启后所有卡片显示复选框；再点一次(或清除所选)退出
        state.batchMode = !state.batchMode;
        state.selected.clear();
        renderMemoList();
        renderSelectedBar();
        if (state.batchMode) toast('已进入多选模式：勾选笔记后使用上方操作栏');
      }
    });
  });
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

function bindSidebar() {
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#sidebar-mask').addEventListener('click', closeSidebar);

  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'auto';
    const dark = !(cur === 'dark');
    applyTheme(dark ? 'dark' : 'light');
    localStorage.setItem('fm-theme', document.documentElement.dataset.theme);
  });

  $('#lang-toggle').addEventListener('click', () => {
    const cur = getLocale();
    const idx = supportedLocales.indexOf(cur);
    const next = supportedLocales[(idx + 1) % supportedLocales.length];
    setLocale(next).then(() => {
      localStorage.setItem('fm-locale', next);
      toast('Language: ' + next);
      renderTagList();
      renderMemoList();
      renderSideUser();
    });
  });

  $('#export-md').addEventListener('click', () => downloadExport('md'));
  $('#export-json').addEventListener('click', () => downloadExport('json'));
  $('#import-btn').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const form = new FormData(); form.append('file', f);
    try {
      const res = await api('/api/import', { method: 'POST', body: form });
      toast('已导入 ' + res.imported + ' 条');
      reloadMemos(); refreshTags(); updateTotalCount();
    } catch (err) { handleActionError(err); }
    e.target.value = '';
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.reload();
  });

  // filter-bar 清除按钮
  $('#filter-clear').addEventListener('click', () => {
    state.view = 'all'; state.tag = ''; state.q = '';
    $('#search-input').value = '';
    $('#search-clear').classList.add('hidden');
    setNavActive('all'); renderTagList(); reloadMemos();
  });
}

function downloadExport(format) {
  const a = document.createElement('a');
  a.href = '/api/export?format=' + format;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已开始下载导出文件');
}

// ---------------- 弹窗 ----------------
function bindModals() {
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => { $('#' + el.dataset.close).classList.add('hidden'); closeTagMenu(); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTagMenu();
      $('#review-modal').classList.add('hidden');
      $('#stats-modal').classList.add('hidden');
      $('#admin-modal').classList.add('hidden');
    }
  });
  $('#review-refresh').addEventListener('click', loadReview);
  $('#review-num').addEventListener('change', loadReview);
  $('#admin-refresh').addEventListener('click', loadUsers);
  $('#admin-search').addEventListener('input', () => setTimeout(loadUsers, 300));
}

function openReview() {
  $('#review-modal').classList.remove('hidden');
  loadReview();
}

async function loadReview() {
  const body = $('#review-body');
  body.innerHTML = '<p class="modal-tip">加载中…</p>';
  const num = Number($('#review-num').value) || 5;
  try {
    const res = await api('/api/memos/random?limit=' + num);
    body.innerHTML = '';
    if (!res.memos.length) {
      body.innerHTML = '<p class="modal-tip">还没有任何笔记，先去记录吧～</p>';
      return;
    }
    for (const memo of res.memos) {
      const card = document.createElement('article');
      card.className = 'memo-card';
      const content = document.createElement('div');
      content.className = 'memo-content md-body';
      content.innerHTML = renderMemoHtml(memo.content);
      card.appendChild(content);

      const meta = document.createElement('div');
      meta.className = 'memo-meta';
      const time = document.createElement('span');
      time.className = 'memo-time';
      time.textContent = fmtFull(memo.created_at);
      meta.appendChild(time);
      card.appendChild(meta);
      body.appendChild(card);
    }
  } catch (err) {
    body.innerHTML = '<p class="modal-tip">' + escapeHtml(err.message) + '</p>';
  }
}

// ---------------- 用户管理（仅管理员） ----------------
function openAdmin() {
  $('#admin-modal').classList.remove('hidden');
  loadUsers();
}

async function loadUsers() {
  const body = $('#admin-body');
  body.innerHTML = '<p class="modal-tip">加载中…</p>';
  const q = $('#admin-search').value.trim();
  try {
    const res = await api('/api/admin/users?q=' + encodeURIComponent(q));
    body.innerHTML = '';
    if (!res.users.length) {
      body.innerHTML = '<p class="modal-tip">没有匹配的用户</p>';
      return;
    }
    const table = document.createElement('div');
    table.className = 'admin-table';
    for (const u of res.users) table.appendChild(renderUserRow(u));
    body.appendChild(table);

    if (res.total > res.users.length) {
      const pager = document.createElement('div');
      pager.className = 'admin-pager';
      pager.textContent = '共 ' + res.total + ' 个用户 · 显示前 ' + res.users.length;
      body.appendChild(pager);
    }

    const tip = document.createElement('p');
    tip.className = 'admin-tip';
    tip.textContent = '封禁后该用户将立即退出登录且无法再登录；删除会一并清除其全部笔记与图片，不可恢复。';
    body.appendChild(tip);
  } catch (err) {
    body.innerHTML = '<p class="modal-tip">' + escapeHtml(err.message) + '</p>';
  }
}

function renderUserRow(u) {
  const row = document.createElement('div');
  row.className = 'admin-row' + (u.banned ? ' banned' : '');

  const info = document.createElement('div');
  info.className = 'admin-user-info';
  const name = document.createElement('span');
  name.className = 'admin-user-name';
  name.textContent = u.email;
  info.appendChild(name);

  const role = document.createElement('span');
  role.className = 'role-badge' + (u.role === 'admin' ? ' role-admin' : '');
  role.textContent = u.role === 'admin' ? '管理员' : '成员';
  info.appendChild(role);

  if (u.banned) {
    const bannedBadge = document.createElement('span');
    bannedBadge.className = 'role-badge role-banned';
    bannedBadge.textContent = '已封禁';
    info.appendChild(bannedBadge);
  }

  const meta = document.createElement('div');
  meta.className = 'admin-user-meta';
  const lastLogin = u.last_login_at ? ' · 最近登录 ' + u.last_login_at.slice(0, 10) : '';
  const lastMemo = u.last_memo_at ? ' · 最近笔记 ' + u.last_memo_at.slice(0, 10) : '';
  meta.textContent = u.memo_count + ' 条笔记 · 注册于 ' + (u.created_at || '').slice(0, 10) + lastLogin + lastMemo;
  info.appendChild(meta);
  row.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'admin-user-actions';
  if (u.role !== 'admin') {
    const banBtn = document.createElement('button');
    banBtn.className = 'btn btn-ghost btn-sm';
    banBtn.textContent = u.banned ? '解封' : '封禁';
    banBtn.addEventListener('click', () => toggleBan(u));
    actions.appendChild(banBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-sm admin-delete';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteUserRow(u));
    actions.appendChild(delBtn);
  } else {
    const self = document.createElement('span');
    self.className = 'admin-user-meta';
    self.textContent = '——';
    actions.appendChild(self);
  }
  row.appendChild(actions);
  return row;
}

async function toggleBan(u) {
  try {
    const res = await api('/api/admin/users/' + u.id + '/ban', { method: 'POST', body: { banned: !u.banned } });
    u.banned = res.banned;
    loadUsers();
    toast(u.banned ? '已封禁 ' + u.email : '已解封 ' + u.email);
  } catch (err) { handleActionError(err); }
}
async function deleteUserRow(u) {
  if (!confirm('确定删除用户' + u.email + '？\n其全部笔记与图片将一并删除，不可恢复。')) return;
  try {
    await api('/api/admin/users/' + u.id, { method: 'DELETE' });
    loadUsers();
    toast('已删除用户 ' + u.email);
  } catch (err) { handleActionError(err); }
}

// ---------------- 统计 ----------------
function openStats() {
  $('#stats-modal').classList.remove('hidden');
  loadStats();
}

async function loadStats() {
  const body = $('#stats-body');
  body.innerHTML = '<p class="modal-tip">加载中…</p>';
  try {
    const s = await api('/api/stats');
    body.innerHTML = '';

    const cards = document.createElement('div');
    cards.className = 'stat-cards';
    const items = [
      ['累计笔记', s.total],
      ['今日新增', s.today],
      ['最近 7 天', s.week],
      ['连续记录（天）', s.streak],
      ['最长连续', s.max_streak || 0],
      ['标签数', s.tags],
    ];
    for (const [label, value] of items) {
      const c = document.createElement('div');
      c.className = 'stat-card';
      const num = document.createElement('div');
      num.className = 'stat-num';
      num.textContent = value;
      const lab = document.createElement('div');
      lab.className = 'stat-label';
      lab.textContent = label;
      c.append(num, lab);
      cards.appendChild(c);
    }
    body.appendChild(cards);

    // 本周 vs 上周
    if (s.week_compare) {
      const cmp = document.createElement('div');
      cmp.className = 'stat-compare';
      const thisW = s.week_compare.this_week || 0;
      const lastW = s.week_compare.last_week || 0;
      const delta = lastW > 0 ? Math.round((thisW - lastW) / lastW * 100) : 0;
      cmp.innerHTML = '本周 <b>' + thisW + '</b> 条 vs 上周 <b>' + lastW + '</b> 条 · '
        + (delta === 0 ? '持平' : (delta > 0 ? '📈 +' : '📉 ') + delta + '%');
      body.appendChild(cmp);
    }

    // 24 小时柱状图
    if (s.by_hour) {
      const hourTitle = document.createElement('div');
      hourTitle.className = 'heat-title';
      hourTitle.textContent = '活跃时段（24 小时）';
      body.appendChild(hourTitle);
      const chart = document.createElement('div');
      chart.className = 'hour-chart';
      const max = Math.max(1, ...Object.values(s.by_hour));
      for (let h = 0; h < 24; h++) {
        const bar = document.createElement('div');
        bar.className = 'hour-bar';
        bar.style.height = ((s.by_hour[h] || 0) / max * 100) + '%';
        bar.title = h + ':00 · ' + (s.by_hour[h] || 0) + ' 条';
        chart.appendChild(bar);
      }
      body.appendChild(chart);
    }

    // 标签云
    if (s.top_tags && s.top_tags.length) {
      const tagTitle = document.createElement('div');
      tagTitle.className = 'heat-title';
      tagTitle.textContent = '热门标签';
      body.appendChild(tagTitle);
      const cloud = document.createElement('div');
      cloud.className = 'tag-cloud';
      const max = s.top_tags[0].count;
      for (const t of s.top_tags) {
        const a = document.createElement('a');
        a.className = 'tag-cloud-item';
        a.style.fontSize = (12 + (t.count / max) * 8) + 'px';
        a.textContent = '#' + t.tag;
        a.addEventListener('click', () => {
          $('#stats-modal').classList.add('hidden');
          filterByTag(t.tag);
        });
        cloud.appendChild(a);
      }
      body.appendChild(cloud);
    }

    const heatTitle = document.createElement('div');
    heatTitle.className = 'heat-title';
    heatTitle.textContent = '近半年记录热力图';
    body.appendChild(heatTitle);

    body.appendChild(buildHeatmap(s.days));

    const legend = document.createElement('div');
    legend.className = 'heat-legend';
    legend.append('少 ');
    for (const level of [0, 1, 2, 3, 4]) {
      const cell = document.createElement('span');
      cell.className = 'heat-cell level-' + level;
      legend.appendChild(cell);
    }
    legend.append(' 多');
    body.appendChild(legend);
  } catch (err) {
    body.innerHTML = '<p class="modal-tip">' + escapeHtml(err.message) + '</p>';
  }
}

function buildHeatmap(days) {
  const wrap = document.createElement('div');
  wrap.className = 'heatmap';

  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 26 * 7 + 1);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);

  const dateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  };

  const cursor = new Date(start);
  while (cursor <= end) {
    const week = document.createElement('div');
    week.className = 'heat-col';
    for (let i = 0; i < 7; i++) {
      const cellDate = new Date(cursor);
      const key = dateKey(cellDate);
      const count = days[key] || 0;
      const cell = document.createElement('span');
      cell.className = 'heat-cell level-' + (count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4);
      cell.title = key + (count ? ' · ' + count + ' 条' : '');
      if (cellDate > end) cell.classList.add('future');
      week.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
    wrap.appendChild(week);
  }
  return wrap;
}

// ---------------- 主题 ----------------
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = prefersDark ? 'dark' : 'light';
    root.dataset.themeMode = 'auto';
  } else {
    root.dataset.theme = theme;
    root.dataset.themeMode = theme;
  }
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = root.dataset.themeMode === 'auto' ? '🌓 跟随系统' : (root.dataset.theme === 'dark' ? '☀️ 日间模式' : '🌙 夜间模式');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (document.documentElement.dataset.themeMode === 'auto') applyTheme('auto');
});

// ---------------- 全局事件 ----------------
function bindGlobal() {
  $('#memo-list').addEventListener('click', (e) => {
    const tag = e.target.closest('.fm-tag');
    if (tag) {
      e.preventDefault();
      filterByTag(tag.dataset.tag);
    }
  });

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting) && state.hasMore && !state.loading) {
      loadMore();
    }
  }, { rootMargin: '200px' });
  observer.observe($('#sentinel'));
}

// ---------------- 启动 ----------------
boot();
bindAuthForms();
bindNav();
bindSidebar();
bindSearch();
bindModals();
bindGlobal();