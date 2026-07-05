# 留言笔记 (Feedback Wall) — Design Spec

**Date:** 2026-07-05
**Status:** Approved (awaiting spec self-review)
**Origin:** User request 2026-07-05 「增加一个小功能,就是留言笔记,构建一个页面,大家针对提到的建议和功能,以论坛帖子的方式进行展现,同时出现了新帖子发邮件将标题和内容发送给管理员」

## Context

The product (字·韵) has 152+ commits of features. Users currently have no in-app channel to leave feedback or suggest new features — they have to email, find GitHub, or post on social media. Admins have no way to receive a centralized stream of suggestions tied to the product's own URL.

This spec adds a lightweight public feedback wall: a single page at `/notes` where any visitor can post a message (logged-in or anonymous), and admins receive an email per new post with full metadata.

## Goal

1. Public-facing `/notes` page where anyone can post a feedback message (10-2000 chars).
2. Anonymous + logged-in dual track: logged-in users auto-fill name + email; anonymous users fill nickname + optional email.
3. Every new post triggers an email to the admin's configured notification address with full metadata (author, IP, UA, content, timestamp, admin link).
4. Auto-publish (no pre-moderation); admin can soft-delete from `/admin/notes`.
5. Mild spam protection via per-IP and per-email rate limits.

## Non-Goals (YAGNI)

- Threaded replies / nested discussions — flat wall only
- Categories / tags / voting / search
- User edit / delete of own posts
- Email subscription for users
- Rate-limit cleanup task (accept small table growth for now; add later if needed)
- Anti-spam CAPTCHAs / honeypot / Akismet integration
- Markdown / rich-text rendering in posts (plain text + line breaks only)

## Architecture

### Tech stack (existing, no new deps)

- Next.js 15 App Router (server components + API routes)
- MySQL 5.7+ via `lib/db.ts` (`getPool()`)
- `mysql2/promise` with parameterized queries
- `lib/email.ts` (existing mailer — add 1 template, no infrastructure changes)
- zod for API validation (already in deps)
- Tailwind + existing `app/globals.css` paper/seal palette
- Vitest 2.x + happy-dom

### New components

```
DB:
  scripts/migrations/2026-07-05-notes.sql            # notes + notes_rate_limits tables
  scripts/migrations/2026-07-05-admin-email-config.sql # seed app_config admin_notification_email

API:
  app/api/notes/route.ts                              # POST create, GET list (paginated)
  app/api/admin/notes/[id]/route.ts                   # DELETE soft-delete
  app/api/admin/settings/email/route.ts               # extend existing endpoint + add new field

Pages:
  app/notes/page.tsx                                  # public feedback wall + form
  app/notes/NotesList.tsx                             # client component (form + list)
  app/admin/notes/page.tsx                            # admin list + soft-delete
  app/admin/notes/AdminNotesList.tsx                  # client component (table + actions)

Lib:
  lib/notes.ts                                        # listNotes, createNote, softDeleteNote, checkRateLimit, bumpRateLimit
  lib/email.ts                                        # add `notes-new` template (HTML body)

Navigation:
  components/common/SiteHeader.tsx                    # add "留言" link (next to "字典" etc.)
  app/admin/layout.tsx                                # add /admin/notes link to sidebar

Tests:
  tests/unit/lib/notes.test.ts
  tests/integration/api/notes.test.ts
  tests/unit/components/notes/NotesForm.test.tsx
  tests/unit/components/notes/NotesList.test.tsx
  tests/unit/components/notes/AdminNotesList.test.tsx
```

### Existing infrastructure reused

- `lib/db.ts:getPool()` — single MySQL pool for all queries
- `lib/email.ts:sendEmail()` — async, fire-and-log on failure (matches existing email-campaigns pattern)
- `lib/api-handler.ts:withErrorHandling` + `badRequest` — wraps API routes with consistent error envelope
- `lib/auth.ts:getCurrentUser()` — derives logged-in user from JWT cookie; `null` for anonymous
- `lib/admin.ts:isAdmin()` — for admin route guards
- `app/admin/settings/email/page.tsx` + `/api/admin/settings/email/route.ts` — extend existing UI + endpoint instead of creating a new settings page
- `lib/audit.ts:logAudit()` — admin actions (soft-delete) log to audit_log
- Existing rate-limit middleware: **none** — this spec adds its own DB-backed table

