# 留言笔记 (Forum-style public notes wall + admin email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-facing notes wall where visitors (anon or registered) post short feedback; admin sees all posts at `/admin/notes` with soft-delete; new-post triggers an email notification to admin addresses configured in `app_config`.

**Architecture:** Server-rendered `/notes` page reads from MySQL `notes` table via `lib/notes.ts`. POST `/api/notes` validates content, applies DB-backed per-IP/per-email rate limit (1/min, 5/hr), inserts row, fans out admin email via `lib/email.ts` extension. Admin DELETE at `/api/admin/notes/[id]` soft-deletes (`deleted_at` + audit `notes_deleted`). `/admin/notes` lists all posts incl. soft-deleted with content-filter & restore not in v1. No threading, replies, voting, or categories — flat feedback wall.

**Tech Stack:** Next.js 15 App Router, MySQL via `mysql2/promise`, zod API validation, nodemailer for admin email, vitest + happy-dom component tests, integration tests gated by `DATABASE_URL`.

## Global Constraints

These constraints apply to every task in this plan.

- **npm only** (`npx vitest`, `npx next build`, `npx tsc --noEmit`) per `project-uses-npm.md`.
- **Commit timestamp suffix**: append `[YYYY-MM-DD HH.MM]` to all commit subjects from 2026-06-23 23:53 onward.
- **API envelope**: `{ ok: true, data }` on success, `{ ok: false, error: { code, message } }` on failure; wrap every route in `withErrorHandling`.
- **Admin auth**: `requireAdmin()` returns `{ ok: true, user }` or `{ ok: false, reason, response }` (lib/auth.ts:140).
- **Audit log**: use `writeAudit({ userId, event, metadata })` from `lib/audit.ts` with new `AuditEvent` values; also add to `AUDIT_EVENTS` tuple and `EVENT_LABEL` in `lib/audit-format.ts`.
- **Migration filename**: `scripts/migrations/YYYY-MM-DD-<short-slug>.sql` with `-- header comment` explaining purpose.
- **Component test pragma**: `// @vitest-environment happy-dom` at top + `cleanup()` in `beforeEach` (per `component-test-pragma-cleanup.md`).
- **Integration test DB**: `piyin_deploy_test` is the default DATABASE_URL in `.env` — all integration tests must hit it; unit tests must not require DB.
- **Cache-Control**: API routes returning mutable data use `Cache-Control: no-store` (per `feedback-cache-control-route-iterations.md`).
- **No new dependencies**: use existing `nodemailer` (via `lib/email.ts`), `zod`, `mysql2`, `bcryptjs`, `next/navigation`.
- **DEPLOY.md migration table** must be updated when adding new SQL migrations (per memory `feedback-deploy-doc-sync.md` if exists; otherwise follow existing §8 pattern).
- **DEV server cache**: kill `pnpm dev` (port 4444) before running `npx next build` (per `dev-build-cache-stomp.md`).
- **Per-task review must run `npx next build`** (per `feedback-per-task-build-check.md`).
- **Database**: write to `piyin_deploy_test` (default .env) for live integration tests; do NOT touch `piyin_dev` unless explicitly needed for data-heavy side.

---

## File Structure

**New files:**
- `scripts/migrations/2026-07-05-notes.sql` — `notes` + `notes_rate_limits` tables
- `lib/notes.ts` — CRUD + rate-limit helper + email template
- `lib/email-templates.ts` — `notesNotificationEmail()` template (so `lib/email.ts` stays API-only)
- `app/api/notes/route.ts` — POST + GET
- `app/api/admin/notes/[id]/route.ts` — DELETE (admin)
- `app/admin/notes/page.tsx` — server page (read all, render client)
- `components/notes/NotesWall.tsx` — public read+form (client)
- `components/notes/NotesForm.tsx` — submission form (client)
- `components/notes/NotesAdminClient.tsx` — admin table + delete (client)
- `tests/integration/scripts/notes-migration.test.ts` — verifies schema + CRUD round-trip
- `tests/unit/lib/notes.test.ts` — unit tests for rate-limit SQL branches
- `tests/unit/components/notes/NotesForm.test.tsx` — form validation + disabled states
- `tests/unit/components/notes/NotesAdminClient.test.tsx` — admin delete flow

**Modified files:**
- `lib/audit-format.ts` — add `notes_posted` + `notes_email_sent` + `notes_email_failed` + `notes_deleted` to `AuditEvent` + tuple + `EVENT_LABEL` + `formatLogMessage` switch
- `app/admin/settings/email/page.tsx` (or create if missing) — extend SMTP/email admin page with a `notes.admin_emails` config field; OR add new admin page for notes email config
- `components/admin/AdminSidebar.tsx` — add `{ href: '/admin/notes', label: '留言笔记' }` entry
- `components/Header.tsx` (or footer, whichever currently lists site links) — add `留言笔记` link
- `lib/config.ts` — `getConfig('notes.admin_emails')` already supported via existing `getConfig(key)` API; no change needed unless getter is missing
- `DEPLOY.md` — add migration row + post-init seed row for notes

---

## Task 1: DB migration (notes + notes_rate_limits)

**Files:**
- Create: `scripts/migrations/2026-07-05-notes.sql`
- Create: `tests/integration/scripts/notes-migration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `notes` table (id, author_user_id, author_name, author_email, content, ip, user_agent, created_at, deleted_at, deleted_by) + `notes_rate_limits` table (scope, key_value, window_kind, window_start, post_count)

- [ ] **Step 1: Write failing test**

`tests/integration/scripts/notes-migration.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test';

