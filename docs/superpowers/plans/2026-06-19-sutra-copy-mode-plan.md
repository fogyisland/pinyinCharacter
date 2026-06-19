# Sutra Copy Mode (抄经) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-place "抄经" (scripture copying) interaction to `/sutra/[id]` where users click each 经文 character to ink it (faint → dark sepia), then the whole scroll collapses and a vermillion seal fades in on completion. Progress persists per-user per-chunk to MySQL.

**Architecture:** Same-page toggle on the existing `/sutra/[id]`. New `SutraCopyView` client component replaces `SutraTextView` while in copy mode; it owns char state + phase machine (copying → collapsing → sealed) and POSTs debounced progress to a new API route. A new `sutra_copy_progress` MySQL table backs the persistence. Login is required to save; anonymous users see a disabled view + banner.

**Tech Stack:** Next.js 15.0.3 (RSC + client components) · React 18 · TypeScript strict · MySQL 5.7 via mysql2/promise · Vitest (unit + integration with real DB) · Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-19-sutra-copy-mode-design.md`

## Global Constraints

- All new server-only modules MUST start with `import 'server-only';`.
- API route handlers MUST use `withErrorHandling` + `requireUser` + `badRequest`/`notFound`/`forbidden` (see `lib/api-handler.ts`).
- Integration tests run against real MySQL via `DATABASE_URL_TEST`; if unset, the test is skipped (follow `tests/integration/api/print-logging.test.ts` pattern).
- Migration MUST be idempotent (`CREATE TABLE IF NOT EXISTS` / `INSERT IGNORE`) and applied via a one-shot `scripts/migrate-<name>.ts` script (per `scripts/migrate-membership.ts` convention). The SQL lives in `scripts/migrations/<date>-<name>.sql`; the script imports it (or inlines the DDL).
- Char state is a `boolean[]` aligned to the FLAT `chunk.content.join('')` length; per-line reconstruction is purely for layout.
- `reading-mode` collapse direction: `scaleX(0)` for `horizontal`, `scaleY(0)` for `vertical-rtl` and `vertical-ltr`. `transform-origin: center`.
- Collisions: clicking a char that is already written is a no-op (idempotent).
- Server-side `chunkIdx` validation: must satisfy `0 <= chunkIdx < chunks.length` for the given sutra id.
- All times stored as MySQL `DATETIME` (UTC); JS side converts to/from `Date`.
- Chinese UI copy:
  - banner: `"请登录后开始抄经，进度将自动保存"`
  - progress: `"已抄 N / Total 字"`
  - reset confirm: `"将清除本段抄经进度，确定？"`
  - buttons: `"重新抄写"` / `"退出抄经"`
  - toggle button: `"进入抄经"` / `"退出抄经"`
  - seal text: `"功德圆满"`

---

## File Structure

**New files (6 source + 3 test):**
- `scripts/migrations/2026-06-19-sutra-copy-progress.sql` — DDL
- `scripts/migrate-sutra-copy-progress.ts` — one-shot migration runner
- `lib/sutra-copy-progress.ts` — server-only DB I/O
- `app/api/sutra/[id]/copy-progress/route.ts` — GET + POST handlers
- `components/sutra/SutraCopyView.tsx` — interactive copy view (client)
- `components/sutra/CopySeal.tsx` — seal SVG (client, no state)
- `tests/unit/lib/sutra-copy-progress.test.ts`
- `tests/unit/components/sutra/sutra-copy-view.test.tsx`
- `tests/integration/api/sutra-copy-progress.test.ts`

**Modified files (2):**
- `components/sutra/SutraReadingClient.tsx` — add copyMode state + toggle + swap view; pass `key={chunk.id}` to force remount on chunk switch
- `app/sutra/[id]/page.tsx` — pass `userId` and `sutraId` to `SutraReadingClient`; suppress Print + SaveAsWorksheet + ReadAloud buttons when `copyMode === true` (lift state or use a context, see Task 6)

---

### Task 1: Migration — `sutra_copy_progress` table

**Files:**
- Create: `scripts/migrations/2026-06-19-sutra-copy-progress.sql`
- Create: `scripts/migrate-sutra-copy-progress.ts`

**Interfaces:**
- Produces: MySQL table `sutra_copy_progress` (PK `(user_id, sutra_id, chunk_idx)`, JSON `written_chars`, timestamps).

- [ ] **Step 1: Write the SQL**

`scripts/migrations/2026-06-19-sutra-copy-progress.sql`:

```sql
-- 2026-06-19: 抄经 (scripture-copying) progress per user × sutra × chunk
-- Idempotent. Single-table DDL.
CREATE TABLE IF NOT EXISTS sutra_copy_progress (
  user_id INT UNSIGNED NOT NULL,
  sutra_id INT UNSIGNED NOT NULL,
  chunk_idx INT UNSIGNED NOT NULL,
  written_chars JSON NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (user_id, sutra_id, chunk_idx),
  INDEX idx_user_completed (user_id, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Write the runner script**

`scripts/migrate-sutra-copy-progress.ts`:

```ts
/**
 * One-time migration: create sutra_copy_progress table.
 * Idempotent: safe to re-run.
 *
 * Run: pnpm tsx --env-file=.env scripts/migrate-sutra-copy-progress.ts
 * After verifying on dev+prod, delete this script (per migrate-membership.ts pattern).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

async function main() {
  const sql = readFileSync(
    join(__dirname, 'migrations', '2026-06-19-sutra-copy-progress.sql'),
    'utf8'
  );
  // Split on `;` boundary for clean execution (single DDL block, but be safe).
  const pool = getPool();
  for (const stmt of sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  // Confirm by selecting the table.
  const [rows] = await pool.query<any[]>(`SHOW TABLES LIKE 'sutra_copy_progress'`);
  if (rows.length === 0) throw new Error('table not created');
  console.error('[migrate-sutra-copy-progress] table created');
  await closePool();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run against local MySQL**

```bash
pnpm tsx --env-file=.env scripts/migrate-sutra-copy-progress.ts
```

Expected output: `[migrate-sutra-copy-progress] table created`

- [ ] **Step 4: Verify in MySQL**

```bash
E:\mysql\bin\mysql.exe -uroot -pAdmin909217 piyin -e "SHOW CREATE TABLE sutra_copy_progress\G"
```

Expected: 11-line CREATE TABLE output, ending with `PRIMARY KEY (user_id, sutra_id, chunk_idx)`.

- [ ] **Step 5: Run the same script again (idempotency)**

```bash
pnpm tsx --env-file=.env scripts/migrate-sutra-copy-progress.ts
```

Expected: same `[migrate-sutra-copy-progress] table created` line, NO error.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/2026-06-19-sutra-copy-progress.sql scripts/migrate-sutra-copy-progress.ts
git commit -m "feat(sutra): add sutra_copy_progress table"
```

---

### Task 2: `lib/sutra-copy-progress.ts` (TDD)

**Files:**
- Create: `lib/sutra-copy-progress.ts`
- Test: `tests/unit/lib/sutra-copy-progress.test.ts`

**Interfaces:**
- Produces:
  - `interface CopyProgress { writtenChars: boolean[]; startedAt: Date; updatedAt: Date; completedAt: Date | null; }`
  - `getProgress(userId, sutraId, chunkIdx): Promise<CopyProgress | null>`
  - `upsertProgress(userId, sutraId, chunkIdx, writtenChars, opts?: { completedAt?: Date | null }): Promise<void>`
  - `markComplete(userId, sutraId, chunkIdx): Promise<void>` — sets `completed_at = NOW()` only when the existing row has all `writtenChars[i] === true`; no-op otherwise.
  - `deleteProgress(userId, sutraId, chunkIdx): Promise<void>` — used by reset.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/sutra-copy-progress.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => queryMock(...a), execute: (...a: unknown[]) => executeMock(...a) }),
}));

