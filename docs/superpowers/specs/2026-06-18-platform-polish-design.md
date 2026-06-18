# Platform Polish — Ancient Texts Nav, SMTP Admin, Guide Filter

**Date:** 2026-06-18
**Status:** Draft
**Scope:** 3 small, independent changes to the user-facing nav, admin config layer, and public /guide page.

---

## Context

Three loose ends from earlier work:

1. **Nav completeness** — the project plans for an 古籍 (classical texts) module but it has no nav entry yet, so users can't reach it once content lands.
2. **Config hygiene** — SMTP credentials currently live in `.env` like a developer secret, but the project already has a consistent pattern of moving operational config to the admin dashboard (`app_config` table) and reading it via `getConfig()`. Email is the last outbound channel still on `.env`.
3. **Public doc quality** — `/guide` renders the project README verbatim. The README is written for developers and contributors, so it currently exposes admin, deployment, and testing sections to end users. The user-facing guide should reflect what end users need to know.

Each change is small enough to be a single focused task; together they form one logical "polish" pass and ship as one commit.

---

## Change 1 — 古籍 nav + placeholder page

### Goal
Add a discoverable entry for the forthcoming 古籍 module. Page is a stub; content arrives in a follow-up plan.

### Nav
- Append `{ href: '/ancient-texts', label: '古籍' }` to `NAV_LINKS` in `lib/design.ts:9-19`, placed after `{ href: '/sutra', label: '佛经' }` to group cultural-content modules.
- Add `'ancient-texts'` to the `safeMode` filter in `components/Header.tsx:17` so it disappears in 儿童模式 (same rule as 佛经 — classical/ancient texts not appropriate for safe mode).

### Page — `app/ancient-texts/page.tsx` (RSC)
- Mirrors `/about` shell: `<Suspense><Header/></Suspense>` → `PageContainer` → `Footer`.
- Title "古籍 / Classical Texts" (`<h1 className="text-3xl font-bold text-ink">`).
- Body paragraph explaining the planned scope: 经史子集, original text with sentence breaks and annotations, pinyin glosses for difficult characters and phrases.
- Two related-content links: `/sutra` (佛经) and `/dictionary` (字典).
- `export const metadata = { title: '古籍 · 字·韵', description: '...' }`.
- `export const dynamic = 'force-dynamic'`.
- No API, no DB.

### Files
- **Edit:** `lib/design.ts`, `components/Header.tsx`
- **New:** `app/ancient-texts/page.tsx`

---

## Change 2 — SMTP → `app_config` + full admin UI

### Goal
Move SMTP credentials from `.env` to the `app_config` table and surface them in a dedicated admin page that mirrors the existing `ai.*` / `paypal.*` admin patterns. `.env` values become a fallback so existing deployments don't break.

### Reading layer — new `lib/smtp-config.ts`
```ts
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

export async function getMailTransport(): Promise<MailTransport>;
export async function getSmtpConfig(): Promise<SmtpConfig | null>;
```
- Reads `smtp.*` keys from `app_config` via existing `getConfig()`.
- `getMailTransport()` returns `'smtp'` only if `smtp.transport` is `'smtp'` AND `smtp.host` is non-empty.
- **Fallback chain:** if a key is missing from DB, fall back to `process.env.SMTP_*`. `MAIL_FROM` and `MAIL_FROM_NAME` env vars are also accepted as last-resort defaults. This keeps existing `.env`-only deployments working until an admin saves the new values.

### Rewrite `lib/email.ts`
- `sendEmail()` becomes:
  ```
  transport = await getMailTransport()
  if transport === 'smtp':
    cfg = await getSmtpConfig()
    if !cfg: throw (config incomplete)
    send via nodemailer using cfg
  else:
    console.log the message
  ```
- Remove direct `process.env.SMTP_*` reads; centralize in `lib/smtp-config.ts`.

### DB keys (all string-typed, namespace `smtp.*`)
| Key | Validator | Default |
|---|---|---|
| `smtp.transport` | enum `console` \| `smtp` | `console` |
| `smtp.host` | non-empty when transport=smtp | — |
| `smtp.port` | integer (1-65535) | `587` |
| `smtp.secure` | boolean string | `false` |
| `smtp.user` | string | — |
| `smtp.pass` | string | — |
| `smtp.from` | email-format when transport=smtp | — |
| `smtp.from_name` | string | — |

Extend `KEY_VALIDATORS` in `lib/config.ts:3-27` to include these.

### Admin UI
- **New page** `app/admin/email/page.tsx` (RSC) — server-loads current `getSmtpConfig()` + `getMailTransport()` + `getConfig('smtp.*')` for each key, hands values to client form.
- **New client component** `components/admin/SmtpConfigForm.tsx`:
  - Form fields: transport (radio: console/smtp), host, port, secure (checkbox), user, password (input with show/hide toggle), from, fromName.
    - **Password overwrite rule:** the password field is "leave empty to keep existing". On save, if the field is empty, the existing `smtp.pass` is not touched. If non-empty, it overwrites. (Prevents accidental lockout from blanking the field on save.)
  - "保存" → `POST /api/admin/email/config` writes validated app_config, returns new values, logs `smtp_config_updated` audit.
  - "发送测试邮件" → `POST /api/admin/email/test` with `{ to }`, sends one test message to verify config, logs `smtp_test_sent` audit. Result shown inline (success / error message).
