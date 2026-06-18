# Platform Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small, independent changes — (1) add a 古籍 nav link to a placeholder page, (2) move SMTP config from `.env` to `app_config` with a full admin UI, (3) filter admin-only sections out of the public `/guide` page.

**Architecture:**
- Nav + placeholder = pure presentation, no DB.
- SMTP = new `lib/smtp-config.ts` reading `app_config` with env fallback; admin UI mirrors the existing `ai.*` pattern (`/admin/ai` page + `/api/admin/ai/config` route). Same `app_config` validators pattern as `lib/config.ts`.
- Guide filter = pure function added to `app/guide/page.tsx` that drops H2 sections by heading; tested in isolation.

**Tech Stack:** Next.js 15 App Router, MySQL 5.7, `app_config` table, Zod, Vitest, nodemailer.

## Global Constraints

- **Existing patterns:** every admin config form follows `app/admin/ai/page.tsx` + `app/api/admin/ai/config/route.ts`. New SMTP UI mirrors that exactly.
- **Audit events:** all mutating user/admin endpoints log to `audit_log` via `writeAudit()` (from `lib/audit.ts`) with event names from `AuditEvent` union in `lib/audit-format.ts`. New events: `smtp_config_updated`, `smtp_test_sent`. Add `formatLogMessage` cases for both.
- **DB read pattern:** use `getConfig(key)` from `lib/config.ts` for any `app_config` lookup. Validators go in `KEY_VALIDATORS` in `lib/config.ts`.
- **Test runner:** Vitest. Tests live in `tests/unit/lib/*.test.ts` (matching the project pattern; no `tests/unit/app/` dir). Add `// @vitest-environment node` only when DB is touched.
- **Dev server:** `pnpm dev` on port 4444 (per `package.json`). Don't run it from inside a task — assume one is already running.
- **Build verification:** every task ends with `pnpm tsc --noEmit` and `pnpm build` clean.

---

## File Structure

**New files (6):**
- `app/ancient-texts/page.tsx` — RSC placeholder page
- `lib/smtp-config.ts` — typed DB reader with env fallback
- `app/admin/email/page.tsx` — RSC admin page (loads current values)
- `components/admin/SmtpConfigForm.tsx` — client form (save + test-send)
- `app/api/admin/email/config/route.ts` — POST: save SMTP config
- `app/api/admin/email/test/route.ts` — POST: send a test email

**New tests (2):**
- `tests/unit/lib/guide-filter.test.ts` — 6 tests for the blocklist
- `tests/unit/lib/smtp-config.test.ts` — tests for DB vs env precedence (extends email tests, see Task 3)

**Edit (8):**
- `lib/design.ts` — add 古籍 to `NAV_LINKS`
- `components/Header.tsx` — filter `/ancient-texts` in safeMode
- `app/guide/page.tsx` — export `filterUserReadme` + use it
- `lib/email.ts` — replace `process.env` reads with `getSmtpConfig` / `getMailTransport`
- `lib/config.ts` — add `smtp.*` validators
- `lib/audit-format.ts` — add 2 events + 2 formatLogMessage cases
- `components/admin/AdminSidebar.tsx` — add 邮件 link
- `tests/unit/lib/email.test.ts` — adjust to new behavior (DB default = console)

---

## Task 1: Ancient Texts nav + placeholder page

**Files:**
- Edit: `lib/design.ts:9-19` (add 1 entry to `NAV_LINKS`)
- Edit: `components/Header.tsx:17` (extend safeMode filter)
- Create: `app/ancient-texts/page.tsx` (RSC)

No tests, no API, no DB.

### Step 1: Add `古籍` to `NAV_LINKS`

Edit `lib/design.ts` line 9-19. Insert one new line **after** the `/sutra` entry (line 15):

```ts
export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/dictionary', label: '字典' },
  { href: '/worksheet', label: '字帖' },
  { href: '/pinyin', label: '字转拼音' },
  { href: '/poetry', label: '诗词' },
  { href: '/sutra', label: '佛经' },
  { href: '/ancient-texts', label: '古籍' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
  { href: '/membership', label: '会员' },
] as const;
```

### Step 2: Hide `/ancient-texts` in safeMode

Edit `components/Header.tsx:17`. Replace the existing filter with one that excludes both sutra and ancient-texts:

