import type { NoteRow } from './notes';

export interface PasswordResetArgs {
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface WelcomeEmailArgs {
  username: string;
  loginUrl: string;
}

export interface EmailVerificationArgs {
  username: string;
  verifyUrl: string;
  expiresInHours: number;
}

export interface CampaignEmailArgs {
  username: string;
  bodyHtml: string;
  bodyText: string;
  unsubscribeUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// i18n: 中文硬编码；后续 v2 用 react-i18next 抽
export function passwordResetEmail(args: PasswordResetArgs): EmailContent {
  const subject = '重置密码 — 字 ↔ 拼音 工具';
  const safeUser = escapeHtml(args.username);
  // NOTE: escapeAttr HTML-escapes & for safety. Our reset URLs only contain
  // a single ?token=base64url query param (no &), so this is correct in
  // practice. If we ever add multi-param URLs, switch safeUrl to a URL-safe
  // escaper (only " and <) to avoid corrupting the href.
  const safeUrl = escapeAttr(args.resetUrl);
  const safeUrlText = escapeHtml(args.resetUrl);
  const mins = args.expiresInMinutes;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#f9fafb;padding:20px 24px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:600;color:#111827;">字 ↔ 拼音 工具</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:15px;">你好 ${safeUser},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
        你 (或使用此邮箱的人) 申请了重置密码。点击下面的按钮,在 ${mins} 分钟内设置新密码:
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:500;">重置密码</a>
      </p>
      <p style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;">如果按钮无法点击,请复制此链接到浏览器:</p>
      <p style="margin:0;font-family:Menlo,Monaco,Consolas,monospace;font-size:12px;color:#2563eb;word-break:break-all;background:#f9fafb;padding:10px;border-radius:4px;">${safeUrlText}</p>
      <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">链接将在 ${mins} 分钟后失效。</p>
      <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">如果你没有申请重置,请忽略此邮件,你的账号仍然安全。</p>
    </div>
    <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      © ${new Date().getFullYear()} 字 ↔ 拼音 工具
    </div>
  </div>
</body></html>`;

  const text = [
    '字 ↔ 拼音 工具 — 重置密码',
    '',
    `你好 ${args.username},`,
    '',
    `你 (或使用此邮箱的人) 申请了重置密码。请在 ${mins} 分钟内访问下面的链接设置新密码:`,
    '',
    args.resetUrl,
    '',
    `链接将在 ${mins} 分钟后失效。`,
    '',
    '如果你没有申请重置,请忽略此邮件,你的账号仍然安全。',
  ].join('\n');

  return { subject, html, text };
}

// Welcome email — sent right after registration completes.
// Includes a direct login link and a brief feature tour. Soft by design:
// no verification gating. The login link is optional (the user already has
// a session cookie), but providing it makes the welcome useful even when
// the user opens the email on a different device.
export function welcomeEmail(args: WelcomeEmailArgs): EmailContent {
  const subject = '欢迎加入字 ↔ 拼音 工具';
  const safeUser = escapeHtml(args.username);
  const safeUrl = escapeAttr(args.loginUrl);
  const safeUrlText = escapeHtml(args.loginUrl);

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#f9fafb;padding:20px 24px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:600;color:#111827;">字 ↔ 拼音 工具</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:15px;">你好 ${safeUser},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
        欢迎加入字 ↔ 拼音 工具!你的账号已创建成功,可以开始使用了。
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:500;">前往登录</a>
      </p>
      <h3 style="margin:24px 0 8px 0;font-size:15px;color:#111827;">你可以试试这些功能</h3>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.8;color:#374151;">
        <li>字典 — 查询 8105 个规范汉字的拼音、释义、字源</li>
        <li>字帖 — 自定义生成田字格/米字格/描红练习</li>
        <li>经典 — 诵读《诗经》《论语》等蒙学经典</li>
        <li>诗词 — 浏览唐诗宋词,带拼音对照</li>
      </ul>
      <p style="margin:24px 0 8px 0;font-size:13px;color:#6b7280;">如果按钮无法点击,请复制此链接到浏览器:</p>
      <p style="margin:0;font-family:Menlo,Monaco,Consolas,monospace;font-size:12px;color:#2563eb;word-break:break-all;background:#f9fafb;padding:10px;border-radius:4px;">${safeUrlText}</p>
    </div>
    <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      © ${new Date().getFullYear()} 字 ↔ 拼音 工具
    </div>
  </div>
</body></html>`;

  const text = [
    '字 ↔ 拼音 工具 — 欢迎加入',
    '',
    `你好 ${args.username},`,
    '',
    '欢迎加入字 ↔ 拼音 工具!你的账号已创建成功,可以开始使用了。',
    '',
    `登录链接: ${args.loginUrl}`,
    '',
    '你可以试试这些功能:',
    '  · 字典 — 查询 8105 个规范汉字的拼音、释义、字源',
    '  · 字帖 — 自定义生成田字格/米字格/描红练习',
    '  · 经典 — 诵读《诗经》《论语》等蒙学经典',
    '  · 诗词 — 浏览唐诗宋词,带拼音对照',
    '',
    '如果你没有注册此账号,请忽略此邮件。',
  ].join('\n');

  return { subject, html, text };
}

// Email verification — single-purpose email for confirming the user's
// address. Soft verification: no auth gating, just an admin-visible
// "未验证" badge on /admin/users/[id]. The user can still use the site
// even if they ignore this email.
export function emailVerificationEmail(args: EmailVerificationArgs): EmailContent {
  const subject = '请验证你的邮箱 — 字 ↔ 拼音 工具';
  const safeUser = escapeHtml(args.username);
  const safeUrl = escapeAttr(args.verifyUrl);
  const safeUrlText = escapeHtml(args.verifyUrl);
  const hours = args.expiresInHours;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#f9fafb;padding:20px 24px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:600;color:#111827;">字 ↔ 拼音 工具</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:15px;">你好 ${safeUser},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
        感谢你注册字 ↔ 拼音 工具。请点击下面的按钮验证你的邮箱(可选,但有助于账号安全):
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:500;">验证邮箱</a>
      </p>
      <p style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;">如果按钮无法点击,请复制此链接到浏览器:</p>
      <p style="margin:0;font-family:Menlo,Monaco,Consolas,monospace;font-size:12px;color:#2563eb;word-break:break-all;background:#f9fafb;padding:10px;border-radius:4px;">${safeUrlText}</p>
      <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">链接将在 ${hours} 小时后失效。</p>
      <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">即使不验证,你也已经可以正常使用网站。如果你没有注册此账号,请忽略此邮件。</p>
    </div>
    <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      © ${new Date().getFullYear()} 字 ↔ 拼音 工具
    </div>
  </div>
</body></html>`;

  const text = [
    '字 ↔ 拼音 工具 — 请验证你的邮箱',
    '',
    `你好 ${args.username},`,
    '',
    `感谢你注册字 ↔ 拼音 工具。请在 ${hours} 小时内访问下面的链接验证邮箱(可选):`,
    '',
    args.verifyUrl,
    '',
    '即使不验证,你也可以正常使用网站。',
    '',
    '如果你没有注册此账号,请忽略此邮件。',
  ].join('\n');

  return { subject, html, text };
}

// Marketing campaign email — wraps an admin-authored HTML body with the
// site chrome + footer unsubscribe link. The body is trusted (admin only)
// but we still escape any {username} interpolation defensively.
export function campaignEmail(args: CampaignEmailArgs): EmailContent {
  const safeUser = escapeHtml(args.username);
  const safeUnsub = escapeAttr(args.unsubscribeUrl);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#f9fafb;padding:20px 24px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:600;color:#111827;">字 ↔ 拼音 工具</div>
    </div>
    <div style="padding:24px;font-size:15px;line-height:1.7;color:#1f2937;">
      <p style="margin:0 0 12px 0;">你好 ${safeUser},</p>
      ${args.bodyHtml}
    </div>
    <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      <p style="margin:0 0 6px 0;">© ${new Date().getFullYear()} 字 ↔ 拼音 工具</p>
      <p style="margin:0;">
        <a href="${safeUnsub}" style="color:#6b7280;text-decoration:underline;">退订邮件通知</a>
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `你好 ${args.username},`,
    '',
    args.bodyText,
    '',
    '—',
    `退订邮件通知: ${args.unsubscribeUrl}`,
  ].join('\n');

  // Subject is decided by the campaign, not the template.
  return { subject: '', html, text };
}

/**
 * Renders the admin notification email for a new public note.
 * Pure function — no DB / nodemailer import — so the template can also be
 * unit-tested without the network.
 */
export function notesNotificationEmail(note: {
  id: number;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: Date;
  ip: string | null;
}): { subject: string; html: string; text: string } {
  const when = note.createdAt.toISOString();
  const safeContent = note.content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  const subject = `[留言笔记] 新留言 #${note.id} — ${note.authorName}`;
  const text = [
    `作者: ${note.authorName}${note.authorEmail ? ` <${note.authorEmail}>` : ''}`,
    `时间: ${when}`,
    note.ip ? `IP:   ${note.ip}` : '',
    '',
    '内容:',
    note.content,
    '',
    `管理: /admin/notes`,
  ].filter((l) => l !== null && l !== undefined).join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif">
<h2>新留言 #${note.id}</h2>
<p><b>作者:</b> ${escapeHtml(note.authorName)}${note.authorEmail ? ` &lt;${escapeHtml(note.authorEmail)}&gt;` : ''}</p>
<p><b>时间:</b> ${when}</p>
${note.ip ? `<p><b>IP:</b> ${escapeHtml(note.ip)}</p>` : ''}
<hr/>
<div style="white-space:pre-wrap">${safeContent}</div>
<hr/>
<p><a href="/admin/notes">前往管理 →</a></p>
</body></html>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
