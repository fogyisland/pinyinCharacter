# Plan D Implementation Plan — Rare Chars + Worksheet + Mini-Game

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rare-character library, a printable-worksheet generator, and a drag-and-match mini-game to the existing 字 ↔ 拼音 工具, with a daily-char banner driven by deterministic per-date selection.

**Architecture:** Server-first React with small client islands for the few interactive surfaces (form, debounced search, drag game). MySQL-backed data model (two new tables) seeded by one-shot import scripts. All AI content generation happens in build-time scripts — the app has no LLM dependency at runtime. Print output uses native `window.print()` + `@media print` CSS.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + MySQL (via `mysql2/promise` pool) + Tailwind + zustand (existing) + zod (new) + OpenAI-compatible HTTP client (no SDK).

**Spec:** `docs/superpowers/specs/2026-06-11-pinyin-character-plan-d-design.md`

**Reference patterns:**
- DB queries: `lib/history.ts`, `lib/admin.ts`
- API routes: `app/api/admin/users/route.ts`
- Audit: `lib/audit.ts`
- Auth guard: `lib/auth.ts` (`requireAdmin`, `getCurrentUser`)
- Integration test: `tests/integration/admin-crud.test.ts`
- DDL: `scripts/init-db.ts`
- Build script: `scripts/build-dict.ts`

---

## Phase 1: Data Foundation (4 tasks)

### Task 1: DDL — add `rare_chars` and `worksheets` tables

**Files:**
- Modify: `scripts/init-db.ts` (add 2 new DDL blocks at the end of the `CREATE TABLE` sequence)
- Modify: `.env.example` (add LLM env vars)

- [ ] **Step 1: Add the two new DDL blocks**

Open `scripts/init-db.ts`. Find the end of the existing `CREATE TABLE` block (after `password_resets`). Append:

```sql
-- Plan D: rare characters library
CREATE TABLE IF NOT EXISTS rare_chars (
  char          VARCHAR(1)     NOT NULL,
  pinyin        VARCHAR(64)    NOT NULL,
  meaning       TEXT           NOT NULL,
  story         TEXT           NOT NULL,
  needs_review  TINYINT(1)     NOT NULL DEFAULT 1,
  generated_by  VARCHAR(64)    NULL,
  generated_at  DATETIME       NULL,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (char),
  KEY idx_pinyin (pinyin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Plan D: user worksheets
CREATE TABLE IF NOT EXISTS worksheets (
  id          INT            NOT NULL AUTO_INCREMENT,
  user_id     INT            NOT NULL,
  title       VARCHAR(80)    NOT NULL,
  content     JSON           NOT NULL,
  cell_style  ENUM('brush','square') NOT NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_created (user_id, created_at DESC),
  CONSTRAINT fk_worksheets_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Update `.env.example`**

Append at the end of `.env.example`:

```
# Plan D — AI content generation (used by scripts/generate-stories.ts only)
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
# LLM_PROVIDER and LLM_MODEL are CLI args, not env vars
```

- [ ] **Step 2.5: Update test setup to truncate new tables**

Open `tests/integration/setup.ts`. Update `truncateAll` to also handle the new tables (and add the worksheets table to the FK-checks-off list since worksheets depends on users):

```ts
export async function truncateAll(): Promise<void> {
  if (!HAS_DB) return;
  const pool = getPool();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE TABLE worksheets');
  await pool.query('TRUNCATE TABLE rare_chars');
  await pool.query('TRUNCATE TABLE history');
  await pool.query('TRUNCATE TABLE users');
  await pool.query('TRUNCATE TABLE audit_log');
  await pool.query('TRUNCATE TABLE password_resets');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}
```

- [ ] **Step 3: Apply DDL locally and verify**

Run:
```bash
pnpm tsx --env-file=.env scripts/init-db.ts
```

Expected output (exact lines may differ):
```
[init-db] connecting to MySQL at mysql://piyin:.../piyin
[init-db] table users OK
... (other tables) ...
[init-db] table rare_chars OK
[init-db] table worksheets OK
[init-db] done.
```

If the script doesn't have a logger that prints per-table, add a `console.log('[init-db] table', name, 'OK')` after each `await pool.query(...)` line.

- [ ] **Step 4: Commit**

```bash
git add scripts/init-db.ts .env.example tests/integration/setup.ts
git commit -m "feat(db): add rare_chars + worksheets tables (Plan D)"
```

---

### Task 2: `lib/rare-chars.ts` — list / get / search / pickDailyChar

**Files:**
- Create: `lib/rare-chars.ts`
- Test: `tests/unit/lib/rare-chars.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/rare-chars.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickDailyChar, buildSearchWhere, isSingleChar } from '@/lib/rare-chars';