## Data Model

### Migration `scripts/migrations/2026-07-05-notes.sql`

```sql
CREATE TABLE IF NOT EXISTS notes (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_user_id  BIGINT NULL,
  author_name     VARCHAR(64)  NOT NULL,
  author_email    VARCHAR(254) NULL,
  content         TEXT         NOT NULL,
  ip              VARCHAR(45)  NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME     NULL,
  deleted_by      BIGINT       NULL,
  PRIMARY KEY (id),
  KEY idx_notes_created (created_at DESC),
  KEY idx_notes_user (author_user_id),
  KEY idx_notes_alive (deleted_at, created_at DESC),
  CONSTRAINT fk_notes_user FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notes_deleted_by FOREIGN KEY (deleted_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes_rate_limits (
  scope       ENUM('ip','email') NOT NULL,
  key_value   VARCHAR(254) NOT NULL,
  window_kind ENUM('minute','hour') NOT NULL,
  window_start DATETIME NOT NULL,
  post_count  SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, key_value, window_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Migration `scripts/migrations/2026-07-05-admin-email-config.sql`

```sql
-- Seed app_config.admin_notification_email placeholder (admin sets actual value via UI)
INSERT IGNORE INTO app_config (`key`, value) VALUES ('admin.notification_email', '');
```

### Decisions

- **`status` ENUM dropped** — auto-publish is the only mode for now. Soft delete via `deleted_at` only. Add `status` later if hidden / pending-review is ever needed.
- **`author_user_id` ON DELETE SET NULL** — when admin deletes a user, the note survives with `author_name` snapshot. Avoids losing historical feedback.
- **`notes_rate_limits` PK includes `window_kind`** — so the IP-minute counter and email-hour counter don't collide on the same `(scope, key_value)` pair.
- **No rate-limit cleanup** — table grows slowly (1 row per unique IP+min or email+hour); a few thousand rows is fine. Add a cron-style cleanup later if needed.

## API Contract

### `POST /api/notes`

**Request body** (zod-validated):

```ts
const PostNoteBody = z.object({
  content: z.string().trim().min(10).max(2000),
  author_name: z.string().trim().min(3).max(32).optional(),
  author_email: z.string().email().max(254).optional(),
});
```

**Behavior:**

1. Resolve current user from cookie via `getCurrentUser()`. If `user` is non-null:
   - `author_user_id = user.id`
   - `author_name = user.username` (override any client-supplied value)
   - `author_email = user.email ?? null`
2. If `user` is null and `author_name` is missing → 400 (`anonymous_name_required`)
3. Extract `ip` from `X-Forwarded-For` first segment (matches `lib/audit.ts` pattern); fall back to req.ip
4. Extract `user_agent` from request header, truncated to 255 chars
5. **Rate limit check** (see §Rate Limit):
   - Check IP-minute: if exists in current minute and count >= 1 → 429
   - Check email-hour: if email provided and exists in current hour and count >= 5 → 429
6. INSERT into `notes` (transaction with rate-limit UPSERT)
7. UPSERT `notes_rate_limits` row(s)
8. **Send admin email** (see §Email) — `await sendEmail(...)`. On failure, log error and still return 200 (the post succeeded; admin notification is best-effort).
9. Return `{ ok: true, data: { id, created_at } }`

**Errors:**

| Code | HTTP | When |
|---|---|---|
| `validation_error` | 400 | zod parse fails |
| `anonymous_name_required` | 400 | anonymous post without `author_name` |
| `rate_limit_ip` | 429 | IP posted in current minute |
| `rate_limit_email` | 429 | email posted 5+ times in current hour |
| `admin_email_unconfigured` | (logged only) | admin_notification_email is empty — proceed without sending |

**429 Response:**

```ts
{ ok: false, error: { code: 'rate_limit_ip', message: '请稍后再试', retry_after_seconds: 42 } }
```

### `GET /api/notes?page=1&pageSize=20`

**Public**, returns only `deleted_at IS NULL`.

**Response:**

```ts
{
  ok: true,
  data: {
    notes: Array<{
      id: number;
      author_name: string;
      is_anonymous: boolean;     // derived: author_user_id === null
      content: string;
      created_at: string;        // ISO
    }>,
    total: number;
    page: number;
    pageSize: number;
  }
}
```

`pageSize` clamped to 1-50, default 20. Returns 400 if page < 1.

### `DELETE /api/admin/notes/[id]`

**Auth**: admin only (`isAdmin()` check). 401/403 if not admin.

**Behavior:**

1. Verify note exists and `deleted_at IS NULL` → 404 if not
2. UPDATE `notes SET deleted_at = NOW(3), deleted_by = ? WHERE id = ?`
3. `logAudit({ user_id, event: 'note.delete', metadata: { note_id: id } })`
4. Return `{ ok: true }`

### `PATCH /api/admin/settings/email` (extension)

Existing endpoint already handles `tts.voice_*`, `ai.*`, etc. Add `admin_notification_email`:

**Body extension:**

```ts
admin_notification_email: z.string().email().max(254).optional()
```

Empty string allowed (clears the config). On success, INSERT/UPDATE `app_config` row.

`/admin/settings/email` form gains a new "管理员通知邮箱" input at the top.

## Rate Limit Logic

`lib/notes.ts` exposes:

```ts
export async function checkRateLimit(
  ip: string,
  email: string | null,
): Promise<{ ok: true } | { ok: false; retry_after_seconds: number; code: 'rate_limit_ip' | 'rate_limit_email' }>;

