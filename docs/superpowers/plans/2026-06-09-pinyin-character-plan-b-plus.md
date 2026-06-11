# Plan B+: 密码找回 + 管理员后台 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan B 的账号系统上补两块功能：(1) 自助密码找回（magic link + SMTP/控制台）；(2) 管理员后台（用户管理 / 审计日志 / 系统统计 + 3 个写操作）。

**Architecture:** 新增一张 `password_resets` 表（存 SHA-256 hash，不存明文 token）。`is_admin` 不进 JWT，每次 admin 请求现查 DB（防止降权滞后）。所有 `/api/admin/*` 与 `app/admin/*` 页面用统一的 `requireAdmin()` 守卫（discriminated union 同时支持 API 和 page）。邮件发送用 nodemailer，`MAIL_TRANSPORT=console|smtp` env 切换。

**Tech Stack:** 复用 mysql2/bcryptjs/jsonwebtoken/zustand。**新增依赖** `nodemailer`（自带 types）。React 19, Tailwind 4, Vitest。

**Out of scope:** OAuth、密码强制轮换、RBAC、国际化（v1 全部中文）、多实例共享的 rate limit（in-memory 即可）。

**Pre-requisites:**
- Node 20+, pnpm 9+
- 项目根目录：`E:\ToolDevelop\PinYinCharacter`
- Plan B 已完成（22 commits 在 main，`main` 分支）
- MySQL 8+ 可选；无 MySQL 时集成测试 skip
- **重要**：`.env` 已配置 `DATABASE_URL` + `JWT_SECRET`（Plan B 阶段已写）
- 重要：dev 端口是 **5555**（不是默认 3000）

---

## 文件结构（Plan B+ 完成后）

```
app/
  api/
    auth/
      forgot/route.ts                 +   (POST: 申请重置邮件)
      reset-info/route.ts             +   (GET: 校验 token 合法性)
      reset/route.ts                  +   (POST: 提交新密码)
      me/route.ts                     ~   (返回 isAdmin)
    admin/
      users/route.ts                  +   (GET: 列表)
      users/[id]/route.ts             +   (GET 详情 / DELETE 用户)
      users/[id]/reset-password/route.ts  +   (POST: 生成临时密码)
      users/[id]/promote/route.ts     +   (POST: 设为 admin)
      users/[id]/demote/route.ts      +   (POST: 撤销 admin)
      audit/route.ts                  +   (GET: 审计日志)
      stats/route.ts                  +   (GET: 系统统计)
  forgot-password/page.tsx            +   (公开)
  reset-password/page.tsx             +   (公开)
  admin/
    layout.tsx                        +   (requireAdmin + 侧栏)
    page.tsx                          +   (redirect → /admin/users)
    users/page.tsx                    +
    users/[id]/page.tsx               +
    audit/page.tsx                    +
    stats/page.tsx                    +
components/
  AdminNav.tsx                        +
  DeleteUserDialog.tsx                +
  ResetPasswordDialog.tsx             +
  ConfirmDialog.tsx                   +
  UserMenu.tsx                        ~   (管理员显示「管理后台」链接)
lib/
  auth.ts                             ~   (+ getCurrentUserWithAdmin, requireAdmin)
  store.ts                            ~   (User.isAdmin?: boolean)
  password-reset.ts                   +   (token 生成/哈希/校验/读写)
  ratelimit.ts                        +   (in-memory 1/60s/IP)
  email.ts                            +   (sendEmail + 错误类)
  email-templates.ts                  +   (HTML 模板)
  admin.ts                            +   (listUsers / getUserDetail / getAuditLog / getSystemStats)
  api-admin.ts                        +   (admin fetch wrappers)
  api-auth.ts                         ~   (+ forgotPasswordRequest / resetPasswordRequest / getResetInfoRequest)
scripts/
  init-db.ts                          ~   (+ password_resets 表 DDL)
tests/
  unit/lib/
    password-reset.test.ts            +
    ratelimit.test.ts                 +
    email.test.ts                     +
    email-templates.test.ts           +
    admin.test.ts                     +
  integration/
    password-reset.test.ts            +
    admin-crud.test.ts                +
    setup.ts                          ~   (+ truncate password_resets)
.env.example                          ~   (mail env)
README.md                             ~   (新章节)
package.json                          ~   (+ nodemailer)
```

---

## 复用（Plan B 已有，直接 import）

- `lib/auth.ts`：`signSession` / `setSessionCookie` / `hashPassword` / `verifyPassword` / `validateUsername` / `validatePassword` / `getCurrentUser`
- `lib/audit.ts`：`writeAudit`（plan B+ 扩展 `AuditEvent` union）
- `lib/db.ts`：`getPool` / `closePool`
- `lib/store.ts`：`useAppStore`
- `lib/api-auth.ts`：现有 fetch wrapper 模式（call() + ApiResult 联合）
- `tests/integration/setup.ts`：`integrationDescribe` / `uniqueUsername` / `truncateAll`（需扩展 + `password_resets`）

---

## 测试基础设施

Plan B 已有的 `tests/integration/setup.ts` 用 `DATABASE_URL_TEST` env 标识测试库。**无该 env 时所有集成测试 skip**。Plan B+ 沿用同样机制。

新 `truncateAll` 必须 truncate `password_resets` 表。

---

## Task 1: 安装 nodemailer + 扩展 .env.example

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\package.json`
- Modify: `E:\ToolDevelop\PinYinCharacter\.env.example`

- [ ] **Step 1: 安装依赖**

```bash
cd E:/ToolDevelop/PinYinCharacter
pnpm add nodemailer
```

（`nodemailer` 自带 types，不需要 `@types/nodemailer`。）

- [ ] **Step 2: 扩展 `.env.example`**

在文件末尾追加（不要删 Plan B 的内容）：

```env
# 邮件 (Plan B+ 必需 for SMTP mode)
MAIL_TRANSPORT=console               # console | smtp
SMTP_HOST=                           # MAIL_TRANSPORT=smtp 时必填
SMTP_PORT=587
SMTP_SECURE=false                    # true for port 465
SMTP_USER=
SMTP_PASS=
MAIL_FROM=noreply@example.com        # MAIL_TRANSPORT=smtp 时必填
MAIL_FROM_NAME=字 ↔ 拼音 工具
```

- [ ] **Step 3: 确认 package.json 有新依赖**

```bash
grep -A1 '"nodemailer"' package.json
```

期望：dependencies 块里有 `"nodemailer": "^x.y.z"`。

- [ ] **Step 4: 跑测试确认 Plan B 没坏**

```bash
pnpm test
```

期望：43+ unit 仍全过，集成测试照旧 skip。

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example pnpm-lock.yaml
git commit -m "feat(deps): add nodemailer + mail env vars"
```

---

## Task 2: 扩展 init-db 加 password_resets 表

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\scripts\init-db.ts`
- Modify: `E:\ToolDevelop\PinYinCharacter\tests\integration\setup.ts`

- [ ] **Step 1: 加 DDL**

在 `scripts/init-db.ts` 的 `DDL` 数组里追加（第 4 条）：

```ts
  `CREATE TABLE IF NOT EXISTS password_resets (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     token_hash CHAR(64) NOT NULL,
     expires_at TIMESTAMP NOT NULL,
     used_at TIMESTAMP NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_pr_user (user_id),
     KEY idx_pr_expires (expires_at),
     CONSTRAINT fk_pr_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
```

- [ ] **Step 2: 扩展 integration setup 的 truncateAll**

在 `tests/integration/setup.ts` 里改 `truncateAll`：

```ts
export async function truncateAll(): Promise<void> {
  if (!HAS_DB) return;
  const pool = getPool();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE TABLE history');
  await pool.query('TRUNCATE TABLE users');
  await pool.query('TRUNCATE TABLE audit_log');
  await pool.query('TRUNCATE TABLE password_resets');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}
```

- [ ] **Step 3: 跑测试确认 schema 改动不影响老测试**

```bash
pnpm test
```

期望：仍全过。

- [ ] **Step 4: Commit**

```bash
git add scripts/init-db.ts tests/integration/setup.ts
git commit -m "feat(db): add password_resets table + truncate"
```

---