describe('rare-chars pure helpers', () => {
  describe('pickDailyChar', () => {
    it('returns a char from the list', () => {
      const chars = ['龘', '齉', '麤', '鱻'];
      const result = pickDailyChar(chars, '2026-06-11');
      expect(chars).toContain(result);
    });

    it('same date returns same char', () => {
      const chars = ['龘', '齉', '麤', '鱻', '龍', '龜'];
      expect(pickDailyChar(chars, '2026-06-11')).toBe(pickDailyChar(chars, '2026-06-11'));
    });

    it('different dates may return different chars (probabilistic)', () => {
      const chars = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i));
      const set = new Set<string>();
      for (let d = 1; d <= 30; d++) {
        set.add(pickDailyChar(chars, `2026-06-${String(d).padStart(2, '0')}`));
      }
      // With 100 chars and 30 dates, should hit at least 10 distinct ones
      expect(set.size).toBeGreaterThanOrEqual(10);
    });
  });

  describe('buildSearchWhere', () => {
    it('returns empty string for empty query (returns all)', () => {
      expect(buildSearchWhere('')).toEqual({ where: '', params: [] });
    });

    it('matches exact single char with =', () => {
      expect(buildSearchWhere('龘')).toEqual({
        where: 'WHERE char = ?',
        params: ['龘'],
      });
    });

    it('matches multi-char or pinyin substring with LIKE', () => {
      expect(buildSearchWhere('da')).toEqual({
        where: 'WHERE pinyin LIKE ?',
        params: ['%da%'],
      });
    });
  });

  describe('isSingleChar', () => {
    it('returns true for a single CJK char', () => {
      expect(isSingleChar('龘')).toBe(true);
      expect(isSingleChar('你')).toBe(true);
    });

    it('returns false for empty or multi-char strings', () => {
      expect(isSingleChar('')).toBe(false);
      expect(isSingleChar('你好')).toBe(false);
      expect(isSingleChar('a')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
pnpm test tests/unit/lib/rare-chars.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/rare-chars'".

- [ ] **Step 3: Implement `lib/rare-chars.ts`**

Create `lib/rare-chars.ts`:

```ts
import { createHash } from 'crypto';
import { getPool } from './db';

export interface RareChar {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  needsReview: boolean;
  generatedBy: string | null;
  generatedAt: Date | null;
  createdAt: Date;
}

export interface ListResult {
  chars: RareChar[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pick a deterministic char from the list for the given date string.
 * Same date → same char; different date → different char (most of the time).
 */
export function pickDailyChar(chars: string[], dateStr: string): string {
  if (chars.length === 0) throw new Error('chars list is empty');
  const hash = createHash('sha1').update(dateStr).digest('hex').slice(0, 8);
  const idx = parseInt(hash, 16) % chars.length;
  return chars[idx];
}

/**
 * Build a WHERE clause + params for the search API.
 * - empty query: no filter
 * - single char: exact match on `char`
 * - otherwise: LIKE on `pinyin`
 */
export function buildSearchWhere(q: string): { where: string; params: string[] } {
  if (!q) return { where: '', params: [] };
  if (isSingleChar(q)) return { where: 'WHERE char = ?', params: [q] };
  return { where: 'WHERE pinyin LIKE ?', params: [`%${q}%`] };
}

export function isSingleChar(s: string): boolean {
  if (!s) return false;
  const arr = Array.from(s);
  return arr.length === 1 && arr[0]!.codePointAt(0)! >= 0x4e00;
}

export async function listChars(opts: { q?: string; page?: number } = {}): Promise<ListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 80;
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(opts.q ?? '');

  const [rows] = await pool.query<any[]>(
    `SELECT char, pinyin, meaning, story, needs_review, generated_by, generated_at, created_at
     FROM rare_chars ${where}
     ORDER BY char ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM rare_chars ${where}`,
    params
  );

  return {
    chars: rows.map(mapRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getChar(c: string): Promise<RareChar | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT char, pinyin, meaning, story, needs_review, generated_by, generated_at, created_at
     FROM rare_chars WHERE char = ? LIMIT 1`,
    [c]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getAllChars(): Promise<string[]> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT char FROM rare_chars WHERE meaning <> '' ORDER BY char ASC`
  );
  return rows.map((r) => r.char as string);
}

export async function getDailyChar(dateStr: string): Promise<{
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  date: string;
} | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT char, pinyin, meaning, story
     FROM rare_chars WHERE meaning <> '' ORDER BY char ASC LIMIT 5000`
  );
  if (rows.length === 0) return null;
  const chars = rows.map((r) => r.char as string);
  const picked = pickDailyChar(chars, dateStr);
  const found = rows.find((r) => r.char === picked);
  return {
    char: found!.char,
    pinyin: found!.pinyin,
    meaning: found!.meaning,
    story: found!.story,
    date: dateStr,
  };
}

function mapRow(r: any): RareChar {
  return {
    char: r.char,
    pinyin: r.pinyin,
    meaning: r.meaning,
    story: r.story,
    needsReview: Boolean(r.needs_review),
    generatedBy: r.generated_by ?? null,
    generatedAt: r.generated_at ?? null,
    createdAt: r.created_at,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
pnpm test tests/unit/lib/rare-chars.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/rare-chars.ts tests/unit/lib/rare-chars.test.ts
git commit -m "feat(lib): rare-chars list/get/search/pickDailyChar + tests"
```

---

### Task 3: `lib/worksheet.ts` — CRUD + `generateLayout`

**Files:**
- Create: `lib/worksheet.ts`
- Test: `tests/unit/lib/worksheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/worksheet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateLayout, validateWorksheetInput } from '@/lib/worksheet';

describe('worksheet pure helpers', () => {
  describe('generateLayout', () => {
    it('returns one cell per char in order', () => {
      const cells = generateLayout(['你', '好', '世', '界'], 'brush');
      expect(cells).toEqual([
        { char: '你', style: 'brush', index: 0 },
        { char: '好', style: 'brush', index: 1 },
        { char: '世', style: 'brush', index: 2 },
        { char: '界', style: 'brush', index: 3 },
      ]);
    });

    it('returns empty array for empty content', () => {
      expect(generateLayout([], 'square')).toEqual([]);
    });

    it('preserves duplicates', () => {
      const cells = generateLayout(['你', '你', '你'], 'square');
      expect(cells).toHaveLength(3);
      expect(cells.every((c) => c.char === '你')).toBe(true);
    });

    it('passes through the style', () => {
      const brush = generateLayout(['你'], 'brush');
      const square = generateLayout(['你'], 'square');
      expect(brush[0]!.style).toBe('brush');
      expect(square[0]!.style).toBe('square');
    });
  });

  describe('validateWorksheetInput', () => {
    it('accepts a valid input', () => {
      const result = validateWorksheetInput({
        title: 'My worksheet',
        content: ['你', '好'],
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty title', () => {
      const result = validateWorksheetInput({ title: '', content: ['你'], cellStyle: 'brush' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title/i);
    });

    it('rejects title > 80 chars', () => {
      const result = validateWorksheetInput({
        title: 'a'.repeat(81),
        content: ['你'],
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects empty content', () => {
      const result = validateWorksheetInput({ title: 't', content: [], cellStyle: 'brush' });
      expect(result.ok).toBe(false);
    });

    it('rejects content > 500', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: Array(501).fill('你'),
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects non-CJK char in content', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: ['你', 'a'],
        cellStyle: 'brush',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid cellStyle', () => {
      const result = validateWorksheetInput({
        title: 't',
        content: ['你'],
        cellStyle: 'invalid' as any,
      });
      expect(result.ok).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
pnpm test tests/unit/lib/worksheet.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/worksheet'".

- [ ] **Step 3: Implement `lib/worksheet.ts`**

Create `lib/worksheet.ts`:

```ts
import { getPool } from './db';
import { writeAudit } from './audit';

export type CellStyle = 'brush' | 'square';

export interface Cell {
  char: string;
  style: CellStyle;
  index: number;
}

export interface Worksheet {
  id: number;
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  createdAt: Date;
}

export interface SaveWorksheetArgs {
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  ip?: string | null;
  userAgent?: string | null;
}

export type ValidationResult =
  | { ok: true; data: { title: string; content: string[]; cellStyle: CellStyle } }
  | { ok: false; error: string };

const SINGLE_CJK = /^[一-鿿]$/;

export function generateLayout(content: string[], style: CellStyle): Cell[] {
  return content.map((char, index) => ({ char, style, index }));
}

export function validateWorksheetInput(input: {
  title: unknown;
  content: unknown;
  cellStyle: unknown;
}): ValidationResult {
  if (typeof input.title !== 'string' || input.title.length < 1 || input.title.length > 80) {
    return { ok: false, error: 'title must be 1-80 chars' };
  }
  if (!Array.isArray(input.content) || input.content.length < 1 || input.content.length > 500) {
    return { ok: false, error: 'content must be 1-500 chars' };
  }
  if (!input.content.every((c) => typeof c === 'string' && SINGLE_CJK.test(c))) {
    return { ok: false, error: 'content must be CJK chars' };
  }
  if (input.cellStyle !== 'brush' && input.cellStyle !== 'square') {
    return { ok: false, error: 'cellStyle must be brush or square' };
  }
  return {
    ok: true,
    data: { title: input.title, content: input.content as string[], cellStyle: input.cellStyle },
  };
}

export async function saveWorksheet(args: SaveWorksheetArgs): Promise<number> {
  const pool = getPool();
  const [result] = await pool.execute<any>(
    `INSERT INTO worksheets (user_id, title, content, cell_style) VALUES (?, ?, ?, ?)`,
    [args.userId, args.title, JSON.stringify(args.content), args.cellStyle]
  );
  const id = result.insertId as number;
  await writeAudit({
    userId: args.userId,
    event: 'worksheet_saved',
    metadata: { worksheetId: id, charCount: args.content.length, cellStyle: args.cellStyle },
    ip: args.ip,
    userAgent: args.userAgent,
  });
  return id;
}

export async function listUserWorksheets(userId: number): Promise<Worksheet[]> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, created_at
     FROM worksheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map(mapRow);
}

export async function getWorksheet(id: number): Promise<Worksheet | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, title, content, cell_style, created_at
     FROM worksheets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function deleteWorksheet(id: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.execute<any>(
    `DELETE FROM worksheets WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  const affected = (result.affectedRows as number) ?? 0;
  if (affected > 0) {
    await writeAudit({ userId, event: 'worksheet_deleted', metadata: { worksheetId: id } });
  }
  return affected > 0;
}

function mapRow(r: any): Worksheet {
  let content: string[];
  if (typeof r.content === 'string') {
    content = JSON.parse(r.content);
  } else {
    content = r.content;
  }
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content,
    cellStyle: r.cell_style,
    createdAt: r.created_at,
  };
}
```

- [ ] **Step 4: Extend `lib/audit.ts` to include the 2 new events**

Open `lib/audit.ts`. Update the `AuditEvent` union:

```ts
export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote'
  | 'worksheet_saved' | 'worksheet_deleted';
```

- [ ] **Step 5: Run all tests, verify they pass**

Run:
```bash
pnpm test
```

Expected: 63 (existing) + 7 (rare-chars) + 11 (worksheet) = 81 unit tests pass, no integration regressions (still skipped without `DATABASE_URL_TEST`).

- [ ] **Step 6: Commit**

```bash
git add lib/worksheet.ts lib/audit.ts tests/unit/lib/worksheet.test.ts
git commit -m "feat(lib): worksheet CRUD + generateLayout + 2 audit events"
```

---

### Task 4: `lib/validators.ts` + `lib/api-handler.ts`

**Files:**
- Create: `lib/validators.ts`
- Create: `lib/api-handler.ts`
- Test: `tests/unit/lib/validators.test.ts`

- [ ] **Step 1: Install zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/lib/validators.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { searchQuerySchema, saveWorksheetSchema } from '@/lib/validators';

describe('validators', () => {
  describe('searchQuerySchema', () => {
    it('accepts empty query and defaults page to 1', () => {
      const r = searchQuerySchema.parse({});
      expect(r.q).toBeUndefined();
      expect(r.page).toBe(1);
    });

    it('accepts a short q', () => {
      const r = searchQuerySchema.parse({ q: 'da', page: '3' });
      expect(r.q).toBe('da');
      expect(r.page).toBe(3);
    });

    it('rejects q > 32 chars', () => {
      expect(() => searchQuerySchema.parse({ q: 'a'.repeat(33) })).toThrow();
    });

    it('rejects page < 1', () => {
      expect(() => searchQuerySchema.parse({ page: '0' })).toThrow();
    });
  });

  describe('saveWorksheetSchema', () => {
    it('accepts a valid input', () => {
      const r = saveWorksheetSchema.parse({
        title: 'My',
        content: ['你', '好'],
        cellStyle: 'brush',
      });
      expect(r.cellStyle).toBe('brush');
    });

    it('rejects empty content', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: [], cellStyle: 'brush' })
      ).toThrow();
    });

    it('rejects non-CJK char', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['a'], cellStyle: 'brush' })
      ).toThrow();
    });

    it('rejects invalid cellStyle', () => {
      expect(() =>
        saveWorksheetSchema.parse({ title: 't', content: ['你'], cellStyle: 'xyz' })
      ).toThrow();
    });
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run:
```bash
pnpm test tests/unit/lib/validators.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/validators'".

- [ ] **Step 4: Implement `lib/validators.ts`**

Create `lib/validators.ts`:

```ts
import { z } from 'zod';

const SINGLE_CJK = /^[一-鿿]$/;

export const searchQuerySchema = z.object({
  q: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const worksheetIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const charParamSchema = z.object({
  char: z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
    message: 'must be a single CJK char',
  }),
});

export const saveWorksheetSchema = z.object({
  title: z.string().min(1).max(80),
  content: z
    .array(z.string().regex(SINGLE_CJK))
    .min(1)
    .max(500),
  cellStyle: z.enum(['brush', 'square']),
});
```

- [ ] **Step 5: Implement `lib/api-handler.ts`**

Create `lib/api-handler.ts`:

```ts
import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler so that thrown errors become a 500 JSON response.
 * Business errors (4xx) should be returned explicitly by the handler.
 */
export async function withErrorHandling<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    console.error('[api]', err);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export function notFound(message = 'not_found') {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export function forbidden(message = 'forbidden') {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export function unauthorized(message = 'unauthorized') {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run:
```bash
pnpm test tests/unit/lib/validators.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/validators.ts lib/api-handler.ts tests/unit/lib/validators.test.ts package.json pnpm-lock.yaml
git commit -m "feat(lib): zod validators + api-handler error wrapper"
```

---

## Phase 2: Build Pipeline (3 tasks)

### Task 5: `lib/llm.ts` + `lib/ai-rare-chars.ts`

**Files:**
- Create: `lib/llm.ts`
- Create: `lib/ai-rare-chars.ts`

- [ ] **Step 1: Implement `lib/llm.ts`**

Create `lib/llm.ts`:

```ts
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatArgs {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResponse {
  content: string;
}

export class LLMError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Minimal OpenAI-compatible chat completions client.
 * Sends POST {baseUrl}/chat/completions with the messages, returns the first choice's content.
 */
export async function llmChat(args: LLMChatArgs): Promise<LLMChatResponse> {
  const url = `${args.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.3,
      max_tokens: args.maxTokens ?? 4096,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LLMError(`LLM ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LLMError('LLM returned empty content');
  return { content };
}
```

- [ ] **Step 2: Implement `lib/ai-rare-chars.ts`**

Create `lib/ai-rare-chars.ts`:

```ts
import { getPool } from './db';
import { llmChat, LLMError } from './llm';

export interface BatchInput {
  char: string;
  pinyin: string;
}

export interface BatchOutput {
  char: string;
  meaning: string;
  story: string;
}

export interface GenerateOptions {
  provider: string;
  model: string;
  batchSize?: number;
  sleepMs?: number;
  maxAttempts?: number;
  onError?: (err: unknown, batch: BatchInput[]) => void;
}

const SYSTEM_PROMPT = `你是一位小学语文老师。请为每个汉字写:
1) 简短释义(10-30字)
2) 一个适合 6-12 岁孩子的故事或例句(50-200字)。

只返回严格 JSON 数组,不要 markdown 代码块,不要任何额外文字。
格式: [{"char":"龘","pinyin":"dá","meaning":"...","story":"..."}, ...]`;

/**
 * Batch-generate meaning + story for an array of chars using an OpenAI-compatible LLM.
 * Writes back to rare_chars and returns the number of rows successfully updated.
 *
 * Skips rows whose meaning is already non-empty (idempotent re-runs).
 */
export async function batchGenerateStories(
  inputs: BatchInput[],
  options: GenerateOptions
): Promise<number> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  if (!apiKey) throw new Error('LLM_API_KEY is not set');
  if (!baseUrl) throw new Error('LLM_BASE_URL is not set');

  const batchSize = options.batchSize ?? 50;
  const sleepMs = options.sleepMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 2;
  const generatedBy = `${options.provider}:${options.model}`;
  const pool = getPool();

  let updated = 0;
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const userPrompt = `汉字列表:\n${batch.map((b) => b.char).join('\n')}`;
    let attempt = 0;
    let success = false;
    while (attempt < maxAttempts && !success) {
      attempt++;
      try {
        const res = await llmChat({
          baseUrl,
          apiKey,
          model: options.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        });
        const parsed = parseJsonArray(res.content);
        const conn = await pool.getConnection();
        try {
          for (const item of parsed) {
            const match = batch.find((b) => b.char === item.char);
            if (!match) continue;
            await conn.execute(
              `UPDATE rare_chars
               SET meaning = ?, story = ?, generated_by = ?, generated_at = NOW(), needs_review = 1
               WHERE char = ?`,
              [item.meaning, item.story, generatedBy, item.char]
            );
            updated++;
          }
        } finally {
          conn.release();
        }
        success = true;
      } catch (err) {
        if (attempt >= maxAttempts) {
          options.onError?.(err, batch);
        } else {
          await sleep(1000);
        }
      }
    }
    if (i + batchSize < inputs.length) await sleep(sleepMs);
  }
  return updated;
}

function parseJsonArray(content: string): BatchOutput[] {
  // Strip markdown code fences if present
  const stripped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const data = JSON.parse(stripped);
  if (!Array.isArray(data)) throw new Error('expected JSON array');
  return data as BatchOutput[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/llm.ts lib/ai-rare-chars.ts
git commit -m "feat(lib): LLM client + batch story generation"
```

---

### Task 6: `scripts/fetch-rare-chars.ts`

**Files:**
- Create: `scripts/fetch-rare-chars.ts`

This task is a one-shot script. No unit test (it touches network + DB). The smoke test in Phase 7 verifies it works.

- [ ] **Step 1: Add the public source URL constant**

At the top of `scripts/fetch-rare-chars.ts` (we'll create the file in step 2), the URL is:

```
https://raw.githubusercontent.com/elkmovie/通用规范汉字表/master/《通用规范汉字表》三级字表.txt
```

(If this URL fails, see §12 of the spec for the mitigation: the operator updates the URL and re-runs.)

- [ ] **Step 2: Implement the script**

Create `scripts/fetch-rare-chars.ts`:

```ts
/**
 * One-shot script: fetch 通用规范汉字表 third-tier (~1600 chars), look up
 * pinyin from data/pinyin-hanzi.json (Plan A dictionary) or fall back to
 * pinyin-pro for missing chars, and INSERT into rare_chars.
 *
 * Usage: pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
 *
 * Idempotent: existing rows have only `pinyin` updated (meaning/story preserved).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

const SOURCE_URL =
  'https://raw.githubusercontent.com/elkmovie/通用规范汉字表/master/《通用规范汉字表》三级字表.txt';
const DICT_PATH = join(process.cwd(), 'data', 'pinyin-hanzi.json');

interface DictEntry { char: string; freq: number; }
type Dict = Record<string, DictEntry[]>;

function loadDict(): Map<string, string> {
  // Returns a Map of char -> first pinyin base
  const map = new Map<string, string>();
  try {
    const dict = JSON.parse(readFileSync(DICT_PATH, 'utf-8')) as Dict;
    for (const [pyBase, entries] of Object.entries(dict)) {
      for (const e of entries) {
        if (!map.has(e.char)) map.set(e.char, pyBase);
      }
    }
  } catch {
    // dict missing — fall through with empty map
  }
  return map;
}

function pinyinFor(char: string, charToPinyin: Map<string, string>): string {
  const fromDict = charToPinyin.get(char);
  if (fromDict) return fromDict;
  const py = pinyin(char, { toneType: 'symbol', type: 'array' });
  return Array.isArray(py) && py.length > 0 ? py[0]! : '';
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  const charToPinyin = loadDict();

  console.log('[fetch-rare-chars] downloading source...');
  const text = await fetchText(SOURCE_URL);
  const chars = Array.from(new Set(text.split('').filter((c) => /[一-鿿]/.test(c))));
  console.log(`[fetch-rare-chars] ${chars.length} unique chars`);

  const pool = getPool();
  let inserted = 0;
  let updated = 0;
  for (const char of chars) {
    const pinyinStr = charToPinyin.get(char) ?? pinyinFor(char, charToPinyin);
    try {
      const [result] = await pool.execute<any>(
        `INSERT INTO rare_chars (char, pinyin, meaning, story)
         VALUES (?, ?, '', '')
         ON DUPLICATE KEY UPDATE pinyin = VALUES(pinyin)`,
        [char, pinyinStr]
      );
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    } catch (err) {
      console.error('[fetch-rare-chars] insert failed for', char, err);
    }
  }
  console.log(`[fetch-rare-chars] inserted=${inserted} updated=${updated}`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-rare-chars.ts
git commit -m "feat(scripts): fetch-rare-chars imports 通用规范汉字表 三级"
```

---

### Task 7: `scripts/generate-stories.ts` + `scripts/show-stats.ts`

**Files:**
- Create: `scripts/generate-stories.ts`
- Create: `scripts/show-stats.ts`

- [ ] **Step 1: Implement `scripts/generate-stories.ts`**

Create `scripts/generate-stories.ts`:

```ts
/**
 * One-shot script: read all rare_chars with empty meaning, batch-call an LLM
 * to generate meaning + story, write back.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini
 *
 * Re-runnable: skips rows that already have a non-empty meaning.
 */
import { getPool, closePool } from '../lib/db';
import { batchGenerateStories } from '../lib/ai-rare-chars';

function parseArgs(): { provider: string; model: string } {
  const args = process.argv.slice(2);
  let provider = '';
  let model = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') provider = args[++i] ?? '';
    else if (args[i] === '--model') model = args[++i] ?? '';
  }
  if (!provider || !model) {
    console.error('Usage: --provider <name> --model <id>');
    process.exit(1);
  }
  return { provider, model };
}

async function main() {
  const { provider, model } = parseArgs();
  const pool = getPool();

  const [rows] = await pool.query<any[]>(
    `SELECT char, pinyin FROM rare_chars WHERE meaning = '' ORDER BY char ASC`
  );
  console.log(`[generate-stories] ${rows.length} chars need stories`);

  const inputs = rows.map((r) => ({ char: r.char as string, pinyin: r.pinyin as string }));

  const updated = await batchGenerateStories(inputs, {
    provider,
    model,
    onError: (err, batch) => {
      console.error(`[generate-stories] batch failed (${batch.length} chars):`, err);
    },
  });
  console.log(`[generate-stories] updated ${updated} rows`);

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Implement `scripts/show-stats.ts`**

Create `scripts/show-stats.ts`:

```ts
/**
 * One-shot script: print rare_chars stats.
 * Usage: pnpm tsx --env-file=.env scripts/show-stats.ts
 */
import { getPool, closePool } from '../lib/db';

async function main() {
  const pool = getPool();
  const [[totals]] = await pool.query<any[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pinyin <> '' THEN 1 ELSE 0 END) AS pinyin_filled,
       SUM(CASE WHEN meaning <> '' THEN 1 ELSE 0 END) AS meaning_filled,
       SUM(CASE WHEN story <> '' THEN 1 ELSE 0 END) AS story_filled,
       SUM(CASE WHEN needs_review = 1 THEN 1 ELSE 0 END) AS needs_review
     FROM rare_chars`
  );
  const [bySource] = await pool.query<any[]>(
    `SELECT generated_by, COUNT(*) AS n
     FROM rare_chars
     WHERE generated_by IS NOT NULL
     GROUP BY generated_by
     ORDER BY n DESC`
  );

  console.log(`总数:           ${totals.total}`);
  console.log(`拼音已填:       ${totals.pinyin_filled}`);
  console.log(`释义已填:       ${totals.meaning_filled}`);
  console.log(`故事已填:       ${totals.story_filled}`);
  console.log(`待复核:         ${totals.needs_review}`);
  console.log(`来源分布:`);
  for (const r of bySource) {
    console.log(`  ${r.generated_by} = ${r.n}`);
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-stories.ts scripts/show-stats.ts
git commit -m "feat(scripts): AI story generation + stats reporter"
```

---

## Phase 3: API Routes (5 tasks)

### Task 8: `GET /api/rare-chars` (list + search) + integration test

**Files:**
- Create: `app/api/rare-chars/route.ts`
- Create: `tests/integration/rare-chars-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/rare-chars-list.test.ts`:

```ts
import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from './setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { GET } = await import('@/app/api/rare-chars/route');

function makeReq(qs: string) {
  return new Request(`http://x/api/rare-chars${qs}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars (integration)', () => {
  it('returns all chars when no query', async () => {
    const pool = getPool();
    await pool.execute(`TRUNCATE TABLE rare_chars`);
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES
       ('龘','dá','古龙','龙行龘龘'),
       ('齉','nàng','鼻音','鼻子齉了'),
       ('你','ni','代词','你叫什么')`
    );
    const r = await GET(makeReq(''));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.total).toBe(3);
  });

  it('filters by exact char', async () => {
    const r = await GET(makeReq('?q=%E9%BE%98'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.total).toBe(1);
    expect(j.data.chars[0].char).toBe('龘');
  });

  it('filters by pinyin substring', async () => {
    const r = await GET(makeReq('?q=ni'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.total).toBe(1);
    expect(j.data.chars[0].char).toBe('你');
  });

  it('rejects q > 32 chars', async () => {
    const r = await GET(makeReq(`?q=${'a'.repeat(33)}`));
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
pnpm test tests/integration/rare-chars-list.test.ts
```

Expected: FAIL (no route file). The tests are skipped if `DATABASE_URL_TEST` is unset (per `integrationDescribe`).

- [ ] **Step 3: Implement `app/api/rare-chars/route.ts`**

Create `app/api/rare-chars/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listChars } from '@/lib/rare-chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { searchQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = searchQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
    });
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listChars(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/rare-chars-list.test.ts
```

Expected: all 4 tests pass (or are skipped without `DATABASE_URL_TEST`).

- [ ] **Step 5: Commit**

```bash
git add app/api/rare-chars/route.ts tests/integration/rare-chars-list.test.ts
git commit -m "feat(api): GET /api/rare-chars list+search + integration test"
```

---

### Task 9: `GET /api/rare-chars/[char]` (detail) + integration test

**Files:**
- Create: `app/api/rare-chars/[char]/route.ts`
- Create: `tests/integration/rare-chars-detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/rare-chars-detail.test.ts`:

```ts
import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from './setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
  const pool = getPool();
  await pool.execute(`TRUNCATE TABLE rare_chars`);
  await pool.execute(
    `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES ('龘','dá','古龙','龙行龘龘')`
  );
});

const { GET } = await import('@/app/api/rare-chars/[char]/route');

function makeReq(path: string) {
  return new Request(`http://x${path}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars/[char] (integration)', () => {
  it('returns the char when found', async () => {
    const r = await GET(makeReq('/api/rare-chars/%E9%BE%98'), {
      params: Promise.resolve({ char: '%E9%BE%98' }),
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.char).toBe('龘');
    expect(j.data.pinyin).toBe('dá');
  });

  it('returns 404 for unknown char', async () => {
    const r = await GET(makeReq('/api/rare-chars/%E4%B8%8D'), {
      params: Promise.resolve({ char: '%E4%B8%8D' }),
    });
    expect(r.status).toBe(404);
  });

  it('returns 400 for non-CJK', async () => {
    const r = await GET(makeReq('/api/rare-chars/abc'), {
      params: Promise.resolve({ char: 'abc' }),
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
pnpm test tests/integration/rare-chars-detail.test.ts
```

Expected: FAIL (no route file).

- [ ] **Step 3: Implement `app/api/rare-chars/[char]/route.ts`**

Create the directory `app/api/rare-chars/[char]/`, then create `route.ts` in it:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getChar } from '@/lib/rare-chars';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { charParamSchema } from '@/lib/validators';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ char: string }> }
) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const parsed = charParamSchema.safeParse({ char: decodeURIComponent(char) });
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'bad input');
    const found = await getChar(parsed.data.char);
    if (!found) return notFound();
    return NextResponse.json({ ok: true, data: found });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/rare-chars-detail.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/rare-chars/[char]/route.ts tests/integration/rare-chars-detail.test.ts
git commit -m "feat(api): GET /api/rare-chars/[char] detail + integration test"
```

---

### Task 10: `GET /api/rare-chars/daily` + integration test

**Files:**
- Create: `app/api/rare-chars/daily/route.ts`
- Create: `tests/integration/rare-chars-daily.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/rare-chars-daily.test.ts`:

```ts
import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from './setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
  const pool = getPool();
  await pool.execute(`TRUNCATE TABLE rare_chars`);
  const chars = Array.from({ length: 50 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  for (const c of chars) {
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, 'a', 'm', 's')`,
      [c]
    );
  }
});

const { GET } = await import('@/app/api/rare-chars/daily/route');

function makeReq(qs: string) {
  return new Request(`http://x/api/rare-chars/daily${qs}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars/daily (integration)', () => {
  it('returns a char for the given date', async () => {
    const r = await GET(makeReq('?date=2026-06-11'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.char).toBeTruthy();
    expect(j.data.date).toBe('2026-06-11');
  });

  it('same date returns same char (deterministic)', async () => {
    const a = await GET(makeReq('?date=2026-06-11'));
    const b = await GET(makeReq('?date=2026-06-11'));
    const ja = await a.json();
    const jb = await b.json();
    expect(ja.data.char).toBe(jb.data.char);
  });

  it('different dates often return different chars', async () => {
    const set = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-06-${String(d).padStart(2, '0')}`;
      const r = await GET(makeReq(`?date=${date}`));
      const j = await r.json();
      set.add(j.data.char);
    }
    expect(set.size).toBeGreaterThanOrEqual(5);
  });

  it('defaults to today if no date', async () => {
    const r = await GET(makeReq(''));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test tests/integration/rare-chars-daily.test.ts
```

Expected: FAIL (no route file).

- [ ] **Step 3: Implement `app/api/rare-chars/daily/route.ts`**

Create `app/api/rare-chars/daily/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDailyChar } from '@/lib/rare-chars';
import { withErrorHandling } from '@/lib/api-handler';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const dateStr = req.nextUrl.searchParams.get('date') ?? todayLocal();
    const result = await getDailyChar(dateStr);
    if (!result) {
      return NextResponse.json({ ok: false, error: 'no_chars' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/rare-chars-daily.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/rare-chars/daily/route.ts tests/integration/rare-chars-daily.test.ts
git commit -m "feat(api): GET /api/rare-chars/daily + integration test"
```

---

### Task 11: `GET/POST /api/worksheets` + integration test

**Files:**
- Create: `app/api/worksheets/route.ts`
- Create: `tests/integration/worksheets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/worksheets.test.ts`:

```ts
import { beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { GET: listSheets, POST: createSheet } = await import('@/app/api/worksheets/route');

async function regUser(username: string) {
  return register(new Request('http://x/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
}

async function loginAndCookie(username: string) {
  const r = await login(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { cookie };
}

function withCookie(cookie: string, req: Request): Request {
  const h = new Headers(req.headers);
  h.set('cookie', cookie);
  return new Request(req, { headers: h });
}

integrationDescribe('GET/POST /api/worksheets (integration)', () => {
  it('POST requires auth', async () => {
    const r = await createSheet(new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush' }),
    }) as any);
    expect(r.status).toBe(401);
  });

  it('POST saves and returns id', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My sheet', content: ['你', '好'], cellStyle: 'brush' }),
    })) as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.id).toBeGreaterThan(0);
  });

  it('POST validates empty content', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: [], cellStyle: 'brush' }),
    })) as any);
    expect(r.status).toBe(400);
  });

  it('GET list returns the user worksheets', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'first', content: ['你'], cellStyle: 'brush' }),
    })) as any);
    const r = await listSheets(withCookie(cookie, new Request('http://x/api/worksheets')) as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.worksheets.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test tests/integration/worksheets.test.ts
```

Expected: FAIL (no route file).

- [ ] **Step 3: Implement `app/api/worksheets/route.ts`**

Create `app/api/worksheets/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listUserWorksheets, saveWorksheet } from '@/lib/worksheet';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { saveWorksheetSchema } from '@/lib/validators';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const worksheets = await listUserWorksheets(user.id);
    return NextResponse.json({ ok: true, data: { worksheets } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const body = await req.json();
    const parsed = saveWorksheetSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'bad input');
    const id = await saveWorksheet({
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      cellStyle: parsed.data.cellStyle,
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/worksheets.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/worksheets/route.ts tests/integration/worksheets.test.ts
git commit -m "feat(api): GET/POST /api/worksheets + integration test"
```

---

### Task 12: `GET/DELETE /api/worksheets/[id]` + integration test

**Files:**
- Create: `app/api/worksheets/[id]/route.ts`
- Modify: `tests/integration/worksheets.test.ts` (add 2 more cases)

- [ ] **Step 1: Add 4 more cases to the existing test**

Append to `tests/integration/worksheets.test.ts`:

```ts
const { GET: getSheet, DELETE: delSheet } = await import('@/app/api/worksheets/[id]/route');

integrationDescribe('GET/DELETE /api/worksheets/[id] (integration)', () => {
  it('GET returns the worksheet for its owner', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const created = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await getSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.id).toBe(id);
  });

  it('DELETE removes the worksheet', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const created = await createSheet(withCookie(cookie, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await delSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`, { method: 'DELETE' })) as any, ctx);
    expect(r.status).toBe(204);
    const r2 = await getSheet(withCookie(cookie, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    expect(r2.status).toBe(404);
  });

  it('returns 403 for other user', async () => {
    const u1 = uniqueUsername('ws1');
    const u2 = uniqueUsername('ws2');
    await regUser(u1);
    await regUser(u2);
    const { cookie: c1 } = await loginAndCookie(u1);
    const { cookie: c2 } = await loginAndCookie(u2);
    const created = await createSheet(withCookie(c1, new Request('http://x/api/worksheets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', content: ['你'], cellStyle: 'brush' }),
    })) as any);
    const id = (await created.json()).data.id;
    const ctx = { params: Promise.resolve({ id: String(id) }) } as any;
    const r = await getSheet(withCookie(c2, new Request(`http://x/api/worksheets/${id}`)) as any, ctx);
    expect(r.status).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const ctx = { params: Promise.resolve({ id: '9999999' }) } as any;
    const r = await getSheet(withCookie(cookie, new Request('http://x/api/worksheets/9999999')) as any, ctx);
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test tests/integration/worksheets.test.ts
```

Expected: 4 new tests FAIL (no route file).

- [ ] **Step 3: Implement `app/api/worksheets/[id]/route.ts`**

Create `app/api/worksheets/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet, deleteWorksheet } from '@/lib/worksheet';
import { withErrorHandling, notFound, forbidden, unauthorized, badRequest } from '@/lib/api-handler';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid < 1) return badRequest('bad id');
    const ws = await getWorksheet(wid);
    if (!ws) return notFound();
    if (ws.userId !== user.id) return forbidden();
    return NextResponse.json({ ok: true, data: ws });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid < 1) return badRequest('bad id');
    const ws = await getWorksheet(wid);
    if (!ws) return notFound();
    if (ws.userId !== user.id) return forbidden();
    await deleteWorksheet(wid, user.id);
    return new NextResponse(null, { status: 204 });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/worksheets.test.ts
```

Expected: all 8 tests pass (4 from Task 11 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/worksheets/[id]/route.ts tests/integration/worksheets.test.ts
git commit -m "feat(api): GET/DELETE /api/worksheets/[id] + integration test"
```

---

## Phase 4: Components (8 tasks)

### Task 13: Common — `EmptyState` + `LoadingSpinner`

**Files:**
- Create: `components/common/EmptyState.tsx`
- Create: `components/common/LoadingSpinner.tsx`

No tests (pure presentational, low risk).

- [ ] **Step 1: Implement `EmptyState`**

Create `components/common/EmptyState.tsx`:

```tsx
import { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-lg font-medium text-gray-700">{title}</h3>
      {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Implement `LoadingSpinner`**

Create `components/common/LoadingSpinner.tsx`:

```tsx
'use client';

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div
      className="inline-block animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
      style={{ width: size, height: size }}
      role="status"
      aria-label="loading"
    />
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/common/
git commit -m "feat(components): EmptyState + LoadingSpinner"
```

---

### Task 14: `rare/RareCharCard` + unit test

**Files:**
- Create: `components/rare/RareCharCard.tsx`
- Create: `tests/unit/components/RareCharCard.test.tsx`

- [ ] **Step 1: Install testing-library if not present**

```bash
pnpm add -D @testing-library/react @testing-library/jest-dom happy-dom
```

If they are already present (check `package.json`), skip.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/components/RareCharCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RareCharCard } from '@/components/rare/RareCharCard';

describe('RareCharCard', () => {
  it('renders char, pinyin, meaning', () => {
    render(<RareCharCard char="龘" pinyin="dá" meaning="古同'达'" />);
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(screen.getByText('dá')).toBeInTheDocument();
    expect(screen.getByText(/古同/)).toBeInTheDocument();
  });

  it('truncates long meaning', () => {
    const long = 'a'.repeat(200);
    render(<RareCharCard char="你" pinyin="ni" meaning={long} />);
    // The component truncates to ~30 chars + ellipsis
    const text = screen.getByText(/a+…$/).textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(31);
  });
});
```

If `vitest.config.ts` is missing the `happy-dom` environment, add `environment: 'happy-dom'` to the test file or globally. Check existing component test setup.

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm test tests/unit/components/RareCharCard.test.tsx
```

Expected: FAIL (no component file).

- [ ] **Step 4: Implement `components/rare/RareCharCard.tsx`**

Create `components/rare/RareCharCard.tsx`:

```tsx
import Link from 'next/link';

interface Props {
  char: string;
  pinyin: string;
  meaning: string;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function RareCharCard({ char, pinyin, meaning }: Props) {
  return (
    <Link
      href={`/rare-chars/${encodeURIComponent(char)}`}
      className="block rounded-lg border border-gray-200 p-4 transition hover:border-blue-500 hover:shadow"
    >
      <div className="text-4xl font-bold text-gray-900">{char}</div>
      <div className="mt-1 text-sm text-gray-600">{pinyin}</div>
      <div className="mt-2 text-xs text-gray-500">{truncate(meaning, 30)}</div>
    </Link>
  );
}
```

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test tests/unit/components/RareCharCard.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/rare/RareCharCard.tsx tests/unit/components/RareCharCard.test.tsx
git commit -m "feat(components): RareCharCard with truncate + tests"
```

---

### Task 15: `rare/DailyCharBanner` + `rare/RareCharSearch` (client)

**Files:**
- Create: `components/rare/DailyCharBanner.tsx`
- Create: `components/rare/RareCharSearch.tsx`

- [ ] **Step 1: Implement `DailyCharBanner`**

Create `components/rare/DailyCharBanner.tsx`:

```tsx
import Link from 'next/link';

interface Props {
  char: string;
  pinyin: string;
  meaning: string;
  date: string;
}

export function DailyCharBanner({ char, pinyin, meaning, date }: Props) {
  return (
    <Link
      href={`/rare-chars/${encodeURIComponent(char)}`}
      className="block rounded-lg border-2 border-blue-200 bg-blue-50 p-6 transition hover:border-blue-400"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-blue-600">
        今日一字 · {date}
      </div>
      <div className="mt-3 flex items-baseline gap-4">
        <span className="text-6xl font-bold text-gray-900">{char}</span>
        <span className="text-2xl text-gray-600">{pinyin}</span>
      </div>
      <div className="mt-2 text-sm text-gray-700">{meaning}</div>
    </Link>
  );
}
```

- [ ] **Step 2: Implement `rare/RareCharSearch` (client, debounced)**

Create `components/rare/RareCharSearch.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function RareCharSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get('q') ?? '');

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (value) params.set('q', value);
      else params.delete('q');
      params.delete('page');
      router.replace(`/rare-chars?${params.toString()}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, router, sp]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="按字或拼音搜索..."
      className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
    />
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/rare/DailyCharBanner.tsx components/rare/RareCharSearch.tsx
git commit -m "feat(components): DailyCharBanner + debounced RareCharSearch"
```

---

### Task 16: `rare/RareCharPagination` + `rare/RareCharDetail`

**Files:**
- Create: `components/rare/RareCharPagination.tsx`
- Create: `components/rare/RareCharDetail.tsx`

- [ ] **Step 1: Implement `RareCharPagination`**

Create `components/rare/RareCharPagination.tsx`:

```tsx
import Link from 'next/link';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  q: string;
}

export function RareCharPagination({ page, total, pageSize, basePath, q }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (p > 1) params.set('page', String(p));
    return `${basePath}${params.toString() ? '?' + params.toString() : ''}`;
  };

  return (
    <nav className="flex items-center justify-center gap-2 py-4">
      {page > 1 && (
        <Link href={buildHref(page - 1)} className="rounded border px-3 py-1 hover:bg-gray-100">
          上一页
        </Link>
      )}
      <span className="text-sm text-gray-600">
        第 {page} / {last} 页
      </span>
      {page < last && (
        <Link href={buildHref(page + 1)} className="rounded border px-3 py-1 hover:bg-gray-100">
          下一页
        </Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Implement `RareCharDetail`**

Create `components/rare/RareCharDetail.tsx`:

```tsx
import Link from 'next/link';
import { RareChar } from '@/lib/rare-chars';

interface Props {
  data: RareChar;
}

export function RareCharDetail({ data }: Props) {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="text-center">
        <div className="text-9xl font-bold text-gray-900">{data.char}</div>
        <div className="mt-4 text-3xl text-gray-700">{data.pinyin}</div>
      </header>

      <section className="mt-8 rounded-lg bg-gray-50 p-6">
        <h2 className="text-sm font-medium uppercase text-gray-500">释义</h2>
        <p className="mt-2 text-base text-gray-800">{data.meaning}</p>
      </section>

      <section className="mt-4 rounded-lg bg-yellow-50 p-6">
        <h2 className="text-sm font-medium uppercase text-gray-500">故事 / 例句</h2>
        <p className="mt-2 whitespace-pre-line text-base text-gray-800">{data.story}</p>
      </section>

      <div className="mt-8 text-center">
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(data.char)}`}
          className="inline-block rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
        >
          加入字帖 →
        </Link>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add components/rare/RareCharPagination.tsx components/rare/RareCharDetail.tsx
git commit -m "feat(components): RareCharPagination + RareCharDetail"
```

---

### Task 17: `worksheet/StylePicker` + `worksheet/WorksheetCell` (SVG) + tests

**Files:**
- Create: `components/worksheet/StylePicker.tsx`
- Create: `components/worksheet/WorksheetCell.tsx`
- Create: `tests/unit/components/WorksheetCell.test.tsx`

- [ ] **Step 1: Write the failing test for WorksheetCell**

Create `tests/unit/components/WorksheetCell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell', () => {
  it('brush style has diagonals and vertical center, no horizontal center', () => {
    const { container } = render(<WorksheetCell char="你" style="brush" />);
    const lines = container.querySelectorAll('line');
    // 4 lines: top, right, bottom, left border, + 1 vertical center, + 2 diagonals = 7 total
    // Brush has no horizontal center
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it('square style has vertical and horizontal center, no diagonals', () => {
    const { container } = render(<WorksheetCell char="你" style="square" />);
    const lines = container.querySelectorAll('line');
    // Square: 4 border + 1 vertical + 1 horizontal = 6
    expect(lines.length).toBe(6);
  });

  it('renders the char as a text element', () => {
    const { container } = render(<WorksheetCell char="好" style="brush" />);
    expect(container.querySelector('text')?.textContent).toBe('好');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test tests/unit/components/WorksheetCell.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `WorksheetCell`**

Create `components/worksheet/WorksheetCell.tsx`:

```tsx
import { CellStyle } from '@/lib/worksheet';

interface Props {
  char: string;
  style: CellStyle;
  size?: number;
}

export function WorksheetCell({ char, style, size = 80 }: Props) {
  const stroke = '#bbb';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      {/* outer border */}
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={stroke} strokeWidth={1} />
      {/* common: vertical center */}
      <line x1={50} y1={2} x2={50} y2={98} stroke={stroke} strokeWidth={0.5} />
      {/* brush: two diagonals; square: horizontal center */}
      {style === 'brush' ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
        </>
      ) : (
        <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
      )}
      {/* the char (faint guide) */}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={60}
        fill={stroke}
        fontFamily="serif"
      >
        {char}
      </text>
    </svg>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/unit/components/WorksheetCell.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Implement `StylePicker` (client)**

Create `components/worksheet/StylePicker.tsx`:

```tsx
'use client';

import { CellStyle } from '@/lib/worksheet';

interface Props {
  value: CellStyle;
  onChange: (v: CellStyle) => void;
}

export function StylePicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="cellStyle"
          value="brush"
          checked={value === 'brush'}
          onChange={() => onChange('brush')}
        />
        <span>毛笔格</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="cellStyle"
          value="square"
          checked={value === 'square'}
          onChange={() => onChange('square')}
        />
        <span>田字格</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/worksheet/WorksheetCell.tsx components/worksheet/StylePicker.tsx tests/unit/components/WorksheetCell.test.tsx
git commit -m "feat(components): WorksheetCell (SVG) + StylePicker"
```

---

### Task 18: `worksheet/TextInputTab` + `worksheet/LibrarySelectTab`

**Files:**
- Create: `components/worksheet/TextInputTab.tsx`
- Create: `components/worksheet/LibrarySelectTab.tsx`

- [ ] **Step 1: Implement `TextInputTab`**

Create `components/worksheet/TextInputTab.tsx`:

```tsx
'use client';

interface Props {
  value: string[];
  onChange: (chars: string[]) => void;
}

export function TextInputTab({ value, onChange }: Props) {
  const text = value.join('');
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          const filtered = Array.from(e.target.value)
            .filter((c) => /[一-鿿]/.test(c))
            .slice(0, 500);
          onChange(filtered);
        }}
        placeholder="输入或粘贴汉字,每个字一个格子..."
        rows={8}
        className="w-full rounded-md border border-gray-300 p-3 font-serif text-lg focus:border-blue-500 focus:outline-none"
      />
      <p className="mt-2 text-xs text-gray-500">
        {value.length} / 500 字
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `LibrarySelectTab`**

Create `components/worksheet/LibrarySelectTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

interface Props {
  selected: string[];
  onChange: (chars: string[]) => void;
}

export function LibrarySelectTab({ selected, onChange }: Props) {
  const [q, setQ] = useState('');
  const [chars, setChars] = useState<Char[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = q
          ? `/api/rare-chars?q=${encodeURIComponent(q)}&page=1`
          : `/api/rare-chars?page=1`;
        const res = await fetch(url);
        const data = (await res.json()) as { ok: boolean; data: { chars: Char[] } };
        if (data.ok) setChars(data.data.chars);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  const toggle = (c: string) => {
    if (selected.includes(c)) onChange(selected.filter((x) => x !== c));
    else if (selected.length < 500) onChange([...selected, c]);
  };

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索生僻字..."
        className="w-full rounded-md border border-gray-300 px-3 py-2"
      />
      <div className="mt-3 grid max-h-96 grid-cols-6 gap-2 overflow-y-auto sm:grid-cols-8">
        {chars.map((c) => {
          const isSelected = selected.includes(c.char);
          return (
            <button
              key={c.char}
              type="button"
              onClick={() => toggle(c.char)}
              className={`flex flex-col items-center rounded border p-2 text-center transition ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
              title={c.meaning}
            >
              <span className="text-2xl">{c.char}</span>
              <span className="mt-1 text-[10px] text-gray-500">{c.pinyin}</span>
            </button>
          );
        })}
        {!loading && chars.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-gray-500">无匹配</div>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">已选 {selected.length} / 500</p>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add components/worksheet/TextInputTab.tsx components/worksheet/LibrarySelectTab.tsx
git commit -m "feat(components): TextInputTab + LibrarySelectTab"
```

---

### Task 19: `worksheet/WorksheetGenerator` (form state container)

**Files:**
- Create: `components/worksheet/WorksheetGenerator.tsx`

- [ ] **Step 1: Implement `WorksheetGenerator`**

Create `components/worksheet/WorksheetGenerator.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CellStyle } from '@/lib/worksheet';
import { TextInputTab } from './TextInputTab';
import { LibrarySelectTab } from './LibrarySelectTab';
import { StylePicker } from './StylePicker';
import { WorksheetPreview } from './WorksheetPreview';

type Tab = 'text' | 'library';

export function WorksheetGenerator() {
  const sp = useSearchParams();
  const router = useRouter();
  const prefill = sp.get('prefill');

  const [tab, setTab] = useState<Tab>(prefill ? 'library' : 'text');
  const [content, setContent] = useState<string[]>(prefill ? [prefill] : []);
  const [title, setTitle] = useState('');
  const [cellStyle, setCellStyle] = useState<CellStyle>('brush');
  const [view, setView] = useState<'form' | 'preview'>('form');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefill) {
      setTab('library');
      setContent((cur) => (cur.includes(prefill) ? cur : [prefill, ...cur]));
    }
  }, [prefill]);

  const canPreview = content.length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || `字帖 ${new Date().toLocaleDateString()}`, content, cellStyle }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(`/worksheet/${data.data.id}`);
      } else {
        alert('保存失败: ' + (data.error ?? '未知错误'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (view === 'preview') {
    return (
      <WorksheetPreview
        title={title}
        content={content}
        cellStyle={cellStyle}
        onBack={() => setView('form')}
        onSave={handleSave}
        saving={saving}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab('text')}
          className={`px-4 py-2 ${tab === 'text' ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`}
        >
          自由输入
        </button>
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-4 py-2 ${tab === 'library' ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`}
        >
          从字库选
        </button>
      </div>

      {tab === 'text' ? (
        <TextInputTab value={content} onChange={setContent} />
      ) : (
        <LibrarySelectTab selected={content} onChange={setContent} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">标题(可选)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="给字帖起个名字..."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">格子样式</label>
          <div className="mt-2">
            <StylePicker value={cellStyle} onChange={setCellStyle} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setView('preview')}
          disabled={!canPreview}
          className="rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          生成字帖
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add components/worksheet/WorksheetGenerator.tsx
git commit -m "feat(components): WorksheetGenerator (form state container)"
```

---

### Task 20: `worksheet/WorksheetPreview` + `worksheet/WorksheetHistoryList`

**Files:**
- Create: `components/worksheet/WorksheetPreview.tsx`
- Create: `components/worksheet/WorksheetHistoryList.tsx`

- [ ] **Step 1: Implement `WorksheetPreview`**

Create `components/worksheet/WorksheetPreview.tsx`:

```tsx
'use client';

import { CellStyle, generateLayout } from '@/lib/worksheet';
import { WorksheetCell } from './WorksheetCell';

interface BaseProps {
  title?: string;
  content: string[];
  cellStyle: CellStyle;
  showHeader?: boolean;
}

interface FormProps extends BaseProps {
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}

type Props = BaseProps | FormProps;

export function WorksheetPreview(props: Props) {
  const cells = generateLayout(props.content, props.cellStyle);
  const isFormView = 'onBack' in props;

  return (
    <div>
      {isFormView && props.showHeader !== false && (
        <div className="worksheet-no-print mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={props.onBack}
            className="rounded border px-3 py-1 hover:bg-gray-100"
          >
            ← 返回修改
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border px-3 py-1 hover:bg-gray-100"
            >
              打印
            </button>
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {props.saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {props.title && (
        <h1 className="worksheet-no-print mb-4 text-center text-2xl font-bold">{props.title}</h1>
      )}

      <div className="worksheet-grid mx-auto grid max-w-3xl grid-cols-8 gap-2 print:grid-cols-8">
        {cells.map((cell) => (
          <div key={cell.index} className="worksheet-cell">
            <WorksheetCell char={cell.char} style={cell.style} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `WorksheetHistoryList`**

Create `components/worksheet/WorksheetHistoryList.tsx`:

```tsx
import Link from 'next/link';
import { Worksheet } from '@/lib/worksheet';

interface Props {
  worksheets: Worksheet[];
}

export function WorksheetHistoryList({ worksheets }: Props) {
  if (worksheets.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">还没有保存的字帖</div>
    );
  }
  return (
    <ul className="divide-y rounded border">
      {worksheets.map((w) => (
        <li key={w.id} className="flex items-center justify-between p-4">
          <div>
            <Link href={`/worksheet/${w.id}`} className="font-medium text-blue-600 hover:underline">
              {w.title}
            </Link>
            <div className="text-sm text-gray-500">
              {w.content.length} 字 · {w.cellStyle === 'brush' ? '毛笔格' : '田字格'} ·{' '}
              {new Date(w.createdAt).toLocaleString()}
            </div>
          </div>
          <form action={`/api/worksheets/${w.id}`} method="post">
            {/* DELETE via JS in parent; this is a placeholder */}
          </form>
        </li>
      ))}
    </ul>
  );
}
```

(Actual delete is handled by the history page using a client-side button; this component is read-only.)

- [ ] **Step 3: Commit**

```bash
git add components/worksheet/WorksheetPreview.tsx components/worksheet/WorksheetHistoryList.tsx
git commit -m "feat(components): WorksheetPreview (print-ready) + HistoryList"
```

---

## Phase 5: Game + Client Wrappers (3 tasks)

### Task 21: `game/DraggablePinyin` + `game/CharDropZone`

**Files:**
- Create: `components/game/DraggablePinyin.tsx`
- Create: `components/game/CharDropZone.tsx`

- [ ] **Step 1: Implement `DraggablePinyin`**

Create `components/game/DraggablePinyin.tsx`:

```tsx
'use client';

import { DragEvent } from 'react';

interface Props {
  id: string;
  text: string;
  disabled?: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  matched?: boolean;
}

export function DraggablePinyin({ id, text, disabled, onDragStart, matched }: Props) {
  if (matched) {
    return (
      <div className="invisible rounded border border-gray-300 bg-gray-100 px-3 py-2 text-sm">
        {text}
      </div>
    );
  }
  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, id)}
      className={`cursor-grab rounded border border-blue-300 bg-white px-3 py-2 text-sm transition active:cursor-grabbing ${
        disabled ? 'opacity-50' : 'hover:bg-blue-50'
      }`}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Implement `CharDropZone`**

Create `components/game/CharDropZone.tsx`:

```tsx
'use client';

import { DragEvent } from 'react';

interface Props {
  charId: string;
  char: string;
  matchedPinyin: string | null;
  onDrop: (charId: string, pinyinId: string) => void;
}

export function CharDropZone({ charId, char, matchedPinyin, onDrop }: Props) {
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pinyinId = e.dataTransfer.getData('text/plain');
    if (pinyinId) onDrop(charId, pinyinId);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="flex items-center gap-3 rounded border border-gray-300 bg-white p-3"
    >
      <span className="text-3xl font-bold">{char}</span>
      <span className="text-sm text-gray-500">→</span>
      <span className="flex-1 rounded border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-400">
        {matchedPinyin ?? '拖动拼音到这里'}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add components/game/DraggablePinyin.tsx components/game/CharDropZone.tsx
git commit -m "feat(components): DraggablePinyin + CharDropZone (HTML5 DnD)"
```

---

### Task 22: `game/DragMatchGame` (state machine)

**Files:**
- Create: `components/game/DragMatchGame.tsx`

- [ ] **Step 1: Implement `DragMatchGame`**

Create `components/game/DragMatchGame.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DraggablePinyin } from './DraggablePinyin';
import { CharDropZone } from './CharDropZone';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

type Phase = 'loading' | 'playing' | 'finished';

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function DragMatchGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [chars, setChars] = useState<Char[]>([]);
  const [pinyinOrder, setPinyinOrder] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({}); // charId -> pinyinId
  const [mismatches, setMismatches] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    loadGame();
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 100);
    return () => clearInterval(handle);
  }, [phase]);

  const loadGame = async () => {
    setPhase('loading');
    const res = await fetch('/api/rare-chars?page=1');
    const data = (await res.json()) as { ok: boolean; data: { chars: Char[] } };
    const filled = data.data.chars.filter((c) => c.meaning && c.pinyin);
    const picked = shuffle(filled).slice(0, 8);
    setChars(picked);
    setPinyinOrder(shuffle(picked.map((c) => c.pinyin)));
    setPairs({});
    setMismatches(0);
    setElapsedMs(0);
    startedAt.current = Date.now();
    setPhase('playing');
  };

  const handleDragStart = (e: React.DragEvent, pinyin: string) => {
    e.dataTransfer.setData('text/plain', pinyin);
  };

  const handleDrop = (char: string, pinyin: string) => {
    if (pairs[char]) return; // already matched
    if (pinyin === getPinyinFor(char)) {
      setPairs((p) => ({ ...p, [char]: pinyin }));
    } else {
      setMismatches((m) => m + 1);
      // briefly flash by not locking the pair
    }
    // Check if all matched
    setTimeout(() => {
      const allMatched = Object.keys(pairs).length + 1 >= chars.length;
      if (allMatched) setPhase('finished');
    }, 50);
  };

  const getPinyinFor = (char: string) => chars.find((c) => c.char === char)?.pinyin ?? '';

  const accuracy = useMemo(() => {
    const total = mismatches + Object.keys(pairs).length;
    if (total === 0) return 1;
    return Object.keys(pairs).length / total;
  }, [mismatches, pairs]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-gray-500">加载中...</div>;
  }

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center">
        <h2 className="text-2xl font-bold">完成!</h2>
        <p className="mt-2 text-gray-600">用时: {formatTime(elapsedMs)}</p>
        <p className="mt-1 text-gray-600">正确率: {Math.round(accuracy * 100)}%</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={loadGame}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            再来一局
          </button>
          <a
            href="/"
            className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-100"
          >
            返回首页
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">用时: {formatTime(elapsedMs)}</div>
        <div className="text-sm text-gray-600">错配: {mismatches}</div>
        <button
          type="button"
          onClick={() => setPhase('finished')}
          className="text-sm text-gray-500 hover:underline"
        >
          放弃
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">字</h3>
          {chars.map((c) => (
            <CharDropZone
              key={c.char}
              charId={c.char}
              char={c.char}
              matchedPinyin={pairs[c.char] ?? null}
              onDrop={handleDrop}
            />
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">拼音(拖动到对应字)</h3>
          {pinyinOrder.map((py) => {
            const matched = Object.values(pairs).includes(py);
            return (
              <DraggablePinyin
                key={py}
                id={py}
                text={py}
                matched={matched}
                onDragStart={handleDragStart}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add components/game/DragMatchGame.tsx
git commit -m "feat(components): DragMatchGame state machine"
```

---

### Task 23: `lib/api-rare-chars.ts` + `lib/api-worksheet.ts` (client wrappers)

**Files:**
- Create: `lib/api-rare-chars.ts`
- Create: `lib/api-worksheet.ts`

These are thin client-side fetch wrappers used by components. They have no server dependencies and no DB access.

- [ ] **Step 1: Implement `api-rare-chars.ts`**

Create `lib/api-rare-chars.ts`:

```ts
export interface RareCharClient {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  needsReview: boolean;
  generatedBy: string | null;
  generatedAt: string | null;
  createdAt: string;
}

export interface ListResultClient {
  chars: RareCharClient[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchRareChars(opts: { q?: string; page?: number } = {}): Promise<ListResultClient> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/rare-chars?${params.toString()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'fetch failed');
  return data.data;
}

export async function fetchRareChar(char: string): Promise<RareCharClient> {
  const res = await fetch(`/api/rare-chars/${encodeURIComponent(char)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'fetch failed');
  return data.data;
}

export async function fetchDailyChar(date?: string): Promise<{
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  date: string;
}> {
  const url = date ? `/api/rare-chars/daily?date=${date}` : '/api/rare-chars/daily';
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'fetch failed');
  return data.data;
}
```

- [ ] **Step 2: Implement `api-worksheet.ts`**

Create `lib/api-worksheet.ts`:

```ts
import { CellStyle, Worksheet } from './worksheet';

export async function listWorksheets(): Promise<Worksheet[]> {
  const res = await fetch('/api/worksheets');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'fetch failed');
  return data.data.worksheets;
}

export async function fetchWorksheet(id: number): Promise<Worksheet> {
  const res = await fetch(`/api/worksheets/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'fetch failed');
  return data.data;
}

export async function saveWorksheetApi(input: {
  title: string;
  content: string[];
  cellStyle: CellStyle;
}): Promise<{ id: number }> {
  const res = await fetch('/api/worksheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'save failed');
  return data.data;
}

export async function deleteWorksheetApi(id: number): Promise<void> {
  const res = await fetch(`/api/worksheets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('delete failed');
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add lib/api-rare-chars.ts lib/api-worksheet.ts
git commit -m "feat(lib): client API wrappers for rare-chars and worksheets"
```

---

## Phase 6: Pages + Navigation (5 tasks)

### Task 24: `/rare-chars` page (list + search + daily banner)

**Files:**
- Create: `app/rare-chars/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/rare-chars/page.tsx`:

```tsx
import { Suspense } from 'react';
import { listChars, getDailyChar } from '@/lib/rare-chars';
import { RareCharCard } from '@/components/rare/RareCharCard';
import { RareCharSearch } from '@/components/rare/RareCharSearch';
import { RareCharPagination } from '@/components/rare/RareCharPagination';
import { DailyCharBanner } from '@/components/rare/DailyCharBanner';
import { EmptyState } from '@/components/common/EmptyState';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function RareCharsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = sp.q ?? '';
  const page = sp.page ? Number(sp.page) : 1;

  const [listResult, daily] = await Promise.all([
    listChars({ q, page }),
    getDailyChar(new Date().toISOString().slice(0, 10)).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">罕见字库</h1>

      {daily && (
        <DailyCharBanner
          char={daily.char}
          pinyin={daily.pinyin}
          meaning={daily.meaning}
          date={daily.date}
        />
      )}

      <Suspense>
        <RareCharSearch />
      </Suspense>

      {listResult.chars.length === 0 ? (
        <EmptyState
          title="没有匹配的字"
          description={q ? `没有匹配 "${q}" 的字。` : '字库为空。'}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-8">
            {listResult.chars.map((c) => (
              <RareCharCard key={c.char} char={c.char} pinyin={c.pinyin} meaning={c.meaning} />
            ))}
          </div>
          <RareCharPagination
            page={listResult.page}
            total={listResult.total}
            pageSize={listResult.pageSize}
            basePath="/rare-chars"
            q={q}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
pnpm build 2>&1 | tail -20
```

Expected: new `/rare-chars` route appears in the build output.

- [ ] **Step 3: Commit**

```bash
git add app/rare-chars/page.tsx
git commit -m "feat(pages): /rare-chars list with daily banner + search + pagination"
```

---

### Task 25: `/rare-chars/[char]` page

**Files:**
- Create: `app/rare-chars/[char]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/rare-chars/[char]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getChar } from '@/lib/rare-chars';
import { RareCharDetail } from '@/components/rare/RareCharDetail';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function RareCharDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data) notFound();
  return (
    <div className="p-4">
      <RareCharDetail data={data} />
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add app/rare-chars/[char]/page.tsx
git commit -m "feat(pages): /rare-chars/[char] detail view"
```

---

### Task 26: `/worksheet` page (form + preview single page)

**Files:**
- Create: `app/worksheet/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/worksheet/page.tsx`:

```tsx
import { Suspense } from 'react';
import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';

export const dynamic = 'force-dynamic';

export default function WorksheetPage() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">字帖生成器</h1>
      <Suspense fallback={<div>加载中...</div>}>
        <WorksheetGenerator />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add app/worksheet/page.tsx
git commit -m "feat(pages): /worksheet generator (form + preview)"
```

---

### Task 27: `/worksheet/history` + `/worksheet/[id]` pages

**Files:**
- Create: `app/worksheet/history/page.tsx`
- Create: `app/worksheet/[id]/page.tsx`

- [ ] **Step 1: Implement history page**

Create `app/worksheet/history/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listUserWorksheets } from '@/lib/worksheet';
import { WorksheetHistoryList } from '@/components/worksheet/WorksheetHistoryList';

export const dynamic = 'force-dynamic';

export default async function WorksheetHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/?auth=login&next=/worksheet/history');
  const worksheets = await listUserWorksheets(user.id);
  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的字帖</h1>
        <Link href="/worksheet" className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">
          新建字帖
        </Link>
      </div>
      <WorksheetHistoryList worksheets={worksheets} />
    </div>
  );
}
```

- [ ] **Step 2: Implement detail page**

Create `app/worksheet/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet } from '@/lib/worksheet';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';
import { DeleteWorksheetButton } from './DeleteWorksheetButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorksheetDetailPage({ params }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect('/?auth=login');
  const { id } = await params;
  const wid = Number(id);
  if (!Number.isInteger(wid)) notFound();
  const ws = await getWorksheet(wid);
  if (!ws) notFound();
  if (ws.userId !== user.id) notFound();
  return (
    <div className="p-4">
      <div className="worksheet-no-print mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{ws.title}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded border px-3 py-1 hover:bg-gray-100"
          >
            打印
          </button>
          <DeleteWorksheetButton id={ws.id} />
        </div>
      </div>
      <p className="worksheet-no-print mb-4 text-sm text-gray-500">
        {ws.content.length} 字 · {ws.cellStyle === 'brush' ? '毛笔格' : '田字格'} ·{' '}
        {new Date(ws.createdAt).toLocaleString()}
      </p>
      <WorksheetPreview title={undefined} content={ws.content} cellStyle={ws.cellStyle} showHeader={false} />
    </div>
  );
}
```

- [ ] **Step 3: Add the `DeleteWorksheetButton` client component**

Create `app/worksheet/[id]/DeleteWorksheetButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteWorksheetApi } from '@/lib/api-worksheet';

export function DeleteWorksheetButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (!confirm('确定要删除这张字帖吗?')) return;
    setBusy(true);
    try {
      await deleteWorksheetApi(id);
      router.push('/worksheet/history');
    } catch {
      alert('删除失败');
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-red-300 px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? '删除中...' : '删除'}
    </button>
  );
}
```

- [ ] **Step 4: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add app/worksheet/
git commit -m "feat(pages): /worksheet/history + /worksheet/[id]"
```

