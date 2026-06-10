export interface PasswordResetArgs {
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
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
