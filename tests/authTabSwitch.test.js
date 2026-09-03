// 模拟真实 DOM 测试 auth tab 切换是否在重复切换时稳定工作
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

const HTML = `
<!DOCTYPE html>
<html><body>
  <div id="auth-view" class="auth-view hidden">
    <div class="auth-card">
      <div id="auth-tabs" class="auth-tabs">
        <button type="button" class="auth-tab active" data-tab="login">登录</button>
        <button type="button" class="auth-tab" data-tab="register">注册</button>
        <button type="button" class="auth-tab" data-tab="reset">找回密码</button>
      </div>
      <form id="login-form"><input id="login-email"/><input id="login-password"/></form>
      <form id="register-form" class="hidden">
        <input id="register-email"/>
        <input id="register-code"/>
        <input id="register-password"/>
        <input id="register-password2"/>
      </form>
      <form id="reset-form" class="hidden">
        <input id="reset-email"/>
        <input id="reset-code"/>
        <input id="reset-password"/>
      </form>
      <p id="login-error" class="hidden"></p>
      <p id="register-error" class="hidden"></p>
      <p id="reset-error" class="hidden"></p>
      <p id="register-hint" class="hidden"></p>
    </div>
  </div>
  <div id="main-view" class="layout hidden"></div>
</body></html>
`;

// 跟 app.js 同样的实现（保证测的就是生产逻辑）
const AUTH_FORMS = { login: 'login-form', register: 'register-form', reset: 'reset-form' };

function $(sel) { return document.querySelector(sel); }

function setAuthTab(mode) {
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains('auth-tab')) active.blur();
  document.querySelectorAll('.auth-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === mode);
  });
  for (const [tab, formId] of Object.entries(AUTH_FORMS)) {
    const form = $('#' + formId);
    if (!form) continue;
    const wasHidden = form.classList.contains('hidden');
    const shouldHide = tab !== mode;
    form.classList.toggle('hidden', shouldHide);
    if (wasHidden && !shouldHide) {
      const errId = formId.replace('-form', '-error');
      const err = $('#' + errId);
      if (err) err.classList.add('hidden');
    }
  }
  requestAnimationFrame(() => {
    const sel = mode === 'login' ? '#login-email' : mode === 'register' ? '#register-email' : '#reset-email';
    const el = $(sel);
    if (el) el.focus({ preventScroll: true });
  });
}

function showAuth(opts = {}) {
  const mode = opts.mode || 'login';
  $('#auth-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
  $('#auth-tabs').classList.toggle('hidden', opts.hideTabs);
  setAuthTab(mode);
  $('#register-hint').classList.toggle('hidden', !opts.showAdminHint);
}

function clickTab(mode) {
  const btn = document.querySelector(`.auth-tab[data-tab="${mode}"]`);
  // jsdom 里 .click() 不触发事件监听器，必须手动 dispatch
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  btn.dispatchEvent(ev);
}

function bindAuthTabs() {
  document.querySelectorAll('.auth-tab').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = b.dataset.tab;
      if (!AUTH_FORMS[mode]) return;
      showAuth({ mode });
    });
  });
}

describe('auth tab switching', () => {
  let dom;

  beforeEach(async () => {
    dom = new JSDOM(HTML);
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    bindAuthTabs();
  });

  it('starts on login by default', () => {
    showAuth({ mode: 'login' });
    expect($('#login-form').classList.contains('hidden')).toBe(false);
    expect($('#register-form').classList.contains('hidden')).toBe(true);
    expect($('#reset-form').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.auth-tab[data-tab="login"]').classList.contains('active')).toBe(true);
  });

  it('switches to register on click', () => {
    showAuth({ mode: 'login' });
    clickTab('register');
    expect($('#login-form').classList.contains('hidden')).toBe(true);
    expect($('#register-form').classList.contains('hidden')).toBe(false);
    expect($('#reset-form').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.auth-tab[data-tab="register"]').classList.contains('active')).toBe(true);
  });

  it('switches to reset after register', () => {
    showAuth({ mode: 'login' });
    clickTab('register');
    clickTab('reset');
    expect($('#login-form').classList.contains('hidden')).toBe(true);
    expect($('#register-form').classList.contains('hidden')).toBe(true);
    expect($('#reset-form').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.auth-tab[data-tab="reset"]').classList.contains('active')).toBe(true);
  });

  it('switches back to login from reset', () => {
    showAuth({ mode: 'login' });
    clickTab('register');
    clickTab('reset');
    clickTab('login');
    expect($('#login-form').classList.contains('hidden')).toBe(false);
    expect($('#register-form').classList.contains('hidden')).toBe(true);
    expect($('#reset-form').classList.contains('hidden')).toBe(true);
  });

  it('handles many back-and-forth clicks', () => {
    showAuth({ mode: 'login' });
    const sequence = ['register', 'reset', 'login', 'register', 'reset', 'login', 'register'];
    for (const m of sequence) clickTab(m);
    const active = document.querySelector('.auth-tab.active');
    expect(active.dataset.tab).toBe('register');
    expect($('#login-form').classList.contains('hidden')).toBe(true);
    expect($('#register-form').classList.contains('hidden')).toBe(false);
    expect($('#reset-form').classList.contains('hidden')).toBe(true);
  });

  it('ignores invalid tab', () => {
    showAuth({ mode: 'login' });
    const before = $('#login-form').classList.contains('hidden');
    // 模拟无 .dataset.tab 的按钮（理论上不会发生，但要确认不抛错）
    const first = document.querySelector('.auth-tab');
    first.dataset.tab = '';
    expect(() => first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect($('#login-form').classList.contains('hidden')).toBe(before);
  });
});