import {
  getProgress,
  upsertProgress,
  markComplete,
  deleteProgress,
} from '@/lib/sutra-copy-progress';

beforeEach(() => {
  queryMock.mockReset();
  executeMock.mockReset();
});

describe('getProgress', () => {
  it('returns null when no row', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const r = await getProgress(1, 2, 0);
    expect(r).toBeNull();
  });

  it('parses written_chars JSON into boolean[]', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, false, true]),
      started_at: new Date('2026-06-19T08:00:00Z'),
      updated_at: new Date('2026-06-19T08:30:00Z'),
      completed_at: null,
    }]]);
    const r = await getProgress(1, 2, 0);
    expect(r).toEqual({
      writtenChars: [true, false, true],
      startedAt: new Date('2026-06-19T08:00:00Z'),
      updatedAt: new Date('2026-06-19T08:30:00Z'),
      completedAt: null,
    });
  });
});

describe('upsertProgress', () => {
  it('INSERT ... ON DUPLICATE KEY UPDATE written_chars + completed_at', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await upsertProgress(1, 2, 0, [true, true], { completedAt: null });
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO sutra_copy_progress/);
    expect(String(sql)).toMatch(/ON DUPLICATE KEY UPDATE/);
    // params: userId, sutraId, chunkIdx, JSON(writtenChars), completedAt
    expect(params).toEqual([1, 2, 0, JSON.stringify([true, true]), null]);
  });

  it('treats undefined completedAt as null (no completion side-effect)', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await upsertProgress(1, 2, 0, [true], {});
    const [, params] = executeMock.mock.calls[0]!;
    expect((params as unknown[])[4]).toBeNull();
  });
});