```ts
// 儿童模式默认隐藏佛经/古籍导航(古典/宗教内容偏成人);关闭儿童模式后恢复
const visibleNavLinks = safeMode
  ? NAV_LINKS.filter((l) => l.href !== '/sutra' && l.href !== '/ancient-texts')
  : NAV_LINKS;
```

### Step 3: Create the placeholder page

Create `app/ancient-texts/page.tsx`:

```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '古籍 · 字·韵',
  description: '字·韵 古籍模块:经史子集等经典文本,提供原文、断句、注释对照与生字长句的拼音注释。',
};

export default function AncientTextsPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-3xl mx-auto py-12 space-y-6">
          <h1 className="text-3xl font-bold text-ink">古籍 / Classical Texts</h1>

          <p className="text-base text-ink-soft leading-relaxed">
            古籍模块筹备中。计划收录经史子集等经典文本,提供原文、断句、注释对照,以及对生字、长句的拼音注释。
            让你在读古文时,既能看到原汁原味的经典,也能随时查字、读音、释义。敬请期待。
          </p>

          <div className="card-paper rounded-lg p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink">先逛逛这些</h2>
            <ul className="text-sm text-ink-soft space-y-1 list-disc list-inside">
              <li>
                <Link href="/sutra" className="text-seal hover:underline">佛经</Link>
                <span className="ml-1">— 已有的佛经阅读模块,带分章/拼音注释</span>
              </li>
              <li>
                <Link href="/dictionary" className="text-seal hover:underline">字典</Link>
                <span className="ml-1">— 查字形、字义、字源、读音</span>
              </li>
            </ul>
          </div>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

If `components/common/PageContainer` doesn't exist as named, mirror `/about`'s import: use the same container used in `app/about/page.tsx`. Check the existing pattern before saving.

### Step 4: Verify

Run:
```bash
pnpm tsc --noEmit
pnpm build
```

Expected: both succeed. Build output should show `ƒ /ancient-texts` in the route summary.

Then hit the dev server:
```bash
curl -s -o /dev/null -w "ancient-texts: %{http_code}\n" http://localhost:4444/ancient-texts
curl -s http://localhost:4444/ancient-texts | grep -oE '古籍|先逛逛这些|/sutra|/dictionary' | sort -u
```

Expected: `200`, all four strings present.

### Step 5: Commit

```bash
git add lib/design.ts components/Header.tsx app/ancient-texts/page.tsx
git commit -m "feat(nav): add 古籍 nav link to placeholder page

Hides the link in 儿童模式 (classical/ancient content, same rule as
佛经). Page explains planned scope and links to existing 佛经 and 字典
modules.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: /guide filter — drop admin sections

**Files:**
- Create: `tests/unit/lib/guide-filter.test.ts` (failing test first)
- Edit: `app/guide/page.tsx` (export `filterUserReadme`, use it in render)

TDD: write the test, see it fail, implement, see it pass.

### Step 1: Write the failing test

Create `tests/unit/lib/guide-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterUserReadme } from '@/app/guide/page';

// 简化版 README 用来验证 blocklist 行为;真实 README 在 lib/email.ts 测试中已覆盖结构。
const SAMPLE = `# 字 ↔ 拼音 工具

项目描述段。这里写项目是干什么的。

## 功能

汉字转拼音。

## 启动

\`\`\`bash
pnpm install
\`\`\`

## 测试

\`\`\`bash
pnpm test
\`\`\`

## 技术栈

Next.js + MySQL。

## 账号系统

注册 / 登录。

## 密码找回 + 管理员后台

如何重置密码。

## 管理员后台扩展

后台管理用户。

## 罕见字库

罕见字。

## 环境变量

DATABASE_URL 必填。

## 路线图

v2 计划。
`;

