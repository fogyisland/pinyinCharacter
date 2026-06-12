# Plan H: 后台管理平台扩展 — Design Spec

**Date:** 2026-06-12
**Status:** Approved (brainstorm complete)
**Builds on:** Plan B+ (admin scaffold + password reset, committed 2026-06-09)

---

## 1. Goal

Expand the existing `/admin` scaffold into a full admin platform with 4 areas:

- **用户管理** — search + role toggle + disable + password reset link
- **日志管理** — unified log viewer (audit + downloads + AI calls, filterable)
- **下载管理** — user-generated downloads (worksheet/poem/sutra/rare-char prints)
- **AI 管理** — call log + editable config (model, rate limit, timeout, temperature)

Scope: **one plan, ~25-30 tasks across 6 phases.**

---

## 2. Non-Goals

- RBAC beyond the existing `is_admin` boolean (no moderator, no permission matrix)
- Alerting / notifications for log events
- AI cost tracking (no persisted token counts beyond a best-effort capture)
- Admin-initiated downloads (only user-generated ones are logged)
- Regeneration queue for rare-char stories
- Server-side PDF generation (v1 logs `print` events only; PDF gen is a follow-up)
- Bulk operations on users (no batch ban, no batch email)

---

## 3. Architecture

**Approach:** enrich and extend the existing `/admin` layout (Plan B+ shipped a basic version with `/admin/users` list, `/admin/users/[id]`, `/admin/audit`, `/admin/stats`). The existing scaffold stays; this plan adds 2 new tables, 1 config table, ~9 new admin routes, 2 new user-facing "print" hooks, and 3 new admin pages.

**Logging discipline:** `logDownload` and `logAiCall` are **fire-and-forget** `await pool.query(...)` calls wrapped in try/catch. A logging failure logs a warning to stderr and never throws. User-facing flows (PDF print, rare-char gen) must remain working even if the admin log is unavailable.

**Admin UI:** site palette (ink / scroll / seal) + a new `AdminSidebar` component inside `app/admin/layout.tsx`. Pages reuse `Card`, `Pagination`, `EmptyState`, `LoadingSpinner`, `ErrorState`. No new color tokens. Lucide icons (already installed in Plan E) for stat cards and badges.

**Admin entry point:** the existing `UserMenu` (Header) gets a new "后台管理" entry rendered below the username, only when `user.isAdmin === true`. The existing layout in `app/admin/layout.tsx` already guards by `isAdmin` server-side.

**Disable-account enforcement:** `lib/auth.ts` `getCurrentUser` filters out users with `disabled_at IS NOT NULL`. Authenticated API calls return 403 with `code: account_disabled`. Login also short-circuits on disabled users.

---

## 4. Data Model

### 4.1 `downloads` (new)

