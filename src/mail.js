// 邮件发送：通过 Resend HTTP API 发送验证码邮件。
// 需要 RESEND_API_KEY（Secret）；可选 MAIL_FROM（如 "Flomemos <noreply@example.com>"），
// 未配置 MAIL_FROM 时使用 Resend 沙箱发件人（只能投递到 Resend 账号本人邮箱）。
// 本地开发可设 DEV_EXPOSE_CODE=1：跳过真实发送，把验证码直接返回给前端（仅限开发环境！）。

const CODE_TTL_MS = 10 * 60 * 1000; // 验证码 10 分钟有效
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const encoder = new TextEncoder();

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 生成 4 位数字验证码（含前导零）
export function generateCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
}

function codeEmailHtml(code, purpose) {
  const action = purpose === 'reset' ? '重置密码' : '注册';
  return '<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px">'
    + '<h2 style="margin:0 0 8px;color:#0aa870">Flomemos</h2>'
    + '<p style="margin:0 0 16px;color:#555">你正在' + action + '，验证码为：</p>'
    + '<div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#111;margin:0 0 16px">' + code + '</div>'
    + '<p style="margin:0;color:#999;font-size:13px">验证码 10 分钟内有效。若非本人操作，请忽略本邮件。</p>'
    + '</div>';
}

// 发送验证码。返回 { code, devCode } —— devCode 仅在 DEV_EXPOSE_CODE 开启时非空。
export async function sendVerificationCode(db, env, email, purpose) {
  const table = db.prepare('SELECT last_sent_at, expires_at FROM email_codes WHERE email = ? AND purpose = ?');
  const existing = await table.bind(email, purpose).first();
  const now = Date.now();

  // 同一邮箱同一用途 60 秒内只发一次
  if (existing && now - existing.last_sent_at < 60 * 1000) {
    const wait = Math.ceil((60 * 1000 - (now - existing.last_sent_at)) / 1000);
    return { error: '验证码发送过于频繁，请 ' + wait + ' 秒后再试', status: 429 };
  }

  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = now + CODE_TTL_MS;

  // 覆盖旧验证码（重置尝试次数），并顺带清理过期记录
  await db.batch([
    db.prepare(
      'INSERT INTO email_codes (email, purpose, code_hash, attempts, expires_at, last_sent_at) VALUES (?, ?, ?, 0, ?, ?) '
      + 'ON CONFLICT (email, purpose) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, last_sent_at = excluded.last_sent_at'
    ).bind(email, purpose, codeHash, expiresAt, now),
    db.prepare('DELETE FROM email_codes WHERE expires_at < ?').bind(now),
  ]);

  let devCode = '';
  if (env.DEV_EXPOSE_CODE === '1') {
    devCode = code; // 仅开发环境：跳过真实发送，验证码直出
    return { code, devCode };
  }
  if (!env.RESEND_API_KEY) {
    return { error: '邮件服务未配置（缺少 RESEND_API_KEY），无法发送验证码', status: 501 };
  }

  const from = env.MAIL_FROM || 'Flomemos <onboarding@resend.dev>';
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: (purpose === 'reset' ? '【Flomemos】重置密码验证码：' : '【Flomemos】注册验证码：') + code,
      html: codeEmailHtml(code, purpose),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Resend send failed:', res.status, detail);
    if (res.status === 401 || res.status === 403) {
      return { error: '邮件发送失败：API Key 无效或发件域名未验证', status: 502 };
    }
    return { error: '邮件发送失败，请稍后重试', status: 502 };
  }
  return { code };
}

// 校验验证码：正确且未过期返回 true；错误将消耗一次尝试（最多 5 次）
export async function verifyCode(db, email, purpose, code) {
  const row = await db.prepare('SELECT code_hash, attempts, expires_at FROM email_codes WHERE email = ? AND purpose = ?')
    .bind(email, purpose)
    .first();
  if (!row) return false;
  if (row.expires_at < Date.now()) return false;
  if (row.attempts >= 5) return false;

  const codeHash = await sha256Hex(String(code ?? ''));
  if (codeHash === row.code_hash) {
    await db.prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ?').bind(email, purpose).run();
    return true;
  }
  await db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?').bind(email, purpose).run();
  return false;
}