export async function bumpRateLimit(ip: string, email: string | null): Promise<void>;
```

**`checkRateLimit`**:
- Compute `now = new Date()`, `minute_start = floor(now, 1m)`, `hour_start = floor(now, 1h)`
- SELECT row `(scope='ip', key_value=ip, window_kind='minute')` where `window_start = minute_start`; if `post_count >= 1` → block
- If `email` provided: SELECT row `(scope='email', key_value=email, window_kind='hour')` where `window_start = hour_start`; if `post_count >= 5` → block

**`bumpRateLimit`** (called after successful insert, same transaction):
- INSERT ... ON DUPLICATE KEY UPDATE `post_count = post_count + 1`, `window_start = IF(window_start = current_window, window_start, current_window)` (keeps old `window_start` if same window; replaces when the next window starts)
- Simpler: do it as 2 separate INSERTs wrapped in a transaction with the note insert. If a row from a previous window exists, UPDATE its `window_start` to current + reset `post_count = 1`.

**`retry_after_seconds`**:
- IP case: `60 - now.getSeconds()`
- Email case: `3600 - (now.getMinutes() * 60 + now.getSeconds())`

## Pages

### `/notes` — public feedback wall

**Layout** (server-rendered shell + 1 client component):

```
┌─────────────────────────────────────────────────┐
│ Header (existing)                                │
├─────────────────────────────────────────────────┤
│ 留言笔记                                          │
│ 把你的想法、建议、功能请求留在这里 — admin 会看到。 │
│                                                  │
│ ┌─── Form ────────────────────────────────────┐ │
│ │ [nickname] [email (optional)]               │ │
│ │ [textarea: 10-2000 chars]                   │ │
│ │ [发布]                                       │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ ─── 最近的留言 ───                                │
│ ┌─── Card ────────────────────────────────────┐ │
│ │ 🟢 张三 · 游客 · 2 分钟前                    │ │
│ │ 建议增加 ...                                │ │
│ └─────────────────────────────────────────────┘ │
│ ...                                              │
│                                                  │
│ [上一页] [下一页]                                  │
└─────────────────────────────────────────────────┘
```

**Form behavior:**
- Logged-in: hide `nickname` and `email` fields; show "将以 <username> 身份发布" hint
- Anonymous: nickname required (3-32 chars), email optional
- `content` always shown; char counter below textarea
- Submit button disabled when content < 10 chars
- On submit: POST `/api/notes`. On 200: clear form + prepend new card optimistically. On 429: show "请稍后再试 (还剩 N 秒)". On 400: show error inline.

**List card:**
- Avatar circle (first character of author_name, paper-soft bg)
- Name + "游客" / "已登录" badge + relative time
- Content (white-space: pre-wrap)
- Empty state: "还没有留言,做第一个吧"

**Pagination:**
- Server fetches `page=1&pageSize=20` initially
- Client uses `?page=N` URL search param (matches existing patterns like `/poetry`)

### `/admin/notes` — admin moderation

**Layout:**

```
┌─────────────────────────────────────────────────┐
│ Admin sidebar (existing)                         │
├─────────────────────────────────────────────────┤
│ 留言笔记管理 (N 条)                              │
│ ┌─────────────────────────────────────────────┐ │
│ │ ID │ 作者     │ 内容预览  │ IP      │ 时间  │ 操作 │
│ │ 1  │ 张三(游客)│ 建议增加...│ 1.2.3.4│ 2m前 │[删除]│
│ │ 2  │ 李四(已登录)│ 字典页...│ 1.2.3.4│ 1h前 │[删除]│
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Behavior:**
- Default shows `deleted_at IS NULL` rows; toggle to "显示已删除" later if needed
- Delete button → confirmation modal → DELETE API → optimistic remove
- Pagination 50/page (admin volume)