describe('filterUserReadme', () => {
  it('removes 启动 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 启动');
    expect(out).not.toContain('pnpm install');
  });

  it('removes 测试 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 测试');
    expect(out).not.toContain('pnpm test');
  });

  it('removes 管理员后台扩展 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 管理员后台扩展');
    expect(out).not.toContain('后台管理用户');
  });

  it('removes 环境变量 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 环境变量');
    expect(out).not.toContain('DATABASE_URL 必填');
  });

  it('keeps 密码找回 + 管理员后台 section intact (users need to know how to reset password)', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).toContain('## 密码找回 + 管理员后台');
    expect(out).toContain('如何重置密码');
  });

  it('keeps H1 and earlier user sections intact', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).toContain('# 字 ↔ 拼音 工具');
    expect(out).toContain('项目描述段');
    expect(out).toContain('## 功能');
    expect(out).toContain('## 技术栈');
    expect(out).toContain('## 路线图');
  });
});
```

### Step 2: Run the test, expect FAIL

Run:
```bash
pnpm test tests/unit/lib/guide-filter.test.ts 2>&1 | tail -30
```

Expected: FAIL with `filterUserReadme is not a function` (or similar). The import itself should resolve because the `@` alias points to the project root per `vitest.config.ts`.

### Step 3: Implement `filterUserReadme` in `app/guide/page.tsx`

The page currently lives in `app/guide/page.tsx`. Edit it to:

1. Export a new top-level function `filterUserReadme(md: string): string`.
2. Call it from the default export after `readReadme()`.

Use the **plain** text blocklist (no Pinyin / parenthesis variations) to keep it readable. Match by exact H2 heading text since the README uses consistent wording:

```ts
const BLOCKED_H2_SECTIONS = [
  '## 启动',
  '## 测试',
  '## 管理员后台扩展',
  '## 环境变量',
] as const;

/**
 * Drop H2 sections that are admin/deployment-only from the README so that
 * the public /guide page shows only user-facing content. Matching is exact
 * text — keep the blocklist short and obvious.
 */
export function filterUserReadme(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      skip = (BLOCKED_H2_SECTIONS as readonly string[]).includes(line);
    }
    if (!skip) out.push(line);
  }
  return out.join('\n');
}
```

Then in the default export, change:
```ts
const md = readReadme();
const html = renderMarkdown(md);
```
to:
```ts
const md = filterUserReadme(readReadme());
const html = renderMarkdown(md);
```

### Step 4: Run the test, expect PASS

Run:
```bash
pnpm test tests/unit/lib/guide-filter.test.ts 2>&1 | tail -20
```

Expected: 6/6 passing.

If the import path is the issue, change the test import to whatever alias the project uses for `app/`. Look at `vitest.config.ts` for the `@` alias mapping — if it maps to project root, use `@/app/guide/page` (no `..`). Confirm before committing.

### Step 5: Verify in browser

```bash
pnpm tsc --noEmit
pnpm build
curl -s http://localhost:4444/guide | grep -oE '<h2[^>]*>[^<]+' | head -20
```

Expected: H2 list contains `功能`, `技术栈`, `账号系统`, `密码找回 + 管理员后台`, `罕见字库`, `字典 + 字源`, `识字游戏...`, `读故事`, `路线图`. It should NOT contain `启动`, `测试`, `管理员后台扩展`, `环境变量`.

### Step 6: Commit

```bash
git add app/guide/page.tsx tests/unit/lib/guide-filter.test.ts
git commit -m "feat(guide): drop admin/deployment sections from /guide

Code-level blocklist in app/guide/page.tsx drops these H2 sections:
- ## 启动
- ## 测试
- ## 管理员后台扩展
- ## 环境变量

密码找回 + 管理员后台 section is kept (end users need to know how
to reset password). Tests cover each blocked section + the kept one.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: SMTP config → `app_config` + full admin UI

Largest task. Sub-steps:

- 3a: New `lib/smtp-config.ts` (typed DB reader with env fallback)
- 3b: Refactor `lib/email.ts` to use it
- 3c: Extend `lib/config.ts` validators
- 3d: Adjust `tests/unit/lib/email.test.ts` for new behavior, add new tests
- 3e: Extend `lib/audit-format.ts` (events + formatter)
- 3f: New `app/admin/email/page.tsx`
- 3g: New `components/admin/SmtpConfigForm.tsx`
- 3h: New `app/api/admin/email/config/route.ts`
- 3i: New `app/api/admin/email/test/route.ts`
- 3j: Update sidebar
- Verify
- Commit

### Step 1 (3a): Create `lib/smtp-config.ts`

