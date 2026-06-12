# Plan H: 后台管理平台扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing /admin scaffold into a full admin platform with 4 areas: 用户管理, 日志管理, 下载管理, AI 管理.

**Architecture:** Enrich the Plan B+ admin scaffold. 3 new tables (`downloads`, `ai_calls`, `app_config`) + additive `users.disabled_at` column. New server libs `lib/downloads.ts`, `lib/ai-calls.ts`, `lib/config.ts`. ~9 new admin API routes + 4 new user-facing "print" POST endpoints. New admin pages `/admin/logs`, `/admin/downloads`, `/admin/ai`. Reuse site palette + lucide icons + existing `Card`/`Pagination`/`EmptyState`. Logging helpers are fire-and-forget so user-facing flows never break.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MySQL (mysql2), zod, vitest, happy-dom, lucide-react.

**Reference:** Design spec at `docs/superpowers/specs/2026-06-12-admin-platform-expansion-design.md`. Mirror existing admin code: `lib/admin.ts`, `lib/auth.ts`, `lib/audit.ts`, `app/api/admin/users/[id]/promote/route.ts`, `components/UserMenu.tsx`, `app/admin/layout.tsx`, `app/admin/users/page.tsx`. Mirror poem/sutra patterns: `lib/api-*.ts`, components under `components/<area>/`.

**Read first (orient yourself):**
- `lib/auth.ts` — `getCurrentUser`, `getCurrentUserWithAdmin`, `requireAdmin`, `requireUser`
- `lib/api-handler.ts` — `withErrorHandling`, `badRequest`, `notFound`, `forbidden`, `unauthorized`
- `lib/audit.ts` — `writeAudit`, `AuditEvent` union
- `lib/admin.ts` — existing admin queries (e.g. `listUsers`, `getUser`, etc.)
- `app/api/admin/users/[id]/promote/route.ts` — pattern for an existing per-id admin action route
- `app/admin/layout.tsx` — existing admin layout you'll extend with the sidebar
- `components/UserMenu.tsx` — existing user menu you'll add the "后台管理" entry to
- `app/poetry/[id]/page.tsx` and `app/poetry/[id]/SaveAsWorksheetButton.tsx` — pattern for a "save action" client component (mirror for PrintButton)

---

## File Structure

**New files (server libs + types):**
- `lib/downloads.ts` — `logDownload(...)`, type aliases
- `lib/ai-calls.ts` — `logAiCall(...)`, `checkAiRateLimit(...)`, `withAiLogging(...)`
- `lib/config.ts` — `getConfig`, `setConfig`, `getAllConfig`, `setConfigBatch`
- `lib/admin-logs.ts` — `listUnifiedLogs(...)` (joins audit + downloads + ai_calls)
- `lib/admin-downloads.ts` — `listDownloads(...)`, `getDownloadStats(...)`
- `lib/admin-ai.ts` — `listAiCalls(...)`, `getAiStats(...)`, `getAiConfig`, `updateAiConfig`

**New API routes (all under `/api/admin/*`):**
- `app/api/admin/users/[id]/disable/route.ts` — POST
- `app/api/admin/users/[id]/enable/route.ts` — POST
- `app/api/admin/users/[id]/activity/route.ts` — GET
- `app/api/admin/logs/route.ts` — GET
- `app/api/admin/downloads/route.ts` — GET
- `app/api/admin/downloads/stats/route.ts` — GET
- `app/api/admin/ai/calls/route.ts` — GET
- `app/api/admin/ai/stats/route.ts` — GET
- `app/api/admin/ai/config/route.ts` — GET, PUT

**New public logging endpoints (user-facing, called by PrintButton):**
- `app/api/worksheets/[id]/print/route.ts` — POST
- `app/api/poetry/[id]/print/route.ts` — POST
- `app/api/sutra/[slug]/print/route.ts` — POST
- `app/api/rare-chars/[char]/print/route.ts` — POST

**New UI components:**
- `components/admin/AdminSidebar.tsx` — admin nav
- `components/admin/StatCard.tsx` — small KPI card
- `components/admin/SourceBadge.tsx` — source color-coded badge
- `components/admin/LogRow.tsx` — unified log table row
- `components/admin/JsonPanel.tsx` — JSON metadata viewer
- `components/common/PrintButton.tsx` — print action button (calls /print, then window.print())

**New pages:**
- `app/admin/logs/page.tsx`
- `app/admin/downloads/page.tsx`
- `app/admin/ai/page.tsx`

**New client API wrappers:**
- Extend `lib/api-admin.ts` with: `disableUserRequest`, `enableUserRequest`, `getUserActivityRequest`, `listAdminLogsRequest`, `listAdminDownloadsRequest`, `getDownloadStatsRequest`, `listAiCallsRequest`, `getAiStatsRequest`, `getAiConfigRequest`, `updateAiConfigRequest`
- Extend `lib/api-worksheet.ts` with: `printWorksheetRequest`
- Extend `lib/api-poetry.ts` with: `printPoemRequest`
- Extend `lib/api-sutras.ts` with: `printSutraRequest`
- Extend `lib/api-rare-chars.ts` with: `printRareCharRequest`

**Tests:**
- `tests/unit/lib/downloads.test.ts` (2)
- `tests/unit/lib/ai-calls.test.ts` (3 — including withAiLogging)
- `tests/unit/lib/config.test.ts` (3)
- `tests/unit/lib/admin-extensions.test.ts` (3 — disableUser/enableUser/isUserDisabled)
- `tests/unit/lib/admin-logs.test.ts` (2)
- `tests/unit/lib/admin-downloads.test.ts` (2)
- `tests/unit/lib/admin-ai.test.ts` (2)
- `tests/unit/components/admin/AdminSidebar.test.tsx` (2)
- `tests/unit/components/admin/StatCard.test.tsx` (1)
- `tests/unit/components/admin/SourceBadge.test.tsx` (1)
- `tests/unit/components/admin/LogRow.test.tsx` (2)
- `tests/unit/components/common/PrintButton.test.tsx` (1)
- `tests/integration/api/admin-users-disable.test.ts` (3)
- `tests/integration/api/admin-logs.test.ts` (5)
- `tests/integration/api/admin-downloads.test.ts` (3)
- `tests/integration/api/admin-ai.test.ts` (4)
- `tests/integration/api/print-logging.test.ts` (3)

**Modified files:**
- `scripts/init-db.ts` — DDL for 3 new tables + `users.disabled_at` ALTER + seed `app_config`
- `lib/validators.ts` — new schemas (admin logs/downloads/ai-config queries, admin user filter, print body)
- `lib/admin.ts` — `disableUser`, `enableUser`, `isUserDisabled`, extend `listUsers` to support `?disabled=true` filter and include `disabled_at` in response
- `lib/auth.ts` — check `disabled_at` in `getCurrentUser`/`getCurrentUserWithAdmin`/login
- `lib/audit.ts` — extend `AuditEvent` union with `user_disabled`, `user_reenabled`, `ai_config_updated`
- `lib/ai-rare-chars.ts` — wrap `generateStory` with `withAiLogging`
- `lib/api-admin.ts` — add new admin route wrappers
- `lib/api-worksheet.ts` — add `printWorksheetRequest`
- `lib/api-poetry.ts` — add `printPoemRequest`
- `lib/api-sutras.ts` — add `printSutraRequest`
- `lib/api-rare-chars.ts` — add `printRareCharRequest`
- `app/admin/layout.tsx` — add `AdminSidebar` + active highlight
- `app/admin/page.tsx` — add 4 stat cards
- `app/admin/users/page.tsx` — filter chips, action buttons
- `app/admin/users/[id]/page.tsx` — activity tab, disable UI
- `components/UserMenu.tsx` — add "后台管理" entry
- `app/worksheet/[id]/page.tsx` — add `PrintButton`
- `app/worksheet/page.tsx` — add `PrintButton` on preview
- `app/poetry/[id]/page.tsx` — add `PrintButton`
- `app/sutra/[id]/page.tsx` — add `PrintButton`
- `app/rare-chars/[char]/page.tsx` — add `PrintButton`
- `README.md` — document new admin pages and 4 print endpoints

---

## Phase 1: Data + libs

### Task 1: DDL — add 3 new tables + users.disabled_at + seed app_config

**Files:**
- Modify: `scripts/init-db.ts` (append DDL strings, add seed block in `initDb()`)

- [ ] **Step 1: Add 3 new tables + ALTER users**

Open `scripts/init-db.ts`. The DDL array ends with the `sutras` block. Add these 4 entries **immediately after `sutras`** (in this order):