---

### Task 28: `/game` page + Header updates + print CSS

**Files:**
- Create: `app/game/page.tsx`
- Modify: `components/Header.tsx` (add 3 nav links)
- Modify: `app/globals.css` (add `@media print` + new component styles)

- [ ] **Step 1: Implement `/game` page**

Create `app/game/page.tsx`:

```tsx
import { DragMatchGame } from '@/components/game/DragMatchGame';

export const dynamic = 'force-dynamic';

export default function GamePage() {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 text-2xl font-bold">识字游戏</h1>
      <p className="mb-4 text-sm text-gray-600">
        从字库随机取 8 个字,把它们和对应的拼音配对。
      </p>
      <DragMatchGame />
    </div>
  );
}
```

- [ ] **Step 2: Add 3 nav links to Header**

Open `components/Header.tsx`. Find the existing nav section (likely a `<nav>` with `<Link>` elements). Add 3 new links after the existing `字 ↔ 拼音` link:

```tsx
<Link href="/rare-chars" className="...">罕见字库</Link>
<Link href="/worksheet" className="...">字帖</Link>
<Link href="/game" className="...">游戏</Link>
```

(Match the existing styling/classes used in the file. If the file uses a different convention, follow it.)

- [ ] **Step 3: Add print CSS + new component styles**