```ts
import { getConfig } from './config';

export type MailTransport = 'console' | 'smtp';

export interface SmtpConfig {
  transport: MailTransport;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

const KEYS = {
  transport: 'smtp.transport',
  host: 'smtp.host',
  port: 'smtp.port',
  secure: 'smtp.secure',
  user: 'smtp.user',
  pass: 'smtp.pass',
  from: 'smtp.from',
  fromName: 'smtp.from_name',
} as const;

/**
 * Read the current mail transport ('console' or 'smtp').
 * - Returns 'smtp' only if app_config has smtp.transport === 'smtp' AND a host is set.
 * - Otherwise returns 'console' (the safe default).
 */
export async function getMailTransport(): Promise<MailTransport> {
  const t = await getConfig(KEYS.transport);
  if (t === 'smtp') {
    const host = await getConfig(KEYS.host);
    if (host && host.length > 0) return 'smtp';
  }
  return 'console';
}

/**
 * Read SMTP config. If transport is 'console' OR host is missing, returns null
 * (callers should fall back to env or short-circuit). When DB values are
 * absent, fall back to process.env.SMTP_* so existing deployments keep
 * working until an admin saves new values.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [dbTransport, dbHost, dbPort, dbSecure, dbUser, dbPass, dbFrom, dbFromName] = await Promise.all([
    getConfig(KEYS.transport),
    getConfig(KEYS.host),
    getConfig(KEYS.port),
    getConfig(KEYS.secure),
    getConfig(KEYS.user),
    getConfig(KEYS.pass),
    getConfig(KEYS.from),
    getConfig(KEYS.from_name),
  ]);

  // DB transport must be 'smtp' to return a non-null config.
  if (dbTransport !== 'smtp') return null;

  // Host: DB > env fallback
  const host = dbHost ?? process.env.SMTP_HOST ?? null;
  if (!host) return null;

  const portStr = dbPort ?? process.env.SMTP_PORT;
  const port = portStr ? parseInt(portStr, 10) : 587;

  const secureStr = dbSecure ?? process.env.SMTP_SECURE;
  const secure = secureStr === 'true';

  return {
    transport: 'smtp',
    host,
    port,
    secure,
    user: dbUser ?? process.env.SMTP_USER ?? '',
    pass: dbPass ?? process.env.SMTP_PASS ?? '',
    from: dbFrom ?? process.env.MAIL_FROM ?? '',
    fromName: dbFromName ?? process.env.MAIL_FROM_NAME ?? '',
  };
}
```

### Step 2 (3b): Refactor `lib/email.ts`

Replace the entire file content with:

```ts
import nodemailer, { type Transporter } from 'nodemailer';
import { getMailTransport, getSmtpConfig } from './smtp-config';

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

function buildTransport(cfg: NonNullable<Awaited<ReturnType<typeof getSmtpConfig>>>): Transporter {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  return cachedTransport;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const transport = await getMailTransport();

  if (transport === 'console') {
    console.log(`[email] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    return;
  }

  const cfg = await getSmtpConfig();
  if (!cfg) {
    throw new EmailNotConfiguredError('SMTP is not fully configured (set smtp.transport, smtp.host, smtp.from in app_config or SMTP_* in env)');
  }
  if (!cfg.from) {
    throw new EmailNotConfiguredError('MAIL_FROM is not set');
  }

  try {
    const tx = buildTransport(cfg);
    await tx.sendMail({
      from: cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) throw e;
    cachedTransport = null;
    throw new EmailSendError(e instanceof Error ? e.message : String(e));
  }
}
```

### Step 3 (3c): Add `smtp.*` validators in `lib/config.ts`

Edit `lib/config.ts:3-27`. Add these entries inside `KEY_VALIDATORS` (place them after the `tts.*` block, before the closing `};`):

```ts
  'smtp.transport': (v) => v === 'console' || v === 'smtp',
  'smtp.host': (v) => v.length === 0 || v.length <= 256,
  'smtp.port': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535;
  },
  'smtp.secure': (v) => v === 'true' || v === 'false',
  'smtp.user': (v) => v.length <= 256,
  'smtp.pass': (v) => v.length <= 256,
  'smtp.from': (v) => v.length === 0 || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  'smtp.from_name': (v) => v.length <= 128,
