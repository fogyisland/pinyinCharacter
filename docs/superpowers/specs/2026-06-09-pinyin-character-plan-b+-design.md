# Plan B+ Design — Password Recovery + Admin Backend

**Date:** 2026-06-09
**Status:** Approved (pending user review of written spec)
**Supersedes:** nothing (additive to Plan A + Plan B)
**Author:** (brainstorming with user)

---

## 1. Goal

Extend the Plan B user system with two feature groups:
1. **Self-service password recovery** via email magic link (SMTP or dev console)
2. **Admin backend** for managing users, viewing audit logs, and inspecting system stats

Both build on Plan B's existing infrastructure (MySQL, JWT cookies, audit log, `users.is_admin` forward-compat hook, first-user-is-admin logic).

## 2. Out of scope (deferred)

- OAuth / third-party login
- Password rotation policies / forced expiry
- Role-based access control beyond a binary `is_admin` boolean
- i18n (email content + UI text remain Chinese in v1; planned for a later plan with Plan D's per-char pinyin/story)
- Real prod SMTP for **us**; we ship the integration, the operator configures their own SMTP credentials

## 3. Data model

### 3.1 New table: `password_resets`

```sql
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,             -- SHA-256 hex of the raw token
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pr_user (user_id),
  KEY idx_pr_expires (expires_at),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Why store the hash, not the raw token:** if the DB is leaked, an attacker can't directly reset any account. The raw token only ever lives in the email.

**Why per-row, not "current reset token" column on `users`:** a user may request multiple resets; older unused rows just expire naturally and are cleaned up periodically (or left; the table is small).

### 3.2 No changes to existing tables

`users.is_admin` (Plan B forward-compat) and `audit_log` (Plan B) are reused as-is. New audit event names follow the existing `varchar(32)` `event` column.

### 3.3 New audit events

| `event` value | When | Metadata |
|---|---|---|
| `password_reset_request` | User POSTs `/api/auth/forgot` | `{ userExists: boolean }` (logged regardless — see §5.1 anti-enumeration) |
| `password_reset_complete` | User successfully resets password | `{ resetId: number }` |
| `admin_user_delete` | Admin deletes a user | `{ targetUserId, targetUsername }` |
| `admin_user_password_reset` | Admin resets a user's password | `{ targetUserId, targetUsername }` |
| `admin_user_promote` | Admin promotes user to admin | `{ targetUserId, targetUsername }` |
| `admin_user_demote` | Admin demotes admin to regular user | `{ targetUserId, targetUsername }` |

## 4. Authentication / authorization

### 4.1 `is_admin` is **not** in the JWT

The Plan B JWT payload is `{ userId, username }`. Adding `isAdmin` would let a demoted admin keep admin powers until the token expires (7 days). We re-query `is_admin` from the DB on every request that needs it (1 cheap indexed `SELECT is_admin FROM users WHERE id = ?`).

### 4.2 New `lib/auth.ts` exports

```ts
export interface UserWithAdmin extends User { isAdmin: boolean; }

export async function getCurrentUserWithAdmin(): Promise<UserWithAdmin | null>

/**
 * Discriminated result used by both API routes and server pages.
 * - API route: if `!ok`, return `result.response` directly (renders the 401/403 JSON).
 * - Server page: if `!ok`, call `redirect()` based on `result.reason` (login or forbidden).
 */
export type RequireAdminResult =
  | { ok: true; user: UserWithAdmin }
  | { ok: false; reason: 'unauthenticated' | 'forbidden'; response: NextResponse };

export async function requireAdmin(): Promise<RequireAdminResult>;
```

- `requireAdmin()` is the guard used by every `/api/admin/*` route and every `app/admin/*` page.
- Internally: read cookie → `verifySession` → if null, return `{ ok: false, reason: 'unauthenticated', response: 401 JSON }` → else `SELECT is_admin FROM users WHERE id = ?` → if 0, return `{ ok: false, reason: 'forbidden', response: 403 JSON }` → else `{ ok: true, user }`.
- **API route usage:**
  ```ts
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  // auth.user is safe to use
  ```
- **Server page usage:**
  ```ts
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    else redirect('/?error=forbidden');
  }
  // auth.user is safe to use
  ```

### 4.3 Magic link rate limiting

In-memory map `Map<string, number>` keyed by client IP, value = `Date.now()` of last successful `/api/auth/forgot` for that IP. 1 request per 60s per IP. Restart wipes the map (acceptable — restart is rare, and losing the limit window is more secure than persisting it).

## 5. API routes

### 5.1 Password recovery (3 routes, no auth required)

#### `POST /api/auth/forgot`

- **Request body:** `{ username: string }`
- **Validation:** username format only (3-32 chars, `[a-zA-Z0-9_-]+`). Do NOT differentiate error for "user doesn't exist".
- **Rate limit:** 1 request / 60s / IP. Reject with 429 if exceeded.
- **Behavior:** look up user. If exists, generate 32-byte random token (base64url), store `SHA-256(token)` in `password_resets` with `expires_at = NOW() + 15 min`, call `sendPasswordResetEmail(user, rawToken)`, write audit `password_reset_request { userExists: true }`. If user doesn't exist, write audit `password_reset_request { userExists: false }` and return 200 anyway.
- **Response:** always `200 { ok: true, data: null }`.
- **Email send failures:** if email transport throws (SMTP error), still return 200 to the client (we logged the audit, dev will see the error in logs; prod has its own monitoring). Log the error server-side.
- **Production misconfig:** if `MAIL_TRANSPORT=smtp` but SMTP_HOST is unset, this route returns 503 `邮件服务未配置`. (Dev mode with `MAIL_TRANSPORT=console` never hits this.)

#### `GET /api/auth/reset-info?token=xxx`

- **Validation:** token format (base64url-ish, 32+ chars). Look up by hashing the raw token and querying `WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`. If valid, return `{ ok: true, data: { username } }`. If invalid/expired/used, return `{ ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } }` with HTTP 400.
- **No state change.** Pure read.

#### `POST /api/auth/reset`

- **Request body:** `{ token: string, newPassword: string }`
- **Validation:** token format + `validatePassword(newPassword)` (reuse from `lib/auth-client.ts`).
- **Behavior:** look up token (same query as reset-info). If valid, `bcrypt.hash(newPassword, 10)`, `UPDATE users SET password_hash = ? WHERE id = ?`, set `used_at = NOW()` on the reset row. Write audit `password_reset_complete`. Issue new session cookie (sign + set), return `{ ok: true, data: { user } }`. Client can then redirect to `/` (already logged in).
- **Old sessions:** tokens issued before the password change remain valid until they naturally expire (7 days). Documented as a v1 limitation; not worth the complexity of a per-user token version counter.

### 5.2 Admin — read (3 routes, require is_admin)

#### `GET /api/admin/users?limit=50&offset=0`

- Returns: `{ ok: true, data: { users: Array<{ id, username, isAdmin, createdAt, historyCount, favoriteCount }>, total: number } }`
- `historyCount` and `favoriteCount` are subqueries (or a join + group by) for each user.
- Pagination: limit clamped to [1, 200], offset ≥ 0.
- Order: `created_at DESC` (newest first).

#### `GET /api/admin/users/[id]`

- Returns: `{ ok: true, data: { user, recentHistory: HistoryRow[] (max 10) } }`
- 404 if user doesn't exist.

#### `GET /api/admin/audit?user_id=&event=&from=&to=&limit=50&offset=0`

- All query params optional. Filters compose with AND.
- `event` validated against a known list (5 Plan B events + 6 new = 11 total). Unknown `event` → empty result, no error.
- `from` / `to` are ISO date strings, compared against `created_at`.
- Returns: `{ ok: true, data: { rows: AuditRow[], total: number } }`
- Pagination same as users.

### 5.3 Admin — write (4 routes, require is_admin)

#### `DELETE /api/admin/users/[id]`

- **Request body:** `{ confirmUsername: string }`
- **Guards:**
  - `id !== session.userId` (can't delete self)
  - If target `is_admin = 1`, check that other admins exist (`SELECT COUNT(*) FROM users WHERE is_admin = 1 AND id != ?`); if 0, return 400 `至少保留一个管理员`
  - `confirmUsername` must exactly equal target's `username` (case-sensitive, after trim). If mismatch, return 400 `用户名不匹配`.
- **Behavior:** `DELETE FROM users WHERE id = ?`. History / audit_log cascade via FK. Write audit `admin_user_delete`.
- Returns 204.

#### `POST /api/admin/users/[id]/reset-password`

- **No body.**
- **Guards:** `id !== session.userId` (don't reset your own password via admin; use the magic link instead).
- **Behavior:** generate 16-byte random password, base64url-encode, `bcrypt.hash` it, `UPDATE users SET password_hash = ?`. Write audit `admin_user_password_reset`.
- Returns `{ ok: true, data: { tempPassword: '...' } }` (admin copies this and gives to the user out-of-band). The plain text password is **not** stored, never re-sendable. Admin is told to close the dialog once they've copied.

#### `POST /api/admin/users/[id]/promote`

- **No body.**
- **Guards:** target must currently `is_admin = 0` (idempotent: 400 `已经是管理员`).
- Behavior: `UPDATE users SET is_admin = 1 WHERE id = ?`. Write audit.

#### `POST /api/admin/users/[id]/demote`

- **No body.**
- **Guards:** target must currently `is_admin = 1`. And there must be ≥1 other admin after demotion (so we don't end up with zero admins). If not, 400 `至少保留一个管理员`.
- Behavior: `UPDATE users SET is_admin = 0`. Write audit.

## 6. Email

### 6.1 `lib/email.ts`

```ts
export interface EmailMessage { to: string; subject: string; html: string; text: string; }

export async function sendEmail(msg: EmailMessage): Promise<void>;
// - Reads MAIL_TRANSPORT env var
// - 'console' (default) → console.log('[email] To: ...\nSubject: ...\n\n', text); resolve
// - 'smtp' → validate SMTP_HOST present, else throw EmailNotConfiguredError
//           → create nodemailer transport (lazy, per-call), sendMail
//           → on success resolve, on failure throw EmailSendError
// - Other value → throw EmailNotConfiguredError

export class EmailNotConfiguredError extends Error { code = 'email_not_configured' }
export class EmailSendError extends Error { code = 'email_send_failed' }
```

### 6.2 `lib/email-templates.ts`

```ts
export interface PasswordResetArgs { username: string; resetUrl: string; expiresInMinutes: number; }

export interface EmailContent { subject: string; html: string; text: string; }

export function passwordResetEmail(args: PasswordResetArgs): EmailContent;
```

- `subject`: `"重置密码 — 字 ↔ 拼音 工具"`
- `html`: a self-contained HTML document with inline styles. Sections (in order):
  1. Header bar: site name "字 ↔ 拼音 工具" (24px bold, dark text on light background)
  2. Greeting: `你好 {username},`
  3. Body: `你 (或使用此邮箱的人) 申请了重置密码。点击下面的按钮,在 15 分钟内设置新密码:`
  4. CTA button: large blue rounded button with text `重置密码` linking to `resetUrl`
  5. Fallback URL line: `如果按钮无法点击,请复制此链接到浏览器: {resetUrl}` (in monospace, word-break: break-all)
  6. Expiry note: `链接将在 15 分钟后失效。`
  7. Reassurance: `如果你没有申请重置,请忽略此邮件,你的账号仍然安全。`
  8. Footer: site name + copyright year
- `text`: same content, no HTML, plain paragraphs.

All Chinese text is hard-coded in v1. Comment blocks mark `{/* i18n: */}` for future extraction.

### 6.3 Environment variables

```
# .env.example additions:
MAIL_TRANSPORT=console         # console | smtp
SMTP_HOST=                     # required when MAIL_TRANSPORT=smtp
SMTP_PORT=587
SMTP_SECURE=false              # true for port 465
SMTP_USER=
SMTP_PASS=
MAIL_FROM=noreply@example.com  # required when MAIL_TRANSPORT=smtp
MAIL_FROM_NAME=字 ↔ 拼音 工具
```

### 6.4 Dependency

Add `nodemailer` to `dependencies`. (`@types/nodemailer` is not needed — `nodemailer` ships its own types.)

## 7. UI / pages

### 7.1 Public pages (no auth)

#### `/forgot-password`

- Server component, `dynamic = 'force-dynamic'`.
- Centered card (max-w-sm) with site header.
- Form: username input + submit button.
- Client component for the form (calls `forgotPasswordRequest`). On success, replace the form with a static message: "如果该用户存在,重置链接已发送。请检查邮箱。开发环境下,链接会同时打印到 server console。"
- If `/api/auth/forgot` returns 503 (email not configured), show a small banner: "邮件服务未配置,请联系管理员。"

#### `/reset-password?token=xxx`

- Server component. On render: call `GET /api/auth/reset-info?token=xxx` server-side (this is a local function call, not HTTP).
- If token invalid/expired/used: render a card with "链接已失效,请返回 忘记密码 重新申请。" + link to `/forgot-password`. Form is **not** shown.
- If token valid: show username ("你好, {username}") + new-password form (two fields, with strength hint) + submit.
- Client component handles submit. On success: store response user in zustand, show "密码已重置,正在跳转..." for 1s, then `window.location.href = '/'`.

### 7.2 Admin layout (`app/admin/layout.tsx`)

- Server component, `dynamic = 'force-dynamic'`.
- First lines: call `requireAdmin()`; on failure, `redirect('/?auth=login')` or `redirect('/?error=forbidden')` per the discriminated result.
- Renders `<Header />` + a 2-column layout: left sidebar `<AdminNav />` (links to /admin/users, /admin/audit, /admin/stats), right `{children}`.

### 7.3 Admin pages

Server pages call `lib/admin.ts` functions directly (no HTTP round-trip within the server):

| Path | Server component does | Renders |
|---|---|---|
| `/admin` | `redirect('/admin/users')` | (none) |
| `/admin/users` | `listUsers({ limit: 200, offset: 0 })` from `lib/admin.ts` | Table (id skip, username, registered, history count, fav count, admin badge) + "用户管理" h1 |
| `/admin/users/[id]` | `getUserDetail(id)` from `lib/admin.ts` (returns user + recent 10 history rows) | Detail card (username, registered, isAdmin badge) + recent history table + 3 action buttons (delete, reset password, promote/demote) + modals |
| `/admin/audit` | `getAuditLog({})` (empty filter, first page) | Table (timestamp, user, event, ip, user-agent snippet) + filter bar (user_id input, event dropdown, date range) + pagination links |
| `/admin/stats` | `getSystemStats()` from `lib/admin.ts` | 5 stat cards in a grid |

All modals are client components:
- `<DeleteUserDialog>` — title "删除用户 {username}", description warning about cascade, input "请输入用户名确认", submit disabled until matches, "删除" button (red, on submit calls DELETE then refreshes)
- `<ResetPasswordDialog>` — on open, calls POST and gets tempPassword, displays it in a `<code>` block with a "复制" button. Once admin clicks "已转交" checkbox, dialog closes. If dialog reopens, no re-call (state is one-shot).
- `<ConfirmDialog>` — generic "确认" + cancel + action. Used for promote/demote.

### 7.4 UserMenu admin link

`components/UserMenu.tsx` reads `isAdmin` from the zustand `user` (extended in §4.2). If true, render an extra link "管理后台" → `/admin`. Otherwise omit.

`lib/store.ts`'s `User` type gets `isAdmin?: boolean` (optional, to keep backward compat with any persisted state from Plan B).

## 8. File structure (additions/modifications)

### New files (~22)

```
lib/
  password-reset.ts
  admin.ts
  ratelimit.ts
  email.ts
  email-templates.ts