describe('markComplete', () => {
  it('updates completed_at when stored row is all-true', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, true, true]),
    }]]);
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markComplete(1, 2, 0);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/UPDATE sutra_copy_progress\s+SET completed_at = NOW\(\)/);
    expect(params).toEqual([1, 2, 0]);
  });

  it('no-ops when row is missing', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    await markComplete(1, 2, 0);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('no-ops when any char is un-written', async () => {
    queryMock.mockResolvedValueOnce([[{
      written_chars: JSON.stringify([true, false, true]),
    }]]);
    await markComplete(1, 2, 0);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('deleteProgress', () => {
  it('DELETEs the row', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await deleteProgress(1, 2, 0);
    const [sql, params] = executeMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/DELETE FROM sutra_copy_progress/);
    expect(params).toEqual([1, 2, 0]);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm test -- tests/unit/lib/sutra-copy-progress.test.ts
```

Expected: all tests fail with "Cannot find module '@/lib/sutra-copy-progress'" or similar.

- [ ] **Step 3: Implement `lib/sutra-copy-progress.ts`**

```ts
import 'server-only';
import { getPool } from './db';

export interface CopyProgress {
  writtenChars: boolean[];
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface DbRow {
  written_chars: string | boolean[];
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function parseWrittenChars(raw: string | boolean[]): boolean[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number
): Promise<CopyProgress | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT written_chars, started_at, updated_at, completed_at
       FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?
       LIMIT 1`,
    [userId, sutraId, chunkIdx]
  );
  if (rows.length === 0) return null;
  const r = rows[0] as DbRow;
  return {
    writtenChars: parseWrittenChars(r.written_chars),
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

export async function upsertProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number,
  writtenChars: boolean[],
  opts: { completedAt?: Date | null } = {}
): Promise<void> {
  const completedAt = opts.completedAt === undefined ? null : opts.completedAt;
  await getPool().execute(
    `INSERT INTO sutra_copy_progress
       (user_id, sutra_id, chunk_idx, written_chars, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       written_chars = VALUES(written_chars),
       completed_at  = VALUES(completed_at)`,
    [userId, sutraId, chunkIdx, JSON.stringify(writtenChars), completedAt]
  );
}

export async function markComplete(
  userId: number,
  sutraId: number,
  chunkIdx: number
): Promise<void> {
  const [rows] = await getPool().query<any[]>(
    `SELECT written_chars FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ? LIMIT 1`,
    [userId, sutraId, chunkIdx]
  );
  if (rows.length === 0) return;
  const written = parseWrittenChars(rows[0].written_chars);
  if (written.length === 0 || !written.every(Boolean)) return;
  await getPool().execute(
    `UPDATE sutra_copy_progress
       SET completed_at = NOW()
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?`,
    [userId, sutraId, chunkIdx]
  );
}

export async function deleteProgress(
  userId: number,
  sutraId: number,
  chunkIdx: number
): Promise<void> {
  await getPool().execute(
    `DELETE FROM sutra_copy_progress
       WHERE user_id = ? AND sutra_id = ? AND chunk_idx = ?`,
    [userId, sutraId, chunkIdx]
  );
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm test -- tests/unit/lib/sutra-copy-progress.test.ts
```

Expected: 9/9 tests pass.

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/sutra-copy-progress.ts tests/unit/lib/sutra-copy-progress.test.ts
git commit -m "feat(sutra): add copy-progress lib with TDD"
```

---

### Task 3: API route `GET` / `POST /api/sutra/[id]/copy-progress`

**Files:**
- Create: `app/api/sutra/[id]/copy-progress/route.ts`
- Test: `tests/integration/api/sutra-copy-progress.test.ts`

**Interfaces:**
- `GET ?chunk=N` → `{ ok: true, data: { progress: CopyProgress | null } }`
- `POST { chunkIdx, writtenChars, completed?: bool, reset?: bool }` → `{ ok: true, data: { saved: true } }`
- Both require `requireUser()` (401 anonymous).
- Validates `chunkIdx` against `getSutra(id).chunks.length` (400 if out of range).
- `writtenChars` must be a non-empty array of booleans (400 if not).
- `reset=true` → call `deleteProgress`; response 200.

- [ ] **Step 1: Write the integration test**

`tests/integration/api/sutra-copy-progress.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

import { getPool, closePool } from '@/lib/db';
import { GET, POST } from '@/app/api/sutra/[id]/copy-progress/route';
import { signSession } from '@/lib/auth';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

let userId: number;
let userToken: string;
let sutraId: number;

function req(method: string, path: string, body: object | null, cookie: string | null = userToken): NextRequest {
  const headers: Record<string, string> = { cookie: `auth_token=${cookie}` };
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://test${path}`, init);
}

function anonReq(method: string, path: string, body: object | null = null): NextRequest {
  const headers: Record<string, string> = {};
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://test${path}`, init);
}

d('sutra copy-progress API', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');

    await pool.query(`DELETE FROM users WHERE username = 'usr_copy'`);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('usr_copy', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(u[0].id);
    userToken = await signSession({ id: userId, username: 'usr_copy' });

    await pool.query(`DELETE FROM sutras WHERE slug = 'copytest'`);
    const [s] = await pool.query<any>(
      `INSERT INTO sutras (title, slug, chunks) VALUES (?, ?, ?)`,
      ['抄经测试', 'copytest', JSON.stringify([
        { id: 0, label: '全段', content: ['观自在菩萨', '行深般若波罗蜜多时'], pinyin: [] },
      ])]
    );
    sutraId = Number(s.insertId);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM sutras WHERE slug = 'copytest'`);
    await pool.query(`DELETE FROM users WHERE username = 'usr_copy'`);
    await closePool();
  });

  it('GET 401 anonymous', async () => {
    const r = await GET(anonReq('GET', `/api/sutra/${sutraId}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(401);
  });

  it('POST 401 anonymous', async () => {
    const r = await POST(anonReq('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 0, writtenChars: [true] }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(401);
  });

  it('GET 200 with progress=null for fresh user', async () => {
    const r = await GET(req('GET', `/api/sutra/${sutraId}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.progress).toBeNull();
  });

  it('POST 200 upserts; subsequent GET returns same array', async () => {
    const r1 = await POST(req('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 0, writtenChars: [true, false, true, true] }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r1.status).toBe(200);
    const r2 = await GET(req('GET', `/api/sutra/${sutraId}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    const body = await r2.json();
    expect(body.data.progress.writtenChars).toEqual([true, false, true, true]);
    expect(body.data.progress.completedAt).toBeNull();
  });

  it('POST 400 on out-of-range chunkIdx', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 99, writtenChars: [true] }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(400);
  });

  it('POST 400 on non-array writtenChars', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 0, writtenChars: 'nope' }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(400);
  });

  it('POST with completed=true sets completed_at when all true', async () => {
    await POST(req('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 0, writtenChars: [true, true, true, true], completed: true }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    const r = await GET(req('GET', `/api/sutra/${sutraId}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    const body = await r.json();
    expect(body.data.progress.completedAt).not.toBeNull();
  });

  it('POST reset=true deletes the row', async () => {
    const r = await POST(req('POST', `/api/sutra/${sutraId}/copy-progress`, { chunkIdx: 0, reset: true }) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    expect(r.status).toBe(200);
    const r2 = await GET(req('GET', `/api/sutra/${sutraId}/copy-progress?chunk=0`) as any, { params: Promise.resolve({ id: String(sutraId) }) });
    const body = await r2.json();
    expect(body.data.progress).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify all skip (no module yet)**

```bash
pnpm test -- tests/integration/api/sutra-copy-progress.test.ts
```

Expected: tests reported as `skipped` (no `DATABASE_URL_TEST` env) OR all fail with "Cannot find module" — both are acceptable signals.

- [ ] **Step 3: Implement the route**

`app/api/sutra/[id]/copy-progress/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getSutra } from '@/lib/sutras';
import {
  getProgress,
  upsertProgress,
  markComplete,
  deleteProgress,
} from '@/lib/sutra-copy-progress';

interface RouteContext { params: Promise<{ id: string }>; }

function parseChunkIdx(url: string): number | null {
  const u = new URL(url);
  const raw = u.searchParams.get('chunk');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await ctx.params;
    const sutraId = Number(idStr);
    if (!Number.isInteger(sutraId) || sutraId <= 0) return badRequest('bad_id', 'invalid sutra id');

    const chunkIdx = parseChunkIdx(req.url);
    if (chunkIdx === null) return badRequest('bad_chunk', 'chunk query param required');

    const sutra = await getSutra(sutraId);
    if (!sutra) return notFound('sutra_not_found', 'sutra not found');
    if (chunkIdx >= sutra.chunks.length) return badRequest('bad_chunk', 'chunk out of range');

    const progress = await getProgress(auth.user.id, sutraId, chunkIdx);
    return NextResponse.json({ ok: true, data: { progress } });
  });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await ctx.params;
    const sutraId = Number(idStr);
    if (!Number.isInteger(sutraId) || sutraId <= 0) return badRequest('bad_id', 'invalid sutra id');

    const body = await req.json().catch(() => ({} as any));
    const chunkIdx = Number(body?.chunkIdx);
    if (!Number.isInteger(chunkIdx) || chunkIdx < 0) return badRequest('bad_chunk', 'chunkIdx invalid');

    const sutra = await getSutra(sutraId);
    if (!sutra) return notFound('sutra_not_found', 'sutra not found');
    if (chunkIdx >= sutra.chunks.length) return badRequest('bad_chunk', 'chunk out of range');

    if (body?.reset === true) {
      await deleteProgress(auth.user.id, sutraId, chunkIdx);
      return NextResponse.json({ ok: true, data: { saved: true, reset: true } });
    }

    if (!Array.isArray(body?.writtenChars) || body.writtenChars.length === 0) {
      return badRequest('bad_written', 'writtenChars must be a non-empty array');
    }
    if (!body.writtenChars.every((v: unknown) => typeof v === 'boolean')) {
      return badRequest('bad_written', 'writtenChars must be all booleans');
    }

    await upsertProgress(auth.user.id, sutraId, chunkIdx, body.writtenChars);
    if (body?.completed === true) {
      await markComplete(auth.user.id, sutraId, chunkIdx);
    }
    return NextResponse.json({ ok: true, data: { saved: true } });
  });
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Run integration test**

```bash
DATABASE_URL_TEST=$DATABASE_URL pnpm test -- tests/integration/api/sutra-copy-progress.test.ts
```

(Use whatever the project's `.env.test` / Makefile / package.json sets; the integration test reads `DATABASE_URL_TEST`. If unset, tests skip — that's the existing convention. To force run, set `DATABASE_URL_TEST=$DATABASE_URL` or your local piyin URL.)

Expected: 8/8 pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/sutra/[id]/copy-progress/route.ts tests/integration/api/sutra-copy-progress.test.ts
git commit -m "feat(sutra): add copy-progress GET/POST API + integration test"
```

---

### Task 4: `<CopySeal />` component (pure SVG)

**Files:**
- Create: `components/sutra/CopySeal.tsx`

**Interfaces:**
- Props: `{ className?: string }` — purely presentational, no state.
- Renders an inline SVG: 80×80 viewBox, `<circle r=36 cx=40 cy=40 stroke=#B22B2B strokeWidth=1.5 fill=none/>` + `<text x=40 y=44 textAnchor=middle fontSize=10 fill=#B22B2B fontFamily="Noto Serif SC, serif">功德圆满</text>`.

- [ ] **Step 1: Write the component**

`components/sutra/CopySeal.tsx`:

```tsx
interface Props {
  className?: string;
}

export function CopySeal({ className = '' }: Props) {
  return (
    <div
      className={`copy-seal flex flex-col items-center gap-6 ${className}`}
      role="img"
      aria-label="功德圆满"
    >
      <svg
        width={120}
        height={120}
        viewBox="0 0 80 80"
        xmlns="http://www.w3.org/2000/svg"
        className="copy-seal__svg"
      >
        <circle cx={40} cy={40} r={36} stroke="#B22B2B" strokeWidth={1.5} fill="none" />
        <text
          x={40}
          y={38}
          textAnchor="middle"
          fontSize={10}
          fill="#B22B2B"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          功德
        </text>
        <text
          x={40}
          y={52}
          textAnchor="middle"
          fontSize={10}
          fill="#B22B2B"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          圆满
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/sutra/CopySeal.tsx
git commit -m "feat(sutra): add CopySeal vermillion SVG component"
```

---

### Task 5: `<SutraCopyView />` — interactive copy view (TDD component test)

**Files:**
- Create: `components/sutra/SutraCopyView.tsx`
- Test: `tests/unit/components/sutra/sutra-copy-view.test.tsx`

**Interfaces:**
- Props:
  ```ts
  interface SutraCopyViewProps {
    chunk: SutraChunk;
    sutraId: number;
    userId: number | null;
    reading: SutraReading;
    onExit: () => void;
  }
  ```
- State: `writtenChars: boolean[]` (hydrated from API on mount), `phase: 'copying' | 'collapsing' | 'sealed'`, `error: string | null`.
- Effects:
  - On mount + on `chunk.id` change: `GET /api/sutra/${sutraId}/copy-progress?chunk=${chunkIdx}`. If 200, hydrate; if 401 (anonymous), set `writtenChars = new Array(totalChars).fill(false)` + render disabled.
  - After last char clicked: set `phase='collapsing'`, after 1200ms set `phase='sealed'` + POST `{ completed: true }`.
- Debounce: 500ms timer for POST on `writtenChars` change.
- Layout:
  - Top progress bar: `<div className="copy-progress"><span style={{ width: `${pct}%` }} /></div>` + `<p>已抄 N / Total 字</p>`
  - Banner if `userId === null`: `<div>请登录后开始抄经，进度将自动保存。 <a href={loginUrl}>登录</a></div>`
  - Char body: each line as `<p className="copy-line">` with chars as `<span className={charClass(idx)} data-idx={idx}>`.
  - Sealed phase: render `<CopySeal />` + 2 buttons.

- [ ] **Step 1: Write the failing component test**

`tests/unit/components/sutra/sutra-copy-view.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { SutraCopyView } from '@/components/sutra/SutraCopyView';
import type { SutraChunk } from '@/lib/sutra-types';

const CHUNK: SutraChunk = {
  id: 0,
  label: '心经',
  content: ['观自在菩萨', '行深般若波罗蜜多时'],
  pinyin: [['guān'], ['xíng']],
};

function getWrittenChars(row: HTMLElement): boolean[] {
  const spans = Array.from(row.querySelectorAll<HTMLElement>('span[data-idx]'));
  return spans.map(s => s.classList.contains('copy-char--written'));
}

beforeEach(() => {
  fetchMock.mockReset();
  // Default GET: fresh user, no progress
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: { progress: null } }),
  });
});

describe('SutraCopyView', () => {
  it('renders all chars unwritten by default (logged-in user)', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    // Wait for the GET to resolve
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const written = getWrittenChars(screen.getByTestId('copy-body'));
    expect(written).toEqual([false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it('hydrates from GET response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { progress: { writtenChars: [true, true, false, false, false, false, false, false, false, false, false, false, false, false, false], startedAt: new Date(), updatedAt: new Date(), completedAt: null } } }),
    });
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const written = getWrittenChars(screen.getByTestId('copy-body'));
    expect(written).toEqual([true, true, false, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it('clicking a char marks it written and triggers POST (after 500ms debounce)', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // Click the first char
    const spans = screen.getByTestId('copy-body').querySelectorAll<HTMLElement>('span[data-idx]');
    await act(async () => { fireEvent.click(spans[0]!); });
    expect(spans[0]!.classList.contains('copy-char--written')).toBe(true);

    // Wait debounce 500ms
    await act(async () => { await new Promise(r => setTimeout(r, 550)); });

    // The POST call should be the 2nd fetch (1st was the GET)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('/api/sutra/1/copy-progress');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chunkIdx: 0, writtenChars: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false] });
  });

  it('anonymous user sees disabled view + banner', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={null} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(screen.getByText(/请登录后开始抄经/)).toBeInTheDocument();
    const spans = screen.getByTestId('copy-body').querySelectorAll<HTMLElement>('span[data-idx]');
    expect(spans[0]!.classList.contains('copy-char--disabled')).toBe(true);
    // Click is a no-op
    await act(async () => { fireEvent.click(spans[0]!); });
    expect(spans[0]!.classList.contains('copy-char--written')).toBe(false);
  });

  it('last char click triggers collapse + seal phase', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { progress: { writtenChars: new Array(15).fill(true), startedAt: new Date(), updatedAt: new Date(), completedAt: null } } }),
    });
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    // flush initial GET microtask
    await act(async () => { await vi.runAllTimersAsync(); });
    // Find the body — should already be in collapsing phase
    const body = screen.getByTestId('copy-view');
    expect(body.classList.contains('copy-view--collapsing')).toBe(true);
    // Advance 1200ms to sealed phase
    await act(async () => { vi.advanceTimersByTime(1200); });
    // Seal text appears
    expect(screen.getByText('功德圆满')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, verify failures**

```bash
pnpm test -- tests/unit/components/sutra/sutra-copy-view.test.tsx
```

Expected: all fail (no module / no `copy-body` test id / etc).

- [ ] **Step 3: Implement `SutraCopyView`**

`components/sutra/SutraCopyView.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SutraChunk } from '@/lib/sutra-types';
import type { SutraReading } from '@/lib/sutra-reading';
import type { CopyProgress } from '@/lib/sutra-copy-progress';
import { CopySeal } from './CopySeal';

interface Props {
  chunk: SutraChunk;
  sutraId: number;
  userId: number | null;
  reading: SutraReading;
  onExit: () => void;
}

type Phase = 'copying' | 'collapsing' | 'sealed';

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

const DEBOUNCE_MS = 500;
const COLLAPSE_MS = 1200;

function flatChars(chunk: SutraChunk): string[] {
  return chunk.content.join('').split('');
}

function charClass(idx: number, written: boolean, disabled: boolean): string {
  const base = 'copy-char inline-block px-1.5 py-1 transition-colors duration-400';
  if (disabled) return `${base} copy-char--disabled`;
  return written
    ? `${base} copy-char--written text-[#2c251e]`
    : `${base} text-[rgba(0,0,0,0.15)] hover:bg-[rgba(222,203,183,0.15)] cursor-pointer`;
}

export function SutraCopyView({ chunk, sutraId, userId, reading, onExit }: Props) {
  const chars = flatChars(chunk);
  const total = chars.length;
  const [writtenChars, setWrittenChars] = useState<boolean[]>(() => new Array(total).fill(false));
  const [phase, setPhase] = useState<Phase>('copying');
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from API on mount + on chunk.id change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/sutra/${sutraId}/copy-progress?chunk=${chunk.id}`);
      if (cancelled) return;
      if (res.status === 401 || !res.ok) {
        // Anonymous or failure: stay all-false
        setWrittenChars(new Array(total).fill(false));
        return;
      }
      const body = await res.json();
      const p: CopyProgress | null = body?.data?.progress ?? null;
      const arr = p?.writtenChars?.length === total ? p.writtenChars : new Array(total).fill(false);
      setWrittenChars(arr);
      if (p?.completedAt) setPhase('sealed');
    }
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk.id, sutraId]);

  // Trigger collapse when all written.
  const writtenCount = writtenChars.filter(Boolean).length;
  useEffect(() => {
    if (phase === 'copying' && total > 0 && writtenCount === total) {
      setPhase('collapsing');
    }
  }, [writtenCount, total, phase]);

  // Schedule collapse → sealed.
  useEffect(() => {
    if (phase !== 'collapsing') return;
    collapseTimerRef.current = setTimeout(() => {
      setPhase('sealed');
      void fetch(`/api/sutra/${sutraId}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, writtenChars, completed: true }),
      });
    }, COLLAPSE_MS);
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Debounced POST on writtenChars change.
  useEffect(() => {
    if (!userId) return;
    if (phase !== 'copying') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/sutra/${sutraId}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, writtenChars }),
      }).then(r => {
        if (!r.ok) setError('进度保存失败');
      });
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [writtenChars, sutraId, chunk.id, userId, phase]);

  const handleCharClick = useCallback((idx: number) => {
    if (!userId) return;
    setPhase('copying'); // reset from sealed if user re-clicks after a reset
    setWrittenChars(prev => {
      if (prev[idx]) return prev;
      const next = prev.slice();
      next[idx] = true;
      return next;
    });
  }, [userId]);

  const handleReset = useCallback(() => {
    if (!window.confirm('将清除本段抄经进度，确定？')) return;
    setWrittenChars(new Array(total).fill(false));
    setPhase('copying');
    if (userId) {
      void fetch(`/api/sutra/${sutraId}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, reset: true }),
      });
    }
  }, [sutraId, chunk.id, userId, total]);

  const disabled = userId === null;
  const pct = total > 0 ? Math.round((writtenCount / total) * 100) : 0;

  if (phase === 'sealed') {
    return (
      <div
        data-testid="copy-view"
        className="copy-view copy-view--sealed fixed inset-0 z-10 flex flex-col items-center justify-center bg-paper-warm/95"
      >
        <CopySeal className="copy-seal--enter" />
        <div className="mt-8 flex gap-3">
          <button type="button" onClick={handleReset} className="rounded-md border border-ink/20 px-4 py-2 hover:bg-ink/5">
            重新抄写
          </button>
          <button type="button" onClick={onExit} className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80">
            退出抄经
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="copy-view"
      className={
        'copy-view' +
        (phase === 'collapsing' ? ' copy-view--collapse copy-view--collapsing' : '')
      }
    >
      <div className="copy-progress mb-3">
        <div className="h-1 w-full rounded bg-ink/10">
          <div
            className="h-1 rounded bg-seal transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-ink-faint">已抄 {writtenCount} / {total} 字</p>
      </div>

      {disabled && (
        <div
          role="alert"
          className="mb-3 rounded border-l-4 border-seal bg-paper-warm p-3 text-sm text-ink-soft"
        >
          请登录后开始抄经，进度将自动保存。
          <a className="ml-2 text-seal underline" href={`/login?next=${encodeURIComponent(`/sutra/${sutraId}?chunk=${chunk.id}`)}`}>
            登录
          </a>
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div
        data-testid="copy-body"
        className="copy-body font-serif text-lg sm:text-xl leading-loose text-ink"
        style={{ writingMode: WRITING_MODE[reading] as any }}
      >
        {chunk.content.map((line, li) => (
          <p key={li} className={reading === 'horizontal' ? 'my-1.5' : 'mx-3 inline-block align-top'}>
            {[...line].map((ch, ci) => {
              const safeIdx = lineStartsAt(chunk, li) + ci;
              return (
                <span
                  key={ci}
                  data-idx={safeIdx}
                  data-testid={`copy-char-${safeIdx}`}
                  className={charClass(safeIdx, writtenChars[safeIdx] === true, disabled)}
                  onClick={() => handleCharClick(safeIdx)}
                >
                  {ch}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}

function lineStartsAt(chunk: SutraChunk, lineIndex: number): number {
  let acc = 0;
  for (let k = 0; k < lineIndex; k++) acc += chunk.content[k]!.length;
  return acc;
}
```

- [ ] **Step 4: Add CSS for collapse + seal entrance**

First, update the root element in `SutraCopyView` (from step 3) to also carry `data-reading={reading}` so CSS can branch the collapse direction:

```tsx
<div
  data-testid="copy-view"
  data-reading={reading}
  className={
    'copy-view' +
    (phase === 'collapsing' ? ' copy-view--collapse copy-view--collapsing' : '')
  }
>
```

Then append to `app/globals.css` (below the existing `/* ============ Print (worksheet) ============ */` block):

```css
/* ============ Sutra Copy Mode ============ */
.copy-view { transform-origin: center; transition: transform 1.2s cubic-bezier(0.25, 1, 0.5, 1), opacity 1.2s cubic-bezier(0.25, 1, 0.5, 1); }
.copy-view--collapse { opacity: 0; }
.copy-view--collapse[data-reading="horizontal"] { transform: scaleX(0); }
.copy-view--collapse[data-reading="vertical-rtl"] { transform: scaleY(0); }
.copy-view--collapse[data-reading="vertical-ltr"] { transform: scaleY(0); }
.copy-view--collapsing { pointer-events: none; }
.copy-seal { transition: transform 0.6s ease-out, opacity 0.6s ease-out; transform-origin: center; opacity: 0; transform: scale(0.5); }
.copy-seal--enter { opacity: 1; transform: scale(1); }
.copy-char { transition: color 0.4s ease-in-out; }
.copy-char--disabled { pointer-events: none; }
```

- [ ] **Step 5: Run component tests, verify they pass**

```bash
pnpm test -- tests/unit/components/sutra/sutra-copy-view.test.tsx
```

Expected: 5/5 pass.

- [ ] **Step 6: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add components/sutra/SutraCopyView.tsx tests/unit/components/sutra/sutra-copy-view.test.tsx app/globals.css
git commit -m "feat(sutra): add SutraCopyView with click-to-ink + collapse + seal"
```

---

### Task 6: Wire `<SutraCopyView />` into `SutraReadingClient` + page (smoke + lint)

**Files:**
- Modify: `components/sutra/SutraReadingClient.tsx`
- Modify: `app/sutra/[id]/page.tsx`

**Interfaces:**
- `SutraReadingClient` new prop: `sutraId: number` and `userId: number | null`.
- Adds `copyMode: boolean` state, toggle button next to ReadingModePicker, and renders `<SutraCopyView key={chunk.id} ... />` instead of `<SutraTextView />` when on.
- `app/sutra/[id]/page.tsx` passes `sutraId={sutra.id}` and `userId={user?.id ?? null}`. The Print / SaveAsWorksheet / ReadAloud buttons are hidden when `copyMode` is on — easiest path: lift `copyMode` to a small client wrapper that wraps the page right column. (Or: extract the right column into a client component. Choose the wrapper approach — smaller diff.)

- [ ] **Step 1: Create the right-column wrapper**

Create `app/sutra/[id]/SutraRightColumn.tsx` (`'use client'`). It owns `copyMode` state, hides Print / SaveAsWorksheet / ReadAloud in copy mode, and reads the same `useSutraReading` value that `SutraReadingClient` uses so copy mode honors the existing preference:

```tsx
'use client';

import { useState } from 'react';
import type { SutraChunk } from '@/lib/sutra-types';
import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { PrintButton } from '@/components/common/PrintButton';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import { SutraReadingClient } from './SutraReadingClient';
import { SutraCopyView } from '@/components/sutra/SutraCopyView';

interface Props {
  sutraId: number;
  sutraSlug: string;
  sutraTitle: string;
  chunk: SutraChunk;
  userId: number | null;
  isLoggedIn: boolean;
}

export function SutraRightColumn({ sutraId, sutraSlug, sutraTitle, chunk, userId }: Props) {
  const [copyMode, setCopyMode] = useState(false);
  const [reading] = useSutraReading();
  return (
    <>
      <div className="flex items-center justify-between mb-2 worksheet-no-print">
        <button
          type="button"
          onClick={() => setCopyMode(v => !v)}
          className={
            'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
            (copyMode
              ? 'border-seal bg-seal text-white'
              : 'border-ink/20 text-ink-soft hover:bg-ink/5')
          }
          aria-pressed={copyMode}
        >
          {copyMode ? '退出抄经' : '进入抄经'}
        </button>
        {!copyMode && <ReadAloudButton text={chunk.content.join('\n')} size="sm" variant="seal" />}
      </div>
      <div className="card-paper p-5 sm:p-8">
        {copyMode ? (
          <SutraCopyView
            key={chunk.id}
            chunk={chunk}
            sutraId={sutraId}
            userId={userId}
            reading={reading}
            onExit={() => setCopyMode(false)}
          />
        ) : (
          <SutraReadingClient chunk={chunk} />
        )}
      </div>
      {!copyMode && (
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <PrintButton endpoint={`/api/sutra/${sutraSlug}/print`} sourceId={`${sutraSlug}#${chunk.id}`} />
          <SaveAsWorksheetButton id={sutraId} title={sutraTitle} chunk={chunk} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Update `app/sutra/[id]/page.tsx`**

Replace the body of `SutraDetailPage` (lines 22-67) to use `SutraRightColumn` and pass `sutraId` / `userId`:

```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSutra } from '@/lib/sutras';
import { getCurrentUser } from '@/lib/auth';
import type { SutraChunk } from '@/lib/sutra-types';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { SutraMeta } from '@/components/sutra/SutraMeta';
import { SutraChunkPickerClient } from './SutraChunkPickerClient';
import { SutraRightColumn } from './SutraRightColumn';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chunk?: string }>;
}

export default async function SutraDetailPage({ params, searchParams }: Props) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sutra = await getSutra(id);
  if (!sutra) notFound();
  const user = await getCurrentUser();

  const requestedChunk = Number(sp.chunk ?? '0');
  const activeChunkId =
    Number.isInteger(requestedChunk) && requestedChunk >= 0 && requestedChunk < sutra.chunks.length
      ? requestedChunk
      : 0;
  const activeChunk = sutra.chunks[activeChunkId]!;

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <SutraMeta title={sutra.title} chunkLabel={sutra.chunks.length > 1 ? activeChunk.label : null} />
        </div>
        <div className="flex gap-6">
          <Suspense fallback={null}>
            <SutraChunkPickerClient sutraId={sutra.id} chunks={sutra.chunks as SutraChunk[]} activeId={activeChunkId} />
          </Suspense>
          <div className="flex-1">
            <SutraRightColumn
              sutraId={sutra.id}
              sutraSlug={sutra.slug}
              sutraTitle={sutra.title}
              chunk={activeChunk}
              userId={user?.id ?? null}
              isLoggedIn={!!user}
            />
          </div>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Type-check + build**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: both exit 0.

- [ ] **Step 4: Re-run the full unit + integration test suite**

```bash
pnpm test
```

Expected: all existing tests pass, plus 9/9 (lib) + 5/5 (component) + 8/8 (integration, if DB available) new tests pass.

- [ ] **Step 5: Manual smoke (described for human)**

1. `pnpm dev` (port 4444)
2. Log in, navigate to `/sutra/1`
3. Click "进入抄经" → all chars faint, hover works
4. Click 3 chars → top progress bar advances, 3 chars dark
5. Reload page → re-enter copy mode → those 3 chars still dark
6. Switch chunk (left picker) → fresh progress loads
7. Click all chars in a chunk → scroll collapses (1.2s) → seal fades in (0.6s)
8. Log out → "进入抄经" → disabled view with banner
9. Click "重新抄写" → confirm → all chars back to faint, page=copying phase

If any step fails, fix and add a regression test before committing.

- [ ] **Step 6: Commit**

```bash
git add app/sutra/[id]/page.tsx app/sutra/[id]/SutraRightColumn.tsx
git commit -m "feat(sutra): wire SutraCopyView into /sutra/[id] with toggle + chunk key remount"
```

---

## Out of scope (deliberately deferred)

- 功德次数 / leaderboard / "今日全站 N 段抄经完成"
- Exporting the inked copy as image / PDF
- 回向文 input after the seal appears
- Tracking per-char tap timing
- Multi-user collaborative copy of the same chunk
- Mobile haptic feedback on completion

## Test commands quick reference

```bash
# All tests
pnpm test

# Just this feature
pnpm test -- tests/unit/lib/sutra-copy-progress.test.ts tests/unit/components/sutra/sutra-copy-view.test.tsx tests/integration/api/sutra-copy-progress.test.ts

# Integration with explicit DB
DATABASE_URL_TEST=$DATABASE_URL pnpm test -- tests/integration/api/sutra-copy-progress.test.ts

# Type check
pnpm tsc --noEmit

# Build
pnpm build

# Migration
pnpm tsx --env-file=.env scripts/migrate-sutra-copy-progress.ts
```

## Total commits expected: 6

1. `feat(sutra): add sutra_copy_progress table`
2. `feat(sutra): add copy-progress lib with TDD`
3. `feat(sutra): add copy-progress GET/POST API + integration test`
4. `feat(sutra): add CopySeal vermillion SVG component`
5. `feat(sutra): add SutraCopyView with click-to-ink + collapse + seal`
6. `feat(sutra): wire SutraCopyView into /sutra/[id] with toggle + chunk key remount`