```sql
CREATE TABLE downloads (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NOT NULL,
  format      ENUM('pdf','print') NOT NULL,
  source_type ENUM('worksheet','poem','sutra','rare-char-card') NOT NULL,
  source_id   VARCHAR(64)  NULL,
  status      ENUM('ok','error') NOT NULL DEFAULT 'ok',
  duration_ms INT UNSIGNED NULL,
  ip          VARCHAR(45)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_created (user_id, created_at DESC),
  KEY idx_source (source_type, source_id),
  CONSTRAINT fk_downloads_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 `ai_calls` (new)

```sql
CREATE TABLE ai_calls (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NULL,
  feature     VARCHAR(32)  NOT NULL,
  model       VARCHAR(64)  NOT NULL,
  status      ENUM('ok','error','rate-limited') NOT NULL,
  prompt_tokens     INT UNSIGNED NULL,
  completion_tokens INT UNSIGNED NULL,
  duration_ms INT UNSIGNED NULL,
  error       TEXT         NULL,
  metadata    JSON         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feature_created (feature, created_at DESC),
  KEY idx_user_created (user_id, created_at DESC),
  KEY idx_status (status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.3 `app_config` (new, small)

```sql
CREATE TABLE app_config (
  `key`       VARCHAR(64)  NOT NULL,
  value       TEXT         NOT NULL,
  updated_by  BIGINT       NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`),
  CONSTRAINT fk_app_config_user FOREIGN KEY (updated_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.4 `users` (additive change)

```sql
ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin;
```

Soft delete only; history/worksheets/downloads stay intact.

### 4.5 `audit_log` (reuse as-is)

Already has `event` ENUM and JSON `metadata`. Admin actions add new event types: `user_disabled`, `user_reenabled`, `ai_config_updated`, `download_logged`. AI call records themselves go in `ai_calls`, not `audit_log`, so they can be queried as a stream with detail (duration, model, error, metadata).

### 4.6 Seed

After DDL runs, seed `app_config` with these defaults if empty:
- `ai.model` = `"gpt-4o-mini"`
- `ai.rate_limit_per_user_per_day` = `"5"`
- `ai.timeout_ms` = `"30000"`
- `ai.temperature` = `"0.7"`

---

## 5. Library Functions

### 5.1 `lib/downloads.ts` (new)

```ts
export type DownloadFormat = 'pdf' | 'print';
export type DownloadSourceType = 'worksheet' | 'poem' | 'sutra' | 'rare-char-card';
export type DownloadStatus = 'ok' | 'error';

export interface LogDownloadArgs {
  userId: number;
  format: DownloadFormat;
  sourceType: DownloadSourceType;
  sourceId: string | null;
  status?: DownloadStatus;
  durationMs?: number;
  ip?: string | null;
}

export async function logDownload(args: LogDownloadArgs): Promise<void>;
// fire-and-forget; never throws. Logs warn on insert failure.
```

### 5.2 `lib/ai-calls.ts` (new)

```ts
export type AiCallStatus = 'ok' | 'error' | 'rate-limited';

export interface LogAiCallArgs {
  userId: number | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function logAiCall(args: LogAiCallArgs): Promise<void>;

export async function checkAiRateLimit(userId: number): Promise<boolean>;
// returns true if under limit, false if exceeded. Reads ai.rate_limit_per_user_per_day
// from app_config and counts today's calls for the user with status='ok' or 'error'.

export async function withAiLogging<T>(
  args: { userId: number | null; feature: string; metadata?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T>;
// higher-order: runs fn, captures duration + result/error, inserts ai_calls row, returns result.
// On fn error: re-throws, but only after logging. On insert failure: warns, does not throw.
```

### 5.3 `lib/admin.ts` (extend existing)

```ts
export async function disableUser(id: number, byAdminId: number): Promise<void>;
export async function enableUser(id: number, byAdminId: number): Promise<void>;
export async function isUserDisabled(userId: number): Promise<boolean>;
// also: extend GET /api/admin/users to support `?disabled=true` filter
//       and the list response to include `disabled_at` field
```

### 5.4 `lib/auth.ts` (extend existing)

```ts
// In getCurrentUser / getCurrentUserWithAdmin:
//   - if user.disabled_at IS NOT NULL, treat as unauthenticated for API calls
//     and add `code: account_disabled` to 403 responses
// In login route:
//   - if user.disabled_at IS NOT NULL, return 403 with code account_disabled
```

### 5.5 `lib/config.ts` (new, small)

```ts
export async function getConfig(key: string): Promise<string | null>;
export async function setConfig(key: string, value: string, byUserId: number | null): Promise<void>;
export async function getAllConfig(): Promise<Record<string, string>>;
export async function setConfigBatch(updates: Record<string, string>, byUserId: number): Promise<void>;
// validates `value` shape for known keys (number coercion for *_ms, integer for rate_limit, float for temperature)
```

---

## 6. API Surface

All admin routes under `/api/admin/*` require `is_admin=1` (reusing Plan B+'s `requireAdmin`). Standard `{ ok, data, error }` envelope.

### 6.1 Existing routes (Plan B+ — no changes)

- `GET /api/admin/users` — list with search
- `GET /api/admin/users/[id]` — detail
- `DELETE /api/admin/users/[id]` — hard delete (kept for now; can be deprecated later)
- `POST /api/admin/users/[id]/reset-password`
- `POST /api/admin/users/[id]/promote` / `demote`
- `GET /api/admin/audit`

### 6.2 New routes — Users

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/admin/users/[id]/disable` | — | `{ ok: true }` |
| POST | `/api/admin/users/[id]/enable` | — | `{ ok: true }` |
| GET  | `/api/admin/users/[id]/activity` | — | `{ items: UnifiedLogEntry[] }` last 100 events (audit + downloads + ai_calls) for this user |

### 6.3 New routes — Unified Logs

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/admin/logs` | `type?`, `userId?`, `ip?`, `from?`, `to?`, `page?`, `pageSize?` | `{ items: UnifiedLogEntry[], total, page, pageSize }` |

`UnifiedLogEntry` shape (uniform across sources):

```ts
interface UnifiedLogEntry {
  id: string | number;       // string for composite keys (e.g. `audit:42`), number for primary keys
  source: 'audit' | 'download' | 'ai_call';
  event: string;             // e.g. 'login', 'download_logged', 'ai_call'
  userId: number | null;
  username: string | null;
  ip: string | null;
  createdAt: string;         // ISO
  metadata: Record<string, unknown>;
}
```

`type` accepts any of: `login`, `register`, `password_reset`, `password_reset_requested`, `user_promoted`, `user_demoted`, `user_disabled`, `user_reenabled`, `download_logged`, `ai_call`, `ai_error`, `ai_rate_limited`, plus the catch-all `error` (matches all events with `event LIKE '%error%'`). When `type=download_logged` or `type=ai_call` / `ai_error` / `ai_rate_limited`, the route joins the respective table.

Page size cap 100.

### 6.4 New routes — Downloads

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/admin/downloads` | `userId?`, `sourceType?`, `from?`, `to?`, `page?`, `pageSize?` | `{ items, total, page, pageSize }` |
| GET | `/api/admin/downloads/stats?days=7` | — | `{ total, bySourceType: { worksheet: N, poem: N, ... }, topUsers: { userId, username, count }[] }` |

### 6.5 New routes — AI

| Method | Path | Query / Body | Returns |
|---|---|---|---|
| GET | `/api/admin/ai/calls` | `feature?`, `status?`, `userId?`, `from?`, `to?`, `page?`, `pageSize?` | `{ items, total, page, pageSize }` |
| GET | `/api/admin/ai/stats?days=7` | — | `{ total, byDay: { date, count }[], errorRate, p50Duration, p95Duration, topUsers: ... }` |
| GET | `/api/admin/ai/config` | — | `{ model, rateLimitPerUserPerDay, timeoutMs, temperature }` |
| PUT | `/api/admin/ai/config` | `{ model?, rateLimitPerUserPerDay?, timeoutMs?, temperature? }` | `{ ok: true }` |

Config validation rules:
- `model`: non-empty string ≤ 64 chars
- `rateLimitPerUserPerDay`: integer 0..1000
- `timeoutMs`: integer 1000..300000
- `temperature`: float 0..2

### 6.6 Public logging endpoints (server-side, no new HTTP)

- `lib/downloads.ts:logDownload(...)` — called from print handlers
- `lib/ai-calls.ts:withAiLogging(...)` — wraps `lib/ai-rare-chars.ts:generateStory`

---

## 7. UI / UX

### 7.1 AdminLayout & Sidebar

- `app/admin/layout.tsx` — wraps all `/admin/*` pages. Adds `AdminSidebar` on the left (desktop ≥ md) or top tabs (mobile). Sidebar items: **仪表盘** (/admin), **用户**, **日志**, **下载**, **AI**. Each is a NavLink with active highlight. Background `bg-paper`. Footer is the existing site Footer.
- Active highlight uses site palette (selected = `bg-ink text-paper`, hover = `bg-paper-warm`).

### 7.2 UserMenu update

- New "后台管理" entry below username, only when `user.isAdmin === true`. Lucide `Shield` icon.

### 7.3 Pages

#### `/admin` (improve)
4 new stat cards on top: **总下载数 (7d)**, **AI 调用 (7d)**, **AI 错误率 (7d)**, **禁用账号数**. Each is clickable into the relevant filter view.

#### `/admin/users` (improve)
- Filter chips: **全部 / 管理员 / 禁用**.
- Per-row actions: **查看活动**, **禁用** / **启用** (toggle based on `disabled_at`), **重置密码** (existing), **提升/降级** (existing). Destructive actions get a confirm modal.
- Username cell clickable → `/admin/users/[id]`.

#### `/admin/users/[id]` (improve)
- New "活动" tab alongside existing fields. Shows last 100 events (audit + downloads + ai_calls) for this user. "加载更多" button loads next 100 via `?after=...`.
- Existing promote/demote/reset buttons. New "禁用账号" destructive button with confirmation modal. When user is disabled, show a banner at top: "此账号已被禁用 since {disabledAt}".

#### `/admin/logs` (new)
- Filter bar: event type dropdown, user ID search, IP search, date range (default = last 7 days), free-text search across metadata.
- Table: timestamp, source badge (color-coded: audit=ink, download=scroll, ai_call=seal), event, user (link if exists), short metadata preview. 50 rows/page.
- Row click → side panel with full JSON metadata viewer.

#### `/admin/downloads` (new)
- Top: 4 stat cards (total today, total 7d, top user 7d, top source 7d).
- Filters: source type, user, date range.
- Table: timestamp, user (link), source type badge, format badge, status badge, duration, source_id. 50 rows/page.
- Row click → navigates to source.

#### `/admin/ai` (new)
- Top: 3 stat cards (calls 7d, error rate 7d, p95 duration 7d).
- Two tabs: **调用记录** (default) + **配置**.
- Calls tab: filters by feature, status, user, date. Table: timestamp, user, feature, model, status badge, duration, short error. 50 rows/page.
- Config tab: form with current `ai.model`, `ai.rate_limit_per_user_per_day`, `ai.timeout_ms`, `ai.temperature`. Save button shows a confirm modal listing what's changing. On save → audit log entry `ai_config_updated`.

### 7.4 Reusable components

- `components/admin/AdminSidebar.tsx` — sidebar nav
- `components/admin/StatCard.tsx` — small KPI card
- `components/admin/SourceBadge.tsx` — source color-coded badge
- `components/admin/LogRow.tsx` — unified log table row
- `components/admin/JsonPanel.tsx` — collapsible JSON viewer for side panel
- `components/common/PrintButton.tsx` — calls print endpoint, shows toast

---

## 8. Integration into Existing Flows

### 8.1 Print hooks

Add a `PrintButton` to:
- `app/worksheet/[id]/page.tsx` (and `app/worksheet/page.tsx` preview)
- `app/poetry/[id]/page.tsx`
- `app/sutra/[id]/page.tsx`
- `app/rare-chars/[char]/page.tsx`

Each calls the corresponding POST endpoint:
- `POST /api/worksheets/[id]/print` — body: `{ sourceId: worksheet.id }`
- `POST /api/poetry/[id]/print` — body: `{ sourceId: poem.id }`
- `POST /api/sutra/[slug]/print` — body: `{ sourceId: "{slug}#{chunkId}" }` (chunk picker selects which chunk to print)
- `POST /api/rare-chars/[char]/print` — body: `{ sourceId: char }`

All 4 routes: require auth, call `logDownload(...)`, return `{ ok: true }`. After success, the button calls `window.print()`. Disabled users get 403 with `code: account_disabled`.

### 8.2 AI call logging

`lib/ai-rare-chars.ts:generateStory` becomes:

```ts
export async function generateStory(char: string, meaning: string, userId: number | null) {
  return withAiLogging(
    { userId, feature: 'rare-char-story', metadata: { char, meaning_len: meaning.length } },
    async () => {
      if (!(await checkAiRateLimit(userId ?? 0))) {
        throw new RateLimitError();
      }
      return await callLlm(...);
    },
  );
}
```

`withAiLogging` catches the rate-limit error and inserts a row with `status='rate-limited'`.

### 8.3 Disable-account enforcement

- `lib/auth.ts:getCurrentUser` checks `disabled_at`; if set, returns null (treating as unauthenticated) for API routes, and the existing `requireAdmin`/`requireUser` helpers return 403 `account_disabled`.
- `POST /api/auth/login` returns 403 `account_disabled` when user is disabled.
- Anonymous pages (no auth required) still work; the disabled user just can't act.

---

## 9. Testing

### 9.1 Unit tests

- `lib/downloads.test.ts` — 2 tests
- `lib/ai-calls.test.ts` — 2 tests
- `lib/admin.test.ts` (extend) — 3 tests (disable/enable/isDisabled)
- `lib/config.test.ts` — 3 tests (get/set/validate)
- `lib/auth.test.ts` (extend) — 2 tests (disabled user behavior)

### 9.2 Integration tests

- `tests/integration/api/admin-users-disable.test.ts` — 3 tests
- `tests/integration/api/admin-logs.test.ts` — 5 tests (filter, pagination, mixed source, date range, empty)
- `tests/integration/api/admin-downloads.test.ts` — 3 tests
- `tests/integration/api/admin-ai.test.ts` — 4 tests
- `tests/integration/api/print-logging.test.ts` — 3 tests (4 endpoints + disabled user)

### 9.3 Component tests

- `AdminSidebar.test.tsx` — 2 tests
- `PrintButton.test.tsx` — 1 test
- `LogRow.test.tsx` — 2 tests
- `SourceBadge.test.tsx` — 1 test

### 9.4 E2E manual smoke (human)

12-step checklist:
1. Sign in as non-admin → header dropdown has no "后台管理".
2. Sign in as admin → it does.
3. /admin shows 4 new stat cards with non-zero numbers (after seeding).
4. /admin/users: filter to "禁用"; disable a test user; verify they appear.
5. Log in as disabled user → 403 with `account_disabled`.
6. Re-enable → login works again.
7. /admin/users/[id]: click a user → activity tab populated.
8. /admin/logs: filter `type=download`; see print logs from step 4; click row → side panel opens.
9. Click "打印" on /poetry/[id] → new row in /admin/downloads.
10. /admin/ai/config: change `ai.model` → save → next rare-char regen uses new model.
11. Trigger rare-char regen → row in /admin/ai/calls with new model + duration.
12. `pnpm test` + `pnpm build` all green.

---

## 10. Phasing

6 phases, ~25-30 tasks:

1. **Phase 1 — Data + libs (6 tasks)**: DDL updates (4 tables), seed, `lib/downloads.ts`, `lib/ai-calls.ts`, `lib/config.ts`, `lib/admin.ts` extensions, unit tests.
2. **Phase 2 — API (8 tasks)**: users disable/enable/activity, unified logs, downloads list/stats, AI list/stats/config, print POSTs, rate-limit, integration tests.
3. **Phase 3 — Admin shell (3 tasks)**: AdminSidebar, AdminLayout refinement, UserMenu entry, 2 component tests.
4. **Phase 4 — Pages (6 tasks)**: enrich dashboard, /admin/users, /admin/users/[id], build /admin/logs, /admin/downloads, /admin/ai (calls + config), component tests.
5. **Phase 5 — Wiring (3 tasks)**: PrintButton component, wire 4 print entry points, wrap ai-rare-chars with withAiLogging.
6. **Phase 6 — Smoke + docs (2 tasks)**: README + .env.example updates, final code review, human manual smoke.

---

## 11. Open questions / future work

- Replace the `print` event with actual `pdf` generation using `pdf-lib` or `@react-pdf/renderer`.
- Add alerting (webhook, email) for repeated failed logins or sustained AI error rate.
- Token-cost tracking for AI calls (store prompt/completion tokens in a structured way, not just INT UNSIGNED nullable).
- Moderator role + permission matrix.
- Bulk operations on /admin/users (batch disable, batch email).