## Task 3: lib/ratelimit.ts（in-memory 1/60s/IP）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\ratelimit.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\ratelimit.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/ratelimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('first call returns true', () => {
    expect(checkRateLimit('1.1.1.1', 60_000)).toBe(true);
  });

  it('second call within window returns false', () => {
    expect(checkRateLimit('2.2.2.2', 60_000)).toBe(true);
    expect(checkRateLimit('2.2.2.2', 60_000)).toBe(false);
  });

  it('different IPs are independent', () => {
    expect(checkRateLimit('3.3.3.3', 60_000)).toBe(true);
    expect(checkRateLimit('4.4.4.4', 60_000)).toBe(true);
  });

  it('after window expires, allows again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(checkRateLimit('5.5.5.5', 60_000)).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit('5.5.5.5', 60_000)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
pnpm test tests/unit/lib/ratelimit.test.ts
```

期望：FAIL (`checkRateLimit` 不存在)。

- [ ] **Step 3: 实现 `lib/ratelimit.ts`**

```ts
const last = new Map<string, number>();

/**
 * True if this key has not hit the endpoint within `windowMs` of its last call.
 * False otherwise. In-memory only — restart wipes the window (acceptable for v1).
 */
export function checkRateLimit(key: string, windowMs: number): boolean {
  const now = Date.now();
  const prev = last.get(key);
  if (prev !== undefined && now - prev < windowMs) return false;
  last.set(key, now);
  return true;
}
```

- [ ] **Step 4: 跑测试确认 pass**

```bash
pnpm test tests/unit/lib/ratelimit.test.ts
```

期望：4/4 通过。

- [ ] **Step 5: Commit**

```bash
git add lib/ratelimit.ts tests/unit/lib/ratelimit.test.ts
git commit -m "feat(lib): in-memory rate limit (1/60s/key)"
```

---

## Task 4: lib/email.ts（sendEmail + 错误类）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\email.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\email.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';

describe('sendEmail', () => {
  const origEnv = { ...process.env };
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.env = { ...origEnv };
    consoleSpy.mockClear();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('MAIL_TRANSPORT=console writes to console.log', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>x</p>', text: 'x' });
    expect(consoleSpy).toHaveBeenCalled();
    const out = consoleSpy.mock.calls[0].join(' ');
    expect(out).toContain('a@b.com');
    expect(out).toContain('hi');
  });

  it('defaults to console when MAIL_TRANSPORT unset', async () => {
    delete process.env.MAIL_TRANSPORT;
    await sendEmail({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('MAIL_TRANSPORT=smtp + missing SMTP_HOST throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_HOST;
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('MAIL_TRANSPORT=foo throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'foo';
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});
```

- [ ] **Step 2: 跑测试 fail**

```bash
pnpm test tests/unit/lib/email.test.ts
```

- [ ] **Step 3: 实现 `lib/email.ts`**

```ts
import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  code = 'email_not_configured' as const;
}
export class EmailSendError extends Error {
  code = 'email_send_failed' as const;
}

let cachedTransport: Transporter | null = null;

function buildTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host) throw new EmailNotConfiguredError('SMTP_HOST is not set');
  cachedTransport = nodemailer.createTransport({
    host, port, secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  return cachedTransport;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const transport = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase();

  if (transport === 'console') {
    console.log(`[email] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    return;
  }

  if (transport !== 'smtp') {
    throw new EmailNotConfiguredError(`Unknown MAIL_TRANSPORT: ${transport}`);
  }

  try {
    const tx = buildTransport();
    const fromName = process.env.MAIL_FROM_NAME ?? '';
    const fromAddr = process.env.MAIL_FROM;
    if (!fromAddr) throw new EmailNotConfiguredError('MAIL_FROM is not set');
    await tx.sendMail({
      from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) throw e;
    // 重建 transport（避免一次失败后卡住）
    cachedTransport = null;
    throw new EmailSendError(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: 跑测试 pass**

```bash
pnpm test tests/unit/lib/email.test.ts
```

期望：4/4 通过。

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts tests/unit/lib/email.test.ts
git commit -m "feat(email): sendEmail with console/smtp transport + errors"
```

---

## Task 5: lib/email-templates.ts（passwordResetEmail）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\email-templates.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\email-templates.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { passwordResetEmail } from '@/lib/email-templates';

describe('passwordResetEmail', () => {
  const args = { username: 'alice', resetUrl: 'https://x.com/reset?token=abc', expiresInMinutes: 15 };

  it('subject mentions 密码', () => {
    expect(passwordResetEmail(args).subject).toMatch(/密码/);
  });

  it('html contains username and the reset URL twice (button + fallback)', () => {
    const html = passwordResetEmail(args).html;
    expect(html).toContain('alice');
    expect(html).toContain('https://x.com/reset?token=abc');
    expect(html).toMatch(/<a [^>]*href="https:\/\/x\.com\/reset\?token=abc"/);
  });

  it('html mentions expiry in minutes', () => {
    expect(passwordResetEmail(args).html).toContain('15 分钟');
  });

  it('text contains username, URL, and expiry', () => {
    const text = passwordResetEmail(args).text;
    expect(text).toContain('alice');
    expect(text).toContain('https://x.com/reset?token=abc');
    expect(text).toContain('15 分钟');
  });
});
```

- [ ] **Step 2: 跑测试 fail**

```bash
pnpm test tests/unit/lib/email-templates.test.ts
```

- [ ] **Step 3: 实现 `lib/email-templates.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试 pass**

```bash
pnpm test tests/unit/lib/email-templates.test.ts
```

期望：4/4 通过。

- [ ] **Step 5: Commit**

```bash
git add lib/email-templates.ts tests/unit/lib/email-templates.test.ts
git commit -m "feat(email): password reset HTML + text template"
```

---

## Task 6: lib/password-reset.ts（token 生成/校验/CRUD）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\password-reset.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\password-reset.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import {
  generateResetToken, hashResetToken,
  RESET_TTL_MINUTES, TOKEN_MIN_LENGTH,
} from '@/lib/password-reset';

describe('password-reset primitives', () => {
  it('generateResetToken returns base64url with min length', () => {
    const t = generateResetToken();
    expect(t.length).toBeGreaterThanOrEqual(TOKEN_MIN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls return different tokens', () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });

  it('hashResetToken is deterministic and 64 hex chars', () => {
    const h = hashResetToken('abc');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(hashResetToken('abc')).toBe(h);
  });

  it('hashResetToken changes with different input', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('xyz'));
  });

  it('RESET_TTL_MINUTES is 15', () => {
    expect(RESET_TTL_MINUTES).toBe(15);
  });
});
```

- [ ] **Step 2: 跑测试 fail**

```bash
pnpm test tests/unit/lib/password-reset.test.ts
```

- [ ] **Step 3: 实现 `lib/password-reset.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';

export const RESET_TTL_MINUTES = 15;
export const TOKEN_MIN_LENGTH = 32;

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface ResetRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export async function createResetRow(userId: number, rawToken: string): Promise<number> {
  const pool = getPool();
  const hash = hashResetToken(rawToken);
  const [res] = await pool.execute<any>(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, hash, RESET_TTL_MINUTES]
  );
  return Number(res.insertId);
}

export async function findValidResetRow(rawToken: string): Promise<ResetRow | null> {
  const pool = getPool();
  const hash = hashResetToken(rawToken);
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM password_resets
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [hash]
  );
  return rows.length > 0 ? (rows[0] as ResetRow) : null;
}

export async function markResetUsed(id: number): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE password_resets SET used_at = NOW() WHERE id = ?`,
    [id]
  );
}

export async function findUserByUsername(username: string): Promise<{ id: number } | null> {
  // v1: 表里没有 email 字段；SMTP mode 下需要把用户的真实 email 路径在 v2 加进 schema
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  if (rows.length === 0) return null;
  return { id: Number(rows[0].id) };
}
```

- [ ] **Step 4: 跑测试 pass**

```bash
pnpm test tests/unit/lib/password-reset.test.ts
```

期望：5/5 通过。

- [ ] **Step 5: Commit**

```bash
git add lib/password-reset.ts tests/unit/lib/password-reset.test.ts
git commit -m "feat(auth): password reset token + CRUD helpers"
```

---

## Task 7: lib/auth.ts 加 `getCurrentUserWithAdmin` + `requireAdmin`

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\auth.ts`

- [ ] **Step 1: 在文件末尾追加**

```ts
// 在现有 export 之后追加
import { NextResponse } from 'next/server';
import { getPool } from './db';

export interface UserWithAdmin extends User { isAdmin: boolean; }

/**
 * Same as getCurrentUser, but also queries is_admin from DB.
 * Use this whenever admin privileges need to be checked.
 * Note: is_admin is NOT in the JWT — we re-query on every request so that
 * a demoted admin loses access immediately, not at JWT expiry.
 */
export async function getCurrentUserWithAdmin(): Promise<UserWithAdmin | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT is_admin FROM users WHERE id = ? LIMIT 1`,
    [user.id]
  );
  if (rows.length === 0) return null;
  return { ...user, isAdmin: Number(rows[0].is_admin) === 1 };
}

export type RequireAdminResult =
  | { ok: true; user: UserWithAdmin }
  | { ok: false; reason: 'unauthenticated' | 'forbidden'; response: NextResponse };