## Email Template

Added to `lib/email.ts`:

```ts
export const notesNewTemplate = (input: {
  authorName: string;
  authorEmail: string | null;
  authorUserId: number | null;
  content: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  siteUrl: string;
  adminNoteUrl: string;
}): { subject: string; html: string } => {
  const preview = input.content.slice(0, 30) + (input.content.length > 30 ? '...' : '');
  const subject = `【新留言】${preview}`;
  const html = `...`; // see full HTML in implementation
  return { subject, html };
};
```

**HTML body** (sent via existing `sendEmail()`):

```html
<h2>新留言通知</h2>
<table>
  <tr><td>作者昵称</td><td>{authorName}</td></tr>
  <tr><td>作者邮箱</td><td>{authorEmail || '未提供'}</td></tr>
  <tr><td>用户类型</td><td>{input.authorUserId ? `登录用户 (user_id: ${input.authorUserId})` : '游客'}</td></tr>
  <tr><td>IP</td><td>{ip || '未知'}</td></tr>
  <tr><td>UA</td><td>{userAgent || '未知'}</td></tr>
  <tr><td>时间</td><td>{input.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td></tr>
</table>
<hr/>
<pre style="white-space: pre-wrap; font-family: inherit;">{content}</pre>
<hr/>
<a href="{adminNoteUrl}">查看/删除 →</a>
```

**Send flow:**
- `await sendEmail({ to: adminEmail, subject, html })`
- On error, `console.error('[notes] admin email failed:', err)` and proceed (still return 200 to user)

## Error Handling & Security

| Scenario | Handling |
|---|---|
| `content` > 2000 chars | Client `maxLength` + server zod `.max(2000)` |
| Anonymous spam | Rate limit + admin can delete |
| Email send failure | Log error, don't block 200 |
| `admin_notification_email` empty | Log warning, skip send, return 200 |
| User deleted (FK) | `ON DELETE SET NULL`; note survives with name snapshot |
| Rate-limit table growth | Accept (small table); add cron later if needed |
| XSS in content | React escapes by default; render with `white-space: pre-wrap` only |
| CSRF | Existing middleware applies |
| SQL injection | Parameterized queries via `getPool()` |
| Email enumeration | Not exposed (no lookup against users table) |

## Testing

### `tests/unit/lib/notes.test.ts`
- `listNotes` returns paginated alive notes
- `createNote` resolves author from user / payload
- `softDeleteNote` sets `deleted_at` + `deleted_by`
- `checkRateLimit` blocks IP after 1 post in current minute
- `checkRateLimit` blocks email after 5 posts in current hour
- `checkRateLimit` allows new IP / email (no row exists)
- `bumpRateLimit` upserts correctly across window boundaries

### `tests/integration/api/notes.test.ts`
- POST as anonymous → 200, note inserted, admin email sent (mock)
- POST as logged-in → author_user_id + author_name auto-filled
- POST without nickname (anon) → 400 `anonymous_name_required`
- POST twice from same IP within 1 minute → 1st 200, 2nd 429
- POST with same email 6 times in 1 hour → 6th 429
- GET returns only `deleted_at IS NULL` rows
- DELETE without admin cookie → 403
- DELETE as admin → 200 + audit_log entry

