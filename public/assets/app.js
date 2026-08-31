// Flomemos 前端入口：登录注册 / 笔记列表 / 编辑器 / 标签 / 搜索 / 统计 / 回顾 / 用户管理

import { api, ApiError } from './api.js';
import { renderMemoHtml, escapeHtml } from './md.js';
import { MarkdownEditor } from './editor.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  email: '',
  role: 'user',
  view: 'all', // all | pinned | tag
  tag: '',
  q: '',
  memos: [],
  hasMore: false,
  nextBefore: 0,
  loading: false,
  tags: [], // [{tag, count}]
};

// ---------------- 工具 ----------------
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
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

function dayInfo(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let label;
  if (diffDays === 0) label = '今天';
  else if (diffDays === 1) label = '昨天';
  else {
    label = (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '年' : '') +
      (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + weekdays[d.getDay()];
  }
  const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  return { label, key };
}

function handleActionError(err) {
  if (err instanceof ApiError && (err.status === 401 || err.code === 'banned')) return; // 已由全局事件处理
  toast(err.message, 'error');
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
  applyTheme(localStorage.getItem('fm-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  try {
    const me = await api('/api/me');
    if (me.authenticated) enterApp({ email: me.email, role: me.role });
    else showAuth({ mode: me.hasUsers ? 'login' : 'register', hideTabs: !me.hasUsers, showAdminHint: !me.hasUsers });
  } catch (err) {
    showAuth({ mode: 'login' });
    toast(err.message || '加载失败', 'error');
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
  mainEditor = new MarkdownEditor($('#editor-mount'), {
    placeholder: '记录想法… 用 #标签 归类',
    submitText: '记录',
    getTags: () => state.tags.map((t) => t.tag),
    uploadImage: uploadImage,
    onSubmit: async (text) => {
      const res = await api('/api/memos', { method: 'POST', body: { content: text } });
      await refreshTags();
      updateTotalCount();
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

async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await api('/api/upload', { method: 'POST', body: form });
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
  renderMemoList();
  await loadMore();
}

async function loadMore() {
  if (state.loading) return;
  state.loading = true;
  $('#sentinel').classList.remove('hidden');
  try {
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (state.nextBefore) params.set('before', String(state.nextBefore));
    if (state.view === 'pinned') params.set('pinned', '1');
    if (state.view === 'tag' && state.tag) params.set('tag', state.tag);
    if (state.q) params.set('q', state.q);

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
    empty.innerHTML = state.q
      ? '<p>没有找到与「' + escapeHtml(state.q) + '」相关的笔记</p>'
      : '<p class="list-empty-main">还没有笔记</p><p>在上方写下第一条想法吧，用 #标签 归类 ✨</p>';
    list.appendChild(empty);
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
  $('#sentinel').classList.toggle('hidden', !state.hasMore);
}

function renderMemoCard(memo) {
  const card = document.createElement('article');
  card.className = 'memo-card';
  card.dataset.id = memo.id;

  const body = document.createElement('div');
  body.className = 'memo-content md-body';
  body.innerHTML = renderMemoHtml(memo.content);
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

  const actions = document.createElement('span');
  actions.className = 'memo-actions';
  actions.appendChild(actionBtn('⭐', memo.pinned ? '取消收藏' : '收藏', () => togglePin(memo)));
  actions.appendChild(actionBtn('✏️', '编辑', () => editMemo(card, memo)));
  actions.appendChild(actionBtn('📋', '复制', () => copyMemo(memo)));
  actions.appendChild(actionBtn('🗑', '删除', () => deleteMemo(memo)));
  right.appendChild(actions);

  const time = document.createElement('span');
  time.className = 'memo-time';
  time.textContent = fmtTime(memo.created_at);
  time.title = fmtFull(memo.created_at);
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
  b.addEventListener('click', onClick);
  return b;
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
  if (!confirm('确定删除这条笔记吗？删除后不可恢复。')) return;
  try {
    await api('/api/memos/' + memo.id, { method: 'DELETE' });
    state.memos = state.memos.filter((m) => m.id !== memo.id);
    renderMemoList();
    await refreshTags();
    updateTotalCount();
    toast('已删除');
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
    const res = await api('/api/tags');
    state.tags = res.tags;
    renderTagList();
  } catch {
    // 忽略：标签加载失败不阻塞主流程
  }
}

function renderTagList() {
  const wrap = $('#tag-list');
  wrap.innerHTML = '';
  if (!state.tags.length) {
    const p = document.createElement('p');
    p.className = 'tag-empty';
    p.textContent = '暂无标签，在笔记里用 #标签 即可创建';
    wrap.appendChild(p);
    return;
  }
  for (const t of state.tags) {
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
    wrap.appendChild(item);
  }
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
        state.view = 'all';
        state.tag = '';
        state.q = '';
        $('#search-input').value = '';
        $('#search-clear').classList.add('hidden');
        setNavActive('all');
        renderTagList();
        reloadMemos();
      } else if (nav === 'pinned') {
        state.view = 'pinned';
        state.tag = '';
        setNavActive('pinned');
        renderTagList();
        reloadMemos();
      } else if (nav === 'review') {
        openReview();
      } else if (nav === 'stats') {
        openStats();
      } else if (nav === 'admin') {
        openAdmin();
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
    const dark = document.documentElement.dataset.theme !== 'dark';
    applyTheme(dark ? 'dark' : 'light');
    localStorage.setItem('fm-theme', dark ? 'dark' : 'light');
  });

  $('#export-md').addEventListener('click', () => downloadExport('md'));
  $('#export-json').addEventListener('click', () => downloadExport('json'));

  $('#logout').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* 忽略 */ }
    location.reload();
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
    el.addEventListener('click', () => {
      $('#' + el.dataset.close).classList.add('hidden');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#review-modal').classList.add('hidden');
      $('#stats-modal').classList.add('hidden');
      $('#admin-modal').classList.add('hidden');
    }
  });
  $('#review-refresh').addEventListener('click', loadReview);
  $('#admin-refresh').addEventListener('click', loadUsers);
}

function openReview() {
  $('#review-modal').classList.remove('hidden');
  loadReview();
}

async function loadReview() {
  const body = $('#review-body');
  body.innerHTML = '<p class="modal-tip">加载中…</p>';
  try {
    const res = await api('/api/memos/random?limit=5');
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
  try {
    const res = await api('/api/admin/users');
    body.innerHTML = '';
    const table = document.createElement('div');
    table.className = 'admin-table';
    for (const u of res.users) {
      table.appendChild(renderUserRow(u));
    }
    body.appendChild(table);
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
  meta.textContent = u.memo_count + ' 条笔记 · 注册于 ' + (u.created_at || '').slice(0, 10);
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
    delBtn.addEventListener('click', () => deleteUser(u));
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
  } catch (err) {
    handleActionError(err);
  }
}

async function deleteUser(u) {
  if (!confirm('确定删除用户「' + u.email + '」吗？\n其全部笔记与图片将一并删除，不可恢复。')) return;
  try {
    await api('/api/admin/users/' + u.id, { method: 'DELETE' });
    loadUsers();
    toast('已删除用户 ' + u.email);
  } catch (err) {
    handleActionError(err);
  }
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
      c.appendChild(num);
      c.appendChild(lab);
      cards.appendChild(c);
    }
    body.appendChild(cards);

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
  // 从周一对齐
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
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').textContent = theme === 'dark' ? '☀️ 日间模式' : '🌙 夜间模式';
}

// ---------------- 全局事件 ----------------
function bindGlobal() {
  // 正文中的 #标签 点击过滤
  $('#memo-list').addEventListener('click', (e) => {
    const tag = e.target.closest('.fm-tag');
    if (tag) {
      e.preventDefault();
      filterByTag(tag.dataset.tag);
    }
  });

  // 无限滚动
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