app/api/
  auth/forgot/route.ts
  auth/reset-info/route.ts
  auth/reset/route.ts
  admin/users/route.ts
  admin/users/[id]/route.ts
  admin/users/[id]/reset-password/route.ts
  admin/users/[id]/promote/route.ts
  admin/users/[id]/demote/route.ts
  admin/audit/route.ts
  admin/stats/route.ts
app/
  forgot-password/page.tsx
  reset-password/page.tsx
  admin/layout.tsx
  admin/page.tsx
  admin/users/page.tsx
  admin/users/[id]/page.tsx
  admin/audit/page.tsx
  admin/stats/page.tsx
components/
  DeleteUserDialog.tsx
  ResetPasswordDialog.tsx
  ConfirmDialog.tsx
  AdminNav.tsx
lib/api-admin.ts
tests/unit/lib/
  password-reset.test.ts
  ratelimit.test.ts
  email.test.ts
  email-templates.test.ts
  admin.test.ts
tests/integration/
  password-reset.test.ts
  admin-crud.test.ts
```

### Modified files (~7)

- `lib/auth.ts` — add `getCurrentUserWithAdmin`, `requireAdmin`
- `lib/auth-client.ts` — add `validatePasswordConfirmation(password, confirm)` helper (optional client-side, server is source of truth)
- `lib/store.ts` — `User.isAdmin?: boolean`
- `components/UserMenu.tsx` — admin link
- `app/api/auth/me/route.ts` — return `isAdmin` in user payload
- `scripts/init-db.ts` — add `password_resets` DDL
- `.env.example` — add mail env vars
- `README.md` — add "密码找回 + 管理员后台" section + env var table update
- `package.json` — add `nodemailer` dependency

## 9. Testing

### 9.1 Unit tests (always run)

- `password-reset.test.ts`:
  - `generateResetToken()` returns 32+ chars base64url
  - `hashResetToken(raw)` is deterministic, length 64 hex chars
  - `isResetRowValid(row)` checks `used_at IS NULL` and `expires_at > now`
- `ratelimit.test.ts`:
  - First call returns `true`, second within 60s returns `false`, after 60s returns `true` (mock `Date.now`)
- `email.test.ts`:
  - `MAIL_TRANSPORT=console` → console.log called with expected prefix
  - `MAIL_TRANSPORT=smtp` + missing `SMTP_HOST` → throws `EmailNotConfiguredError`
  - `MAIL_TRANSPORT=smtp` + valid config → calls `nodemailer.createTransport(...).sendMail(...)` (mock)
- `email-templates.test.ts`:
  - `passwordResetEmail({...})` includes the username, resetUrl, and "15 分钟" in the text body
  - HTML body contains `<a href="{resetUrl}">` and a plain-URL fallback
- `admin.test.ts`:
  - `listUsers({...})` returns expected join with history counts
  - `getUserDetail(id)` includes recent history
  - `getAuditLog({...})` applies all filter combinations

### 9.2 Integration tests (skip if `DATABASE_URL_TEST` unset)

- `password-reset.test.ts`:
  - Full flow: POST `/api/auth/forgot` with existing user → 200; query `password_resets` → row exists with hash; GET `/api/auth/reset-info?token=xxx` → 200 + username; POST `/api/auth/reset` with new password → 200; new password works for login; old password fails
  - Token reuse: use same token twice → second call 400
  - Expired token: manually expire it via SQL, then use → 400
  - Unknown username: POST `/api/auth/forgot` → still 200, no row in `password_resets`
  - Rate limit: two POSTs in 1 second → second 429
- `admin-crud.test.ts`:
  - Non-admin user → all `/api/admin/*` routes return 403
  - Admin user → `GET /api/admin/users` returns list
  - Delete user: cascade removes history, can't delete self, can't delete last admin
  - Reset password: returns tempPassword, new password works for login
  - Promote: isAdmin = 1, demote: isAdmin = 0, can't demote last admin
  - Audit log: each admin write writes the correct event

### 9.3 Manual smoke (Task "smoke" in the implementation plan)

- Register first user (becomes admin)
- Register second user (not admin)
- User 2 clicks "忘记密码" on /forgot-password, enters username → dev console shows the reset URL
- Copy the URL into browser, land on /reset-password, set new password
- Logout user 2, login with the new password
- User 2 visits /admin → redirected to /?error=forbidden
- Login as user 1 (admin), open UserMenu → "管理后台" link present
- Go to /admin/users → see both users
- Click user 2 → detail page → click "重置密码" → copy the temp password → login as user 2 with the temp password
- Promote user 2 to admin → UserMenu now shows "管理后台" for user 2 too
- Demote user 2 → UserMenu loses the link
- Try to demote user 1 (the only remaining admin) → 400
- Try to delete user 1 as user 1 → 400
- Delete user 2 → confirm by typing username → user 2's history cascade-deleted, audit log has the entry
- Visit /admin/audit → filter by event=admin_user_delete → see the deletion
- Visit /admin/stats → numbers match

## 10. Acceptance criteria (definition of done)

1. `pnpm test` all pass (≥ 73 unit + ≥ 7 integration skipping without DB)
2. `pnpm exec tsc --noEmit` clean
3. `pnpm build` produces 18+ routes
4. All 9 manual smoke steps pass
5. All commits on `main` branch
6. README has a "密码找回 + 管理员后台" section documenting:
   - The two new env var groups (mail + admin)
   - How the first user becomes admin
   - How to configure SMTP for prod
7. The 4 deferred items (OAuth, password rotation, RBAC, i18n) are NOT in the code

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Email enumeration via timing (forgot endpoint takes longer for existing users) | v1: acceptable. v1.1 (out of scope): always do the email-send path with a no-op when user missing. |
| Forgot-password rate limit is in-memory → useless if you have multiple server instances | Documented in README; if multi-instance, swap in Redis later |
| Admin demoting themselves accidentally | Demote page requires a confirmation dialog with the username typed in |
| `nodemailer` adds ~250KB to client bundle | It's a server-only import; verify Next.js tree-shakes it out of client bundle |
| Magic link is HTTP, not HTTPS → token leaks | Cookie is httpOnly + sameSite=lax; link is one-time. In production `COOKIE_SECURE=true` + HTTPS terminator is the user's responsibility. |

## 12. Plan for the implementation phase

Estimated ~24 commits, executed via the subagent-driven-development skill (same pattern as Plan B):
- Tasks 1-2: deps + env scaffold
- Tasks 3-5: libs (password-reset, ratelimit, email, email-templates, admin queries)
- Tasks 6-7: `requireAdmin` + init-db DDL update
- Tasks 8-10: 3 password-recovery API routes
- Tasks 11-13: 3 admin-read API routes
- Tasks 14-17: 4 admin-write API routes
- Tasks 18-19: client wrappers (api-admin.ts + store update)
- Tasks 20-22: 2 public pages (forgot, reset)
- Tasks 23-27: admin layout + 4 admin pages
- Tasks 28-31: 4 new components (3 modals + AdminNav)
- Task 32: README + .env.example
- Task 33: manual smoke
- Final: cross-cutting code review

Out of scope for the implementation plan: any deferred item from §2.
