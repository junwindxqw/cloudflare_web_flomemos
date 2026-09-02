import { describe, it, expect, beforeEach } from 'vitest';
import { t, getLocale, setLocale, supportedLocales } from '../public/assets/i18n.js';

describe('i18n', () => {
  beforeEach(() => {
    // 清空 DOM 状态
    document.documentElement.lang = '';
    document.querySelectorAll('[data-i18n],[data-i18n-placeholder]').forEach((el) => {
      if (el.dataset.i18n) el.textContent = '';
      if (el.dataset.i18nPlaceholder) el.placeholder = '';
    });
  });

  it('defaults to zh-CN', () => {
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(t('btn.record')).toBe('记录');
  });

  it('falls back to zh-CN for unsupported locale', async () => {
    await setLocale('fr-FR');
    expect(getLocale()).toBe('zh-CN');
  });

  it('returns English strings when locale is en', async () => {
    await setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('btn.record')).toBe('Record');
    expect(t('placeholder.memo')).toContain('Capture');
  });

  it('returns the key itself when translation missing', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('applies data-i18n and data-i18n-placeholder to DOM nodes', async () => {
    document.body.innerHTML = `
      <h1 data-i18n="btn.record"></h1>
      <input data-i18n-placeholder="placeholder.memo">
    `;
    await setLocale('en');
    expect(document.querySelector('h1').textContent).toBe('Record');
    expect(document.querySelector('input').placeholder).toContain('Capture');

    await setLocale('zh-CN');
    expect(document.querySelector('h1').textContent).toBe('记录');
    expect(document.querySelector('input').placeholder).toContain('想法');
  });

  it('updates document.documentElement.lang', async () => {
    await setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    await setLocale('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('exports supportedLocales list', () => {
    expect(Array.isArray(supportedLocales)).toBe(true);
    expect(supportedLocales).toContain('zh-CN');
    expect(supportedLocales).toContain('en');
  });
});