- **New API routes:**
  - `app/api/admin/email/config/route.ts` — POST: admin auth → validate against KEY_VALIDATORS → writeConfig() → writeAudit.
  - `app/api/admin/email/test/route.ts` — POST: admin auth → getSmtpConfig() → sendEmail({ to, subject: '字·韵 SMTP 测试', text: '...' }) → writeAudit.
- **Sidebar** — add `{ href: '/admin/email', label: '邮件' }` to `components/admin/AdminSidebar.tsx`, placed after 语音设置.

### Audit events (extend `AuditEvent` union in `lib/audit-format.ts`)
- `smtp_config_updated` — `metadata: { keys: string[] }` (which fields were saved)
- `smtp_test_sent` — `metadata: { to: string, ok: boolean, error?: string }`

Add `formatLogMessage` cases:
- `smtp_config_updated` → "更新邮件配置(enabled、host、…)"
- `smtp_test_sent` → "测试邮件发送 (to=…, ok=true)" / "测试邮件发送失败 (to=…, error=…)"

### Files
- **New:** `lib/smtp-config.ts`, `app/admin/email/page.tsx`, `components/admin/SmtpConfigForm.tsx`, `app/api/admin/email/config/route.ts`, `app/api/admin/email/test/route.ts`
- **Edit:** `lib/email.ts`, `lib/config.ts`, `lib/audit-format.ts`, `components/admin/AdminSidebar.tsx`

### Backwards compat
Existing deployments with `SMTP_*` in `.env` continue to work — `getSmtpConfig()` falls back to env values. Once an admin saves via UI, DB values take precedence.

---

## Change 3 — Guide: drop admin sections via code blocklist

### Goal
`/guide` should only show README sections that are useful to end users. Admin / deployment / testing sections are excluded.

### Blocklist (H2 headings to drop, plus all content until the next H2)
- `## 启动` — admin/setup
- `## 测试` — dev
- `## 管理员后台扩展` — admin-only
- `## 环境变量` — admin/deployment

### Keep (user-facing, even though the heading also mentions admin)
- `## 密码找回 + 管理员后台 (v1 / Plan B+)` — users need to know how to reset their password. Admin dashboard coverage here is brief; mixing is acceptable for a public doc.

### Implementation
- Edit `app/guide/page.tsx`. After `readReadme()` returns, run a new `filterUserReadme(md: string): string` step before `renderMarkdown()`.
- Algorithm:
  ```
  lines = md.split('\n')
  out = []
  skip = false
  for line in lines:
    if line starts with '## ':
      skip = blocklist.some(block => line startsWith '## ' + block)
    if !skip: out.push(line)
  return out.join('\n')
  ```
  Blocklist is a `const` array at the top of the file so future changes are one-line edits.
- The H1 title (project name) and H2 sections before the first blocklist hit (e.g. "功能", "技术栈", "账号系统") all pass through.

### Tests
- Add `tests/unit/app/guide-filter.test.ts` with 6 cases:
  1. removes `## 启动` section
  2. removes `## 测试` section
  3. removes `## 管理员后台扩展` section
  4. removes `## 环境变量` section
  5. keeps `## 密码找回 + 管理员后台` section intact
  6. keeps H1 + first user section intact when no blocklist match

### Files
- **Edit:** `app/guide/page.tsx`
- **New:** `tests/unit/app/guide-filter.test.ts`

---

## Verification

- `pnpm tsc --noEmit` clean
- `pnpm build` succeeds; new routes appear:
  - `ƒ /ancient-texts`
  - `ƒ /admin/email`
  - `ƒ /api/admin/email/config`
  - `ƒ /api/admin/email/test`
- `pnpm test` — new guide-filter tests pass (all 6); existing tests still green
- Browser smoke (manual, on `http://localhost:4444`):
  - Nav shows 古籍 (and disappears when 儿童模式 on)
  - `/ancient-texts` renders placeholder, lists 佛经 + 字典 links
  - `/guide` shows 功能 / 技术栈 / 账号系统 / 密码找回 + 管理员后台 / 罕见字库 / 字典 / 识字游戏 / 读故事 / 路线图, but NOT 启动 / 测试 / 管理员后台扩展 / 环境变量
  - `/admin/email` (as admin): form loads with current values (or blanks if none), save persists, refresh shows new values, "发送测试邮件" returns success when configured
  - Send a real email via SMTP and confirm receipt (uses whatever creds the admin saved)

## Commit

One commit: `feat(admin): ancient-texts nav, SMTP admin config, guide admin-section filter`