/**
 * Discriminated guard for both API routes and server pages.
 *
 * API route usage:
 *   const auth = await requireAdmin();
 *   if (!auth.ok) return auth.response;
 *   // auth.user.id, auth.user.username, auth.user.isAdmin are safe
 *
 * Server page usage:
 *   const auth = await requireAdmin();
 *   if (!auth.ok) {
 *     if (auth.reason === 'unauthenticated') redirect('/?auth=login');
 *     else redirect('/?error=forbidden');
 *   }
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const user = await getCurrentUserWithAdmin();
  if (!user) {
    return {
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 }
      ),
    };
  }
  if (!user.isAdmin) {
    return {
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}
```

- [ ] **Step 2: 跑测试确认没破坏老测试**

```bash
pnpm test tests/unit/lib/auth.test.ts
```

期望：9/9 仍过。

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "feat(auth): getCurrentUserWithAdmin + requireAdmin guard"
```

---

## Task 8: lib/store.ts 加 `isAdmin`

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\store.ts`

- [ ] **Step 1: 加可选字段**

把 `User` interface 改成：

```ts
export interface User { id: number; username: string; isAdmin?: boolean; }
```

（`isAdmin` 设为可选以保持 zustand persist 旧 state 兼容。）

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

期望：全过（无回归）。

- [ ] **Step 3: Commit**

```bash
git add lib/store.ts
git commit -m "feat(store): User.isAdmin optional field"
```

---

## Task 9: /api/auth/me 返回 isAdmin

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\app\api\auth\me\route.ts`

- [ ] **Step 1: 替换整个文件**

```ts
import { NextResponse } from 'next/server';
import { getCurrentUserWithAdmin } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUserWithAdmin();
  if (!user) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });
  }
  return NextResponse.json({ ok: true, data: { user } });
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/me/route.ts
git commit -m "feat(api): /me returns isAdmin"
```

---

## Task 10: lib/audit.ts 扩展 AuditEvent 联合

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\audit.ts`

- [ ] **Step 1: 扩展 union**

把第一行替换为：

```ts
export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote';
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add lib/audit.ts
git commit -m "feat(audit): 6 new admin/password events"
```

---

## Task 11: POST /api/auth/forgot

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\forgot\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { validateUsername } from '@/lib/auth';
import { findUserByUsername, generateResetToken, createResetRow, RESET_TTL_MINUTES } from '@/lib/password-reset';
import { checkRateLimit } from '@/lib/ratelimit';
import { sendEmail, EmailNotConfiguredError } from '@/lib/email';
import { passwordResetEmail } from '@/lib/email-templates';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; }

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '请求过于频繁,请稍后再试' } },
      { status: 429 }
    );
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const uErr = validateUsername(username);
  if (uErr) return NextResponse.json({ ok: false, error: { code: 'invalid_username', message: uErr } }, { status: 400 });

  const ua = req.headers.get('user-agent') ?? null;
  const user = await findUserByUsername(username);
  if (!user) {
    await writeAudit({ userId: null, event: 'password_reset_request', metadata: { userExists: false, username }, ip, userAgent: ua });
    return NextResponse.json({ ok: true, data: null });
  }

  const token = generateResetToken();
  await createResetRow(user.id, token);

  const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://${req.headers.get('host') ?? 'localhost:5555'}`;
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  let emailError: string | null = null;
  try {
    const tpl = passwordResetEmail({ username, resetUrl, expiresInMinutes: RESET_TTL_MINUTES });
    // v1: dev 模式 console 不关心 to 地址；SMTP 模式需 v2 加 users.email 列
    await sendEmail({ to: username, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: { code: 'email_not_configured', message: '邮件服务未配置' } },
        { status: 503 }
      );
    }
    emailError = e instanceof Error ? e.message : String(e);
    console.error('[forgot] email send failed', emailError);
  }

  await writeAudit({
    userId: user.id,
    event: 'password_reset_request',
    metadata: { userExists: true, emailError },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, data: null });
}
```

- [ ] **Step 2: 跑测试确认旧测试没坏**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/forgot/route.ts
git commit -m "feat(api): POST /api/auth/forgot with rate limit + audit"
```

---

## Task 12: GET /api/auth/reset-info

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\reset-info\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { findValidResetRow, hashResetToken } from '@/lib/password-reset';

const TOKEN_MIN = 32;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('token') ?? '';
  if (raw.length < TOKEN_MIN) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const row = await findValidResetRow(raw);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, data: { username: rows[0].username } });
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/reset-info/route.ts
git commit -m "feat(api): GET /api/auth/reset-info validates token"
```

---

## Task 13: POST /api/auth/reset

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\reset\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, signSession, setSessionCookie, validatePassword } from '@/lib/auth';
import { findValidResetRow, markResetUsed } from '@/lib/password-reset';
import { writeAudit } from '@/lib/audit';

interface Body { token?: string; newPassword?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const token = body.token ?? '';
  const newPassword = body.newPassword ?? '';
  if (token.length < 32) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }
  const pErr = validatePassword(newPassword);
  if (pErr) return NextResponse.json({ ok: false, error: { code: 'invalid_password', message: pErr } }, { status: 400 });

  const row = await findValidResetRow(token);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const { getPool } = await import('@/lib/db');
  const pool = getPool();
  const [urows] = await pool.execute<any[]>(
    `SELECT id, username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (urows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }
  const user = { id: Number(urows[0].id), username: urows[0].username as string };

  const newHash = await hashPassword(newPassword);
  await pool.execute(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [newHash, user.id]
  );
  await markResetUsed(row.id);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'password_reset_complete', metadata: { resetId: row.id }, ip, userAgent: ua });

  const sessionToken = await signSession(user);
  await setSessionCookie(sessionToken, { secure: process.env.COOKIE_SECURE === 'true' });

  return NextResponse.json({ ok: true, data: { user } });
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/reset/route.ts
git commit -m "feat(api): POST /api/auth/reset completes password change"
```

---

## Task 14: lib/admin.ts（listUsers / getUserDetail / getAuditLog / getSystemStats / writeAdminOps）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\admin.ts`

- [ ] **Step 1: 创建文件**

```ts
import { getPool } from './db';
import { HistoryRow, HistoryKind } from './history';
import { randomBytes } from 'node:crypto';

export interface AdminUserRow {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: Date;
  historyCount: number;
  favoriteCount: number;
}

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
}
export interface ListUsersResult {
  users: AdminUserRow[];
  total: number;
}

export async function listUsers(opts: ListUsersOptions = {}): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pool = getPool();

  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at,
            COALESCE(h.total, 0) AS historyCount,
            COALESCE(h.fav, 0) AS favoriteCount
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS total,
              SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
       FROM history GROUP BY user_id
     ) h ON h.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM users`
  );

  return {
    users: rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      isAdmin: Number(r.is_admin) === 1,
      createdAt: r.created_at,
      historyCount: Number(r.historyCount),
      favoriteCount: Number(r.favoriteCount),
    })),
    total: Number(countRows[0]?.n ?? 0),
  };
}

export interface UserDetail {
  user: AdminUserRow;
  recentHistory: HistoryRow[];
}

export async function getUserDetail(id: number): Promise<UserDetail | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at,
            COALESCE(h.total, 0) AS historyCount,
            COALESCE(h.fav, 0) AS favoriteCount
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS total,
              SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
       FROM history GROUP BY user_id
     ) h ON h.user_id = u.id
     WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const user: AdminUserRow = {
    id: Number(r.id),
    username: r.username,
    isAdmin: Number(r.is_admin) === 1,
    createdAt: r.created_at,
    historyCount: Number(r.historyCount),
    favoriteCount: Number(r.favoriteCount),
  };
  const [hist] = await pool.execute<any[]>(
    `SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [id]
  );
  return { user, recentHistory: hist as HistoryRow[] };
}

export type AuditEventName =
  | 'register' | 'login' | 'logout' | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote';

export interface AuditLogRow {
  id: number;
  user_id: number | null;
  event: string;
  metadata: any;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface AuditLogOptions {
  userId?: number;
  event?: AuditEventName;
  from?: string;     // ISO date
  to?: string;       // ISO date
  limit?: number;
  offset?: number;
}
export interface AuditLogResult { rows: AuditLogRow[]; total: number; }

export async function getAuditLog(opts: AuditLogOptions = {}): Promise<AuditLogResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const wheres: string[] = [];
  const params: any[] = [];
  if (opts.userId !== undefined) { wheres.push('user_id = ?'); params.push(opts.userId); }
  if (opts.event) { wheres.push('event = ?'); params.push(opts.event); }
  if (opts.from) { wheres.push('created_at >= ?'); params.push(opts.from); }
  if (opts.to) { wheres.push('created_at <= ?'); params.push(opts.to); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, event, metadata, ip, user_agent, created_at
     FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM audit_log ${where}`,
    params
  );
  return { rows: rows as AuditLogRow[], total: Number(countRows[0]?.n ?? 0) };
}

export interface SystemStats {
  users: number;
  admins: number;
  history: number;
  favorites: number;
  audit: number;
}

export async function getSystemStats(): Promise<SystemStats> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
       (SELECT COUNT(*) FROM history) AS history,
       (SELECT COUNT(*) FROM history WHERE is_favorite = 1) AS favorites,
       (SELECT COUNT(*) FROM audit_log) AS audit`
  );
  const r = rows[0] ?? {};
  return {
    users: Number(r.users ?? 0),
    admins: Number(r.admins ?? 0),
    history: Number(r.history ?? 0),
    favorites: Number(r.favorites ?? 0),
    audit: Number(r.audit ?? 0),
  };
}

export async function countOtherAdmins(excludeUserId: number): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?`,
    [excludeUserId]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function deleteUserCascade(id: number): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `DELETE FROM users WHERE id = ?`,
    [id]
  );
  return res.affectedRows > 0;
}

export async function setUserAdmin(id: number, isAdmin: boolean): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE users SET is_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, id]
  );
  return res.affectedRows > 0;
}

export async function setUserPasswordHash(id: number, hash: string): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [hash, id]
  );
  return res.affectedRows > 0;
}

export function generateTempPassword(): string {
  // 16 字节随机 → base64url ≈ 22 字符；bcrypt 限 72 字节，无压力
  return randomBytes(16).toString('base64url');
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add lib/admin.ts
git commit -m "feat(admin): listUsers / getUserDetail / getAuditLog / getSystemStats / write helpers"
```

---

## Task 15: GET /api/admin/users

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\users\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/admin';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;
  const result = await listUsers({ limit, offset });
  return NextResponse.json({ ok: true, data: result });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/users/route.ts
git commit -m "feat(api): GET /api/admin/users"
```

---

## Task 16: GET /api/admin/users/[id] + DELETE 同路径

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\users\[id]\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, validateUsername } from '@/lib/auth';
import { getUserDetail, deleteUserCascade, countOtherAdmins } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

function asIdInt(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = asIdInt(idStr);
  if (!id) return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  return NextResponse.json({ ok: true, data: detail });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = asIdInt(idStr);
  if (!id) return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });

  if (id === auth.user.id) {
    return NextResponse.json({ ok: false, error: { code: 'cannot_delete_self', message: '不能删除自己' } }, { status: 400 });
  }

  let body: { confirmUsername?: string };
  try { body = await req.json(); } catch { body = {}; }
  const confirm = (body.confirmUsername ?? '').trim();
  const uErr = validateUsername(confirm);
  // 用户名格式错误时也算 mismatch（不区分原因以减少信息泄露）
  void uErr;

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  if (confirm !== detail.user.username) {
    return NextResponse.json({ ok: false, error: { code: 'username_mismatch', message: '用户名不匹配' } }, { status: 400 });
  }
  if (detail.user.isAdmin) {
    const others = await countOtherAdmins(id);
    if (others === 0) {
      return NextResponse.json({ ok: false, error: { code: 'last_admin', message: '至少保留一个管理员' } }, { status: 400 });
    }
  }

  await deleteUserCascade(id);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_delete',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/users/[id]/route.ts
git commit -m "feat(api): GET/DELETE /api/admin/users/[id]"
```

---

## Task 17: POST /api/admin/users/[id]/reset-password

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\users\[id]\reset-password\route.ts`

- [ ] **Step 1: 创建文件**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { getUserDetail, generateTempPassword, setUserPasswordHash } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });
  }
  if (id === auth.user.id) {
    return NextResponse.json({ ok: false, error: { code: 'cannot_reset_self', message: '请使用「忘记密码」重置自己的密码' } }, { status: 400 });
  }

  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  await setUserPasswordHash(id, hash);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_password_reset',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });

  return NextResponse.json({ ok: true, data: { tempPassword } });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/users/[id]/reset-password/route.ts
git commit -m "feat(api): admin reset password (returns temp password)"
```

---

## Task 18: POST /api/admin/users/[id]/promote + /demote

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\users\[id]\promote\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\users\[id]\demote\route.ts`

- [ ] **Step 1: 创建 promote**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getUserDetail, setUserAdmin } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });
  }
  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  if (detail.user.isAdmin) {
    return NextResponse.json({ ok: false, error: { code: 'already_admin', message: '已经是管理员' } }, { status: 400 });
  }
  await setUserAdmin(id, true);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_promote',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });
  return NextResponse.json({ ok: true, data: { id, isAdmin: true } });
}
```

- [ ] **Step 2: 创建 demote**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getUserDetail, setUserAdmin, countOtherAdmins } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'bad_id', message: 'id 不合法' } }, { status: 400 });
  }
  const detail = await getUserDetail(id);
  if (!detail) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '用户不存在' } }, { status: 404 });
  if (!detail.user.isAdmin) {
    return NextResponse.json({ ok: false, error: { code: 'not_admin', message: '该用户不是管理员' } }, { status: 400 });
  }
  const others = await countOtherAdmins(id);
  if (others === 0) {
    return NextResponse.json({ ok: false, error: { code: 'last_admin', message: '至少保留一个管理员' } }, { status: 400 });
  }
  await setUserAdmin(id, false);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: auth.user.id, event: 'admin_user_demote',
    metadata: { targetUserId: id, targetUsername: detail.user.username },
    ip, userAgent: ua,
  });
  return NextResponse.json({ ok: true, data: { id, isAdmin: false } });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/users/[id]/promote/route.ts app/api/admin/users/[id]/demote/route.ts
git commit -m "feat(api): admin promote/demote user"
```

---

## Task 19: GET /api/admin/audit + /api/admin/stats

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\audit\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\admin\stats\route.ts`

- [ ] **Step 1: 创建 audit**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAuditLog, type AuditEventName } from '@/lib/admin';

const ALLOWED_EVENTS: AuditEventName[] = [
  'register', 'login', 'logout', 'history_create', 'history_delete',
  'password_reset_request', 'password_reset_complete',
  'admin_user_delete', 'admin_user_password_reset',
  'admin_user_promote', 'admin_user_demote',
];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const userIdStr = sp.get('user_id');
  const eventStr = sp.get('event') ?? undefined;
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;

  const opts: Parameters<typeof getAuditLog>[0] = { limit, offset };
  if (userIdStr && /^\d+$/.test(userIdStr)) opts.userId = Number(userIdStr);
  if (eventStr && (ALLOWED_EVENTS as string[]).includes(eventStr)) opts.event = eventStr as AuditEventName;
  if (from) opts.from = from;
  if (to) opts.to = to;

  const result = await getAuditLog(opts);
  return NextResponse.json({ ok: true, data: result });
}
```

- [ ] **Step 2: 创建 stats**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSystemStats } from '@/lib/admin';

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const stats = await getSystemStats();
  return NextResponse.json({ ok: true, data: stats });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/audit/route.ts app/api/admin/stats/route.ts
git commit -m "feat(api): admin audit log + system stats"
```

---

## Task 20: lib/api-auth.ts 加 forgot/reset 包装 + 新建 lib/api-admin.ts

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\api-auth.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\lib\api-admin.ts`

- [ ] **Step 1: 追加到 lib/api-auth.ts 末尾**

```ts
export async function forgotPasswordRequest(username: string): Promise<ApiResult<null>> {
  return call<null>('/api/auth/forgot', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
}

export async function getResetInfoRequest(token: string): Promise<ApiResult<{ username: string }>> {
  return call(`/api/auth/reset-info?token=${encodeURIComponent(token)}`, { method: 'GET' });
}

export async function resetPasswordRequest(token: string, newPassword: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/reset', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
}
```

- [ ] **Step 2: 创建 lib/api-admin.ts**

```ts
import type { ApiResult } from './api-auth';
import type { User } from './store';

export interface AdminUserRow {
  id: number; username: string; isAdmin: boolean;
  createdAt: string | Date; historyCount: number; favoriteCount: number;
}
export interface ListUsersData { users: AdminUserRow[]; total: number; }

export interface AuditLogRow {
  id: number; user_id: number | null; event: string;
  metadata: any; ip: string | null; user_agent: string | null; created_at: string | Date;
}
export interface AuditLogData { rows: AuditLogRow[]; total: number; }

export interface SystemStats {
  users: number; admins: number; history: number; favorites: number; audit: number;
}

export interface UserDetailData {
  user: AdminUserRow;
  recentHistory: Array<{
    id: number; user_id: number; kind: 'text2pinyin' | 'pinyin2text';
    input: string; output: string | null; is_favorite: 0 | 1;
    char_count: number; created_at: string | Date;
  }>;
}

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { ok: true, data: null as any };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function adminListUsers(opts: { limit?: number; offset?: number } = {}): Promise<ApiResult<ListUsersData>> {
  const sp = new URLSearchParams();
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/admin/users${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function adminGetUser(id: number): Promise<ApiResult<UserDetailData>> {
  return call(`/api/admin/users/${id}`, { method: 'GET' });
}

export async function adminDeleteUser(id: number, confirmUsername: string): Promise<ApiResult<null>> {
  return call(`/api/admin/users/${id}`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmUsername }),
  });
}

export async function adminResetUserPassword(id: number): Promise<ApiResult<{ tempPassword: string }>> {
  return call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
}

export async function adminPromoteUser(id: number): Promise<ApiResult<{ id: number; isAdmin: true }>> {
  return call(`/api/admin/users/${id}/promote`, { method: 'POST' });
}

export async function adminDemoteUser(id: number): Promise<ApiResult<{ id: number; isAdmin: false }>> {
  return call(`/api/admin/users/${id}/demote`, { method: 'POST' });
}

export async function adminGetAudit(opts: {
  userId?: number; event?: string; from?: string; to?: string;
  limit?: number; offset?: number;
} = {}): Promise<ApiResult<AuditLogData>> {
  const sp = new URLSearchParams();
  if (opts.userId !== undefined) sp.set('user_id', String(opts.userId));
  if (opts.event) sp.set('event', opts.event);
  if (opts.from) sp.set('from', opts.from);
  if (opts.to) sp.set('to', opts.to);
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/admin/audit${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function adminGetStats(): Promise<ApiResult<SystemStats>> {
  return call('/api/admin/stats', { method: 'GET' });
}
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add lib/api-auth.ts lib/api-admin.ts
git commit -m "feat(client): api wrappers for forgot/reset + admin endpoints"
```

---

## Task 21: /forgot-password 页面

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\forgot-password\page.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\app\forgot-password\ForgotForm.tsx`

- [ ] **Step 1: 创建 ForgotForm 客户端组件**

```tsx
'use client';

import { useState } from 'react';
import { forgotPasswordRequest } from '@/lib/api-auth';

export function ForgotForm() {
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await forgotPasswordRequest(username);
    setSubmitting(false);
    if (r.ok) {
      setDone(true);
    } else if (r.error.code === 'rate_limited') {
      setError('请求过于频繁,请稍后再试');
    } else if (r.error.code === 'email_not_configured') {
      setError('邮件服务未配置,请联系管理员');
    } else {
      setError(r.error.message);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-gray-700">
        如果该用户存在,重置链接已发送。请检查邮箱。开发环境下,链接会同时打印到 server console。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block text-sm mb-1">用户名</label>
        <input
          type="text" value={username} onChange={e => setUsername(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required minLength={3} maxLength={32}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50">
        {submitting ? '提交中…' : '发送重置链接'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 创建 page.tsx（server component）**

```tsx
import type { ReactNode } from 'react';
import { ForgotForm } from './ForgotForm';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">忘记密码</h2>
          <p className="text-sm text-gray-600 mb-4">输入你的用户名,我们会发送一封重置链接到你的注册邮箱。</p>
          <ForgotForm />
          <p className="text-xs text-gray-500 mt-4">
            想起密码了? <a href="/?auth=login" className="text-blue-600 hover:underline">返回登录</a>
          </p>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/forgot-password/
git commit -m "feat(ui): /forgot-password page with form"
```

---

## Task 22: /reset-password 页面

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\reset-password\page.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\app\reset-password\ResetForm.tsx`

- [ ] **Step 1: 创建 ResetForm 客户端组件**

```tsx
'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { resetPasswordRequest } from '@/lib/api-auth';
import { validatePasswordConfirmation } from '@/lib/auth-client';

export function ResetForm({ token, username }: { token: string; username: string }) {
  const setUser = useAppStore(s => s.setUser);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cErr = validatePasswordConfirmation(pw, pw2);
    if (cErr) { setError(cErr); return; }
    if (pw.length < 8) { setError('密码至少 8 位'); return; }
    setSubmitting(true);
    const r = await resetPasswordRequest(token, pw);
    if (r.ok) {
      setUser(r.data.user);
      setTimeout(() => { window.location.href = '/'; }, 1000);
    } else {
      setSubmitting(false);
      setError(r.error.message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-gray-700">你好,{username}。请输入新密码 (至少 8 位)。</p>
      <div>
        <label className="block text-sm mb-1">新密码</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)}
          className="w-full border rounded px-3 py-2" required minLength={8} maxLength={72} />
      </div>
      <div>
        <label className="block text-sm mb-1">再次输入</label>
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
          className="w-full border rounded px-3 py-2" required minLength={8} maxLength={72} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50">
        {submitting ? '提交中…' : '重置密码'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 创建 page.tsx（server component）**

```tsx
import { headers } from 'next/headers';
import { findValidResetRow } from '@/lib/password-reset';
import { getPool } from '@/lib/db';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? '';
  const expired = (
    <p className="text-sm text-gray-700">
      链接已失效,请返回 <a href="/forgot-password" className="text-blue-600 hover:underline">忘记密码</a> 重新申请。
    </p>
  );

  if (token.length < 32) {
    return <Shell>{expired}</Shell>;
  }

  const row = await findValidResetRow(token);
  if (!row) {
    return <Shell>{expired}</Shell>;
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (rows.length === 0) return <Shell>{expired}</Shell>;
  const username = rows[0].username as string;

  return <Shell><ResetForm token={token} username={username} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">重置密码</h2>
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add app/reset-password/
git commit -m "feat(ui): /reset-password page (server validates token, client resets)"
```

---

## Task 23: AdminNav 组件

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\components\AdminNav.tsx`

- [ ] **Step 1: 创建文件**

```tsx
'use client';

import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/audit', label: '审计日志' },
  { href: '/admin/stats', label: '系统统计' },
];

export function AdminNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="w-48 border-r bg-white">
      <ul className="py-4">
        {ITEMS.map(item => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <a href={item.href}
                className={`block px-4 py-2 text-sm ${active ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600' : 'text-gray-700 hover:bg-gray-50'}`}>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/AdminNav.tsx
git commit -m "feat(ui): AdminNav sidebar"
```

---

## Task 24: Admin layout

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\layout.tsx`

- [ ] **Step 1: 创建文件**

```tsx
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { Header } from '@/components/Header';
import { AdminNav } from '@/components/AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    else redirect('/?error=forbidden');
  }
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex">
        <AdminNav />
        <main className="flex-1 p-6 bg-gray-50">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(admin): layout with requireAdmin + sidebar"
```

---

## Task 25: /admin redirect + /admin/users 页

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\page.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\users\page.tsx`

- [ ] **Step 1: app/admin/page.tsx**

```tsx
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default function AdminIndex() { redirect('/admin/users'); }
```

- [ ] **Step 2: app/admin/users/page.tsx**

```tsx
import { listUsers } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const { users, total } = await listUsers({ limit: 200, offset: 0 });
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">用户管理 (共 {total})</h1>
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">用户名</th>
              <th className="px-3 py-2">注册时间</th>
              <th className="px-3 py-2">历史</th>
              <th className="px-3 py-2">收藏</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2 text-gray-600">{new Date(u.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{u.historyCount}</td>
                <td className="px-3 py-2">{u.favoriteCount}</td>
                <td className="px-3 py-2">
                  {u.isAdmin
                    ? <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">管理员</span>
                    : <span className="text-xs text-gray-500">用户</span>}
                </td>
                <td className="px-3 py-2">
                  <a href={`/admin/users/${u.id}`} className="text-blue-600 hover:underline">详情 →</a>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">暂无用户</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx app/admin/users/page.tsx
git commit -m "feat(admin): /admin index redirect + /admin/users list"
```

---

## Task 26: 3 个 admin 对话框组件 (DeleteUserDialog, ResetPasswordDialog, ConfirmDialog)

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\components\DeleteUserDialog.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\components\ResetPasswordDialog.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\components\ConfirmDialog.tsx`

- [ ] **Step 1: ConfirmDialog (generic)**

```tsx
'use client';

import { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = '确认', cancelLabel = '取消',
  destructive = false, onConfirm, onClose, children,
}: Props) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function go() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); onClose(); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">{description}</p>
        {children}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">{cancelLabel}</button>
          <button type="button" onClick={go} disabled={busy}
            className={`px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DeleteUserDialog**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminDeleteUser } from '@/lib/api-admin';
import { ConfirmDialog } from './ConfirmDialog';

export function DeleteUserDialog({ userId, username, open, onClose }: {
  userId: number; username: string; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const match = confirm === username;

  return (
    <ConfirmDialog
      open={open}
      title={`删除用户 ${username}`}
      description="此操作不可撤销。该用户的所有历史和审计记录会一并删除。请输入用户名以确认。"
      confirmLabel="删除"
      destructive
      onClose={() => { setConfirm(''); setError(null); onClose(); }}
      onConfirm={async () => {
        setError(null);
        const r = await adminDeleteUser(userId, confirm);
        if (!r.ok) { setError(r.error.message); throw new Error(r.error.message); }
        router.push('/admin/users');
        router.refresh();
      }}
    >
      <input
        type="text" value={confirm} onChange={e => setConfirm(e.target.value)}
        placeholder={`输入 ${username} 以确认`}
        className="w-full border rounded px-3 py-2 text-sm mb-1"
      />
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {!match && confirm && <p className="text-xs text-gray-500">用户名不匹配</p>}
    </ConfirmDialog>
  );
}
```

- [ ] **Step 3: ResetPasswordDialog (one-shot)**

```tsx
'use client';

import { useState } from 'react';
import { adminResetUserPassword } from '@/lib/api-admin';
import { ConfirmDialog } from './ConfirmDialog';

export function ResetPasswordDialog({ userId, username, open, onClose }: {
  userId: number; username: string; open: boolean; onClose: () => void;
}) {
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 在 open 从 false → true 时拉一次
  if (open && temp === null && !error) {
    adminResetUserPassword(userId).then(r => {
      if (r.ok) setTemp(r.data.tempPassword);
      else setError(r.error.message);
    });
  }

  function close() {
    setTemp(null); setCopied(false); setHandedOff(false); setError(null);
    onClose();
  }

  async function copy() {
    if (!temp) return;
    await navigator.clipboard.writeText(temp);
    setCopied(true);
  }

  return (
    <ConfirmDialog
      open={open}
      title={`重置 ${username} 的密码`}
      description="系统将生成一个临时密码。请把临时密码当面或通过安全渠道交给该用户,并建议其尽快修改。"
      confirmLabel={handedOff ? '关闭' : '已转交'}
      cancelLabel="取消"
      onClose={close}
      onConfirm={() => setHandedOff(true)}
    >
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {temp && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">{temp}</code>
            <button type="button" onClick={copy} className="text-sm px-2 py-1 border rounded hover:bg-gray-50">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-xs text-gray-500">关闭此对话框后,临时密码不再可见。</p>
        </>
      )}
    </ConfirmDialog>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/ConfirmDialog.tsx components/DeleteUserDialog.tsx components/ResetPasswordDialog.tsx
git commit -m "feat(ui): admin ConfirmDialog + DeleteUserDialog + ResetPasswordDialog"
```

---

## Task 27: /admin/users/[id] 详情页

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\users\[id]\page.tsx`

- [ ] **Step 1: 创建文件**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminPromoteUser, adminDemoteUser } from '@/lib/api-admin';
import { DeleteUserDialog } from '@/components/DeleteUserDialog';
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { AdminUserRow } from '@/lib/api-admin';
import type { HistoryRow } from '@/lib/api-history';

export function UserDetailClient({ user, recentHistory, isSelf }: {
  user: AdminUserRow; recentHistory: HistoryRow[]; isSelf: boolean;
}) {
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showDemote, setShowDemote] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doPromote() {
    setErr(null);
    const r = await adminPromoteUser(user.id);
    if (!r.ok) setErr(r.error.message); else router.refresh();
  }
  async function doDemote() {
    setErr(null);
    const r = await adminDemoteUser(user.id);
    if (!r.ok) setErr(r.error.message); else router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-lg p-4">
        <h1 className="text-xl font-semibold">{user.username}</h1>
        <p className="text-sm text-gray-600">注册时间: {new Date(user.createdAt).toLocaleString('zh-CN')}</p>
        <p className="text-sm text-gray-600">历史: {user.historyCount} / 收藏: {user.favoriteCount}</p>
        <p className="text-sm mt-1">
          角色: {user.isAdmin
            ? <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">管理员</span>
            : <span className="text-xs text-gray-500">用户</span>}
        </p>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <div className="flex gap-2 mt-4 flex-wrap">
          {!isSelf && (
            <>
              <button type="button" onClick={() => setShowReset(true)}
                className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">重置密码</button>
              {!user.isAdmin
                ? <button type="button" onClick={() => setShowPromote(true)}
                    className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">提升为管理员</button>
                : <button type="button" onClick={() => setShowDemote(true)}
                    className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">撤销管理员</button>}
              <button type="button" onClick={() => setShowDelete(true)}
                className="text-sm px-3 py-1.5 border rounded text-red-600 hover:bg-red-50">删除用户</button>
            </>
          )}
          {isSelf && <p className="text-xs text-gray-500">不能对自己执行写操作,请用其他管理员账号操作。</p>}
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <h2 className="px-4 py-2 text-sm font-semibold bg-gray-50">最近 10 条历史</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-600">
            <th className="px-3 py-2">时间</th><th className="px-3 py-2">类型</th>
            <th className="px-3 py-2">输入</th><th className="px-3 py-2">输出</th>
            <th className="px-3 py-2">字数</th>
          </tr></thead>
          <tbody>
            {recentHistory.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">暂无</td></tr>
            )}
            {recentHistory.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-600">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{r.kind}</td>
                <td className="px-3 py-2 truncate max-w-xs">{r.input}</td>
                <td className="px-3 py-2 truncate max-w-xs">{r.output ?? '—'}</td>
                <td className="px-3 py-2">{r.char_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeleteUserDialog userId={user.id} username={user.username}
        open={showDelete} onClose={() => setShowDelete(false)} />
      <ResetPasswordDialog userId={user.id} username={user.username}
        open={showReset} onClose={() => setShowReset(false)} />
      <ConfirmDialog open={showPromote} title={`将 ${user.username} 提升为管理员`}
        description="该用户将获得管理后台的完全访问权限。"
        onConfirm={doPromote} onClose={() => setShowPromote(false)} />
      <ConfirmDialog open={showDemote} title={`撤销 ${user.username} 的管理员权限`}
        description="撤销后,该用户将无法访问管理后台。"
        onConfirm={doDemote} onClose={() => setShowDemote(false)} />
    </div>
  );
}
```

- [ ] **Step 2: 创建 server 包装（page.tsx）**

```tsx
import { notFound } from 'next/navigation';
import { getUserDetail } from '@/lib/admin';
import { getCurrentUser } from '@/lib/auth';
import { UserDetailClient } from './UserDetailClient';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const me = await getCurrentUser();
  return (
    <UserDetailClient
      user={detail.user as any}
      recentHistory={detail.recentHistory as any}
      isSelf={me?.id === id}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/\[id\]/
git commit -m "feat(admin): /admin/users/[id] detail with action buttons"
```

---

## Task 28: /admin/audit + /admin/stats 页

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\audit\page.tsx`
- Create: `E:\ToolDevelop\PinYinCharacter\app\admin\stats\page.tsx`

- [ ] **Step 1: audit page**

```tsx
import Link from 'next/link';
import { getAuditLog, type AuditEventName } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  register: '注册', login: '登录', logout: '登出',
  history_create: '历史创建', history_delete: '历史删除',
  password_reset_request: '密码重置申请', password_reset_complete: '密码重置完成',
  admin_user_delete: '管理员删除用户',
  admin_user_password_reset: '管理员重置密码',
  admin_user_promote: '管理员提升', admin_user_demote: '管理员撤销',
};

export default async function AdminAuditPage({ searchParams }: {
  searchParams: Promise<{ user_id?: string; event?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page ?? 0), 0);
  const limit = 50;
  const opts: Parameters<typeof getAuditLog>[0] = { limit, offset: page * limit };
  if (sp.user_id && /^\d+$/.test(sp.user_id)) opts.userId = Number(sp.user_id);
  if (sp.event) opts.event = sp.event as AuditEventName;
  if (sp.from) opts.from = sp.from;
  if (sp.to) opts.to = sp.to;
  const { rows, total } = await getAuditLog(opts);
  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">审计日志 (共 {total})</h1>
      <form className="bg-white border rounded p-3 mb-4 flex flex-wrap gap-2 text-sm">
        <input type="text" name="user_id" placeholder="用户 ID" defaultValue={sp.user_id ?? ''}
          className="border rounded px-2 py-1 w-24" />
        <select name="event" defaultValue={sp.event ?? ''} className="border rounded px-2 py-1">
          <option value="">全部事件</option>
          {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ''} className="border rounded px-2 py-1" />
        <input type="date" name="to" defaultValue={sp.to ?? ''} className="border rounded px-2 py-1" />
        <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded">筛选</button>
        <Link href="/admin/audit" className="px-3 py-1 border rounded text-gray-600">清空</Link>
      </form>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">用户 ID</th>
              <th className="px-3 py-2">事件</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">元数据</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">无记录</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{r.user_id ?? '—'}</td>
                <td className="px-3 py-2">{EVENT_LABEL[r.event] ?? r.event}</td>
                <td className="px-3 py-2 text-gray-500">{r.ip ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono max-w-md truncate">{r.metadata ? JSON.stringify(r.metadata) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4 text-sm">
        {page > 0 && <Link href={{ query: { ...sp, page: String(page - 1) } }} className="px-3 py-1 border rounded">← 上一页</Link>}
        <span className="px-3 py-1 text-gray-600">第 {page + 1} / {totalPages} 页</span>
        {page + 1 < totalPages && <Link href={{ query: { ...sp, page: String(page + 1) } }} className="px-3 py-1 border rounded">下一页 →</Link>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: stats page**

```tsx
import { getSystemStats } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const s = await getSystemStats();
  const cards = [
    { label: '总用户数', value: s.users },
    { label: '管理员', value: s.admins },
    { label: '历史记录', value: s.history },
    { label: '收藏', value: s.favorites },
    { label: '审计事件', value: s.audit },
  ];
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">系统统计</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-white border rounded-lg p-4">
            <div className="text-sm text-gray-500">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/audit/page.tsx app/admin/stats/page.tsx
git commit -m "feat(admin): /admin/audit + /admin/stats pages"
```

---

## Task 29: UserMenu 加管理后台链接

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\UserMenu.tsx`

- [ ] **Step 1: 在「我的主页」之前插入链接**

把现有 `<a href="/profile">` 之前加：

```tsx
        {user.isAdmin && (
          <a href="/admin/users" className="block px-3 py-1.5 hover:bg-gray-50 text-blue-600">管理后台</a>
        )}
```

完整文件内容：

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { logoutRequest } from '@/lib/api-auth';

export function UserMenu() {
  const user = useAppStore(s => s.user);
  const setUser = useAppStore(s => s.setUser);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!user) return null;

  async function logout() {
    await logoutRequest();
    setUser(null);
    setOpen(false);
    window.location.href = '/';
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >{user.username} ⌄</button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border rounded shadow-lg py-1 z-20">
          {user.isAdmin && (
            <a href="/admin/users" className="block px-3 py-1.5 hover:bg-gray-50 text-blue-600">管理后台</a>
          )}
          <a href="/profile" className="block px-3 py-1.5 hover:bg-gray-50">我的主页</a>
          <a href="/history" className="block px-3 py-1.5 hover:bg-gray-50">历史记录</a>
          <a href="/history?favorite=true" className="block px-3 py-1.5 hover:bg-gray-50">收藏夹</a>
          <button type="button" onClick={logout} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600">退出登录</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add components/UserMenu.tsx
git commit -m "feat(ui): UserMenu shows admin link when isAdmin"
```

---

## Task 30: AuthModal 加「忘记密码」链接 + lib/auth-client.ts 加 validatePasswordConfirmation

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\AuthModal.tsx`
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\auth-client.ts`

- [ ] **Step 1: lib/auth-client.ts 追加**

在文件末尾追加：

```ts
/** 客户端再次输入密码校验（服务端仍是 source of truth） */
export function validatePasswordConfirmation(pw: string, confirm: string): string | null {
  if (pw !== confirm) return '两次输入不一致';
  return null;
}
```

- [ ] **Step 2: AuthModal 加链接**

定位到 `</form>` 之后追加（**先 Read 文件确认结构**）：

```tsx
      <p className="text-xs text-gray-500 mt-3 text-center">
        <a href="/forgot-password" className="text-blue-600 hover:underline">忘记密码</a>
      </p>
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add components/AuthModal.tsx lib/auth-client.ts
git commit -m "feat(ui+client): AuthModal forgot-password link + password confirmation helper"
```

---

## Task 31: 集成测试 — password-reset

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\tests\integration\password-reset.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';
import { getPool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: forgot } = await import('@/app/api/auth/forgot/route');
const { GET: resetInfo } = await import('@/app/api/auth/reset-info/route');
const { POST: reset } = await import('@/app/api/auth/reset/route');

function makeReq(url: string, body?: any) {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

integrationDescribe('password reset full flow', () => {
  it('forgot → reset-info → reset with valid token logs in user', async () => {
    const username = uniqueUsername('pr');
    const r1 = await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    expect(r1.status).toBe(200);

    // 第一次 forgot：拿 token from console
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r2 = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    expect(r2.status).toBe(200);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    expect(m).not.toBeNull();
    const token = m![1];
    consoleSpy.mockRestore();

    // reset-info
    const r3 = await resetInfo(makeReq(`http://x/api/auth/reset-info?token=${token}`) as any);
    expect(r3.status).toBe(200);
    const j3 = await r3.json();
    expect(j3.data.username).toBe(username);

    // reset
    const r4 = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(r4.status).toBe(200);
    expect(r4.headers.get('set-cookie')).toMatch(/auth_token=/);

    // 新密码可以登录
    const r5 = await login(makeReq('http://x/api/auth/login', { username, password: 'newpassword1' }) as any);
    expect(r5.status).toBe(200);

    // 旧密码失败
    const r6 = await login(makeReq('http://x/api/auth/login', { username, password: 'oldpassword1' }) as any);
    expect(r6.status).toBe(401);
  });

  it('token reuse: second reset with same token returns 400', async () => {
    const username = uniqueUsername('pr2');
    await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    const token = m![1];
    consoleSpy.mockRestore();

    const a = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(a.status).toBe(200);
    const b = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword2' }) as any);
    expect(b.status).toBe(400);
  });

  it('expired token: manually expire, then use returns 400', async () => {
    const username = uniqueUsername('pr3');
    const r1 = await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const userId = (await r1.json()).data.user.id;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const logText = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const m = logText.match(/token=([A-Za-z0-9_-]+)/);
    const token = m![1];
    consoleSpy.mockRestore();

    const pool = getPool();
    await pool.execute(`UPDATE password_resets SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?`, [userId]);
    const r2 = await reset(makeReq('http://x/api/auth/reset', { token, newPassword: 'newpassword1' }) as any);
    expect(r2.status).toBe(400);
  });

  it('unknown username: forgot returns 200, no row created', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await forgot(makeReq('http://x/api/auth/forgot', { username: 'nobody_here_xxx' }) as any);
    consoleSpy.mockRestore();
    expect(r.status).toBe(200);
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
      ['nobody_here_xxx']);
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  it('rate limit: two forgot in 1 second: second 429', async () => {
    const username = uniqueUsername('pr4');
    await register(makeReq('http://x/api/auth/register', { username, password: 'oldpassword1' }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    const b = await forgot(makeReq('http://x/api/auth/forgot', { username }) as any);
    consoleSpy.mockRestore();
    expect(a.status).toBe(200);
    expect(b.status).toBe(429);
  });
});
```

- [ ] **Step 2: 跑测试（没 DB 时 skip）**

```bash
pnpm test tests/integration/password-reset.test.ts
```

期望：5 个 skip（无 DB） 或 5 个 pass（有 DB）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/password-reset.test.ts
git commit -m "test: password reset integration suite (5 cases)"
```