```

### Step 4 (3d): Update email tests

Edit `tests/unit/lib/email.test.ts`. The existing tests rely on `process.env.MAIL_TRANSPORT=smtp` triggering SMTP path. After the refactor, `getMailTransport()` first checks `app_config.smtp.transport`, and only falls back to env if DB is empty. The existing tests should still pass because the test DB won't have `smtp.transport` set, so the env value takes effect.

But add a new test for DB precedence. Replace the file with:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';
import { setConfig, getPool, closePool } from '@/lib/db';

// @vitest-environment node
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

  afterAll(async () => {
    await getPool().query(`DELETE FROM app_config WHERE \`key\` LIKE 'smtp.%'`);
    await closePool();
  });

  it('MAIL_TRANSPORT=console writes to console.log', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>x</p>', text: 'x' });
    expect(consoleSpy).toHaveBeenCalled();
    const out = consoleSpy.mock.calls[0].join(' ');
    expect(out).toContain('a@b.com');
    expect(out).toContain('hi');
  });

  it('defaults to console when MAIL_TRANSPORT unset and no DB entry', async () => {
    delete process.env.MAIL_TRANSPORT;
    await sendEmail({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('MAIL_TRANSPORT=smtp + missing host throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_HOST;
    // also clear DB to make sure env path triggers
    await getPool().query(`DELETE FROM app_config WHERE \`key\` = 'smtp.host'`);
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

  it('DB smtp.transport=smtp takes precedence over env=console', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await setConfig('smtp.transport', 'smtp', null);
    await setConfig('smtp.host', 'localhost', null);
    await setConfig('smtp.from', 'test@local', null);
    // We expect it to TRY to send (not console.log). The send will fail
    // because localhost:25 isn't real, but the failure mode is EmailSendError,
    // not console output.
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailSendError);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
```

### Step 5 (3e): Add audit events

Edit `lib/audit-format.ts`. Add two new event types to the `AuditEvent` union (line 9-26), after the last entry:

```ts
  | 'smtp_config_updated' | 'smtp_test_sent';
```

Add two new cases inside `formatLogMessage` (after the `admin_about_intro_regenerated` case at line 110, before `default:`):

```ts
    case 'smtp_config_updated':
      return `更新邮件配置${Array.isArray(m.keys) && m.keys.length ? `(${join(m.keys as string[])})` : ''}`;
    case 'smtp_test_sent':
      return `测试邮件发送 (to=${str(m.to) || '?'}, ok=${m.ok === true ? 'true' : m.ok === false ? 'false' : '?'}${str(m.error) ? `, error=${str(m.error)}` : ''})`;
```

### Step 6 (3f): Create admin page `app/admin/email/page.tsx`

```tsx
import { getAllConfig } from '@/lib/config';
import { SmtpConfigForm } from '@/components/admin/SmtpConfigForm';

export const dynamic = 'force-dynamic';

export default async function AdminEmailPage() {
  const all = await getAllConfig();
  // Mask the password (return '' if set) — UI uses "leave empty to keep".
  const initial = {
    transport: (all['smtp.transport'] ?? 'console') as 'console' | 'smtp',
    host: all['smtp.host'] ?? '',
    port: all['smtp.port'] ?? '587',
    secure: all['smtp.secure'] === 'true',
    user: all['smtp.user'] ?? '',
    passSet: !!all['smtp.pass'],
    from: all['smtp.from'] ?? '',
    fromName: all['smtp.from_name'] ?? '',
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">邮件</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        邮件发送配置。写入 <code>app_config</code> 表,优先级高于 <code>SMTP_*</code> 环境变量。
        在 <code>smtp.transport=console</code> 时只把邮件内容打印到服务器日志(开发用)。
      </p>
      <SmtpConfigForm initial={initial} />
    </div>
  );
}
```

### Step 7 (3g): Create `components/admin/SmtpConfigForm.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Check } from 'lucide-react';

export interface SmtpConfigInitial {
  transport: 'console' | 'smtp';
  host: string;
  port: string;
  secure: boolean;
  user: string;
  passSet: boolean;
  from: string;
  fromName: string;
}

export function SmtpConfigForm({ initial }: { initial: SmtpConfigInitial }) {
  const router = useRouter();
  const [form, setForm] = useState({
    transport: initial.transport,
    host: initial.host,
    port: initial.port,
    secure: initial.secure,
    user: initial.user,
    pass: '',
    from: initial.from,
    fromName: initial.fromName,
  });
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(null); setTestResult(null);
    const body: Record<string, string> = {
      'smtp.transport': form.transport,
      'smtp.host': form.host,
      'smtp.port': form.port,
      'smtp.secure': form.secure ? 'true' : 'false',
      'smtp.user': form.user,
      'smtp.from': form.from,
      'smtp.from_name': form.fromName,
    };
    if (form.pass) body['smtp.pass'] = form.pass; // empty = keep
    try {
      const res = await fetch('/api/admin/email/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '保存失败');
      setOk('配置已保存');
      setForm(f => ({ ...f, pass: '' })); // clear pass field after save
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!testTo) {
      setTestResult({ ok: false, message: '请输入收件邮箱' });
      return;
    }
    setTestBusy(true); setTestResult(null);
    try {
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '发送失败');
      setTestResult({ ok: true, message: '测试邮件已发送,请检查收件箱' });
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3">
        {err && <p className="text-sm text-seal">{err}</p>}
        {ok && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{ok}</p>}

        <div>
          <label className="text-sm font-medium">传输方式</label>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="transport" value="console"
                checked={form.transport === 'console'}
                onChange={() => setForm(f => ({ ...f, transport: 'console' }))} />
              console(只打印)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="transport" value="smtp"
                checked={form.transport === 'smtp'}
                onChange={() => setForm(f => ({ ...f, transport: 'smtp' }))} />
              smtp(实际发送)
            </label>
          </div>
        </div>

        <Field label="SMTP 主机" placeholder="smtp.example.com"
          value={form.host} onChange={v => setForm(f => ({ ...f, host: v }))} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="端口" placeholder="587"
            value={form.port} onChange={v => setForm(f => ({ ...f, port: v }))} />
          <label className="flex items-end gap-2 text-sm pb-2">
            <input type="checkbox" checked={form.secure}
              onChange={e => setForm(f => ({ ...f, secure: e.target.checked }))} />
            <span>SSL/TLS (465)</span>
          </label>
        </div>
        <Field label="用户名" value={form.user}
          onChange={v => setForm(f => ({ ...f, user: v }))} />
        <div>
          <label className="text-sm font-medium">
            密码 (SMTP 密码 / 授权码)
            <span className="ml-2 text-xs text-ink-soft">
              {form.pass ? '将覆盖现有值' : initial.passSet ? '已配置,留空不改' : '尚未配置'}
            </span>
          </label>
          <div className="mt-1 flex gap-1">
            <input
              type={showPass ? 'text' : 'password'}
              value={form.pass}
              onChange={e => setForm(f => ({ ...f, pass: e.target.value }))}
              placeholder={initial.passSet ? '(未修改)' : ''}
              className="flex-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="px-2 border border-paper-warm rounded text-ink-soft hover:bg-paper-deep"
              aria-label={showPass ? '隐藏密码' : '显示密码'}>
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Field label="发件邮箱 (From)" placeholder="noreply@example.com"
          value={form.from} onChange={v => setForm(f => ({ ...f, from: v }))} />
        <Field label="发件人名称 (可选)" placeholder="字·韵"
          value={form.fromName} onChange={v => setForm(f => ({ ...f, fromName: v }))} />

        <button type="submit" disabled={busy}
          className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
          {busy ? '保存中…' : '保存'}
        </button>
      </form>

      <div className="card-paper rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-ink">发送测试邮件</h2>
        <p className="text-xs text-ink-soft">使用上方保存的配置发送一封测试邮件到指定收件人,验证 SMTP 设置是否正确。</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          />
          <button type="button" onClick={sendTest} disabled={testBusy || !testTo}
            className="text-sm px-3 py-1.5 border border-ink/20 rounded hover:bg-paper-deep disabled:opacity-50">
            {testBusy ? '发送中…' : '发送'}
          </button>
        </div>
        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-seal'}`}>{testResult.message}</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
    </div>
  );
}
```

### Step 8 (3h): Create `app/api/admin/email/config/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const SmtpConfigSchema = z.object({
  'smtp.transport': z.enum(['console', 'smtp']).optional(),
  'smtp.host': z.string().max(256).optional(),
  'smtp.port': z.string().regex(/^\d+$/).optional(),
  'smtp.secure': z.enum(['true', 'false']).optional(),
  'smtp.user': z.string().max(256).optional(),
  'smtp.pass': z.string().max(256).optional(),
  'smtp.from': z.string().max(256).optional(),
  'smtp.from_name': z.string().max(128).optional(),
});

const SECRET_KEYS: ReadonlySet<string> = new Set(['smtp.pass']);

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = SmtpConfigSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined && v !== '') updates[k] = v;
    }
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');
    try {
      await setConfigBatch(updates, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'smtp_config_updated',
      metadata: { keys: Object.keys(updates) },
    });
    const all = await getAllConfig();
    const config: Record<string, string | null> = {
      'smtp.transport': all['smtp.transport'] ?? 'console',
      'smtp.host': all['smtp.host'] ?? '',
      'smtp.port': all['smtp.port'] ?? '',
      'smtp.secure': all['smtp.secure'] ?? '',
      'smtp.user': all['smtp.user'] ?? '',
      'smtp.from': all['smtp.from'] ?? '',
      'smtp.from_name': all['smtp.from_name'] ?? '',
    };
    // Don't echo the password back.
    const passSet = !!all['smtp.pass'];
    return NextResponse.json({ ok: true, data: { config, passSet } });
  });
}
```

### Step 9 (3i): Create `app/api/admin/email/test/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';