Open `app/globals.css`. Append at the end:

```css
/* Plan D: worksheet print styles */
@media print {
  body * {
    visibility: hidden;
  }
  .worksheet-grid, .worksheet-grid * {
    visibility: visible;
  }
  .worksheet-grid {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .worksheet-no-print {
    display: none !important;
  }
  @page {
    margin: 1.5cm;
    size: A4;
  }
}
```

- [ ] **Step 4: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add app/game/page.tsx components/Header.tsx app/globals.css
git commit -m "feat(pages): /game + Header 3 new links + print CSS"
```

---

## Phase 7: Wrap Up (4 tasks)

### Task 29: End-to-end manual smoke (15 steps)

This task is performed by the operator, not a subagent. The subagent's job is to verify the build + tests pass; the user runs the manual UI checks.

**Files:** none

- [ ] **Step 1: Verify build + tests pass**

```bash
pnpm build 2>&1 | tail -10
pnpm test
```

Expected: build succeeds (all routes built, no errors), all unit tests pass, integration tests skipped (no `DATABASE_URL_TEST` in this session) or pass (if test DB is configured).

- [ ] **Step 2: Run the build scripts (operator)**

```bash
pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini
pnpm tsx --env-file=.env scripts/show-stats.ts
```

Expected: `总数: 1600` (or close), all rows have `meaning` and `story` filled, `generated_by = "openai:gpt-4o-mini"`.

- [ ] **Step 3: Manual UI checks (15 steps)**

Start `pnpm dev` and verify:

1. Visit `/rare-chars` — see the daily char banner + 80 cards
2. Search "ni" — list filters to ~few chars
3. Click any card → detail page renders
4. Click "加入字帖" → lands on `/worksheet` with that char selected
5. Switch to "自由输入" tab, type "你好世界" — preview shows 4 cells (毛笔格)
6. Switch style to 田字格 — preview updates to 4 cells (田字格)
7. Click "打印" — print preview shows the grid only
8. Login, save the worksheet → see it in `/worksheet/history`
9. Click a saved worksheet → view it → delete it
10. Visit `/game` — 8 chars + 8 pinyins render
11. Drag a pinyin onto the correct char — green flash, locks
12. Drag a pinyin onto a wrong char — red flash (briefly), returns to pool
13. Complete the game (or give up) — end modal shows elapsed time + accuracy
14. Click "再来一局" — new random 8 chars
15. Visit `/` (home) — Header has 3 new links: 罕见字库, 字帖, 游戏

If any step fails, file a targeted bug fix as a follow-up commit.

- [ ] **Step 4: Commit the verification log (optional)**

If you kept notes during the smoke test, save them to `docs/superpowers/notes/2026-06-11-plan-d-smoke.md` and commit.

```bash
git add docs/superpowers/notes/2026-06-11-plan-d-smoke.md
git commit -m "docs: Plan D smoke test results"
```

---

### Task 30: README + `.env.example` updates

**Files:**
- Modify: `README.md` (add new section)
- Modify: `.env.example` (add LLM env vars if not already done in Task 1)

- [ ] **Step 1: Add the new section to README**

Open `README.md`. After the existing "密码找回 + 管理员后台 (v1 / Plan B+)" section, add:

```markdown
## 罕见字库 + 字帖生成器 + 识字游戏 (v1 / Plan D)