---

## Task 32: 集成测试 — admin CRUD

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\tests\integration\admin-crud.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';
// withCookie 内联在文件底部（避免 setup.ts 多余 export）

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
// 各 admin 路由
const { GET: listUsers } = await import('@/app/api/admin/users/route');
const { GET: getUser, DELETE: delUser } = await import('@/app/api/admin/users/[id]/route');
const { POST: resetPw } = await import('@/app/api/admin/users/[id]/reset-password/route');
const { POST: promote } = await import('@/app/api/admin/users/[id]/promote/route');
const { POST: demote } = await import('@/app/api/admin/users/[id]/demote/route');

async function regUser(username: string) {
  const r = await register(new Request('http://x/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  return r;
}

async function loginAndCookie(username: string) {
  const r = await login(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  const cookie = r.headers.get('set-cookie')!.split(';')[0]; // 'auth_token=...'
  const j = await r.json();
  return { cookie, user: j.data.user };
}

function withCookie(cookie: string, req: Request): Request {
  const h = new Headers(req.headers);
  h.set('cookie', cookie);
  return new Request(req, { headers: h });
}

integrationDescribe('admin: read endpoints', () => {
  it('non-admin gets 403 on /api/admin/users', async () => {
    const u = uniqueUsername('nonadm');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await listUsers(withCookie(cookie, new Request('http://x/api/admin/users')) as any);
    expect(r.status).toBe(403);
  });

  it('first user (admin) gets 200 on /api/admin/users', async () => {
    const u = uniqueUsername('adm');
    const r1 = await regUser(u);
    const j = (await r1.json()).data;
    expect(j.user.username).toBe(u);
    const { cookie } = await loginAndCookie(u);
    const r2 = await listUsers(withCookie(cookie, new Request('http://x/api/admin/users')) as any);
    expect(r2.status).toBe(200);
  });
});

integrationDescribe('admin: write endpoints', () => {
  it('admin can reset another user password; new password works', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    await regUser(target);
    const { cookie, user: adminUser } = await loginAndCookie(admin);
    const { user: targetUser } = await loginAndCookie(target);

    const ctx = { params: Promise.resolve({ id: String(targetUser.id) }) } as any;
    const r = await resetPw(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/reset-password`, { method: 'POST' })) as any, ctx);
    expect(r.status).toBe(200);
    const j = await r.json();
    const tempPw = j.data.tempPassword;
    expect(tempPw).toBeTruthy();

    // target 用临时密码登录
    const lr = await login(new Request('http://x/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: target, password: tempPw }),
    }) as any);
    expect(lr.status).toBe(200);
  });

  it('promote then demote round trip works', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    await regUser(target);
    const { cookie } = await loginAndCookie(admin);
    const { user: targetUser } = await loginAndCookie(target);

    const ctx = { params: Promise.resolve({ id: String(targetUser.id) }) } as any;
    const p1 = await promote(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/promote`, { method: 'POST' })) as any, ctx);
    expect(p1.status).toBe(200);

    const p2 = await demote(withCookie(cookie, new Request(`http://x/api/admin/users/${targetUser.id}/demote`, { method: 'POST' })) as any, ctx);
    expect(p2.status).toBe(200);
  });

  it('cannot demote last admin', async () => {
    const admin = uniqueUsername('a');
    const reg = await regUser(admin);
    const adminId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    const ctx = { params: Promise.resolve({ id: String(adminId) }) } as any;
    const r = await demote(withCookie(cookie, new Request(`http://x/api/admin/users/${adminId}/demote`, { method: 'POST' })) as any, ctx);
    expect(r.status).toBe(400);
  });

  it('cannot delete self', async () => {
    const admin = uniqueUsername('a');
    const reg = await regUser(admin);
    const adminId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    const ctx = { params: Promise.resolve({ id: String(adminId) }) } as any;
    const r = await delUser(withCookie(cookie, new Request(`http://x/api/admin/users/${adminId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmUsername: admin }),
    })) as any, ctx);
    expect(r.status).toBe(400);
  });

  it('delete user cascade removes history; audit log has event', async () => {
    const admin = uniqueUsername('a');
    const target = uniqueUsername('t');
    await regUser(admin);
    const reg = await regUser(target);
    const targetId = (await reg.json()).data.user.id;
    const { cookie } = await loginAndCookie(admin);

    // 写一条 history
    const { POST: createHistory } = await import('@/app/api/history/route');
    const { cookie: targetCookie } = await loginAndCookie(target);
    const ch = await createHistory(withCookie(targetCookie, new Request('http://x/api/history', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text2pinyin', input: '你好', char_count: 2, dedup: false }),
    })) as any);
    expect(ch.status).toBe(200);

    // admin 删除 target
    const ctx = { params: Promise.resolve({ id: String(targetId) }) } as any;
    const r = await delUser(withCookie(cookie, new Request(`http://x/api/admin/users/${targetId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmUsername: target }),
    })) as any, ctx);
    expect(r.status).toBe(204);

    // 验证 cascade
    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const [u] = await pool.execute<any[]>(`SELECT id FROM users WHERE id = ?`, [targetId]);
    expect(u.length).toBe(0);
    const [h] = await pool.execute<any[]>(`SELECT id FROM history WHERE user_id = ?`, [targetId]);
    expect(h.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/integration/admin-crud.test.ts
```

期望：6 个 skip（无 DB） 或 6 个 pass。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/admin-crud.test.ts
git commit -m "test: admin CRUD integration suite (6 cases)"
```

---

## Task 33: README + .env.example 更新

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\README.md`
- Modify: `E:\ToolDevelop\PinYinCharacter\.env.example`

- [ ] **Step 1: README 在「账号系统」之后插入新章节**

插入位置：「## 路线图」之前。

```markdown
## 密码找回 + 管理员后台（v1 / Plan B+）

- **密码找回**：在登录框或 `/forgot-password` 输入用户名 → 系统发送一封带 magic link 的邮件（15 分钟内有效）。开发模式下邮件内容打印到 server console；生产环境配置 SMTP 后真实发送。
- **管理员后台**（首个注册的用户自动是 admin）：`/admin/users`、`/admin/audit`、`/admin/stats`
  - 写操作：删除用户（需输入用户名确认）、重置密码（生成临时密码）、提升/撤销管理员
  - 所有写操作都入审计日志
- **首个用户自动为 admin**：注册时检查 `users` 表行数，第一个注册的用户 `is_admin=1`，后续都是 0。
- **v1 限制**：密码重置成功后,旧会话的 JWT 仍有效至 7 天期满。如果需要立即失效所有旧会话,需在 `users` 表加 `token_version` 字段并在 `verifySession` 里比对 — 留待 Plan C。

### 邮件配置

`.env` 中：
- `MAIL_TRANSPORT=console`（默认）：邮件打印到 server console，无需 SMTP
- `MAIL_TRANSPORT=smtp`：启用真实 SMTP，需填 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`
```

- [ ] **Step 2: .env.example 已包含 mail 段（Task 1 已写），无需重复**

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add 密码找回 + 管理员后台 section to README"
```

---

## Task 34: 手动冒烟测试（人工 Task）

**重要**：本环境无 MySQL，此任务由用户在他们自己的 MySQL 实例上跑。

冒烟步骤（用户执行，参考 `docs/superpowers/specs/2026-06-09-pinyin-character-plan-b+-design.md` §9.3）：

1. 注册第一个用户 → 变 admin
2. 注册第二个用户（不是 admin）
3. 第二个用户在 `/forgot-password` 输入用户名 → server console 打印 reset URL
4. 把 URL 复制到浏览器 → 进 `/reset-password?token=xxx`
5. 设置新密码 → 跳回首页（已登录）
6. 用旧密码登录第二个用户 → 401
7. 用新密码登录第二个用户 → 200
8. 第二个用户访问 `/admin` → 重定向到 `/?error=forbidden`
9. 第一个用户访问 `/admin` → 看到侧栏，UserMenu 有「管理后台」链接
10. `/admin/users` 看到 2 个用户
11. 点第二个用户 → 详情页 → 点「重置密码」→ 复制临时密码 → 第二个用户用临时密码登录成功
12. 提升第二个用户为 admin → UserMenu 现在显示「管理后台」
13. 撤销第二个用户的 admin → 链接消失
14. 尝试撤销第一个用户（唯一 admin）→ 400 错误
15. 尝试删除第一个用户（自己）→ 400 错误
16. 删除第二个用户（确认输入用户名）→ 成功 → 历史/审计 cascade
17. 访问 `/admin/audit` → 看到 `admin_user_delete` 事件
18. 访问 `/admin/stats` → 数字正确

完成后回报。

---

## Task 35: 集成测试套件端到端跑通

**Files:**
- （无新文件，跑测试）

- [ ] **Step 1: 跑全套**

```bash
pnpm test
```

期望：unit 全过（≥ 60），integration 6+5=11 个全过（用户有 MySQL 时）或全 skip（无 DB 时）。

- [ ] **Step 2: 类型检查**

```bash
pnpm exec tsc --noEmit
```

期望：clean。

- [ ] **Step 3: build 跑通**

```bash
pnpm build
```

期望：18+ routes 编译成功（多了 11 个新 API + 6 个新 page）。

- [ ] **Step 4: Commit（如有需要）**

如果没东西改就不 commit。

---

## Task 36: admin 单元测试 (纯函数 + 辅助)

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\admin.test.ts`

注意：admin.ts 里大部分函数（listUsers / getUserDetail / getAuditLog / getSystemStats / countOtherAdmins / deleteUserCascade / setUserAdmin / setUserPasswordHash）都直连 DB，纯单元测试需要 mock `getPool`。这些函数的覆盖由 Task 32 集成测试完成。本任务只测**纯函数**部分。

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { generateTempPassword } from '@/lib/admin';

describe('admin pure helpers', () => {
  it('generateTempPassword returns 16+ char base64url', () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls return different passwords', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
```

- [ ] **Step 2: 跑测试 pass**

```bash
pnpm test tests/unit/lib/admin.test.ts
```

期望：2/2 通过。

- [ ] **Step 3: Commit**

```bash
git add tests/unit/lib/admin.test.ts
git commit -m "test: admin pure helpers (generateTempPassword)"
```

---

## Final: 整体 code review

派一个独立子代理做 final code review（spec compliance + code quality）：
- 对照 spec 检查 12 个章节是否都实现
- 重点看：SMTP 行为、admin guard、rate limit、HTML 模板、cascading delete
- 跑一遍 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`

如有发现，单独开 commit 修复。

---

## 验证（Definition of Done）

- [ ] `pnpm test` 全部通过（unit + integration，DB 缺时 integration skip）
  - 期望：unit ≥ 70 全过，integration 11 个（无 DB 时全 skip）
- [ ] `pnpm exec tsc --noEmit` 干净
- [ ] `pnpm build` 18+ routes
- [ ] 36 个任务全部 commit 在 `main` 分支
- [ ] 用户完成 Task 34 冒烟测试全过
- [ ] README 含「密码找回 + 管理员后台」章节
- [ ] 4 个 deferred 项（OAuth、密码轮换、RBAC、i18n）确认未实现