### `tests/unit/components/notes/NotesForm.test.tsx`
- Anonymous form: nickname required, email optional
- Logged-in form: nickname/email hidden, hint shown
- Submit button disabled when content < 10 chars
- 429 response shows retry-after message

### `tests/unit/components/notes/NotesList.test.tsx`
- Renders empty state when no notes
- Renders card per note with name + time + content
- "游客" / "已登录" badge shows correctly

### `tests/unit/components/notes/AdminNotesList.test.tsx`
- Renders table rows
- Delete button triggers DELETE + optimistic removal
- Confirmation modal appears before delete

## Files to Modify

| File | Change |
|---|---|
| `scripts/migrations/2026-07-05-notes.sql` | NEW — `notes` + `notes_rate_limits` |
| `scripts/migrations/2026-07-05-admin-email-config.sql` | NEW — seed `app_config.admin_notification_email` |
| `lib/notes.ts` | NEW — `listNotes`, `createNote`, `softDeleteNote`, `checkRateLimit`, `bumpRateLimit` |
| `lib/email.ts` | EXTEND — add `notesNewTemplate` |
| `app/api/notes/route.ts` | NEW — POST + GET |
| `app/api/admin/notes/[id]/route.ts` | NEW — DELETE |
| `app/api/admin/settings/email/route.ts` | EXTEND — handle `admin_notification_email` |
| `app/notes/page.tsx` | NEW — server-rendered shell |
| `app/notes/NotesList.tsx` | NEW — client form + list |
| `app/admin/notes/page.tsx` | NEW — server shell |
| `app/admin/notes/AdminNotesList.tsx` | NEW — client table + delete |
| `app/admin/layout.tsx` | EXTEND — sidebar link to `/admin/notes` |
| `app/admin/settings/email/page.tsx` | EXTEND — add admin_notification_email input |
| `components/common/SiteHeader.tsx` | EXTEND — add "留言" nav link (guests + logged-in) |
| `tests/unit/lib/notes.test.ts` | NEW |
| `tests/integration/api/notes.test.ts` | NEW |
| `tests/unit/components/notes/NotesForm.test.tsx` | NEW |
| `tests/unit/components/notes/NotesList.test.tsx` | NEW |
| `tests/unit/components/notes/AdminNotesList.test.tsx` | NEW |
| `DEPLOY.md` | EXTEND §8 — add `2026-07-05-notes.sql` row; extend §9 — `notes` table is in `/init` (auto via DDL), no manual seed needed |

## Global Constraints

- **Migration naming**: `YYYY-MM-DD-<short-slug>.sql`, idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`)
- **API routes**: wrap with `withErrorHandling`; return `{ ok, data }` or `{ ok: false, error: { code, message } }`; `Cache-Control: no-store`
- **No new dependencies** — use existing mysql2 / zod / Tailwind / lucide-react
- **Component test pragma**: `// @vitest-environment happy-dom` + `cleanup()` in `beforeEach`
- **No commit timestamp suffix on this spec file** — this is a markdown design doc, not a commit
- **Commit message**: `feat(notes): public feedback wall + admin email notification [2026-07-05 HH.MM]` (subject timestamp suffix per project convention)
- **Comment language**: code comments in English; user-facing strings in Chinese (Simplified)
- **Push policy**: Not pushed (no prod env per `no-prod-env-2026-06-21.md`)
- **Up/ bundle**: regenerate with `python scripts/copy-to-up.py` after implementation

## Risks / Open Questions

1. **Rate-limit table growth** — accepted; flagged for follow-up cleanup cron
2. **Email send blocking POST response** — currently synchronous; if Edge mail relay is slow, POST latency could spike. Mitigation: switch to fire-and-forget (`sendEmail().catch(log)`) in Task implementation if benchmarks show > 500ms overhead. Spec currently says `await`; reviewer may flip this.
3. **Admin email not configured** — posts succeed silently; admin never sees them. Acceptable for now (admin can configure before going live). Add a startup warning in `/admin/init` checklist if `admin_notification_email` is empty AND `notes` table has rows.
4. **Anonymous user has same IP as a registered user** — rate limit per IP applies to both; if a registered user posts from same NAT, both get blocked. Acceptable for v1.