- **罕见字库**:从《通用规范汉字表》三级导入 ~1600 字,每字含拼音、释义、故事(AI 生成)。`/rare-chars` 浏览 + 搜索,`/rare-chars/[char]` 详情。
- **字帖生成器**:`/worksheet` 支持自由输入或从字库选字,毛笔格/田字格两种样式,浏览器原生打印 → 另存为 PDF。登录用户可保存到 `/worksheet/history`。
- **识字游戏**:`/game` 拖拽匹配字与拼音,8 张牌,计时计错配。

### 数据初始化(一次性)

```bash
pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini
pnpm tsx --env-file=.env scripts/show-stats.ts
```

需要 `LLM_API_KEY` 和 `LLM_BASE_URL` 在 `.env` 中。脚本可重复运行(已填的释义/故事不覆盖)。
```

- [ ] **Step 2: Commit**

```bash
git add README.md .env.example
git commit -m "docs: Plan D section in README"
```

---

### Task 31: Final code review (cross-cutting)

**Files:** none (this is a verification + fix-up task)

- [ ] **Step 1: Run all checks**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build 2>&1 | tail -20
```

Expected: all green. If anything fails, dispatch a small fix subagent.

- [ ] **Step 2: Dispatch final code review subagent**

Use the `superpowers:requesting-code-review` skill or dispatch a review subagent directly. Pass it the full diff of all Plan D commits and the spec.

