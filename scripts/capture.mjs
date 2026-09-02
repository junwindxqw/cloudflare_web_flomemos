// 自动启动本地 wrangler dev 并截取主要界面截图。
// 用法: CAPTURE_PASSWORD=demo12345 npm run capture
//
// 依赖:已安装 npm 依赖;已安装系统级浏览器(默认 Edge,改 EXECUTABLE_PATH 即可)
//
// 截图输出到 docs/screenshots/01-main.png ... 06-preview.png。README 引用其中几张。

import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const WRANGLER_BIN = resolve(PROJECT_ROOT, 'node_modules/.bin/wrangler');

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = resolve(PROJECT_ROOT, 'docs/screenshots');
const EXECUTABLE_PATH = process.env.EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

if (!process.env.CAPTURE_PASSWORD) {
  console.error('错误: 请先设置 CAPTURE_PASSWORD 环境变量(仅本地 dev 用占位密码)');
  console.error('  CAPTURE_PASSWORD=demo12345 npm run capture');
  process.exit(1);
}

function startDev() {
  const proc = spawn(WRANGLER_BIN, ['dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
    shell: process.platform === 'win32',
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  return proc;
}

// Windows 下 proc.kill() 只杀 shell 不杀 node/workerd 子进程树，会留下僵尸实例
// 占住 dev registry，导致下一次 spawn 的 wrangler "already registered" 而挂起。
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill('SIGTERM');
  }
}

async function waitForReady(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev 在 ' + timeoutMs + 'ms 内未就绪');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const dev = startDev();
  const cleanup = () => { try { killTree(dev); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    console.log('等待 wrangler dev 就绪...');
    await waitForReady(BASE + '/api/me');

    const browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 800 },
    });

    try {
      const page = await browser.newPage();
      const password = process.env.CAPTURE_PASSWORD;

      async function shot(name) {
        const file = `${OUT_DIR}/${name}.png`;
        await page.screenshot({ path: file, fullPage: false });
        console.log('  ✓', name);
      }

      console.log('打开', BASE);
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#auth-view', { timeout: 5000 });

      const email = `demo-${Date.now()}@flomemos.test`;
      console.log('注册', email);
      await page.click('[data-tab="register"]');
      await page.waitForSelector('#register-form:not(.hidden)', { timeout: 3000 });
      await page.type('#register-email', email);
      await page.click('#register-send');
      await page.waitForFunction(
        () => document.querySelector('#register-code').value.length === 4,
        { timeout: 5000 }
      );
      await page.type('#register-password', password);
      await page.type('#register-password2', password);
      await page.click('#register-form button[type="submit"]');
      await page.waitForSelector('#main-view:not(.hidden)', { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 600));
      await shot('01-main');

      const samples = [
        '今天读完了《人类简史》第三章,讲的是 #读书 的起源',
        '工作笔记:\n- 完成 #工作/项目A 需求评审\n- 提了 PR,等同事 review',
        '周末去了 #生活/咖啡馆,点了杯 #购物/手冲,味道不错',
      ];
      for (const t of samples) {
        await page.click('textarea.md-input');
        await page.evaluate((text) => {
          const i = document.querySelector('textarea.md-input');
          i.value = text;
          i.dispatchEvent(new Event('input', { bubbles: true }));
        }, t);
        await new Promise((r) => setTimeout(r, 200));
        await page.click('.md-footer button.btn-primary');
        await new Promise((r) => setTimeout(r, 500));
      }
      await shot('02-list');

      console.log('统计面板');
      await page.click('[data-nav="stats"]');
      await page.waitForSelector('#stats-modal:not(.hidden)', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 800));
      await shot('03-stats');
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));

      console.log('随机回顾');
      await page.click('[data-nav="review"]');
      await page.waitForSelector('#review-modal:not(.hidden)', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 600));
      await shot('04-review');
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));

      console.log('搜索');
      await page.type('#search-input', '读书');
      await new Promise((r) => setTimeout(r, 800));
      await shot('05-search');
      await page.click('#search-clear');
      await new Promise((r) => setTimeout(r, 300));

      console.log('预览');
      await page.click('textarea.md-input');
      await page.evaluate(() => {
        const i = document.querySelector('textarea.md-input');
        i.value = '预览测试 #演示\n\n- a\n- b\n\n[链接](https://example.com)';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 300));
      await page.click('[data-cmd="preview"]');
      await new Promise((r) => setTimeout(r, 500));
      await shot('06-preview');
    } finally {
      await browser.close();
    }
  } finally {
    cleanup();
  }
  console.log('\n完成。截图在', OUT_DIR);
}

main().catch((err) => { console.error(err); process.exit(1); });