const TestSchema = z.object({ to: z.string().email() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = TestSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const { to } = parsed.data;

    let ok = false;
    let error: string | null = null;
    try {
      await sendEmail({
        to,
        subject: '字·韵 SMTP 测试',
        html: '<p>这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。</p>',
        text: '这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。',
      });
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'smtp_test_sent',
      metadata: { to, ok, error },
    });
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: { code: 'send_failed', message: error ?? 'send failed' } },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data: { to } });
  });
}

// Avoid unused-import warning for EmailNotConfiguredError / EmailSendError;
// these are caught by the generic `e` above but listed here for clarity.
void EmailNotConfiguredError;
void EmailSendError;
```

### Step 10 (3j): Add 邮件 entry to sidebar

Edit `components/admin/AdminSidebar.tsx:4-15`. Add a new entry after 语音设置:

```ts
const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/chars/init', label: '⚙ 初始化', exact: true },
  { href: '/admin/scheduler', label: '定期更新', exact: true },
  { href: '/admin/memberships', label: '会员' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
  { href: '/admin/email', label: '邮件' },
];
```

### Step 11: Verify

```bash
pnpm tsc --noEmit
pnpm build
pnpm test tests/unit/lib/email.test.ts tests/unit/lib/guide-filter.test.ts
```

Expected:
- tsc clean
- Build succeeds; new routes appear: `ƒ /admin/email`, `ƒ /api/admin/email/config`, `ƒ /api/admin/email/test`
- All tests pass (8 email + 6 guide-filter)

Then smoke in browser:
```bash
curl -s -o /dev/null -w "admin/email: %{http_code}\n" -b "session=<admin-cookie>" http://localhost:4444/admin/email
```

Expected: 200 if logged in as admin, redirect to `/` if not.

### Step 12: Commit

```bash
git add lib/smtp-config.ts lib/email.ts lib/config.ts lib/audit-format.ts \
        app/admin/email/page.tsx components/admin/SmtpConfigForm.tsx \
        app/api/admin/email/config/route.ts app/api/admin/email/test/route.ts \
        components/admin/AdminSidebar.tsx \
        tests/unit/lib/email.test.ts