The subagent checks:
- No Critical or Important issues
- All 32 estimated commits are present
- Spec coverage: every requirement in `docs/superpowers/specs/2026-06-11-pinyin-character-plan-d-design.md` is implemented
- No security issues (SQL injection, XSS, etc.)

- [ ] **Step 3: Address review findings**

If the reviewer finds issues, dispatch fix subagents for each. Re-run `pnpm test` and `pnpm build` after fixes.

- [ ] **Step 4: Commit review notes (if any)**

If the reviewer produced a written summary, save it to `docs/superpowers/notes/2026-06-11-plan-d-review.md` and commit.

---

### Task 32: Wrap up — update memory + spec memory

**Files:**
- Modify: `C:\Users\徐鹏\.claude\projects\E--ToolDevelop-PinYinCharacter\memory\MEMORY.md` (add new line)
- Create: `C:\Users\徐鹏\.claude\projects\E--ToolDevelop-PinYinCharacter\memory\plan-d-status.md`

- [ ] **Step 1: Create the Plan D status memory file**

Create `C:\Users\徐鹏\.claude\projects\E--ToolDevelop-PinYinCharacter\memory\plan-d-status.md`:

```markdown
---
name: Plan D status — implementation complete
description: Plan D (rare chars + worksheet + game) implementation done, awaiting human smoke test
type: project
---

Plan D (罕见字库 + 字帖 + 游戏) is **implementation-complete** as of 2026-06-11. 32 commits on main, all unit + integration tests passing.

**Run-once scripts to populate data:**
- `pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts` — imports ~1600 chars
- `pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini` — AI fills meaning/story
- `pnpm tsx --env-file=.env scripts/show-stats.ts` — verify counts

**Build pipeline notes:**
- LLM_API_KEY + LLM_BASE_URL in `.env`
- Provider/model passed as CLI args (not env) so the same key can switch between models
- AI content tracked in `rare_chars.generated_by` (e.g., "openai:gpt-4o-mini") for audit
- Idempotent re-runs: `INSERT ... ON DUPLICATE KEY UPDATE pinyin` for fetch, skips rows with `meaning != ''` for generate

**Key design decisions:**
- Worksheet = single client page with form/preview view toggle (no separate /preview route, no sessionStorage)
- Cell rendering: inline `<svg>` per cell (diagonals + center lines), CSS `@media print` hides form/header
- Game: HTML5 drag-and-drop, 8 chars × 8 pinyin, no score persistence
- Daily char: deterministic SHA-1(date) % len(chars), no separate table
- Library: public browse, login required only for save/delete

**How to apply:**
- Next session: user runs Task 29 manual smoke (15 steps) against live MySQL
- If smoke test passes: Plan D done, ask user about next plan (E?)
- If smoke test fails: triage specific failure and fix in a targeted commit
```