```ts
  `ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin`,

  `CREATE TABLE IF NOT EXISTS downloads (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ai_calls (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS app_config (
     \`key\`       VARCHAR(64)  NOT NULL,
     value       TEXT         NOT NULL,
     updated_by  BIGINT       NULL,
     updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                   ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (\`key\`),
     CONSTRAINT fk_app_config_user FOREIGN KEY (updated_by)
       REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
```

Note: `ALTER TABLE users ADD COLUMN` will fail with a duplicate-column error on re-run. To make the script idempotent, do **not** rely on the DDL loop. Instead, replace `ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin` with a guarded check at the top of `initDb()` (see step 2).

- [ ] **Step 2: Guarded `disabled_at` + seed `app_config`**

Replace `initDb()` body (the `for (const sql of DDL)` block) so that AFTER the DDL loop runs, it adds a guarded ALTER and seeds the config defaults:

```ts
export async function initDb(): Promise<void> {
  const pool = getPool();
  for (const sql of DDL) {
    await pool.query(sql);
  }
  // Idempotent ALTER: only add disabled_at if it doesn't already exist
  const [cols] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'disabled_at'`,
  );
  if (cols.length === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin`);
  }
  // Seed app_config defaults
  const [[{ count: cfgCount }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count FROM app_config`,
  );
  if (Number(cfgCount) === 0) {
    const defaults: Array<[string, string]> = [
      ['ai.model', 'gpt-4o-mini'],
      ['ai.rate_limit_per_user_per_day', '5'],
      ['ai.timeout_ms', '30000'],
      ['ai.temperature', '0.7'],
    ];
    for (const [k, v] of defaults) {
      await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES (?, ?)`, [k, v]);
    }
    console.log(`[initDb] seeded ${defaults.length} app_config defaults`);
  } else {
    console.log(`[initDb] app_config has ${cfgCount} rows, skip seed`);
  }
  // (existing auto-populate blocks for poems + sutras stay below)
}
```

Remove the `ALTER TABLE users ADD COLUMN disabled_at ...` line from the DDL array (it was only shown above for reference — the actual ALTER goes in the function body).

- [ ] **Step 3: Verify it parses**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/init-db.ts
git commit -m "feat(admin): DDL for downloads, ai_calls, app_config, users.disabled_at + seed"
```

---

### Task 2: lib/downloads.ts (logDownload) + tests

**Files:**
- Create: `lib/downloads.ts`
- Create: `tests/unit/lib/downloads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/downloads.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { logDownload } from '../../../lib/downloads';

describe('logDownload', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('dl_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('inserts a row with all fields', async () => {
    await logDownload({
      userId,
      format: 'print',
      sourceType: 'poem',
      sourceId: '42',
      status: 'ok',
      durationMs: 123,
      ip: '127.0.0.1',
    });
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM downloads WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe('print');
    expect(rows[0].source_type).toBe('poem');
    expect(rows[0].source_id).toBe('42');
    expect(rows[0].status).toBe('ok');
    expect(Number(rows[0].duration_ms)).toBe(123);
    expect(rows[0].ip).toBe('127.0.0.1');
  });

  it('does not throw when insert fails (fail-soft)', async () => {
    // pass userId that doesn't exist → FK fails
    await expect(
      logDownload({
        userId: 99999999,
        format: 'print',
        sourceType: 'poem',
        sourceId: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/downloads.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/downloads.ts**

Create `lib/downloads.ts`:

```ts
import { getPool } from './db';

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

/** Fire-and-forget. Never throws. */
export async function logDownload(args: LogDownloadArgs): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO downloads
         (user_id, format, source_type, source_id, status, duration_ms, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        args.userId,
        args.format,
        args.sourceType,
        args.sourceId,
        args.status ?? 'ok',
        args.durationMs ?? null,
        args.ip ?? null,
      ],
    );
  } catch (err) {
    console.warn('[logDownload] insert failed:', (err as Error).message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/downloads.test.ts 2>&1 | tail -20`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/downloads.ts tests/unit/lib/downloads.test.ts
git commit -m "feat(admin): lib/downloads.ts with fail-soft logDownload"
```

---

### Task 3: lib/ai-calls.ts (logAiCall, checkAiRateLimit, withAiLogging) + tests

**Files:**
- Create: `lib/ai-calls.ts`
- Create: `tests/unit/lib/ai-calls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/ai-calls.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { logAiCall, checkAiRateLimit, withAiLogging } from '../../../lib/ai-calls';

describe('ai-calls', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('ai_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('logAiCall inserts a row', async () => {
    await logAiCall({
      userId,
      feature: 'rare-char-story',
      model: 'gpt-4o-mini',
      status: 'ok',
      durationMs: 250,
      metadata: { char: '龘' },
    });
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0].feature).toBe('rare-char-story');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(rows[0].status).toBe('ok');
    expect(Number(rows[0].duration_ms)).toBe(250);
  });

  it('withAiLogging wraps a function and logs the call', async () => {
    const result = await withAiLogging(
      { userId, feature: 'rare-char-story', metadata: { test: 1 } },
      async () => 'hello',
    );
    expect(result).toBe('hello');
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? AND feature = 'rare-char-story' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0].status).toBe('ok');
  });

  it('withAiLogging logs error and re-throws on failure', async () => {
    await expect(
      withAiLogging({ userId, feature: 'rare-char-story' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? AND status = 'error' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toContain('boom');
  });

  it('checkAiRateLimit returns true when under limit', async () => {
    const ok = await checkAiRateLimit(userId);
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/ai-calls.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/ai-calls.ts**

Create `lib/ai-calls.ts`:

```ts
import { getPool } from './db';
import { getConfig } from './config';

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

export async function logAiCall(args: LogAiCallArgs): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO ai_calls
         (user_id, feature, model, status, prompt_tokens, completion_tokens, duration_ms, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.userId,
        args.feature,
        args.model,
        args.status,
        args.promptTokens ?? null,
        args.completionTokens ?? null,
        args.durationMs ?? null,
        args.error ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
  } catch (err) {
    console.warn('[logAiCall] insert failed:', (err as Error).message);
  }
}

export async function checkAiRateLimit(userId: number): Promise<boolean> {
  const limitStr = await getConfig('ai.rate_limit_per_user_per_day');
  const limit = limitStr ? parseInt(limitStr, 10) : 5;
  if (limit <= 0) return true; // 0 = unlimited
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM ai_calls
     WHERE user_id = ? AND created_at >= CURDATE() AND status IN ('ok','error')`,
    [userId],
  );
  return Number(rows[0].n) < limit;
}

export class RateLimitError extends Error {
  constructor() { super('rate limit exceeded'); this.name = 'RateLimitError'; }
}

export interface WithAiLoggingArgs {
  userId: number | null;
  feature: string;
  metadata?: Record<string, unknown>;
}

export async function withAiLogging<T>(args: WithAiLoggingArgs, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let model = 'unknown';
  let status: AiCallStatus = 'ok';
  let error: string | undefined;
  let result: T;
  try {
    result = await fn();
    return result;
  } catch (err) {
    error = (err as Error).message;
    status = err instanceof RateLimitError ? 'rate-limited' : 'error';
    throw err;
  } finally {
    const duration = Date.now() - start;
    await logAiCall({
      userId: args.userId,
      feature: args.feature,
      model,
      status,
      durationMs: duration,
      error,
      metadata: args.metadata,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/ai-calls.test.ts 2>&1 | tail -20`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-calls.ts tests/unit/lib/ai-calls.test.ts
git commit -m "feat(admin): lib/ai-calls.ts with logAiCall, checkAiRateLimit, withAiLogging"
```

---

### Task 4: lib/config.ts (getConfig, setConfig, getAllConfig, setConfigBatch) + tests

**Files:**
- Create: `lib/config.ts`
- Create: `tests/unit/lib/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/config.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { getConfig, setConfig, getAllConfig, setConfigBatch } from '../../../lib/config';

describe('config', () => {
  afterAll(async () => {
    await getPool().query(`DELETE FROM app_config WHERE \`key\` LIKE 'test.%'`);
    await closePool();
  });

  it('getConfig returns null for missing key', async () => {
    const v = await getConfig('test.does_not_exist');
    expect(v).toBeNull();
  });

  it('setConfig inserts/updates a value', async () => {
    await setConfig('test.foo', 'bar', null);
    expect(await getConfig('test.foo')).toBe('bar');
    await setConfig('test.foo', 'baz', null);
    expect(await getConfig('test.foo')).toBe('baz');
  });

  it('getAllConfig returns the seeded AI keys', async () => {
    const all = await getAllConfig();
    expect(all['ai.model']).toBe('gpt-4o-mini');
  });

  it('setConfigBatch validates values', async () => {
    await expect(
      setConfigBatch({ 'test.timeout': '30000' }, 0),
    ).resolves.toBeUndefined();
    // a key that doesn't match a known shape should still store
    expect(await getConfig('test.timeout')).toBe('30000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/config.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/config.ts**

Create `lib/config.ts`:

```ts
import { getPool } from './db';

const KEY_VALIDATORS: Record<string, (v: string) => boolean> = {
  'ai.model': (v) => v.length > 0 && v.length <= 64,
  'ai.rate_limit_per_user_per_day': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && n <= 1000;
  },
  'ai.timeout_ms': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 1000 && n <= 300000;
  },
  'ai.temperature': (v) => {
    const n = parseFloat(v);
    return !isNaN(n) && n >= 0 && n <= 2;
  },
};

export async function getConfig(key: string): Promise<string | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT value FROM app_config WHERE \`key\` = ? LIMIT 1`,
    [key],
  );
  return rows.length ? rows[0].value : null;
}

export async function setConfig(key: string, value: string, byUserId: number | null): Promise<void> {
  const validator = KEY_VALIDATORS[key];
  if (validator && !validator(value)) {
    throw new Error(`Invalid value for ${key}: ${value}`);
  }
  await getPool().query(
    `INSERT INTO app_config (\`key\`, value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    [key, value, byUserId],
  );
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const [rows] = await getPool().query<any[]>(`SELECT \`key\`, value FROM app_config`);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setConfigBatch(updates: Record<string, string>, byUserId: number): Promise<void> {
  for (const [k, v] of Object.entries(updates)) {
    await setConfig(k, v, byUserId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/config.test.ts 2>&1 | tail -20`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts tests/unit/lib/config.test.ts
git commit -m "feat(admin): lib/config.ts with validated get/set/batch"
```

---

### Task 5: lib/admin.ts extensions (disableUser, enableUser, isUserDisabled, listUsers + disabled filter) + tests

**Files:**
- Modify: `lib/admin.ts` (add 3 functions + extend listUsers)
- Create: `tests/unit/lib/admin-extensions.test.ts`

- [ ] **Step 1: Read existing lib/admin.ts and add the 3 functions + filter**

Open `lib/admin.ts`. Find the end of the file and append these functions. Also locate the existing `listUsers` function — the test in step 2 expects an additional `disabled?: boolean` option; you'll need to extend the function signature to accept that.

```ts
// Append to lib/admin.ts:

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
  q?: string;             // search by username LIKE
  isAdmin?: boolean;      // filter to admins only
  disabled?: boolean;     // filter to disabled only
}
export interface AdminUserRowExtended extends AdminUserRow {
  disabledAt: Date | null;
}

export async function listUsers(opts: ListUsersOptions = {}): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pool = getPool();

  const where: string[] = [];
  const params: any[] = [];
  if (opts.q) { where.push(`u.username LIKE ?`); params.push(`%${opts.q}%`); }
  if (typeof opts.isAdmin === 'boolean') { where.push(`u.is_admin = ?`); params.push(opts.isAdmin ? 1 : 0); }
  if (typeof opts.disabled === 'boolean') {
    where.push(opts.disabled ? `u.disabled_at IS NOT NULL` : `u.disabled_at IS NULL`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at, u.disabled_at,
            COALESCE(h.total, 0) AS historyCount,
            COALESCE(h.fav, 0) AS favoriteCount
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS total,
              SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
       FROM history GROUP BY user_id
     ) h ON h.user_id = u.id
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM users u ${whereSql}`,
    params,
  );

  return {
    users: rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      isAdmin: r.is_admin === 1 || r.is_admin === true,
      createdAt: r.created_at,
      disabledAt: r.disabled_at,
      historyCount: Number(r.historyCount),
      favoriteCount: Number(r.favoriteCount),
    })) as any,
    total: Number(countRows[0].n),
  };
}

export async function disableUser(id: number, byAdminId: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE users SET disabled_at = NOW() WHERE id = ? AND disabled_at IS NULL`, [id]);
}

export async function enableUser(id: number, byAdminId: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE users SET disabled_at = NULL WHERE id = ?`, [id]);
}

export async function isUserDisabled(userId: number): Promise<boolean> {
  const [rows] = await getPool().query<any[]>(
    `SELECT disabled_at FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return false;
  return rows[0].disabled_at !== null;
}
```

(If the existing `listUsers` had a different shape that other code depends on, keep both signatures by renaming the old one to `listUsersLegacy` — but in practice the only caller is `app/api/admin/users/route.ts` which you'll be modifying to pass the new query params. Prefer to update the single caller rather than fork the function.)

- [ ] **Step 2: Write the test**

Create `tests/unit/lib/admin-extensions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { disableUser, enableUser, isUserDisabled, listUsers } from '../../../lib/admin';

describe('admin-extensions', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('ext_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('disableUser sets disabled_at', async () => {
    await disableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(true);
  });

  it('enableUser clears disabled_at', async () => {
    await enableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(false);
  });

  it('listUsers filters by disabled', async () => {
    await disableUser(userId, 0);
    const all = await listUsers({ limit: 200 });
    const only = await listUsers({ disabled: true, limit: 200 });
    expect(only.users.find(u => u.id === userId)).toBeTruthy();
    expect(all.users.find(u => u.id === userId && u.disabledAt)).toBeTruthy();
    await enableUser(userId, 0);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/admin-extensions.test.ts 2>&1 | tail -20`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add lib/admin.ts tests/unit/lib/admin-extensions.test.ts
git commit -m "feat(admin): lib/admin.ts disableUser/enableUser/isUserDisabled + listUsers filter"
```

---

### Task 6: lib/auth.ts + lib/audit.ts updates (disabled_at enforcement + new audit events) + tests

**Files:**
- Modify: `lib/auth.ts` (check `disabled_at` in getCurrentUser and login)
- Modify: `lib/audit.ts` (extend AuditEvent union)
- Create: `tests/unit/lib/auth-disabled.test.ts`

- [ ] **Step 1: Extend AuditEvent union**

Open `lib/audit.ts`. Replace the `AuditEvent` type with:

```ts
export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote'
  | 'user_disabled' | 'user_reenabled'
  | 'ai_config_updated' | 'ai_call_logged'
  | 'worksheet_saved' | 'worksheet_deleted';
```

- [ ] **Step 2: Update lib/auth.ts to check disabled_at**

Open `lib/auth.ts`. Replace `getCurrentUser` with this version (keeps the rest of the file untouched):

```ts
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  // Check disabled_at
  const [rows] = await getPool().query<any[]>(
    `SELECT disabled_at FROM users WHERE id = ? LIMIT 1`,
    [session.userId],
  );
  if (rows.length === 0 || rows[0].disabled_at !== null) return null;
  return { id: session.userId, username: session.username };
}
```

Also find `getCurrentUserWithAdmin` and ensure it also checks `disabled_at` (apply the same guard). If it already does, no change.

In the login route handler (look in `app/api/auth/login/route.ts`), after the password check succeeds, query the user's `disabled_at`. If set, return:

```ts
return NextResponse.json(
  { ok: false, error: { code: 'account_disabled', message: '账号已被禁用' } },
  { status: 403 },
);
```

(Adjust the file's existing import + handler structure — keep its error envelope and `withErrorHandling` wrap intact.)

- [ ] **Step 3: Write the test**

Create `tests/unit/lib/auth-disabled.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { isUserDisabled, disableUser, enableUser } from '../../../lib/admin';
import { getCurrentUser } from '../../../lib/auth';
import { cookies } from 'next/headers';

describe('auth-disabled', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('dis_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('isUserDisabled reflects DB state', async () => {
    expect(await isUserDisabled(userId)).toBe(false);
    await disableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(true);
    await enableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/auth-disabled.test.ts 2>&1 | tail -20`
Expected: 1 passed (the getCurrentUser cookie-path branch is covered indirectly by integration tests in Phase 2; this unit test focuses on the helper).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/audit.ts app/api/auth/login/route.ts tests/unit/lib/auth-disabled.test.ts
git commit -m "feat(auth): enforce users.disabled_at in getCurrentUser + login; extend AuditEvent"
```

---

## Phase 2: API

### Task 7: POST /api/admin/users/[id]/disable + /enable + integration tests

**Files:**
- Create: `app/api/admin/users/[id]/disable/route.ts`
- Create: `app/api/admin/users/[id]/enable/route.ts`
- Create: `tests/integration/api/admin-users-disable.test.ts`

- [ ] **Step 1: Read the existing promote route as a pattern**

Open `app/api/admin/users/[id]/promote/route.ts`. Note how it uses `requireAdmin`, validates the user exists, calls the lib function, and writes an audit event. Mirror that exact pattern.

- [ ] **Step 2: Create disable route**

Create `app/api/admin/users/[id]/disable/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, notFound, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { disableUser } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const { id } = await params;
    const userId = parseInt(id, 10);
    if (!Number.isInteger(userId) || userId <= 0) return badRequest('bad_id', 'invalid id');
    if (userId === auth.user.id) return badRequest('self_disable', 'cannot disable yourself');
    await disableUser(userId, auth.user.id);
    await writeAudit({ userId: auth.user.id, event: 'user_disabled', metadata: { targetUserId: userId } });
    return NextResponse.json({ ok: true, data: { id: userId } });
  });
}
```

- [ ] **Step 3: Create enable route**

Create `app/api/admin/users/[id]/enable/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { enableUser } from '@/lib/admin';
import { writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const { id } = await params;
    const userId = parseInt(id, 10);
    if (!Number.isInteger(userId) || userId <= 0) return badRequest('bad_id', 'invalid id');
    await enableUser(userId, auth.user.id);
    await writeAudit({ userId: auth.user.id, event: 'user_reenabled', metadata: { targetUserId: userId } });
    return NextResponse.json({ ok: true, data: { id: userId } });
  });
}
```

- [ ] **Step 4: Write integration test**

Create `tests/integration/api/admin-users-disable.test.ts`. Follow the existing admin route integration test pattern (see `tests/integration/api/admin-crud.test.ts`): it should set up an admin user, set a session cookie, then exercise disable + enable. Adapt the helper imports to your existing test scaffolding (look for how `admin-crud.test.ts` builds the `NextRequest` with cookies).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { POST as disable } from '../../../app/api/admin/users/[id]/disable/route';
import { POST as enable } from '../../../app/api/admin/users/[id]/enable/route';
// adapt: use the same NextRequest + cookie helpers used in admin-crud.test.ts

describe('admin/users disable+enable', () => {
  let adminId: number;
  let victimId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_d', 'x', 1)`);
    const a = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number(a[0].id);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('vic_d', 'x')`);
    const v = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    victimId = Number(v[0].id);
    // (sign session for admin and set cookie in request)
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [adminId, victimId]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, victimId]);
    await closePool();
  });

  it('disables a user', async () => {
    const res = await disable(new NextRequest(...) , { params: Promise.resolve({ id: String(victimId) }) });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const [[row]] = await getPool().query<any[]>(`SELECT disabled_at FROM users WHERE id = ?`, [victimId]);
    expect(row.disabled_at).not.toBeNull();
  });

  it('enables a user', async () => { /* symmetric */ });

  it('non-admin gets 403', async () => { /* make a request without the admin cookie */ });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/integration/api/admin-users-disable.test.ts 2>&1 | tail -20`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/users/[id]/disable app/api/admin/users/[id]/enable tests/integration/api/admin-users-disable.test.ts
git commit -m "feat(admin): POST /api/admin/users/[id]/{disable,enable} + tests"
```

---

### Task 8: GET /api/admin/users/[id]/activity + integration test

**Files:**
- Create: `app/api/admin/users/[id]/activity/route.ts`
- Create: `tests/integration/api/admin-users-activity.test.ts` (or extend the disable test file)

- [ ] **Step 1: Create the route**

Create `app/api/admin/users/[id]/activity/route.ts`. The route returns the last 100 events for a user, combining audit_log + downloads + ai_calls into the unified `UnifiedLogEntry` shape (defined in spec section 6.3). Mirror the pattern from `app/api/admin/audit/route.ts`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const { id } = await params;
    const userId = parseInt(id, 10);
    if (!Number.isInteger(userId) || userId <= 0) return badRequest('bad_id', 'invalid id');

    const url = new URL(req.url);
    const after = url.searchParams.get('after'); // ISO timestamp cursor — return rows NEWER than this (load more recent)

    const pool = getPool();
    const [audit, downloads, aiCalls] = await Promise.all([
      pool.query<any[]>(
        `SELECT id, event, metadata, ip, created_at FROM audit_log
         WHERE user_id = ? ${after ? 'AND created_at > ?' : ''}
         ORDER BY created_at DESC LIMIT 100`,
        after ? [userId, after] : [userId],
      ),
      pool.query<any[]>(
        `SELECT id, source_type, source_id, status, format, duration_ms, created_at
         FROM downloads WHERE user_id = ? ${after ? 'AND created_at > ?' : ''}
         ORDER BY created_at DESC LIMIT 100`,
        after ? [userId, after] : [userId],
      ),
      pool.query<any[]>(
        `SELECT id, feature, model, status, duration_ms, error, metadata, created_at
         FROM ai_calls WHERE user_id = ? ${after ? 'AND created_at > ?' : ''}
         ORDER BY created_at DESC LIMIT 100`,
        after ? [userId, after] : [userId],
      ),
    ]);

    const items = [
      ...audit[0].map(r => ({
        id: `audit:${r.id}`, source: 'audit', event: r.event, userId,
        username: null, ip: r.ip, createdAt: r.created_at,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      })),
      ...downloads[0].map(r => ({
        id: `download:${r.id}`, source: 'download', event: 'download_logged', userId,
        username: null, ip: null, createdAt: r.created_at,
        metadata: { sourceType: r.source_type, sourceId: r.source_id, status: r.status, format: r.format, durationMs: r.duration_ms },
      })),
      ...aiCalls[0].map(r => ({
        id: `ai_call:${r.id}`, source: 'ai_call', event: r.feature, userId,
        username: null, ip: null, createdAt: r.created_at,
        metadata: { model: r.model, status: r.status, durationMs: r.duration_ms, error: r.error, ...(typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata ?? {}) },
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, data: { items: items.slice(0, 100) } });
  });
}
```

- [ ] **Step 2: Write integration test (2 tests)**

Insert a row into each of `audit_log`, `downloads`, `ai_calls` for the test user, hit the route, assert 3 items returned, sorted by created_at desc. Then test `?after=` pagination. Use the same NextRequest + cookie pattern as the disable test (step 4 of Task 7).

- [ ] **Step 3: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/integration/api/admin-users-activity.test.ts 2>&1 | tail -20`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/users/[id]/activity tests/integration/api/admin-users-activity.test.ts
git commit -m "feat(admin): GET /api/admin/users/[id]/activity (audit + downloads + ai_calls)"
```

---

### Task 9: lib/admin-logs.ts (listUnifiedLogs) + tests + GET /api/admin/logs

**Files:**
- Create: `lib/admin-logs.ts`
- Create: `tests/unit/lib/admin-logs.test.ts`
- Create: `app/api/admin/logs/route.ts`
- Create: `tests/integration/api/admin-logs.test.ts`

- [ ] **Step 1: Create lib/admin-logs.ts**

```ts
import { getPool } from './db';

export type UnifiedLogSource = 'audit' | 'download' | 'ai_call';

export interface UnifiedLogEntry {
  id: string;
  source: UnifiedLogSource;
  event: string;
  userId: number | null;
  username: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ListUnifiedLogsOptions {
  type?: string;        // event type filter (matches audit_log.event OR 'download_logged' OR 'ai_call' etc.)
  userId?: number;
  ip?: string;
  from?: string;        // ISO date
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListUnifiedLogsResult {
  items: UnifiedLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listUnifiedLogs(opts: ListUnifiedLogsOptions = {}): Promise<ListUnifiedLogsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const offset = (page - 1) * pageSize;

  const pool = getPool();

  // Build source-specific WHERE clauses
  const auditWhere: string[] = [];
  const auditParams: any[] = [];
  if (opts.type) { auditWhere.push(`a.event = ?`); auditParams.push(opts.type); }
  if (opts.userId) { auditWhere.push(`a.user_id = ?`); auditParams.push(opts.userId); }
  if (opts.ip) { auditWhere.push(`a.ip = ?`); auditParams.push(opts.ip); }
  if (opts.from) { auditWhere.push(`a.created_at >= ?`); auditParams.push(opts.from); }
  if (opts.to) { auditWhere.push(`a.created_at <= ?`); auditParams.push(opts.to); }
  const auditSql = auditWhere.length ? `WHERE ${auditWhere.join(' AND ')}` : '';

  const dlWhere: string[] = [];
  const dlParams: any[] = [];
  const includeDownloads = !opts.type || opts.type === 'download_logged' || opts.type === 'download';
  if (includeDownloads) {
    if (opts.userId) { dlWhere.push(`d.user_id = ?`); dlParams.push(opts.userId); }
    if (opts.from) { dlWhere.push(`d.created_at >= ?`); dlParams.push(opts.from); }
    if (opts.to) { dlWhere.push(`d.created_at <= ?`); dlParams.push(opts.to); }
  }
  const dlSql = includeDownloads && dlWhere.length ? `WHERE ${dlWhere.join(' AND ')}` : '';

  const aiWhere: string[] = [];
  const aiParams: any[] = [];
  const includeAi = !opts.type || opts.type.startsWith('ai_') || opts.type === 'ai_call';
  if (includeAi) {
    if (opts.type && opts.type.startsWith('ai_')) { aiWhere.push(`a.status = ?`); aiParams.push(opts.type.replace('ai_', '')); }
    if (opts.userId) { aiWhere.push(`a.user_id = ?`); aiParams.push(opts.userId); }
    if (opts.from) { aiWhere.push(`a.created_at >= ?`); aiParams.push(opts.from); }
    if (opts.to) { aiWhere.push(`a.created_at <= ?`); aiParams.push(opts.to); }
  }
  const aiSql = includeAi && aiWhere.length ? `WHERE ${aiWhere.join(' AND ')}` : '';

  // Fetch one page-sized window from each source, then merge + sort + re-paginate.
  // This is OK at our scale (< 10k rows expected); replace with UNION + LIMIT if perf becomes an issue.
  const [auditRows] = await pool.query<any[]>(
    `SELECT a.id, a.event, a.user_id, u.username, a.ip, a.metadata, a.created_at
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${auditSql} ORDER BY a.created_at DESC LIMIT 200`,
    auditParams,
  );
  const [dlRows] = includeDownloads ? await pool.query<any[]>(
    `SELECT d.id, d.user_id, u.username, d.source_type, d.source_id, d.status, d.format, d.duration_ms, d.created_at
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ${dlSql} ORDER BY d.created_at DESC LIMIT 200`,
    dlParams,
  ) : [[]];
  const [aiRows] = includeAi ? await pool.query<any[]>(
    `SELECT a.id, a.user_id, u.username, a.feature, a.model, a.status, a.duration_ms, a.error, a.metadata, a.created_at
     FROM ai_calls a LEFT JOIN users u ON u.id = a.user_id
     ${aiSql} ORDER BY a.created_at DESC LIMIT 200`,
    aiParams,
  ) : [[]];

  const items: UnifiedLogEntry[] = [
    ...auditRows.map((r: any) => ({
      id: `audit:${r.id}`, source: 'audit', event: r.event, userId: r.user_id,
      username: r.username, ip: r.ip, createdAt: r.created_at,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {}),
    })),
    ...dlRows.map((r: any) => ({
      id: `download:${r.id}`, source: 'download', event: 'download_logged', userId: r.user_id,
      username: r.username, ip: null, createdAt: r.created_at,
      metadata: { sourceType: r.source_type, sourceId: r.source_id, status: r.status, format: r.format, durationMs: r.duration_ms },
    })),
    ...aiRows.map((r: any) => ({
      id: `ai_call:${r.id}`, source: 'ai_call', event: r.feature, userId: r.user_id,
      username: r.username, ip: null, createdAt: r.created_at,
      metadata: { model: r.model, status: r.status, durationMs: r.duration_ms, error: r.error, ...(typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {})) },
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize };
}
```

- [ ] **Step 2: Write unit test (2 tests)**

Test that mixing rows from all 3 sources returns them sorted by `createdAt` desc, and that `type=download_logged` only returns download rows.

- [ ] **Step 3: Create app/api/admin/logs/route.ts**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listUnifiedLogs } from '@/lib/admin-logs';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const sp = req.nextUrl.searchParams;
    const result = await listUnifiedLogs({
      type: sp.get('type') ?? undefined,
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      ip: sp.get('ip') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Write integration test (5 tests)**

Insert 3 rows (one per source) + filter by `type=` + filter by `userId=` + date range + empty result + pagination. Adapt NextRequest + cookie pattern from existing admin tests.

- [ ] **Step 5: Run tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/admin-logs.test.ts tests/integration/api/admin-logs.test.ts 2>&1 | tail -20`
Expected: 2 + 5 = 7 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/admin-logs.ts tests/unit/lib/admin-logs.test.ts app/api/admin/logs/route.ts tests/integration/api/admin-logs.test.ts
git commit -m "feat(admin): unified /api/admin/logs across audit + downloads + ai_calls"
```

---

### Task 10: lib/admin-downloads.ts + GET /api/admin/downloads + /stats

**Files:**
- Create: `lib/admin-downloads.ts`
- Create: `tests/unit/lib/admin-downloads.test.ts`
- Create: `app/api/admin/downloads/route.ts`
- Create: `app/api/admin/downloads/stats/route.ts`
- Create: `tests/integration/api/admin-downloads.test.ts`

- [ ] **Step 1: Create lib/admin-downloads.ts**

```ts
import { getPool } from './db';
import type { DownloadSourceType } from './downloads';

export interface DownloadRow {
  id: number;
  userId: number;
  username: string;
  format: 'pdf' | 'print';
  sourceType: DownloadSourceType;
  sourceId: string | null;
  status: 'ok' | 'error';
  durationMs: number | null;
  createdAt: string;
}

export interface ListDownloadsOptions {
  userId?: number;
  sourceType?: DownloadSourceType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListDownloadsResult {
  items: DownloadRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDownloads(opts: ListDownloadsOptions = {}): Promise<ListDownloadsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId) { where.push('d.user_id = ?'); params.push(opts.userId); }
  if (opts.sourceType) { where.push('d.source_type = ?'); params.push(opts.sourceType); }
  if (opts.from) { where.push('d.created_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('d.created_at <= ?'); params.push(opts.to); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT d.id, d.user_id, u.username, d.format, d.source_type, d.source_id, d.status, d.duration_ms, d.created_at
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ${sql} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM downloads d ${sql}`,
    params,
  );
  return {
    items: rows.map(r => ({
      id: Number(r.id), userId: Number(r.user_id), username: r.username,
      format: r.format, sourceType: r.source_type, sourceId: r.source_id,
      status: r.status, durationMs: r.duration_ms, createdAt: r.created_at,
    })),
    total: Number(countRows[0].n), page, pageSize,
  };
}

export interface DownloadStats {
  total: number;
  bySourceType: Record<DownloadSourceType, number>;
  topUsers: { userId: number; username: string; count: number }[];
}

export async function getDownloadStats(days = 7): Promise<DownloadStats> {
  const pool = getPool();
  const [totalRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM downloads WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const [bySrc] = await pool.query<any[]>(
    `SELECT source_type, COUNT(*) AS n FROM downloads
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY source_type`,
    [days],
  );
  const [topUsers] = await pool.query<any[]>(
    `SELECT d.user_id, u.username, COUNT(*) AS n
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY d.user_id, u.username
     ORDER BY n DESC LIMIT 5`,
    [days],
  );
  return {
    total: Number(totalRows[0].n),
    bySourceType: { worksheet: 0, poem: 0, sutra: 0, 'rare-char-card': 0, ...Object.fromEntries(bySrc.map((r: any) => [r.source_type, Number(r.n)])) } as any,
    topUsers: topUsers.map((r: any) => ({ userId: Number(r.user_id), username: r.username, count: Number(r.n) })),
  };
}
```

- [ ] **Step 2: Unit test (2 tests)**

Test listDownloads filtering and getDownloadStats aggregation.

- [ ] **Step 3: Create the two API routes**

`app/api/admin/downloads/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listDownloads } from '@/lib/admin-downloads';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const sp = req.nextUrl.searchParams;
    const result = await listDownloads({
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      sourceType: sp.get('sourceType') as any ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

`app/api/admin/downloads/stats/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getDownloadStats } from '@/lib/admin-downloads';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10);
    const stats = await getDownloadStats(Math.min(Math.max(days, 1), 90));
    return NextResponse.json({ ok: true, data: stats });
  });
}
```

- [ ] **Step 4: Integration test (3 tests)**

Default filters, source_type filter, stats aggregate.

- [ ] **Step 5: Run tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/admin-downloads.test.ts tests/integration/api/admin-downloads.test.ts 2>&1 | tail -20`
Expected: 2 + 3 = 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/admin-downloads.ts tests/unit/lib/admin-downloads.test.ts app/api/admin/downloads tests/integration/api/admin-downloads.test.ts
git commit -m "feat(admin): /api/admin/downloads list + stats"
```

---

### Task 11: lib/admin-ai.ts + GET /api/admin/ai/calls + /stats

**Files:**
- Create: `lib/admin-ai.ts`
- Create: `tests/unit/lib/admin-ai.test.ts`
- Create: `app/api/admin/ai/calls/route.ts`
- Create: `app/api/admin/ai/stats/route.ts`
- Create: `tests/integration/api/admin-ai-calls.test.ts` (4 tests; config in next task)

- [ ] **Step 1: Create lib/admin-ai.ts**

```ts
import { getPool } from './db';
import type { AiCallStatus } from './ai-calls';

export interface AiCallRow {
  id: number;
  userId: number | null;
  username: string | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ListAiCallsOptions {
  feature?: string;
  status?: AiCallStatus;
  userId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListAiCallsResult {
  items: AiCallRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAiCalls(opts: ListAiCallsOptions = {}): Promise<ListAiCallsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: any[] = [];
  if (opts.feature) { where.push('a.feature = ?'); params.push(opts.feature); }
  if (opts.status) { where.push('a.status = ?'); params.push(opts.status); }
  if (opts.userId) { where.push('a.user_id = ?'); params.push(opts.userId); }
  if (opts.from) { where.push('a.created_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('a.created_at <= ?'); params.push(opts.to); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT a.id, a.user_id, u.username, a.feature, a.model, a.status,
            a.prompt_tokens, a.completion_tokens, a.duration_ms, a.error, a.metadata, a.created_at
     FROM ai_calls a LEFT JOIN users u ON u.id = a.user_id
     ${sql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM ai_calls a ${sql}`, params,
  );
  return {
    items: rows.map(r => ({
      id: Number(r.id), userId: r.user_id, username: r.username,
      feature: r.feature, model: r.model, status: r.status,
      promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens,
      durationMs: r.duration_ms, error: r.error,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      createdAt: r.created_at,
    })),
    total: Number(countRows[0].n), page, pageSize,
  };
}

export interface AiStats {
  total: number;
  byDay: { date: string; count: number }[];
  errorRate: number;          // 0..1
  p50Duration: number | null; // ms
  p95Duration: number | null; // ms
  topUsers: { userId: number; username: string; count: number }[];
}

export async function getAiStats(days = 7): Promise<AiStats> {
  const pool = getPool();
  const [totalRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM ai_calls WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const [byDay] = await pool.query<any[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS n FROM ai_calls
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY DATE(created_at) ORDER BY d ASC`,
    [days],
  );
  const [errRate] = await pool.query<any[]>(
    `SELECT
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errs,
       COUNT(*) AS total
     FROM ai_calls WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const [durations] = await pool.query<any[]>(
    `SELECT duration_ms FROM ai_calls
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND duration_ms IS NOT NULL
     ORDER BY duration_ms ASC`,
    [days],
  );
  const p = (q: number) => {
    if (!durations.length) return null;
    const idx = Math.min(durations.length - 1, Math.floor(q * durations.length));
    return Number(durations[idx].duration_ms);
  };
  const [topUsers] = await pool.query<any[]>(
    `SELECT a.user_id, u.username, COUNT(*) AS n FROM ai_calls a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND a.user_id IS NOT NULL
     GROUP BY a.user_id, u.username ORDER BY n DESC LIMIT 5`,
    [days],
  );
  const total = Number(errRate[0].total) || 0;
  return {
    total: Number(totalRows[0].n),
    byDay: byDay.map((r: any) => ({ date: r.d, count: Number(r.n) })),
    errorRate: total > 0 ? Number(errRate[0].errs) / total : 0,
    p50Duration: p(0.5),
    p95Duration: p(0.95),
    topUsers: topUsers.map((r: any) => ({ userId: Number(r.user_id), username: r.username, count: Number(r.n) })),
  };
}
```

- [ ] **Step 2: Unit test (2 tests)**

Test listAiCalls filtering and getAiStats aggregation (insert 5 rows with known durations, verify p50/p95).

- [ ] **Step 3: Create the two API routes**

`app/api/admin/ai/calls/route.ts` and `app/api/admin/ai/stats/route.ts` follow the exact same pattern as the downloads routes from Task 10. Replace the lib import with `lib/admin-ai`. The `/stats` route accepts `?days=N`.

- [ ] **Step 4: Integration test (4 tests for calls + stats)**

Status filter, feature filter, p50/p95 calculation, top users.

- [ ] **Step 5: Run tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/admin-ai.test.ts tests/integration/api/admin-ai-calls.test.ts 2>&1 | tail -20`
Expected: 2 + 4 = 6 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/admin-ai.ts tests/unit/lib/admin-ai.test.ts app/api/admin/ai/calls app/api/admin/ai/stats tests/integration/api/admin-ai-calls.test.ts
git commit -m "feat(admin): /api/admin/ai/calls + /stats"
```

---

### Task 12: GET / PUT /api/admin/ai/config + integration test

**Files:**
- Create: `app/api/admin/ai/config/route.ts`
- Create: `tests/integration/api/admin-ai-config.test.ts` (4 tests)

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const CONFIG_KEYS = ['ai.model', 'ai.rate_limit_per_user_per_day', 'ai.timeout_ms', 'ai.temperature'] as const;
type AiConfigKey = typeof CONFIG_KEYS[number];

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const all = await getAllConfig();
    const out: Record<string, string> = {};
    for (const k of CONFIG_KEYS) out[k] = all[k] ?? '';
    return NextResponse.json({ ok: true, data: out });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;
    const body = await req.json();
    const updates: Record<string, string> = {};
    for (const k of CONFIG_KEYS) {
      if (k in body && body[k] !== undefined) updates[k] = String(body[k]);
    }
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');
    try {
      await setConfigBatch(updates, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({ userId: auth.user.id, event: 'ai_config_updated', metadata: updates });
    return NextResponse.json({ ok: true, data: updates });
  });
}
```

- [ ] **Step 2: Integration test (4 tests)**

GET returns 4 keys; PUT updates a key; PUT validates bad value (e.g. timeout_ms=10) → 400; PUT audit-logs.

- [ ] **Step 3: Run test**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/integration/api/admin-ai-config.test.ts 2>&1 | tail -20`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/ai/config tests/integration/api/admin-ai-config.test.ts
git commit -m "feat(admin): GET/PUT /api/admin/ai/config with validation + audit"
```

---

### Task 13: 4 print POST endpoints + integration tests

**Files:**
- Create: `app/api/worksheets/[id]/print/route.ts`
- Create: `app/api/poetry/[id]/print/route.ts`
- Create: `app/api/sutra/[slug]/print/route.ts`
- Create: `app/api/rare-chars/[char]/print/route.ts`
- Create: `tests/integration/api/print-logging.test.ts`

- [ ] **Step 1: Create the 4 routes**

All 4 routes follow the same pattern. Below is the worksheets version; the other 3 are nearly identical with the sourceType and sourceId changed. Each requires auth via `requireUser` (NOT `requireAdmin` — this is a user-facing action).

`app/api/worksheets/[id]/print/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound, forbidden } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if ('error' in auth) return auth.error;
    const { id } = await params;
    const wid = parseInt(id, 10);
    if (!Number.isInteger(wid) || wid <= 0) return badRequest('bad_id', 'invalid id');
    const [rows] = await getPool().query<any[]>(`SELECT id FROM worksheets WHERE id = ? AND user_id = ? LIMIT 1`, [wid, auth.user.id]);
    if (rows.length === 0) return notFound('not_found', 'worksheet not found');
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'worksheet', sourceId: String(wid),
      ip: req.headers.get('x-forwarded-for') ?? null,
    });
    await writeAudit({ userId: auth.user.id, event: 'worksheet_saved', metadata: { action: 'print', worksheetId: wid } });
    return NextResponse.json({ ok: true, data: { id: wid } });
  });
}
```

For the other 3:
- `app/api/poetry/[id]/print/route.ts`: same shape, `sourceType: 'poem'`, `sourceId: String(pid)`. No DB existence check (poems are public).
- `app/api/sutra/[slug]/print/route.ts`: same shape, `sourceType: 'sutra'`, `sourceId` is the body's `chunkId` (read JSON body to get `{ sourceId: 'slug#chunkId' }`).
- `app/api/rare-chars/[char]/print/route.ts`: same shape, `sourceType: 'rare-char-card'`, `sourceId: char`.

For the sutra route, the body parsing:
```ts
const body = await req.json().catch(() => ({}));
const sourceId = (body.sourceId as string) ?? ''; // expected: '{slug}#{chunkId}'
if (!sourceId.startsWith(`${slug}#`)) return badRequest('bad_sourceId', 'sourceId must start with slug#');
```

- [ ] **Step 2: Integration test (3 tests)**

Hit each of 4 routes with an authed user → row appears in downloads with the right source. Hit one route as anonymous → 401. Hit one route as disabled user → 403 account_disabled.

- [ ] **Step 3: Run test**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/integration/api/print-logging.test.ts 2>&1 | tail -20`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add app/api/worksheets/[id]/print app/api/poetry/[id]/print app/api/sutra/[slug]/print app/api/rare-chars/[char]/print tests/integration/api/print-logging.test.ts
git commit -m "feat(print): 4 print POST endpoints logging to downloads table"
```

---

### Task 14: Extend client API wrappers (lib/api-*.ts) for new routes

**Files:**
- Modify: `lib/api-admin.ts` — add wrappers for the 9 new admin routes
- Modify: `lib/api-worksheet.ts` — add `printWorksheetRequest`
- Modify: `lib/api-poetry.ts` — add `printPoemRequest`
- Modify: `lib/api-sutras.ts` — add `printSutraRequest`
- Modify: `lib/api-rare-chars.ts` — add `printRareCharRequest`

- [ ] **Step 1: Read an existing wrapper to match the pattern**

Open `lib/api-admin.ts` and find the existing `promoteUserRequest` function. Mirror that pattern exactly for the new admin wrappers.

- [ ] **Step 2: Add the new admin wrappers to lib/api-admin.ts**

Append:
```ts
export const disableUserRequest = (id: number) => postJson(`/api/admin/users/${id}/disable`, {});
export const enableUserRequest  = (id: number) => postJson(`/api/admin/users/${id}/enable`,  {});
export const getUserActivityRequest = (id: number, after?: string) => {
  const qs = after ? `?after=${encodeURIComponent(after)}` : '';
  return getJson(`/api/admin/users/${id}/activity${qs}`);
};
export const listAdminLogsRequest = (params: {
  type?: string; userId?: number; ip?: string; from?: string; to?: string;
  page?: number; pageSize?: number;
}) => getJson(`/api/admin/logs${buildQuery(params)}`);

export const listAdminDownloadsRequest = (params: {
  userId?: number; sourceType?: string; from?: string; to?: string; page?: number; pageSize?: number;
}) => getJson(`/api/admin/downloads${buildQuery(params)}`);
export const getDownloadStatsRequest = (days = 7) => getJson(`/api/admin/downloads/stats?days=${days}`);

export const listAiCallsRequest = (params: {
  feature?: string; status?: string; userId?: number; from?: string; to?: string; page?: number; pageSize?: number;
}) => getJson(`/api/admin/ai/calls${buildQuery(params)}`);
export const getAiStatsRequest = (days = 7) => getJson(`/api/admin/ai/stats?days=${days}`);
export const getAiConfigRequest = () => getJson('/api/admin/ai/config');
export const updateAiConfigRequest = (body: Record<string, string | number>) =>
  putJson('/api/admin/ai/config', body);

// (Adjust to the helper functions actually exported in your lib/api-admin.ts.
// If it uses a single `apiFetch` helper, route the calls through that. Match the
// surrounding style — don't introduce a new pattern.)
```

- [ ] **Step 3: Add 4 print wrappers**

Add `printWorksheetRequest(id)`, `printPoemRequest(id)`, `printSutraRequest(slug, chunkId)`, `printRareCharRequest(char)` to their respective files. Each is a thin `postJson` call to the corresponding print route.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add lib/api-admin.ts lib/api-worksheet.ts lib/api-poetry.ts lib/api-sutras.ts lib/api-rare-chars.ts
git commit -m "feat(api): client wrappers for new admin + print endpoints"
```

---

## Phase 3: Admin shell

### Task 15: AdminSidebar component + tests

**Files:**
- Create: `components/admin/AdminSidebar.tsx`
- Create: `tests/unit/components/admin/AdminSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/admin/AdminSidebar.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

describe('AdminSidebar', () => {
  it('renders 4 areas', () => {
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('highlights the active link', () => {
    render(<AdminSidebar currentPath="/admin/logs" />);
    const link = screen.getByText('日志').closest('a');
    expect(link).toHaveClass('bg-ink');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/admin/AdminSidebar.test.tsx 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AdminSidebar**

Create `components/admin/AdminSidebar.tsx`:
```tsx
'use client';
import Link from 'next/link';

const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
];

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  return (
    <nav className="flex md:flex-col gap-1 md:w-40 border-b md:border-b-0 md:border-r border-paper-warm md:min-h-[calc(100vh-4rem)] p-2">
      {ITEMS.map(item => {
        const isActive = item.exact ? currentPath === item.href : currentPath.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'px-3 py-2 rounded-md text-sm ' +
              (isActive ? 'bg-ink text-paper' : 'hover:bg-paper-warm text-ink')
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/admin/AdminSidebar.test.tsx 2>&1 | tail -20`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminSidebar.tsx tests/unit/components/admin/AdminSidebar.test.tsx
git commit -m "feat(admin): AdminSidebar with 5 areas + active highlight"
```

---

### Task 16: StatCard component + tests + wire AdminSidebar into app/admin/layout.tsx

**Files:**
- Create: `components/admin/StatCard.tsx`
- Create: `tests/unit/components/admin/StatCard.test.tsx`
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Write StatCard test**

`tests/unit/components/admin/StatCard.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '@/components/admin/StatCard';
import { Download } from 'lucide-react';

describe('StatCard', () => {
  it('renders label, value, and icon', () => {
    render(<StatCard label="下载 (7d)" value={42} icon={Download} href="/admin/downloads" />);
    expect(screen.getByText('下载 (7d)')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement StatCard**

`components/admin/StatCard.tsx`:
```tsx
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function StatCard({ label, value, icon: Icon, href }: {
  label: string; value: string | number; icon: LucideIcon; href?: string;
}) {
  const content = (
    <div className="rounded-lg border border-paper-warm bg-paper p-4 flex items-center gap-3 hover:bg-paper-warm transition-colors">
      <Icon className="h-6 w-6 text-seal shrink-0" />
      <div>
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-2xl font-serif text-ink">{value}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
```

- [ ] **Step 3: Wire AdminSidebar into app/admin/layout.tsx**

Open `app/admin/layout.tsx`. The existing layout already enforces `requireAdmin`. After that check (server component side), it currently renders children. Update it to also fetch the current pathname and render `<AdminSidebar currentPath={...} />` alongside `{children}` in a flex row.

The current path can be read via `headers()` (using `next/headers`'s `headers()` — get `x-invoke-path` or use `usePathname` in a client wrapper). Cleanest approach: extract a small client component `AdminShell` that uses `usePathname` and renders `AdminSidebar` + `children` slot.

Create `components/admin/AdminShell.tsx`:
```tsx
'use client';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './AdminSidebar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/admin';
  return (
    <div className="flex flex-col md:flex-row gap-4 max-w-7xl mx-auto p-4">
      <AdminSidebar currentPath={path} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
```

Then in `app/admin/layout.tsx`, replace the existing children wrapper with `<AdminShell>{children}</AdminShell>`.

- [ ] **Step 4: Run StatCard test + admin pages still render**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/admin/StatCard.test.tsx 2>&1 | tail -10`
Expected: 1 passed.

Then: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/StatCard.tsx components/admin/AdminShell.tsx app/admin/layout.tsx tests/unit/components/admin/StatCard.test.tsx
git commit -m "feat(admin): AdminShell + StatCard, wire sidebar into /admin layout"
```

---

### Task 17: UserMenu — add 后台管理 entry + tests

**Files:**
- Modify: `components/UserMenu.tsx`
- Create: `tests/unit/components/UserMenu.test.tsx` (or extend existing test if present)

- [ ] **Step 1: Read existing UserMenu.tsx and its test (if any)**

Locate `components/UserMenu.tsx` and find where the user dropdown items are rendered. Look for an `isAdmin` field already on the user state (the store likely has it from Plan B+).

- [ ] **Step 2: Add the admin entry**

Inside the user menu dropdown (where 个人中心 / 退出 are rendered), add:
```tsx
{user.isAdmin && (
  <Link
    href="/admin"
    className="block px-4 py-2 text-sm text-ink hover:bg-paper-warm"
  >
    <Shield className="inline h-4 w-4 mr-2" />
    后台管理
  </Link>
)}
```

Add `import { Shield } from 'lucide-react';` at the top.

- [ ] **Step 3: Add or update test**

If a UserMenu test exists, add a test that asserts the "后台管理" link is rendered when `user.isAdmin=true` and NOT rendered when `user.isAdmin=false`. If no test exists, create one with the same pattern (mock the store, render UserMenu, assert).

- [ ] **Step 4: Run test**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/UserMenu.test.tsx 2>&1 | tail -20`
Expected: passes (including any pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add components/UserMenu.tsx tests/unit/components/UserMenu.test.tsx
git commit -m "feat(header): UserMenu shows '后台管理' entry for admins"
```

---

## Phase 4: Pages

### Task 18: SourceBadge + JsonPanel components + tests, enrich /admin dashboard with 4 stat cards

**Files:**
- Create: `components/admin/SourceBadge.tsx`
- Create: `tests/unit/components/admin/SourceBadge.test.tsx`
- Create: `components/admin/JsonPanel.tsx`
- Modify: `app/admin/page.tsx` (add 4 stat cards)
- Create: `app/api/admin/stats/route.ts` (or extend existing)

- [ ] **Step 1: Write SourceBadge test**

`tests/unit/components/admin/SourceBadge.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SourceBadge } from '@/components/admin/SourceBadge';

describe('SourceBadge', () => {
  it('renders the source label', () => {
    render(<SourceBadge source="audit" />);
    expect(screen.getByText('audit')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement SourceBadge**

`components/admin/SourceBadge.tsx`:
```tsx
const COLORS: Record<string, string> = {
  audit: 'bg-ink/10 text-ink',
  download: 'bg-scroll/20 text-ink',
  ai_call: 'bg-seal/10 text-seal',
};
export function SourceBadge({ source }: { source: 'audit' | 'download' | 'ai_call' }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${COLORS[source]}`}>{source}</span>;
}
```

- [ ] **Step 3: Implement JsonPanel**

`components/admin/JsonPanel.tsx` (client component with collapse toggle):
```tsx
'use client';
import { useState } from 'react';
export function JsonPanel({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button className="text-seal hover:underline" onClick={() => setOpen(o => !o)}>
        {open ? '收起' : '查看'} JSON
      </button>
      {open && <pre className="mt-2 p-2 bg-paper-warm rounded overflow-auto">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
```

- [ ] **Step 4: Extend the /admin/stats route to also return the 4 KPI numbers**

Look at the existing `app/api/admin/stats/route.ts` (from Plan B+). If it already returns `totalUsers`, `totalHistory`, etc., add 4 new fields: `downloads7d` (call `getDownloadStats(7)`), `aiCalls7d`, `aiErrorRate7d` (call `getAiStats(7)`), `disabledUsersCount` (a new tiny query: `SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL`).

If the route doesn't exist or has a different shape, create the simple `GET /api/admin/stats` route that returns:
```ts
{
  totalUsers, totalHistory, totalFavorites,
  downloads7d, aiCalls7d, aiErrorRate7d, disabledUsersCount
}
```

(Reuse whatever `lib/admin.ts` already provides for the user counts; add the new ones.)

- [ ] **Step 5: Enrich app/admin/page.tsx**

Open `app/admin/page.tsx` (existing dashboard from Plan B+). Add 4 `<StatCard>` instances in a grid above the existing content, passing the new stats values and `href`s to `/admin/downloads`, `/admin/ai`, `/admin/ai?status=error`, `/admin/users?disabled=true`. Use lucide icons `Download`, `Bot`, `AlertTriangle`, `UserX`.

- [ ] **Step 6: Run tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/admin/SourceBadge.test.tsx 2>&1 | tail -10`
Expected: 1 passed.

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add components/admin/SourceBadge.tsx components/admin/JsonPanel.tsx app/admin/page.tsx app/api/admin/stats tests/unit/components/admin/SourceBadge.test.tsx
git commit -m "feat(admin): SourceBadge + JsonPanel; /admin dashboard with 4 stat cards"
```

---

### Task 19: LogRow component + tests; enrich /admin/users (filter chips + action buttons)

**Files:**
- Create: `components/admin/LogRow.tsx`
- Create: `tests/unit/components/admin/LogRow.test.tsx`
- Modify: `app/admin/users/page.tsx`

- [ ] **Step 1: Write LogRow test (2 tests)**

`tests/unit/components/admin/LogRow.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LogRow } from '@/components/admin/LogRow';
import type { UnifiedLogEntry } from '@/lib/admin-logs';

const baseEntry: UnifiedLogEntry = {
  id: 'audit:1', source: 'audit', event: 'login', userId: 7, username: 'alice',
  ip: '127.0.0.1', createdAt: '2026-06-12T10:00:00Z', metadata: {},
};

describe('LogRow', () => {
  it('renders the event and username', () => {
    render(<LogRow entry={baseEntry} />);
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('shows the source badge', () => {
    render(<LogRow entry={{ ...baseEntry, source: 'download' }} />);
    expect(screen.getByText('download')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement LogRow**

`components/admin/LogRow.tsx`:
```tsx
import Link from 'next/link';
import { SourceBadge } from './SourceBadge';
import type { UnifiedLogEntry } from '@/lib/admin-logs';

export function LogRow({ entry, onClick }: {
  entry: UnifiedLogEntry;
  onClick?: (entry: UnifiedLogEntry) => void;
}) {
  return (
    <tr className="border-b border-paper-warm hover:bg-paper-warm/50 cursor-pointer" onClick={() => onClick?.(entry)}>
      <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(entry.createdAt).toLocaleString('zh-CN')}</td>
      <td className="px-3 py-2"><SourceBadge source={entry.source} /></td>
      <td className="px-3 py-2 text-sm">{entry.event}</td>
      <td className="px-3 py-2 text-sm">
        {entry.username ? <Link href={`/admin/users/${entry.userId}`} className="text-seal hover:underline">{entry.username}</Link> : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-ink-soft max-w-xs truncate">{JSON.stringify(entry.metadata)}</td>
    </tr>
  );
}
```

- [ ] **Step 3: Enrich /admin/users page**

Open `app/admin/users/page.tsx` (existing Plan B+ page). The current implementation likely lists users in a table with promote/demote actions. Add:

1. **Filter chips at the top**: 3 buttons "全部" / "管理员" / "禁用" — when clicked, the page reloads with `?adminOnly=1` or `?disabled=1` query params. Server component reads these and passes to `listUsers()`.
2. **Per-row action buttons**: 禁用 / 启用 (toggle based on `disabledAt`), 重置密码 (existing), 提升/降级 (existing). Wrap the destructive actions in a confirm modal (use a tiny client component `ConfirmButton` that wraps a button + dialog — see how `components/admin/ConfirmButton.tsx` should be created if not already present, or use a simple `confirm()` window call to keep the scope small).
3. **Username cell clickable** → `/admin/users/[id]`.

- [ ] **Step 4: Run tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/admin/LogRow.test.tsx 2>&1 | tail -10`
Expected: 2 passed.

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/LogRow.tsx app/admin/users/page.tsx tests/unit/components/admin/LogRow.test.tsx
git commit -m "feat(admin): LogRow + /admin/users filter chips + disable/enable actions"
```

---

### Task 20: Enrich /admin/users/[id] with activity tab + disable UI

**Files:**
- Modify: `app/admin/users/[id]/page.tsx`

(No new test — this is mostly composing existing pieces.)

- [ ] **Step 1: Read existing /admin/users/[id]/page.tsx**

Note the existing structure (server component, fetches user + maybe history count).

- [ ] **Step 2: Add activity tab**

Convert the page (or add a child client component) to include a tabbed view: "详情" (existing) + "活动" (new). The 活动 tab shows a table of `LogRow` entries, fetched server-side from `getUserActivityRequest(userId)` (or call the lib function directly). Add a "加载更多" button that calls `?after=<lastCreatedAt>` and appends.

- [ ] **Step 3: Add 禁用 / 启用 button + disabled banner**

At the top of the page, if `user.disabledAt`, show a red banner: "此账号已被禁用 (since {disabledAt})". Below the banner (or in the action area), add a "禁用账号" / "启用账号" button that calls the new POST route. Reuse the confirm-modal pattern from Task 19.

- [ ] **Step 4: TypeScript check + manual page render check**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/users/[id]/page.tsx
git commit -m "feat(admin): /admin/users/[id] activity tab + disable UI"
```

---

### Task 21: Build /admin/logs page

**Files:**
- Create: `app/admin/logs/page.tsx`

- [ ] **Step 1: Create the page**

This page is a client component (lots of filter state). It needs:
- A filter bar (use lucide icons next to inputs): event type dropdown (with the 13 known event types from the spec), user ID input, IP input, date range (default = last 7 days), free-text search.
- A results table using `<LogRow>`.
- Pagination controls at the bottom.
- Row click → side panel (or modal) with `<JsonPanel>` for the metadata.

Use the existing `listAdminLogsRequest` wrapper from Task 14. Fetch initial results server-side (read `searchParams` in a server-component wrapper, call the lib function, pass to a client child component that owns the filter state).

For simplicity, do it all as a client component that uses `'use client'` and reads `useSearchParams` + a `useEffect` fetch on filter change. The wrapper server component is not required for correctness here.

- [ ] **Step 2: Manual visual check**

After the page is built: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm dev` and visit http://localhost:4444/admin/logs. Verify:
- The 4 default filters render
- The table shows rows after a few seconds
- Row click opens a side panel with JSON

(Don't run automated tests for this — the page is mostly composition.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/logs/page.tsx
git commit -m "feat(admin): /admin/logs unified log viewer page"
```

---

### Task 22: Build /admin/downloads page

**Files:**
- Create: `app/admin/downloads/page.tsx`

- [ ] **Step 1: Create the page**

Same pattern as /admin/logs but simpler:
- 4 stat cards at top (total today, total 7d, top user 7d, top source 7d) — use `<StatCard>` with the data from `getDownloadStatsRequest(7)` and `listAdminDownloadsRequest({ pageSize: 0 })` for the "today" count.
- Filter bar: source type dropdown, user search, date range.
- Table: timestamp, user (link), source type badge (use `<SourceBadge>` for the sourceType), format badge, status badge, duration, source_id. Row click navigates to the source page (e.g. `/worksheet/{id}`, `/poetry/{id}`, `/sutra/{slug}`, `/rare-chars/{char}`).

- [ ] **Step 2: Manual visual check**

Same as Task 21: visit `/admin/downloads`, verify rendering.

- [ ] **Step 3: Commit**

```bash
git add app/admin/downloads/page.tsx
git commit -m "feat(admin): /admin/downloads page with stats + filters + table"
```

---

### Task 23: Build /admin/ai page (calls tab + config tab)

**Files:**
- Create: `app/admin/ai/page.tsx`

- [ ] **Step 1: Create the page**

Two-tab layout:
- **调用记录** (default): 3 stat cards (calls 7d, error rate 7d, p95 duration 7d), filter bar (feature, status, user, date), table (timestamp, user, feature, model, status badge, duration, short error).
- **配置**: form with the 4 AI config fields (model, rate_limit_per_user_per_day, timeout_ms, temperature). Save button shows a confirm modal listing what's changing. On save → `updateAiConfigRequest(...)`.

Use existing components: `<StatCard>`, `<SourceBadge>` doesn't fit here (AI rows are ai_call source only). Create a small inline `StatusBadge` for `ok` / `error` / `rate-limited` (or reuse `<SourceBadge>` with a tweak).

- [ ] **Step 2: Manual visual check**

Visit `/admin/ai`, verify both tabs render. Try changing the model and saving — should reload the form with the new value.

- [ ] **Step 3: Commit**

```bash
git add app/admin/ai/page.tsx
git commit -m "feat(admin): /admin/ai page with calls + config tabs"
```

---

## Phase 5: Wiring

### Task 24: PrintButton component + tests

**Files:**
- Create: `components/common/PrintButton.tsx`
- Create: `tests/unit/components/common/PrintButton.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/components/common/PrintButton.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrintButton } from '@/components/common/PrintButton';

describe('PrintButton', () => {
  beforeEach(() => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { id: 1 } }) });
    (global as any).window.print = vi.fn();
  });

  it('calls the endpoint and window.print on click', async () => {
    render(<PrintButton endpoint="/api/poetry/1/print" label="打印" />);
    fireEvent.click(screen.getByText('打印'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/poetry/1/print', { method: 'POST' }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/common/PrintButton.test.tsx 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PrintButton**

`components/common/PrintButton.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Printer } from 'lucide-react';

export function PrintButton({ endpoint, label = '打印', sourceId }: {
  endpoint: string; label?: string; sourceId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message ?? 'print failed');
      window.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-ink/20 bg-paper px-4 py-2 text-sm text-ink hover:bg-paper-warm disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Printer className="h-4 w-4" />
        {busy ? '准备中…' : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/common/PrintButton.test.tsx 2>&1 | tail -10`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add components/common/PrintButton.tsx tests/unit/components/common/PrintButton.test.tsx
git commit -m "feat(common): PrintButton with fail-soft error + window.print call"
```

---

### Task 25: Wire 4 print entry points into existing pages

**Files:**
- Modify: `app/worksheet/[id]/page.tsx`
- Modify: `app/worksheet/page.tsx`
- Modify: `app/poetry/[id]/page.tsx`
- Modify: `app/sutra/[id]/page.tsx`
- Modify: `app/rare-chars/[char]/page.tsx`

- [ ] **Step 1: Read each target page**

For each of the 5 files above, find where the action buttons are rendered (next to "保存到字帖" / "保存" / "生成字帖" / etc.) and note the existing layout.

- [ ] **Step 2: Add PrintButton to each**

- `app/worksheet/[id]/page.tsx` — add `<PrintButton endpoint={`/api/worksheets/${id}/print`} />` next to the existing "返回" button.
- `app/worksheet/page.tsx` — add `<PrintButton endpoint={`/api/worksheets/${worksheetId}/print`} />` to the preview toolbar (only shown if a worksheet was just generated/saved).
- `app/poetry/[id]/page.tsx` — add `<PrintButton endpoint={`/api/poetry/${id}/print`} />` next to `<SaveAsWorksheetButton>`.
- `app/sutra/[id]/page.tsx` — add `<PrintButton endpoint={`/api/sutra/${slug}/print`} sourceId={`${slug}#${chunkId}`} />` next to `<SaveAsWorksheetButton>` (chunkId from the chunk picker state).
- `app/rare-chars/[char]/page.tsx` — add `<PrintButton endpoint={`/api/rare-chars/${char}/print`} />` in the detail header.

- [ ] **Step 3: Verify TypeScript + smoke test the dev server**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

Then start dev: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm dev` (port 4444) and visit each page to confirm the button renders. Don't actually click (the integration tests in Task 13 already verified the endpoint).

- [ ] **Step 4: Commit**

```bash
git add app/worksheet/[id]/page.tsx app/worksheet/page.tsx app/poetry/[id]/page.tsx app/sutra/[id]/page.tsx app/rare-chars/[char]/page.tsx
git commit -m "feat(print): wire PrintButton into 5 detail pages"
```

---

### Task 26: Wrap ai-rare-chars with withAiLogging

**Files:**
- Modify: `lib/ai-rare-chars.ts`

- [ ] **Step 1: Read lib/ai-rare-chars.ts**

Note the existing function `generateStory(char, meaning, userId)`. Look at how the LLM call works (probably uses `lib/llm.ts`).

- [ ] **Step 2: Wrap with withAiLogging + read model from app_config**

```ts
import { withAiLogging, RateLimitError, checkAiRateLimit } from './ai-calls';
import { getConfig } from './config';

export async function generateStory(char: string, meaning: string, userId: number | null) {
  return withAiLogging(
    { userId, feature: 'rare-char-story', metadata: { char, meaning_len: meaning.length } },
    async () => {
      const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';
      if (userId !== null && !(await checkAiRateLimit(userId))) {
        throw new RateLimitError();
      }
      // existing LLM call using `model`
      return await callLlmWithModel(model, char, meaning);
    },
  );
}
```

(If the existing function has a different signature, adapt the wrapping — the key requirement is that the LLM call is enclosed in `withAiLogging`'s `fn` and that the model value is read from app_config rather than hardcoded.)

- [ ] **Step 3: Verify the existing ai-rare-chars tests still pass**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/ai-rare-chars.test.ts 2>&1 | tail -10`
Expected: All pre-existing tests pass.

Then: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-rare-chars.ts
git commit -m "feat(ai): wrap generateStory with withAiLogging + read model from app_config"
```

---

## Phase 6: Smoke + docs

### Task 27: README + .env.example updates

**Files:**
- Modify: `README.md` — add a section documenting new admin pages and 4 print endpoints
- Modify: `.env.example` — no new env vars needed (AI config is in DB now), but add a comment about app_config

- [ ] **Step 1: Add admin section to README**

Find the existing admin section in `README.md` (Plan B+ added one). Append the new endpoints and pages:

```markdown
## Admin platform

In addition to the Plan B+ admin (users, audit, stats), the platform now includes:

- **/admin/logs** — unified log viewer (audit + downloads + AI calls, filterable)
- **/admin/downloads** — user-generated download history (worksheet/poem/sutra/rare-char prints)
- **/admin/ai** — AI call log + editable config (model, rate limit, timeout, temperature)

Admin-only API routes (require `is_admin=1`):
- `POST /api/admin/users/[id]/disable` — soft-disable a user
- `POST /api/admin/users/[id]/enable` — re-enable
- `GET  /api/admin/users/[id]/activity` — last 100 events for a user
- `GET  /api/admin/logs?type=&userId=&ip=&from=&to=` — unified log query
- `GET  /api/admin/downloads?userId=&sourceType=` — download history
- `GET  /api/admin/downloads/stats?days=7` — aggregates
- `GET  /api/admin/ai/calls?feature=&status=&userId=` — AI call log
- `GET  /api/admin/ai/stats?days=7` — aggregates
- `GET  /api/admin/ai/config` — current AI config
- `PUT  /api/admin/ai/config` — update AI config (validates each value)

User-facing print logging endpoints:
- `POST /api/worksheets/[id]/print`
- `POST /api/poetry/[id]/print`
- `POST /api/sutra/[slug]/print` — body: `{ sourceId: "{slug}#{chunkId}" }`
- `POST /api/rare-chars/[char]/print`
```

- [ ] **Step 2: Add note to .env.example**

Open `.env.example`. If there's a section about AI / LLM config, add a comment:
```
# Plan H moved AI config (model, rate limit, timeout, temperature) into the
# `app_config` table, editable at /admin/ai (Config tab). No env vars needed
# for these — the DB is the source of truth. ANTHROPIC_API_KEY / OPENAI_API_KEY
# (whichever your lib/llm.ts uses) is still required.
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: README + .env.example updated for Plan H admin expansion"
```

---

### Task 28: Final code review + human manual smoke

**Files:**
- (no code changes — review only)

- [ ] **Step 1: Run full test suite + typecheck + build**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm test 2>&1 | tail -10 && pnpm tsc --noEmit 2>&1 | head -20 && pnpm build 2>&1 | tail -10`
Expected: all tests pass, no TS errors, build succeeds.

- [ ] **Step 2: Final cross-cutting code review (yourself or dispatch a subagent)**

Verify:
- All 4 new admin pages render and link to each other
- All 9 new admin API routes enforce `requireAdmin`
- All 4 print endpoints enforce `requireUser` (not admin)
- `lib/downloads.ts:logDownload` and `lib/ai-calls.ts:logAiCall` are fail-soft (try/catch, never throw)
- `users.disabled_at` is checked in `getCurrentUser` and the login route
- `lib/audit.ts` AuditEvent union includes the 3 new events
- `lib/ai-rare-chars.ts:generateStory` is wrapped in `withAiLogging`
- No new env vars were introduced

- [ ] **Step 3: Commit any cleanup**

If the review surfaces issues (unused imports, dead code, comment fixes), commit them in one cleanup commit:
```bash
git add -A
git commit -m "chore(plan-h): code review cleanups"
```

- [ ] **Step 4: Human manual smoke (12 steps)**

Run `pnpm dev` and walk through the spec's section 9.4 checklist. Document any failures and fix them before marking the plan done.

---

## Verification (whole plan)

After all 28 tasks complete:

- `pnpm test` — all unit + integration tests pass
- `pnpm tsc --noEmit` — no errors
- `pnpm build` — succeeds
- `pnpm dev` — dev server runs on port 4444 (per `package.json`)
- Human browser smoke (Task 28 step 4) — 12-step checklist passes
- Spec section 9.4 checklist — 12 items green

## Out-of-scope reminders

- PDF generation (only `print` events are logged; `format='pdf'` is reserved for the future)
- AI cost tracking (token counts captured if the LLM client reports them, but no cost rollup)
- Bulk admin actions
- Alerting (webhook / email on log anomalies)
- Moderator role or permission matrix