git commit -m "feat(admin): SMTP config to app_config with full admin UI

- New lib/smtp-config.ts: typed DB reader with SMTP_* env fallback so
  existing deployments keep working until admin saves new values.
- lib/email.ts refactored to use getSmtpConfig()/getMailTransport().
- Validators added for smtp.* keys in lib/config.ts.
- New /admin/email page + /api/admin/email/{config,test} routes.
  - Save: writes validated app_config, audit-logged as
    smtp_config_updated.
  - Test send: posts to /api/admin/email/test, audit-logged as
    smtp_test_sent.
  - Password field uses 'leave empty to keep' semantics to avoid
    accidental lockout.
- New audit events + formatLogMessage cases in lib/audit-format.ts.
- Sidebar entry 邮件 added after 语音设置.
- Email tests updated for DB-precedence behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification

After all 3 tasks are committed:

1. `pnpm tsc --noEmit` clean
2. `pnpm build` clean (4 new routes visible)
3. `pnpm test` — all tests pass (6 guide-filter + 5 email existing + 1 new DB-precedence)
4. Browser smoke (manual, on `http://localhost:4444`):
   - Nav: 古籍 visible (and hidden in 儿童模式)
   - `/ancient-texts` renders placeholder, lists 佛经 + 字典 links
   - `/guide` shows user sections; admin sections absent
   - `/admin/email` (as admin): form loads, save persists, "发送测试邮件" returns success
   - Real email arrives when SMTP is configured

## Final commit

If multiple commits were used (one per task), no separate final commit is needed. The 3 feature commits plus the spec commit already tell the full story.