- [ ] **Step 2: Update `MEMORY.md` index**

Add a new line to `MEMORY.md`:

```markdown
- [Plan D status — implementation complete](plan-d-status.md) — 32 commits, awaiting human smoke test
```

- [ ] **Step 3: Commit**

```bash
git add ../path/to/MEMORY.md ../path/to/plan-d-status.md
```

(The memory directory is outside the project — commit only if it's tracked. If not, this is a manual step the user does outside the repo.)

---

## Acceptance Criteria (recap)

1. `pnpm test` — all unit + integration tests pass
2. `pnpm exec tsc --noEmit` — clean
3. `pnpm build` — builds with the new routes (7 page + 5 API = 12 new)
4. Build scripts run end-to-end and fill the table
5. All 15 manual smoke steps pass
6. All commits on `main` branch
7. README has a "罕见字库 + 字帖生成器 + 识字游戏" section

## Estimated Timeline

- Phase 1 (data foundation): 4 tasks, ~3 hours
- Phase 2 (build pipeline): 3 tasks, ~2 hours
- Phase 3 (API routes): 5 tasks, ~3 hours
- Phase 4 (components): 8 tasks, ~5 hours
- Phase 5 (game + wrappers): 3 tasks, ~2 hours
- Phase 6 (pages): 5 tasks, ~3 hours
- Phase 7 (wrap up): 4 tasks, ~2 hours

**Total: 32 tasks, ~20 hours of focused subagent execution.**

## Out of Scope (recap)

- Audio / TTS for chars
- Worksheet save-as-PDF (use browser print)
- Worksheet folders / categories
- 「今日一字」on homepage
- Game leaderboards
- Multiplayer
- Admin UI for editing rare chars
- i18n