describe('notes migration', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB_URL);
    // Verify table accessible; if migration not run, this throws.
    await conn.query("SELECT id FROM notes LIMIT 1");
  });

  afterAll(async () => { await conn.end(); });

  it('notes table has expected columns', async () => {
    const [cols] = await conn.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM notes");
    const names = (cols as any[]).map((c) => c.Field);
    for (const col of ['id', 'author_user_id', 'author_name', 'author_email', 'content',
                       'ip', 'user_agent', 'created_at', 'deleted_at', 'deleted_by']) {
      expect(names).toContain(col);
    }
  });

  it('notes_rate_limits primary key is composite', async () => {
    const [idx] = await conn.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM notes_rate_limits WHERE Key_name = 'PRIMARY'"
    );
    expect(idx.length).toBe(3);
    const colNames = (idx as any[]).map((i) => i.Column_name).sort();
    expect(colNames).toEqual(['key_value', 'scope', 'window_kind']);
  });

  it('round-trip: insert anon note + soft delete + restore idempotency', async () => {
    const [res] = await conn.query<any>(
      "INSERT INTO notes (author_name, content) VALUES (?, ?)",
      ['TestAnon', '这是一条测试留言']
    );
    const id = res.insertId;
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id, author_name, content FROM notes WHERE id = ?", [id]
    );
    expect((rows as any[])[0].author_name).toBe('TestAnon');

    // Soft delete
    await conn.query("UPDATE notes SET deleted_at = NOW() WHERE id = ?", [id]);
    const [del] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT deleted_at FROM notes WHERE id = ?", [id]
    );
    expect((del as any[])[0].deleted_at).not.toBeNull();

    // Cleanup
    await conn.query("DELETE FROM notes WHERE id = ?", [id]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test' npx vitest run tests/integration/scripts/notes-migration.test.ts`
Expected: FAIL on `beforeAll` ("Table 'piyin_deploy_test.notes' doesn't exist")

- [ ] **Step 3: Write migration SQL**

`scripts/migrations/2026-07-05-notes.sql`:

```sql
-- Public notes wall (留言笔记): flat feedback posts from anon + registered users.
-- Soft-delete preserves audit trail. Rate-limit table keyed by (scope, key_value, window_kind).
-- Idempotent: tables + indexes only created if missing.

CREATE TABLE IF NOT EXISTS notes (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_user_id  BIGINT NULL,
  author_name     VARCHAR(64) NOT NULL,
  author_email    VARCHAR(254) NULL,
  content         TEXT NOT NULL,
  ip              VARCHAR(45) NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME NULL,
  deleted_by      BIGINT NULL,
  PRIMARY KEY (id),
  KEY idx_notes_alive (deleted_at, created_at DESC),
  CONSTRAINT fk_notes_user FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notes_deleted_by FOREIGN KEY (deleted_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes_rate_limits (
  scope        ENUM('ip', 'email') NOT NULL,
  key_value    VARCHAR(254) NOT NULL,
  window_kind  ENUM('minute', 'hour') NOT NULL,
  window_start DATETIME NOT NULL,
  post_count   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, key_value, window_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Apply migration to piyin_deploy_test**

Run: `mysql -u root -pAdmin909217 piyin_deploy_test < scripts/migrations/2026-07-05-notes.sql`
Expected: tables created; verify with:
`mysql -u root -pAdmin909217 piyin_deploy_test -e "SHOW TABLES LIKE 'notes%'"`

- [ ] **Step 5: Run test — expect PASS**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test' npx vitest run tests/integration/scripts/notes-migration.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/2026-07-05-notes.sql tests/integration/scripts/notes-migration.test.ts
git commit -m "feat(notes): schema migration for notes + notes_rate_limits [2026-07-05 12.10]"
```

---

## Task 2: lib/notes.ts (CRUD + rate-limit SQL + helpers)

**Files:**
- Create: `lib/notes.ts`
- Create: `tests/unit/lib/notes.test.ts`
- Modify: `lib/audit-format.ts` (add 4 new AuditEvent values)

**Interfaces:**
- Consumes: DB pool, audit module, `EmailSendError`-aware flow
- Produces:
  ```typescript
  export interface NoteRow { id: number; authorUserId: number | null; authorName: string;
    authorEmail: string | null; content: string; createdAt: Date; deletedAt: Date | null; }
  export async function listActiveNotes(opts?: { limit?: number }): Promise<NoteRow[]>;
  export async function listAllNotesForAdmin(opts?: { limit?: number; includeDeleted?: boolean }): Promise<NoteRow[]>;
  export async function insertNote(args: { authorUserId: number | null; authorName: string;
    authorEmail: string | null; content: string; ip: string | null; userAgent: string | null; }): Promise<number>;
  export async function softDeleteNote(id: number, byUserId: number): Promise<boolean>;
  export type RateLimitVerdict = { allow: true } | { allow: false; retryAfterSec: number; reason: string };
  export async function checkRateLimit(args: { ip: string | null; email: string | null; }): Promise<RateLimitVerdict>;
  export async function bumpRateLimit(args: { ip: string | null; email: string | null; }): Promise<void>;
  ```

- [ ] **Step 1: Add audit events**

In `lib/audit-format.ts`:
1. Add to `AuditEvent` union (alphabetically with new ones at end):
   ```typescript
   | 'notes_posted' | 'notes_deleted'
   | 'notes_email_sent' | 'notes_email_failed';
   ```
2. Add same 4 strings to `AUDIT_EVENTS` tuple (preserving union order).
3. Add `EVENT_LABEL` entries:
   ```typescript
   notes_posted: '发布留言',
   notes_deleted: '删除留言',
   notes_email_sent: '通知邮件发送',
   notes_email_failed: '通知邮件失败',
   ```
4. Add `formatLogMessage` cases:
   ```typescript
   case 'notes_posted':       return `收到新留言 #${num(m.id) || '?'}「${str(m.authorName) || '匿名'}」${str(m.content) ? `: ${truncate(str(m.content), 40)}` : ''}`;
   case 'notes_deleted':      return `删除留言 #${num(m.id) || '?'}${str(m.authorName) ? `「${str(m.authorName)}」` : ''}`;
   case 'notes_email_sent':   return `留言通知邮件发送 (to=${str(m.to) || '?'}, id=${num(m.noteId) || '?'})`;
   case 'notes_email_failed': return `留言通知邮件失败 (id=${num(m.noteId) || '?'}, error=${str(m.error) || '?'})`;
   ```
5. If a `truncate` helper is needed, add near `num/str/join`:
   ```typescript
   const truncate = (v: unknown, n: number): string => str(v).slice(0, n);
   ```

- [ ] **Step 2: Write failing test for rate-limit SQL**

`tests/unit/lib/notes.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Force DB-dependent branches to skip when DATABASE_URL is unset.
const integrationSkip = !process.env.DATABASE_URL;
const DB_URL = process.env.DATABASE_URL ?? 'mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test';

describe.skipIf(integrationSkip)('lib/notes — rate limit + insert', () => {
  it('insertNote + listActiveNotes round-trip', async () => {
    const { insertNote, listActiveNotes, softDeleteNote } = await import('../../lib/notes');
    const id = await insertNote({
      authorUserId: null,
      authorName: 'Unit测试',
      authorEmail: null,
      content: 'unit test content',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(id).toBeGreaterThan(0);
    const before = await listActiveNotes({ limit: 5 });
    expect(before.find((n) => n.id === id)).toBeTruthy();
    const ok = await softDeleteNote(id, 0); // 0 = system; FK is ON DELETE SET NULL so 0 won't satisfy FK
    // Use real user id if available, else just check delete sets deleted_at
    const [mysqlMod] = await Promise.all([import('mysql2/promise')]);
    const conn = await mysqlMod.default.createConnection(DB_URL);
    try {
      const [rows] = await conn.query('SELECT deleted_at FROM notes WHERE id = ?', [id]);
      expect((rows as any[])[0]?.deleted_at).not.toBeNull();
    } finally {
      await conn.end();
    }
  });

  it('checkRateLimit allows first post from new IP', async () => {
    const { checkRateLimit } = await import('../../lib/notes');
    const verdict = await checkRateLimit({ ip: '203.0.113.99', email: null });
    expect(verdict.allow).toBe(true);
  });

  it('checkRateLimit denies when ip minute window saturated', async () => {
    const { checkRateLimit, bumpRateLimit } = await import('../../lib/notes');
    await bumpRateLimit({ ip: '203.0.113.100', email: null });
    const verdict = await checkRateLimit({ ip: '203.0.113.100', email: null });
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.reason).toMatch(/分钟/);
    }
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test' npx vitest run tests/unit/lib/notes.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Write `lib/notes.ts`**

```typescript
import { getPool } from './db';

export interface NoteRow {
  id: number;
  authorUserId: number | null;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
}

const MAX_CONTENT_LEN = 1000;
const MAX_NAME_LEN = 64;
const IP_MINUTE_LIMIT = 1;
const EMAIL_HOUR_LIMIT = 5;

export interface ListNotesOpts {
  limit?: number;
  includeDeleted?: boolean;
}

export async function listActiveNotes(opts: ListNotesOpts = {}): Promise<NoteRow[]> {
  return listAllNotesForAdmin({ ...opts, includeDeleted: false });
}

export async function listAllNotesForAdmin(opts: ListNotesOpts = {}): Promise<NoteRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.includeDeleted ? '' : 'WHERE deleted_at IS NULL';
  const [rows] = await getPool().query<any[]>(
    `SELECT id, author_user_id, author_name, author_email, content, created_at, deleted_at
     FROM notes ${where} ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    authorEmail: r.author_email,
    content: r.content,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }));
}

export interface InsertNoteArgs {
  authorUserId: number | null;
  authorName: string;
  authorEmail: string | null;
  content: string;
  ip: string | null;
  userAgent: string | null;
}

export async function insertNote(args: InsertNoteArgs): Promise<number> {
  const name = args.authorName.trim().slice(0, MAX_NAME_LEN);
  const content = args.content.trim().slice(0, MAX_CONTENT_LEN);
  const email = args.authorEmail ? args.authorEmail.trim().slice(0, 254) : null;
  const ip = args.ip ? args.ip.slice(0, 45) : null;
  const ua = args.userAgent ? args.userAgent.slice(0, 255) : null;
  const [res] = await getPool().query<any>(
    `INSERT INTO notes (author_user_id, author_name, author_email, content, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [args.authorUserId, name, email, content, ip, ua]
  );
  return Number(res.insertId);
}

export async function softDeleteNote(id: number, byUserId: number): Promise<boolean> {
  const [res] = await getPool().query<any>(
    `UPDATE notes SET deleted_at = NOW(), deleted_by = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [byUserId, id]
  );
  return res.affectedRows > 0;
}

export type RateLimitVerdict =
  | { allow: true }
  | { allow: false; retryAfterSec: number; reason: string };

function truncateDate(d: Date): Date {
  // strip seconds/ms so windowStart buckets cleanly per minute/hour
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}

export interface RateLimitArgs { ip: string | null; email: string | null; }

export async function checkRateLimit(args: RateLimitArgs): Promise<RateLimitVerdict> {
  const now = new Date();
  const minuteStart = truncateDate(now);
  const hourStart = new Date(minuteStart);
  hourStart.setMinutes(0);

  const checks: Array<{
    scope: 'ip' | 'email';
    value: string;
    windowKind: 'minute' | 'hour';
    windowStart: Date;
    limit: number;
    label: string;
  }> = [];

  if (args.ip) {
    checks.push({
      scope: 'ip', value: args.ip,
      windowKind: 'minute', windowStart: minuteStart,
      limit: IP_MINUTE_LIMIT, label: '同一 IP 一分钟内',
    });
  }
  if (args.email) {
    checks.push({
      scope: 'email', value: args.email,
      windowKind: 'hour', windowStart: hourStart,
      limit: EMAIL_HOUR_LIMIT, label: '同一邮箱一小时内',
    });
  }
  if (checks.length === 0) return { allow: true }; // no identifiers — skip

  const pool = getPool();
  for (const c of checks) {
    const [rows] = await pool.query<any[]>(
      `SELECT post_count FROM notes_rate_limits
       WHERE scope = ? AND key_value = ? AND window_kind = ? AND window_start = ? LIMIT 1`,
      [c.scope, c.value, c.windowKind, c.windowStart]
    );
    const count = Number((rows as any[])[0]?.post_count ?? 0);
    if (count >= c.limit) {
      const nextWindow = c.windowKind === 'minute'
        ? new Date(minuteStart.getTime() + 60_000)
        : new Date(hourStart.getTime() + 3600_000);
      const retryAfterSec = Math.max(1, Math.ceil((nextWindow.getTime() - now.getTime()) / 1000));
      return {
        allow: false,
        retryAfterSec,
        reason: `${c.label}最多 ${c.limit} 条,请稍后再试`,
      };
    }
  }
  return { allow: true };
}

export async function bumpRateLimit(args: RateLimitArgs): Promise<void> {
  const now = new Date();
  const minuteStart = truncateDate(now);
  const hourStart = new Date(minuteStart);
  hourStart.setMinutes(0);
  const pool = getPool();

  const bumps: Array<{ scope: 'ip' | 'email'; value: string; windowKind: 'minute' | 'hour'; windowStart: Date; }> = [];
  if (args.ip) bumps.push({ scope: 'ip', value: args.ip, windowKind: 'minute', windowStart: minuteStart });
  if (args.email) bumps.push({ scope: 'email', value: args.email, windowKind: 'hour', windowStart: hourStart });

  for (const b of bumps) {
    await pool.query(
      `INSERT INTO notes_rate_limits (scope, key_value, window_kind, window_start, post_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         window_start = VALUES(window_start),
         post_count   = IF(window_start = VALUES(window_start), post_count + 1, 1)`,
      [b.scope, b.value, b.windowKind, b.windowStart]
    );
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test' npx vitest run tests/unit/lib/notes.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/notes.ts lib/audit-format.ts tests/unit/lib/notes.test.ts
git commit -m "feat(notes): lib/notes.ts CRUD + rate-limit SQL + audit events [2026-07-05 12.20]"
```

---

## Task 3: Email template + admin email helper

**Files:**
- Create: `lib/email-templates.ts`
- Modify: `lib/email.ts` — add top-level re-export of `notesNotificationEmail` (so admin route can `import { sendEmail, notesNotificationEmail } from '@/lib/email'`)

**Interfaces:**
- Consumes: NoteRow (or just author/content)
- Produces: `notesNotificationEmail(note: { id, authorName, authorEmail, content, createdAt, ip }): { subject, html, text }`

- [ ] **Step 1: Write `lib/email-templates.ts`**

```typescript
import type { NoteRow } from './notes';

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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Re-export from `lib/email.ts`**

In `lib/email.ts`, add at top (after `import nodemailer` block, before `export interface EmailMessage`):

```typescript
export { notesNotificationEmail } from './email-templates';
```

(No other change to `lib/email.ts`; the template function is client-safe.)

- [ ] **Step 3: Write unit test for template**

Add `tests/unit/lib/email-templates.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { notesNotificationEmail } from '../../../lib/email-templates';

describe('notesNotificationEmail', () => {
  it('subject includes note id + author', () => {
    const out = notesNotificationEmail({
      id: 42, authorName: '张三', authorEmail: 'a@b.com',
      content: '你好', createdAt: new Date('2026-07-05T08:00:00Z'), ip: '1.2.3.4',
    });
    expect(out.subject).toBe('[留言笔记] 新留言 #42 — 张三');
  });

  it('escapes HTML in author name + content', () => {
    const out = notesNotificationEmail({
      id: 1, authorName: '<script>', authorEmail: null,
      content: '<img src=x>', createdAt: new Date(), ip: null,
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&lt;img src=x&gt;');
  });

  it('omits email line when authorEmail is null', () => {
    const out = notesNotificationEmail({
      id: 1, authorName: '匿名', authorEmail: null,
      content: 'x', createdAt: new Date(), ip: null,
    });
    expect(out.html).not.toContain('@');
    expect(out.text).not.toContain('@');
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/lib/email-templates.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/email-templates.ts lib/email.ts tests/unit/lib/email-templates.test.ts
git commit -m "feat(notes): admin email template (notesNotificationEmail) [2026-07-05 12.30]"
```

---

## Task 4: API routes (POST/GET /api/notes + DELETE /api/admin/notes/[id])

**Files:**
- Create: `app/api/notes/route.ts`
- Create: `app/api/admin/notes/[id]/route.ts`
- Modify: `lib/config.ts` — verify `getConfig('notes.admin_emails')` returns string | null; if signature differs, add a typed helper (read from the comments / pattern below)

**Interfaces:**
- POST `/api/notes` body: `{ name, email?, content }` (anon) OR `{}` (registered user — server reads session); response `{ ok: true, data: { id } }` or 4xx error
- GET `/api/notes?limit=N` response `{ ok: true, data: NoteRow[] }` (alive only, newest first)
- DELETE `/api/admin/notes/[id]` admin-only, soft-delete; 404 if missing/already deleted
- Internal: `sendAdminNotification(note)` in same route module — resolves `notes.admin_emails` from app_config, comma-separated; falls back to `smtp.from` if config empty

- [ ] **Step 1: Write `app/api/notes/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { insertNote, listActiveNotes, checkRateLimit, bumpRateLimit } from '@/lib/notes';
import { sendEmail, notesNotificationEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';
import { getConfig } from '@/lib/config';

const PostSchema = z.object({
  name: z.string().min(1).max(64),
  email: z.string().email().max(254).optional().or(z.literal('')).transform((v) => v || undefined),
  content: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    const user = await getCurrentUser();

    const verdict = await checkRateLimit({
      ip,
      email: parsed.data.email ?? user?.email ?? null,
    });
    if (!verdict.allow) {
      return NextResponse.json(
        { ok: false, error: { code: 'rate_limited', message: verdict.reason, retryAfterSec: verdict.retryAfterSec } },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } }
      );
    }

    let id: number;
    try {
      id = await insertNote({
        authorUserId: user?.id ?? null,
        authorName: parsed.data.name,
        authorEmail: parsed.data.email ?? null,
        content: parsed.data.content,
        ip, userAgent: ua,
      });
    } catch (err) {
      return badRequest('insert_failed', (err as Error).message);
    }

    await bumpRateLimit({ ip, email: parsed.data.email ?? null });

    // Audit + email are best-effort: never fail the user's POST.
    await writeAudit({
      userId: user?.id ?? null,
      event: 'notes_posted',
      metadata: { id, authorName: parsed.data.name },
      ip, userAgent: ua,
    }).catch(() => {});

    // Admin email (fire-and-forget; failures go to audit only)
    sendAdminNotification(id).catch(() => {});

    return NextResponse.json({ ok: true, data: { id } });
  });
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const limit = Math.min(
      Math.max(parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10) || 50, 1),
      100
    );
    const rows = await listActiveNotes({ limit });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    return NextResponse.json({ ok: true, data: rows }, { headers });
  });
}

async function sendAdminNotification(noteId: number): Promise<void> {
  // Lazy import to avoid pulling notes.ts into email-only call paths
  const { listAllNotesForAdmin } = await import('@/lib/notes');
  const all = await listAllNotesForAdmin({ limit: 200, includeDeleted: true });
  const note = all.find((n) => n.id === noteId);
  if (!note) return;
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  const tpl = notesNotificationEmail({
    id: note.id,
    authorName: note.authorName,
    authorEmail: note.authorEmail,
    content: note.content,
    createdAt: note.createdAt,
    ip: null, // we don't expose IP in email; only in admin /admin/notes
  });
  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        template: 'notes_notification',
      });
      await writeAudit({
        userId: null,
        event: 'notes_email_sent',
        metadata: { noteId: note.id, to },
      }).catch(() => {});
    } catch (err) {
      const code = err instanceof EmailNotConfiguredError ? 'email_not_configured'
        : err instanceof EmailSendError ? 'email_send_failed'
        : 'unknown';
      await writeAudit({
        userId: null,
        event: 'notes_email_failed',
        metadata: { noteId: note.id, to, error: code },
      }).catch(() => {});
    }
  }
}

async function resolveAdminRecipients(): Promise<string[]> {
  const cfg = await getConfig('notes.admin_emails').catch(() => null);
  const fallback = await getConfig('smtp.from').catch(() => null);
  const raw = (cfg && String(cfg).trim()) || (fallback && String(fallback).trim()) || '';
  return raw.split(',').map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}
```

- [ ] **Step 2: Verify `lib/config.ts` has `getConfig(key)`**

Run: `grep -n "export.*getConfig" lib/config.ts | head -5`
Expected: function signature returns `string | null` from app_config

If the helper signature differs (e.g., returns an object), add an adapter at the top of the route:
```typescript
async function cfg(key: string): Promise<string | null> {
  const v = await getConfig(key);
  return v == null ? null : String(v);
}
```

- [ ] **Step 3: Write `app/api/admin/notes/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { softDeleteNote } from '@/lib/notes';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: rawId } = await ctx.params;
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id) || id <= 0) return notFound('not_found', 'note not found');
    const ok = await softDeleteNote(id, auth.user.id);
    if (!ok) return notFound('not_found', 'note not found or already deleted');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    await writeAudit({
      userId: auth.user.id,
      event: 'notes_deleted',
      metadata: { id },
      ip, userAgent: ua,
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
```

- [ ] **Step 4: Build verify (per `feedback-per-task-build-check.md`)**

Run: `npx next build 2>&1 | tail -20`
Expected: build exits 0, `/api/notes` appears in route list

- [ ] **Step 5: Commit**

```bash
git add app/api/notes/route.ts app/api/admin/notes/[id]/route.ts
git commit -m "feat(notes): POST/GET /api/notes + DELETE /api/admin/notes/[id] [2026-07-05 12.45]"
```

---

## Task 5: /notes public page (server page → NotesWall client)

**Files:**
- Create: `app/notes/page.tsx` (server)
- Create: `components/notes/NotesWall.tsx`
- Create: `components/notes/NotesForm.tsx`
- Create: `tests/unit/components/notes/NotesForm.test.tsx`

**Interfaces:**
- Server page: reads `listActiveNotes({ limit: 50 })` at request time, renders `<NotesWall initial={...} />`
- `NotesWall`: shows card per note (author + relative time + content), embeds form at top
- `NotesForm`: inputs (name + email optional + content) + submit button. Disabled while in-flight. Posts to `/api/notes`, on success inserts the new note at the top via local state, clears form.

- [ ] **Step 1: Write `tests/unit/components/notes/NotesForm.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/dom';
import { NotesForm } from '@/components/notes/NotesForm';

describe('NotesForm', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders name + email + content fields + submit button', () => {
    render(<NotesForm onPosted={() => {}} />);
    expect(screen.getByLabelText(/姓名/)).toBeTruthy();
    expect(screen.getByLabelText(/邮箱/)).toBeTruthy();
    expect(screen.getByLabelText(/内容/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /发布/ })).toBeTruthy();
  });

  it('posts via fetch on submit and calls onPosted with id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { id: 99 } }),
    }));
    global.fetch = fetchMock as any;
    const cb = vi.fn();
    render(<NotesForm onPosted={cb} />);
    fireEvent.input(screen.getByLabelText(/姓名/), { target: { value: '测试者' } });
    fireEvent.input(screen.getByLabelText(/内容/), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /发布/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(cb).toHaveBeenCalledWith(99));
    const url = (fetchMock.mock.calls[0] as any)[0];
    expect(url).toBe('/api/notes');
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(JSON.parse(init.body)).toMatchObject({ name: '测试者', content: 'hello' });
  });

  it('disables button + shows error text when API returns rate_limited', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 429, json: async () => ({
        ok: false, error: { code: 'rate_limited', message: '请稍后再试' },
      }),
    })) as any;
    render(<NotesForm onPosted={() => {}} />);
    fireEvent.input(screen.getByLabelText(/姓名/), { target: { value: 'X' } });
    fireEvent.input(screen.getByLabelText(/内容/), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: /发布/ }));
    await waitFor(() => expect(screen.getByText(/请稍后再试/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /发布/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/unit/components/notes/NotesForm.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `components/notes/NotesForm.tsx`**

```tsx
'use client';
import { useState } from 'react';

interface NotesFormProps {
  onPosted: (id: number) => void;
  defaultName?: string;
}

export function NotesForm({ onPosted, defaultName }: NotesFormProps) {
  const [name, setName] = useState(defaultName ?? '');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email || undefined, content }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? '提交失败,请稍后再试');
        return;
      }
      onPosted(body.data.id);
      setContent('');
    } catch {
      setError('网络错误,请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg bg-paper-warm">
      <div>
        <label htmlFor="notes-name" className="block text-sm font-medium">姓名 <span className="text-red-600">*</span></label>
        <input id="notes-name" type="text" maxLength={64} required value={name}
               onChange={(e) => setName(e.target.value)}
               disabled={submitting}
               className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label htmlFor="notes-email" className="block text-sm font-medium">邮箱 <span className="text-gray-500">(选填,不会公开)</span></label>
        <input id="notes-email" type="email" maxLength={254} value={email}
               onChange={(e) => setEmail(e.target.value)}
               disabled={submitting}
               className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label htmlFor="notes-content" className="block text-sm font-medium">留言内容 <span className="text-red-600">*</span></label>
        <textarea id="notes-content" required rows={4} maxLength={1000} value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={submitting}
                  className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={submitting || name.trim() === '' || content.trim() === ''}
              className="px-4 py-2 bg-ink text-paper rounded disabled:opacity-50">
        {submitting ? '发布中…' : '发布'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Write `components/notes/NotesWall.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { NotesForm } from './NotesForm';

export interface ClientNote {
  id: number;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: string; // ISO
}

interface NotesWallProps { initial: ClientNote[]; defaultName?: string; }

export function NotesWall({ initial, defaultName }: NotesWallProps) {
  const [notes, setNotes] = useState<ClientNote[]>(initial);

  function handlePosted(id: number) {
    // Optimistic insert; form cleared by parent.
    setNotes((cur) => [{
      id,
      authorName: defaultName ?? '我',
      authorEmail: null,
      content: (document.getElementById('notes-content') as HTMLTextAreaElement | null)?.value ?? '',
      createdAt: new Date().toISOString(),
    }, ...cur]);
  }

  return (
    <div className="space-y-6">
      <NotesForm onPosted={handlePosted} defaultName={defaultName} />
      <section aria-label="留言列表">
        {notes.length === 0
          ? <p className="text-gray-500 italic">暂无留言,做第一个发声的人。</p>
          : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="p-4 border rounded-lg bg-paper">
                  <div className="flex items-baseline gap-2 text-sm text-gray-600">
                    <span className="font-medium text-ink">{n.authorName}</span>
                    <time dateTime={n.createdAt}>{fmtTime(n.createdAt)}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{n.content}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 5: Write `app/notes/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { listActiveNotes } from '@/lib/notes';
import { getCurrentUser } from '@/lib/auth';
import { NotesWall, type ClientNote } from '@/components/notes/NotesWall';

export const metadata: Metadata = {
  title: '留言笔记 · 汉字·韵',
  description: '分享建议与想法 — 汉字·韵用户反馈墙',
};

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const rows = await listActiveNotes({ limit: 50 });
  const user = await getCurrentUser();
  const initial: ClientNote[] = rows.map((r) => ({
    id: r.id,
    authorName: r.authorName,
    authorEmail: r.authorEmail,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">留言笔记</h1>
      <p className="text-gray-600 text-sm">
        欢迎留下你的建议、功能想法或使用感受。每条留言都会发送到管理员邮箱,我们会认真阅读。
        {user ? ` 已识别为 ${user.username}。` : ' 匿名留言也可,只需填个昵称即可。'}
      </p>
      <NotesWall initial={initial} defaultName={user ? '' : undefined} />
    </main>
  );
}
```

(Note: to avoid leaking server-only `NoteRow` (Date) into a client component, map to `ClientNote` with ISO string.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/components/notes/NotesForm.test.tsx`
Expected: 3 tests PASS

Run: `npx next build 2>&1 | tail -10`
Expected: build exits 0

- [ ] **Step 7: Commit**

```bash
git add components/notes app/notes tests/unit/components/notes
git commit -m "feat(notes): /notes public page + NotesForm + NotesWall [2026-07-05 12.55]"
```

---

## Task 6: Admin page + sidebar nav link + admin email config field

**Files:**
- Create: `app/admin/notes/page.tsx` (server)
- Create: `components/notes/NotesAdminClient.tsx`
- Create: `tests/unit/components/notes/NotesAdminClient.test.tsx`
- Modify: `components/admin/AdminSidebar.tsx` — add `{ href: '/admin/notes', label: '留言笔记' }`
- Modify: `components/Header.tsx` (or wherever site footer lives) — add `<Link href="/notes">留言笔记</Link>`
- Modify: `app/admin/settings/email/page.tsx` (or create `app/admin/settings/notes/page.tsx`) — add `notes.admin_emails` field
- Modify: `DEPLOY.md` §8 — add migration row + admin UI mention

- [ ] **Step 1: Write `tests/unit/components/notes/NotesAdminClient.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/dom';
import { NotesAdminClient } from '@/components/notes/NotesAdminClient';

const SAMPLE = [
  { id: 1, authorName: 'Alice', authorEmail: 'a@b.com', content: 'hi', createdAt: '2026-07-05T08:00:00Z', deletedAt: null },
  { id: 2, authorName: 'Bob',   authorEmail: null,     content: 'hey', createdAt: '2026-07-04T08:00:00Z', deletedAt: '2026-07-04T10:00:00Z' },
];

describe('NotesAdminClient', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders table of all notes incl. deleted', () => {
    render(<NotesAdminClient initial={SAMPLE as any} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /删除/ }).length).toBeGreaterThanOrEqual(2);
  });

  it('sends DELETE on click + filters out deleted note', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: true, data: { id: 1 } }),
    }));
    global.fetch = fetchMock as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    // Alice row (id=1)
    const buttons = screen.getAllByRole('button', { name: /删除/ });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/notes/1', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => {
      const remaining = screen.queryAllByText('Alice');
      expect(remaining.length).toBe(0);
    });
  });

  it('shows error when DELETE fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'not found' } }),
    })) as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]);
    await waitFor(() => expect(screen.getByText(/not found/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/unit/components/notes/NotesAdminClient.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `components/notes/NotesAdminClient.tsx`**

```tsx
'use client';
import { useState } from 'react';

export interface AdminNoteRow {
  id: number;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: string;       // ISO
  deletedAt: string | null; // ISO or null
}

interface NotesAdminClientProps { initial: AdminNoteRow[]; }

export function NotesAdminClient({ initial }: NotesAdminClientProps) {
  const [notes, setNotes] = useState<AdminNoteRow[]>(initial);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: number) {
    if (!confirm(`确认删除留言 #${id}?该留言将从公共列表中移除,但审计日志里仍可查看。`)) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? '删除失败');
        return;
      }
      setNotes((cur) =>
        cur.map((n) => (n.id === id ? { ...n, deletedAt: new Date().toISOString() } : n))
      );
    } catch {
      setError('网络错误');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2">#</th>
            <th>作者</th>
            <th>时间</th>
            <th>内容</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {notes.length === 0 && (
            <tr><td colSpan={6} className="py-4 text-center text-gray-500">暂无留言</td></tr>
          )}
          {notes.map((n) => (
            <tr key={n.id} className="border-b align-top">
              <td className="py-2 pr-2">{n.id}</td>
              <td className="pr-2">{n.authorName}{n.authorEmail && <span className="text-gray-500"> &lt;{n.authorEmail}&gt;</span>}</td>
              <td className="pr-2 whitespace-nowrap">{fmtTime(n.createdAt)}</td>
              <td className="pr-2">
                <div className="max-w-md whitespace-pre-wrap break-words">{n.content}</div>
              </td>
              <td className="pr-2">{n.deletedAt ? <span className="text-red-600">已删除 {fmtTime(n.deletedAt)}</span> : <span className="text-green-700">活跃</span>}</td>
              <td>
                {!n.deletedAt && (
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    disabled={pendingId === n.id}
                    className="px-2 py-1 text-xs border rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50">
                    {pendingId === n.id ? '删除中…' : '删除'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 4: Write `app/admin/notes/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { listAllNotesForAdmin } from '@/lib/notes';
import { NotesAdminClient, type AdminNoteRow } from '@/components/notes/NotesAdminClient';

export const metadata: Metadata = { title: '留言笔记 · 管理' };
export const dynamic = 'force-dynamic';

export default async function AdminNotesPage() {
  const rows = await listAllNotesForAdmin({ limit: 200, includeDeleted: true });
  const initial: AdminNoteRow[] = rows.map((r) => ({
    id: r.id, authorName: r.authorName, authorEmail: r.authorEmail,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }));
  return (
    <section>
      <h1 className="text-xl font-bold mb-3">留言笔记</h1>
      <p className="text-sm text-gray-600 mb-4">所有用户发布的留言。被删除的留言会留在审计日志,不会向公众展示。</p>
      <NotesAdminClient initial={initial} />
    </section>
  );
}
```

- [ ] **Step 5: Add sidebar link**

In `components/admin/AdminSidebar.tsx` (after `'/admin/email'` entry, line 24):

```typescript
{ href: '/admin/notes', label: '留言笔记' },
```

- [ ] **Step 6: Add notes email config field**

If `app/admin/settings/email/page.tsx` already exists (manages SMTP), add a new card at the bottom of the form:

```tsx
<div className="rounded-lg border p-4 space-y-2">
  <h2 className="font-semibold">留言笔记通知邮箱</h2>
  <p className="text-sm text-gray-600">新留言的邮件通知会发到这里。多个邮箱用英文逗号分隔。留空则回退到「发件人地址」。</p>
  <input
    type="text"
    placeholder="admin@example.com, dev@example.com"
    defaultValue={initial['notes.admin_emails'] ?? ''}
    // wire to setConfigBatch in the same form's onSubmit, alongside the SMTP keys
  />
</div>
```

If `app/admin/settings/email/page.tsx` does NOT exist (no SMTP admin UI yet), create a focused sub-page `app/admin/settings/notes/page.tsx` that just manages the `notes.admin_emails` config value, with sidebar link `{ href: '/admin/settings/notes', label: '留言通知邮箱' }` added to `AdminSidebar.tsx`.

(The implementer should grep `app/admin` for existing email-related pages and follow whichever pattern is already present. If neither exists, default to creating `app/admin/settings/notes/page.tsx` with the existing patterns in `app/admin/settings/audio/page.tsx` as a reference.)

- [ ] **Step 7: Add public link in main header or footer**

In `components/Header.tsx`, find the existing site nav (likely an `<ul>` listing dictionary/worksheet/etc.) and add:

```tsx
<li><Link href="/notes" className="...">留言笔记</Link></li>
```

(If `Header.tsx` doesn't have a public site nav, use the footer component or `app/page.tsx`. Place at the end of whatever nav list exists.)

- [ ] **Step 8: Run tests + build**

Run: `npx vitest run tests/unit/components/notes/`
Expected: all PASS

Run: `npx next build 2>&1 | tail -10`
Expected: build exits 0; `/notes` and `/admin/notes` appear in route list

- [ ] **Step 9: Commit**

```bash
git add components/notes app/admin/notes components/admin/AdminSidebar.tsx components/Header.tsx app/admin/settings/email/page.tsx tests/unit/components/notes/NotesAdminClient.test.tsx
git commit -m "feat(notes): /admin/notes page + sidebar nav + email config + public link [2026-07-05 13.05]"
```

---

## Task 7: Final verification (full test suite + DEPLOY.md + browser smoke doc)

**Files:**
- Modify: `DEPLOY.md` (add migration row + admin UI bullet)

- [ ] **Step 1: Update DEPLOY.md §8**

Append a row to the migration table:

```
| 2026-07-05-notes.sql | CREATE notes + notes_rate_limits | 留言笔记功能 |
```

Add a bullet under §8 "已完成迁移" or "新功能 migrations" (whichever section is current per the file's actual structure):

```
- 留言笔记 (`/notes` 公共墙 + `/admin/notes` 管理) — 表 `notes`, `notes_rate_limits`. 管理员邮箱通过 `app_config.notes.admin_emails` 配置(逗号分隔,空时回退到 `smtp.from`).
```

- [ ] **Step 2: Full test suite**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test' npx vitest run`
Expected: all PASS (existing baseline 326/326 + new tests; aim for total 326 + ~9 new unit tests + 3 integration tests = 338+). Report actual count in commit message.

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `npx next build`
Expected: exit 0; `/notes`, `/admin/notes`, `/api/notes` (POST/GET), `/api/admin/notes/[id]` (DELETE) all in route list; total route count ≥ previous (130).

- [ ] **Step 3: Manual smoke script (write into commit message or memory)**

Required browser verifications (cannot be automated):

1. Visit `/notes` (no auth) — see NotesForm + empty list (assuming fresh DB).
2. Post a note as anonymous: name=`访客A`, content=`Smoke test留言`. See note appear at top of list.
3. Post immediately again — expect rate-limit response in form ("同一 IP 一分钟内最多 1 条").
4. Login as admin in another tab, visit `/admin/notes` — see smoke-test note.
5. Click 删除 — confirm → note flagged as 已删除 in row, no longer visible on `/notes`.
6. Configure `app_config.notes.admin_emails = <your-test-email>` via admin UI; post another note → email arrives (check smtp.send test or inbox).
7. Restore DB state after test: `mysql -u root -pAdmin909217 piyin_deploy_test -e "DELETE FROM notes; DELETE FROM notes_rate_limits;"`

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): §8 notes migration row + admin UI note [2026-07-05 13.15]"
```

- [ ] **Step 5: Whole-branch review (after all 7 tasks complete)**

Run a Sonnet-grade code-reviewer on `git diff $(git merge-base main HEAD)..HEAD` covering:
- Spec compliance: each row of §API Contract + §Data Model + §Rate Limit covered
- Schema: notes + notes_rate_limits match spec exactly
- Rate-limit window logic: minute window for IP, hour window for email, reset semantics correct
- Email: SMTP-not-configured and SMTP-send-failed both audited, never break user POST
- Security: soft-delete via admin guard only; rate-limit key sanitized
- Test coverage: unit + integration tests cover happy path + 2 rate-limit branches + admin delete
- DEPLOY.md: migration row + post-init note present

Fix any Critical/Important findings before final commit.

- [ ] **Step 6: Final memory update**

Append to a new memory file:

```yaml
---
name: Plan 留言笔记 — shipped YYYY-MM-DD, awaiting human smoke
description: Public notes wall with admin email notifications; 8 tasks complete on local main
type: project
---

[plan-hsk-game-redesign-status.md style entry describing: schema, route, page, audit events, DEPLOY.md update, what's pushed and what's not, what's left for human smoke]
```

Add MEMORY.md index entry linking to it.

---

## Verification

### Automated (verifiable before ship)

- `npx vitest run` — 338+ tests pass, 0 fail
- `npx tsc --noEmit` — exit 0
- `npx next build` — exit 0, ≥130 routes preserved
- Integration test `tests/integration/scripts/notes-migration.test.ts` — 3 tests pass against `piyin_deploy_test`

### Manual browser smoke (per Task 7 step 3) — human runs after code ship

Required: anonymous post, rate-limit trigger, admin delete, admin email delivery (or console fallback), config-edit-then-notify flow.

---

## Commit Summary

7 commits on local main (per `feedback-commit-timestamps.md` suffix):

1. `feat(notes): schema migration for notes + notes_rate_limits [2026-07-05 12.10]`
2. `feat(notes): lib/notes.ts CRUD + rate-limit SQL + audit events [2026-07-05 12.20]`
3. `feat(notes): admin email template (notesNotificationEmail) [2026-07-05 12.30]`
4. `feat(notes): POST/GET /api/notes + DELETE /api/admin/notes/[id] [2026-07-05 12.45]`
5. `feat(notes): /notes public page + NotesForm + NotesWall [2026-07-05 12.55]`
6. `feat(notes): /admin/notes page + sidebar nav + email config + public link [2026-07-05 13.05]`
7. `docs(deploy): §8 notes migration row + admin UI note [2026-07-05 13.15]`

Per `no-prod-env-2026-06-21.md`: DO NOT push. User will authorize push once prod env exists.

---

## Notes / Risks

- **Rate-limit window reset semantics**: `ON DUPLICATE KEY UPDATE post_count = IF(window_start = VALUES(window_start), post_count + 1, 1)` — when a new minute starts, `window_start` differs, count resets to 1. Verified during spec self-review.
- **`sendAdminNotification` failure isolation**: wrapped in `.catch(() => {})` at call site (POST route) AND inside `sendAdminNotification` itself (each recipient; failures audited as `notes_email_failed`). User's POST never fails because of admin email issues.
- **`getConfig('notes.admin_emails')` lazy resolution**: read on demand inside `sendAdminNotification` — no module-load-time DB hit, follows existing config getter pattern. Fallback to `smtp.from` if empty.
- **`@vitest-environment happy-dom`** is required for `NotesForm.test.tsx` + `NotesAdminClient.test.tsx` (per `component-test-pragma-cleanup.md`).
- **Cache-Control: no-store** on `GET /api/notes` to match `feedback-cache-control-route-iterations.md`.
- **Anonymous vs registered**: `getCurrentUser()` returns `null` for anon; `author_user_id` column is nullable; server only stores name + optional email + content, never the user's id unless logged in.
- **HTML escape**: `notesNotificationEmail` escapes all user-derived strings; expected content uses `<br/>` for newlines (preserves whitespace semantics in plain text → HTML conversion).
- **Soft-delete audit FK**: `notes.deleted_by` references `users(id)` with ON DELETE SET NULL — preserves deleted_by even if user is later deleted; matching constraint added by Task 1 migration.
- **Admin audit page (`/admin/logs`)** should auto-pick up the 4 new event labels via the existing render path (uses `EVENT_LABEL` and `formatLogMessage`).
- **Admin email recipients limit**: out-of-scope for v1; simple comma-split is fine. Future: support separate `notes_admin_emails` DB table for per-note routing.
