# Plan G6 — Ancient Classics Module + 宋词补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/ancient-texts` placeholder with a real 古籍 (classical texts) module (`/ancient`) that lets users browse 四书五经/弟子规/etc., read each chapter with pinyin annotation, and feed the text into the existing 字帖 generator — brush OR pen — with 上一章/下一章 and the standard random-generation flow. Also populate the empty 宋词 dynasty in the existing `poems` table.

**Architecture:** Independent `classics` MySQL table mirroring the `sutras` shape (id, slug, category ENUM, chunks JSON). New `/ancient` (list) and `/ancient/[slug]` (detail with chapter picker + reader) routes that mirror the existing `/sutra/*` UI pattern but use a new reader component. `chinese-poetry/chinese-poetry@master/古文/*.json` ingested once via `scripts/build-classics.ts` (network-bound). WorksheetGenerator accepts `?source=ancient&book=<slug>&chapterIdx=<n>` and renders inter-sentence separator marks OUTSIDE cells at `。！？` boundaries, hidden in print mode.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MySQL 5.7 (`mysql2/promise`), Vitest, `@testing-library/user-event`, `pinyin-pro`, `opencc-js`. No new dependencies.

## Global Constraints

- Project convention: main branch (no feature branch); one commit per task; spec at `docs/superpowers/specs/2026-06-20-ancient-classics-design.md` (commit `38d63ddc`) is source of truth.
- MySQL 5.7 target — no `JSON_TABLE` (MySQL 8.0+). `JSON_LENGTH` is fine.
- Network dependency: `scripts/build-classics.ts` + re-running `scripts/build-poems.ts` for 宋词 require outbound HTTPS to `raw.githubusercontent.com`. Sandbox has no network — both scripts MUST soft-fail with a clear log message and `process.exit(1)` so the human can re-run on a network host before browser smoke.
- `useSutraReading` hook signature changes: `useSutraReading(storageKey = 'pinyin:sutra-reading')` — pass `'pinyin:classic-reading'` from `ClassicReader`. Sutra callers unchanged (default keeps prior behavior).
- Punctuation filter list (used by `isPunct` AND breakpoint detection):
  `。，！？；：、` (CJK full-width) + `""''「」（）()…—` (quotes/brackets/dashes).
- Separator rendering rule: separator `<div>` is rendered BETWEEN cells (never INSIDE a cell), `col-span-full` so it occupies a full grid row, `print:hidden` so it never appears in printed worksheets.
- All new components follow the existing `Sutra*` shape: server components by default, `'use client'` only for interactive pieces (CategoryNav, ChunkPicker, Reader).
- Test pattern: project uses `// @vitest-environment happy-dom` pragma + `import '@testing-library/jest-dom/vitest'` at top of component test files; `tests/unit/lib/*.test.ts` for pure logic; `tests/integration/api/*.test.ts` for API routes.
- All `classics` rows are public-readable (no `requireUser()`); only the worksheet-save endpoint requires login.
- 12 new files + 7 modified, one DB migration.

---

## Task 1: Data model + punctuation/breakpoint helpers (TDD)

**Files:**
- Create: `migrations/2026-06-20-classics.sql`
- Modify: `scripts/init-db.ts:13` (append CREATE TABLE to DDL array)
- Create: `lib/classics-types.ts`
- Create: `lib/punctuation.ts`
- Create: `tests/unit/lib/punctuation.test.ts`

**Interfaces:**
- Produces: `ClassicListItem`, `ClassicDetail`, `ClassicChunk`, `ClassicListResult` (types in `lib/classics-types.ts`)
- Produces: `isPunct(ch: string): boolean`, `SENT_END: ReadonlySet<string>`, `buildBreakpoints(chunk: ClassicChunk): Set<number>`, `stripPunct(s: string): string` (helpers in `lib/punctuation.ts`)

- [ ] **Step 1: Write the failing test for `lib/punctuation.ts`**

Create `tests/unit/lib/punctuation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isPunct, buildBreakpoints, stripPunct } from '@/lib/punctuation';
import type { ClassicChunk } from '@/lib/classics-types';

describe('isPunct', () => {
  it.each([
    '。', '，', '！', '？', '；', '：', '、',
    '"', '"', ''', ''', '「', '」', '（', '）', '(', ')', '…', '—',
  ])('returns true for %s', (ch) => {
    expect(isPunct(ch)).toBe(true);
  });
  it.each(['字', 'A', '1', ' '])('returns false for %s', (ch) => {
    expect(isPunct(ch)).toBe(false);
  });
  it('returns false for empty string', () => {
    expect(isPunct('')).toBe(false);
  });
});

describe('stripPunct', () => {
  it('removes all CJK punctuation', () => {
    expect(stripPunct('子曰:学而时习之。')).toBe('子曰学而时习之');
  });
  it('returns empty string for all-punct input', () => {
    expect(stripPunct('。！？')).toBe('');
  });
  it('returns input unchanged when no punct', () => {
    expect(stripPunct('学而')).toBe('学而');
  });
});

describe('buildBreakpoints', () => {
  const chunk: ClassicChunk = {
    id: 1,
    label: 'test',
    // 学而时习之。不亦说乎。有朋自远方来。
    content: ['学而时习之。不亦说乎。', '有朋自远方来。'],
    pinyin: [],
  };
  // 6 non-punct chars: 学 而 时 习 之 不 → 0..5
  // breakpoint BEFORE "不" (index 5) because prior char was "。"
  it('marks cell index after each 。！？ as a breakpoint', () => {
    const set = buildBreakpoints(chunk);
    expect(set.has(5)).toBe(true);
    // no breakpoint at index 0 (no preceding sentence)
    expect(set.has(0)).toBe(false);
  });

  it('handles ！ and ？ as sentence boundaries too', () => {
    const c: ClassicChunk = { id: 1, label: 't', content: ['善哉！善哉？'], pinyin: [] };
    const set = buildBreakpoints(c);
    // 4 chars: 善 哉 善 哉 → indices 0..3
    // breakpoint before char at index 2 (after ！) and index 3 (after ？)
    expect(set.has(2)).toBe(true);
    expect(set.has(3)).toBe(true);
  });

  it('returns empty set when chunk has no sentence-ending punctuation', () => {
    const c: ClassicChunk = { id: 1, label: 't', content: ['子曰学而'], pinyin: [] };
    expect(buildBreakpoints(c).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/punctuation.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '@/lib/punctuation'` or `classics-types`.

- [ ] **Step 3: Write types and helpers**

Create `lib/classics-types.ts`:
```ts
export type ClassicCategory =
  | 'four-books'
  | 'five-classics'
  | 'mengxue'
  | 'philosophy'
  | 'history'
  | 'other';

export interface ClassicChunk {
  id: number;          // 1-based, contiguous within book
  label: string;       // e.g. "学而第一", "第一篇", "乾"
  content: string[];   // lines of text including punctuation
  pinyin: string[][];  // line-aligned pinyin; punctuation chars → "" entry
}

export interface ClassicListItem {
  id: number;
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chunkCount: number;
  charCount: number;
}

export interface ClassicDetail {
  id: number;
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chunks: ClassicChunk[];
}

export interface ClassicListResult {
  items: ClassicListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

Create `lib/punctuation.ts`:
```ts
export const SENT_END: ReadonlySet<string> = new Set(['。', '！', '？']);

const PUNCT: ReadonlySet<string> = new Set([
  '。', '，', '！', '？', '；', '：', '、',
  '"', '"', ''', ''',
  '「', '」', '（', '）', '(', ')', '…', '—',
]);

export function isPunct(ch: string): boolean {
  if (!ch) return false;
  return PUNCT.has(ch);
}

export function stripPunct(s: string): string {
  return Array.from(s).filter(ch => !isPunct(ch)).join('');
}

/**
 * Returns cell indices where a separator should be inserted BEFORE that cell.
 * A cell at index N gets a separator if the original string had a sentence-end
 * punctuation (`。！？`) immediately before the non-punct char that produced
 * cell N.
 *
 * Example: '学而时习之。不亦说乎。' (10 chars total, 8 non-punct)
 *   non-punct chars: 学(0) 而(1) 时(2) 习(3) 之(4) 不(5) 亦(6) 说(7) 乎(8)
 *   breakpoint set: { 5 }  (before "不")
 */
export function buildBreakpoints(chunk: { content: string[] }): Set<number> {
  const set = new Set<number>();
  const chars = chunk.content.flatMap(line => Array.from(line));
  let cellIdx = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (isPunct(ch)) continue;
    const prev = i > 0 ? chars[i - 1]! : '';
    if (SENT_END.has(prev)) set.add(cellIdx);
    cellIdx++;
  }
  return set;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/punctuation.test.ts 2>&1 | tail -20`
Expected: PASS — all 12+ tests green.

- [ ] **Step 5: Add migration file and init-db entry**

Create `migrations/2026-06-20-classics.sql`:
```sql
-- Plan G6 — Ancient Classics table.
-- Stores classical Chinese texts (论语, 孟子, 弟子规, etc.) as JSON chunks,
-- each chunk = one chapter. Pinyin is pre-computed at ingest time.
CREATE TABLE IF NOT EXISTS classics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  category ENUM('four-books','five-classics','mengxue','philosophy','history','other') NOT NULL DEFAULT 'other',
  author VARCHAR(64) NULL,
  era VARCHAR(16) NULL,
  chunks JSON NOT NULL,
  chunk_count INT UNSIGNED GENERATED ALWAYS AS (JSON_LENGTH(chunks)) STORED,
  source VARCHAR(64) NOT NULL DEFAULT 'chinese-poetry@master',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug (slug),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Edit `scripts/init-db.ts` — append this DDL to the `DDL` array (after the last existing entry, before the closing `]`):
```ts
  `CREATE TABLE IF NOT EXISTS classics (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     slug VARCHAR(64) NOT NULL,
     title VARCHAR(128) NOT NULL,
     category ENUM('four-books','five-classics','mengxue','philosophy','history','other') NOT NULL DEFAULT 'other',
     author VARCHAR(64) NULL,
     era VARCHAR(16) NULL,
     chunks JSON NOT NULL,
     chunk_count INT UNSIGNED GENERATED ALWAYS AS (JSON_LENGTH(chunks)) STORED,
     source VARCHAR(64) NOT NULL DEFAULT 'chinese-poetry@master',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_slug (slug),
     KEY idx_category (category)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
```

- [ ] **Step 6: Run migration on dev DB**

Run: `pnpm tsx scripts/migrate.ts migrations/2026-06-20-classics.sql`
Expected: log line "Applied migrations/2026-06-20-classics.sql" or equivalent (matches existing migrate.ts output style). Verify with:
```bash
mysql -uroot -pAdmin909217 piyin_dev -e "DESCRIBE classics;"
```
Expected: 10 rows including `id`, `slug`, `title`, `category` (ENUM with 6 values), `chunks` (JSON), `chunk_count` (GENERATED).

- [ ] **Step 7: Commit**

```bash
git add migrations/2026-06-20-classics.sql scripts/init-db.ts lib/classics-types.ts lib/punctuation.ts tests/unit/lib/punctuation.test.ts
git commit -m "feat(classics): classics table migration + punctuation/breakpoint helpers"
```

---

## Task 2: `lib/classics.ts` — server data access (TDD)

**Files:**
- Create: `lib/classics.ts`
- Create: `tests/unit/lib/classics.test.ts`
- Consumes: `getPool()` from `lib/db`, types from `lib/classics-types.ts`

**Interfaces:**
- Produces: `listClassics(args: ListClassicsArgs): Promise<ClassicListResult>`, `getClassicBySlug(slug: string): Promise<ClassicDetail | null>`, `countByCategory(): Promise<Record<ClassicCategory, number>>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/classics.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { listClassics, getClassicBySlug, countByCategory } from '@/lib/classics';

async function reset() {
  const pool = getPool();
  await pool.execute('DELETE FROM classics');
}

async function insertFixture(slug: string, title: string, category: string, chunks: unknown[], author: string | null = null, era: string | null = null) {
  const pool = getPool();
  await pool.execute(
    'INSERT INTO classics (slug, title, category, author, era, chunks) VALUES (?, ?, ?, ?, ?, ?)',
    [slug, title, category, author, era, JSON.stringify(chunks)]
  );
}

describe('listClassics', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [
      { id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [[]] },
      { id: 2, label: '为政第二', content: ['子曰为政以德。'], pinyin: [[]] },
    ], '孔子', '春秋');
    await insertFixture('dizigui', '弟子规', 'mengxue', [
      { id: 1, label: '总叙', content: ['弟子规圣人训。'], pinyin: [[]] },
    ]);
  });
  afterAll(async () => { await closePool(); });

  it('returns all classics when no filter', async () => {
    const r = await listClassics({});
    expect(r.total).toBe(2);
    expect(r.items.map(i => i.slug)).toEqual(['lunyu', 'dizigui']);
  });

  it('filters by category', async () => {
    const r = await listClassics({ category: 'four-books' });
    expect(r.items.map(i => i.slug)).toEqual(['lunyu']);
  });

  it('filters by q (title match)', async () => {
    const r = await listClassics({ q: '弟子' });
    expect(r.items.map(i => i.slug)).toEqual(['dizigui']);
  });

  it('paginates', async () => {
    const r = await listClassics({ page: 1, pageSize: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(2);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(1);
  });

  it('computes chunkCount from JSON_LENGTH', async () => {
    const r = await listClassics({});
    const lunyu = r.items.find(i => i.slug === 'lunyu')!;
    expect(lunyu.chunkCount).toBe(2);
  });

  it('computes charCount from chunk content (excludes punctuation)', async () => {
    const r = await listClassics({});
    const lunyu = r.items.find(i => i.slug === 'lunyu')!;
    // 学而时习之 + 为政以德 = 10 non-punct chars
    expect(lunyu.charCount).toBe(10);
  });
});

describe('getClassicBySlug', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [
      { id: 1, label: '学而第一', content: ['子曰学而时习之。', '有朋自远方来。'], pinyin: [[], []] },
    ], '孔子', '春秋');
  });
  afterAll(async () => { await closePool(); });

  it('returns full detail with chunks parsed', async () => {
    const c = await getClassicBySlug('lunyu');
    expect(c).not.toBeNull();
    expect(c!.title).toBe('论语');
    expect(c!.author).toBe('孔子');
    expect(c!.era).toBe('春秋');
    expect(c!.chunks).toHaveLength(1);
    expect(c!.chunks[0]!.label).toBe('学而第一');
    expect(c!.chunks[0]!.content).toEqual(['子曰学而时习之。', '有朋自远方来。']);
  });

  it('returns null for nonexistent slug', async () => {
    const c = await getClassicBySlug('nonexistent');
    expect(c).toBeNull();
  });

  it('assigns sequential chunk ids when missing', async () => {
    await reset();
    await insertFixture('shijing', '诗经', 'five-classics', [
      { label: '关雎', content: ['关关雎鸠。'], pinyin: [[]] },
      { label: '蒹葭', content: ['蒹葭苍苍。'], pinyin: [[]] },
    ]);
    const c = await getClassicBySlug('shijing');
    expect(c!.chunks.map(x => x.id)).toEqual([1, 2]);
  });
});

describe('countByCategory', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [{ id: 1, label: 'x', content: [], pinyin: [] }]);
    await insertFixture('dizigui', '弟子规', 'mengxue', [{ id: 1, label: 'x', content: [], pinyin: [] }]);
  });
  afterAll(async () => { await closePool(); });

  it('returns counts keyed by category', async () => {
    const counts = await countByCategory();
    expect(counts['four-books']).toBe(1);
    expect(counts.mengxue).toBe(1);
    expect(counts['five-classics']).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/classics.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classics.ts`**

Create `lib/classics.ts`:
```ts
import 'server-only';
import { getPool } from './db';
import type {
  ClassicCategory,
  ClassicChunk,
  ClassicDetail,
  ClassicListItem,
  ClassicListResult,
} from './classics-types';
import { stripPunct } from './punctuation';

const PAGE_SIZE = 12;

export interface ListClassicsArgs {
  category?: ClassicCategory;
  q?: string;
  page?: number;
  pageSize?: number;
}

function buildWhereClause(args: ListClassicsArgs): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (args.category) {
    parts.push('category = ?');
    params.push(args.category);
  }
  if (args.q && args.q.trim()) {
    parts.push('title LIKE ?');
    params.push(`%${args.q.trim()}%`);
  }
  const where = parts.length === 0 ? '' : `WHERE ${parts.join(' AND ')}`;
  return { where, params };
}

function parseChunks(raw: unknown): ClassicChunk[] {
  const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw as ClassicChunk[]);
  return arr.map((c, i) => ({ id: c.id ?? i + 1, label: String(c.label ?? ''), content: c.content ?? [], pinyin: c.pinyin ?? [] }));
}

function computeCharCount(chunks: ClassicChunk[]): number {
  return chunks.reduce(
    (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(stripPunct(line)).length, 0),
    0,
  );
}

function mapListRow(r: { id: number; slug: string; title: string; category: ClassicCategory; author: string | null; era: string | null; chunks: unknown }): ClassicListItem {
  const chunks = parseChunks(r.chunks);
  return {
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    category: r.category,
    author: r.author,
    era: r.era,
    chunkCount: chunks.length,
    charCount: computeCharCount(chunks),
  };
}

export async function listClassics(args: ListClassicsArgs = {}): Promise<ClassicListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(50, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildWhereClause(args);

  const sql = `SELECT id, slug, title, category, author, era, chunks FROM classics
               ${where}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<any[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM classics ${where}`,
    params,
  );

  return {
    items: (rows as any[]).map(mapListRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getClassicBySlug(slug: string): Promise<ClassicDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, slug, title, category, author, era, chunks FROM classics WHERE slug = ? LIMIT 1`,
    [slug],
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  const chunks = parseChunks(row.chunks);
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    category: row.category,
    author: row.author,
    era: row.era,
    chunks,
  };
}

export async function countByCategory(): Promise<Record<ClassicCategory, number>> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT category, COUNT(*) AS n FROM classics GROUP BY category`,
  );
  const map: Record<ClassicCategory, number> = {
    'four-books': 0,
    'five-classics': 0,
    mengxue: 0,
    philosophy: 0,
    history: 0,
    other: 0,
  };
  for (const r of rows as any[]) {
    map[r.category as ClassicCategory] = Number(r.n);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/classics.test.ts 2>&1 | tail -15`
Expected: PASS — all 10+ tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/classics.ts tests/unit/lib/classics.test.ts
git commit -m "feat(classics): lib/classics.ts (listClassics, getClassicBySlug, countByCategory)"
```

---

## Task 3: API endpoints + validators (TDD)

**Files:**
- Create: `app/api/classics/route.ts`
- Create: `app/api/classics/[slug]/route.ts`
- Modify: `lib/validators.ts` (append `classicsListQuerySchema`, `classicSlugParamSchema`)
- Create: `tests/integration/api/classics.test.ts`

**Interfaces:**
- Consumes: `listClassics`, `getClassicBySlug` from Task 2
- Produces:
  - `GET /api/classics?category=&q=&page=&pageSize=` → `{ ok: true, data: ClassicListResult }`
  - `GET /api/classics/[slug]` → `{ ok: true, data: ClassicDetail }` or 404

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/classics.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4444';

beforeAll(async () => {
  const pool = getPool();
  await pool.execute('DELETE FROM classics');
  await pool.execute(
    `INSERT INTO classics (slug, title, category, author, era, chunks) VALUES
     ('lunyu', '论语', 'four-books', '孔子', '春秋', ?),
     ('dizigui', '弟子规', 'mengxue', NULL, '清', ?)`,
    [
      JSON.stringify([{ id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [[]] }]),
      JSON.stringify([{ id: 1, label: '总叙', content: ['弟子规圣人训。'], pinyin: [[]] }]),
    ],
  );
});
afterAll(async () => { await closePool(); });
beforeEach(async () => {});

describe('GET /api/classics', () => {
  it('returns list', async () => {
    const res = await fetch(`${BASE}/api/classics`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.data.total).toBe(2);
  });

  it('filters by category', async () => {
    const res = await fetch(`${BASE}/api/classics?category=four-books`);
    const data = await res.json();
    expect(data.data.items.map((i: any) => i.slug)).toEqual(['lunyu']);
  });

  it('rejects bad category', async () => {
    const res = await fetch(`${BASE}/api/classics?category=bogus`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/classics/[slug]', () => {
  it('returns detail', async () => {
    const res = await fetch(`${BASE}/api/classics/lunyu`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.title).toBe('论语');
    expect(data.data.author).toBe('孔子');
    expect(data.data.chunks).toHaveLength(1);
  });

  it('404 for missing', async () => {
    const res = await fetch(`${BASE}/api/classics/nope`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/classics.test.ts 2>&1 | tail -15`
Expected: FAIL — 404 or route not found.

- [ ] **Step 3: Add validators**

Append to `lib/validators.ts`:
```ts
export const classicsListQuerySchema = z.object({
  category: z.enum(['four-books', 'five-classics', 'mengxue', 'philosophy', 'history', 'other']).optional(),
  q: z.string().max(64).transform((s) => s.trim()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const classicSlugParamSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(64),
});
```

- [ ] **Step 4: Implement endpoints**

Create `app/api/classics/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { listClassics } from '@/lib/classics';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { classicsListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = classicsListQuerySchema.safeParse({
      category: sp.get('category') ?? undefined,
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listClassics(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
```

Create `app/api/classics/[slug]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getClassicBySlug } from '@/lib/classics';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { classicSlugParamSchema } from '@/lib/validators';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const { slug } = await ctx.params;
    const parsed = classicSlugParamSchema.safeParse({ slug });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const c = await getClassicBySlug(parsed.data.slug);
    if (!c) return notFound();
    return NextResponse.json({ ok: true, data: c });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/classics.test.ts 2>&1 | tail -15`
Expected: PASS — 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add app/api/classics/route.ts 'app/api/classics/[slug]/route.ts' lib/validators.ts tests/integration/api/classics.test.ts
git commit -m "feat(classics): GET /api/classics + /api/classics/[slug] endpoints"
```

---

## Task 4: Data ingestion — `build-classics.ts` + re-run `build-poems.ts` for 宋词

**Files:**
- Create: `scripts/build-classics.ts`
- Modify: `package.json:scripts` (add `fonts:ancient` line — optional, see step 4)

**Interfaces:**
- Produces: `buildClassics(): Promise<number>` — fetches chinese-poetry/古文 JSONs, OpenCC t2s, generates pinyin, UPSERTs by slug
- Network-bound; sandbox fails — must soft-fail with clear log

- [ ] **Step 1: Write `scripts/build-classics.ts`**

```ts
/**
 * Pull ancient Chinese classics (论语, 孟子, 弟子规, etc.) from
 * chinese-poetry/chinese-poetry GitHub repo, generate pinyin per char,
 * UPSERT into the `classics` table.
 *
 * Idempotent: safe to re-run. UPSERT by slug.
 * Network-bound: requires outbound HTTPS to raw.githubusercontent.com.
 * Fails soft on fetch error with a clear log + process.exit(1).
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

// slug → (upstream path, title, category, author, era)
const CLASSIC_FILES: Array<{
  path: string;
  slug: string;
  title: string;
  category: 'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other';
  author: string | null;
  era: string | null;
}> = [
  { path: '/古文/论语.json', slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋' },
  { path: '/古文/孟子.json', slug: 'mengzi', title: '孟子', category: 'four-books', author: '孟子', era: '战国' },
  { path: '/古文/大学.json', slug: 'daxue', title: '大学', category: 'four-books', author: '曾子', era: '春秋' },
  { path: '/古文中庸.json', slug: 'zhongyong', title: '中庸', category: 'four-books', author: '子思', era: '战国' },
  { path: '/古文/诗经.json', slug: 'shijing', title: '诗经', category: 'five-classics', author: null, era: '西周' },
  { path: '/古文/尚书.json', slug: 'shangshu', title: '尚书', category: 'five-classics', author: null, era: '上古' },
  { path: '/古文/礼记.json', slug: 'liji', title: '礼记', category: 'five-classics', author: null, era: '西汉' },
  { path: '/古文/易经.json', slug: 'yijing', title: '易经', category: 'five-classics', author: null, era: '上古' },
  { path: '/古文/春秋.json', slug: 'chunqiu', title: '春秋', category: 'five-classics', author: '孔子', era: '春秋' },
  { path: '/古文/弟子规.json', slug: 'dizigui', title: '弟子规', category: 'mengxue', author: '李毓秀', era: '清' },
  { path: '/古文/千字文.json', slug: 'qianziwen', title: '千字文', category: 'mengxue', author: '周兴嗣', era: '南朝' },
  { path: '/古文/三字经.json', slug: 'sanzijing', title: '三字经', category: 'mengxue', author: '王应麟', era: '宋' },
  { path: '/古文/百家姓.json', slug: 'baijiaxing', title: '百家姓', category: 'mengxue', author: null, era: '北宋' },
  { path: '/古文/道德经.json', slug: 'daodejing', title: '道德经', category: 'philosophy', author: '老子', era: '春秋' },
  { path: '/古文/庄子.json', slug: 'zhuangzi', title: '庄子', category: 'philosophy', author: '庄子', era: '战国' },
  { path: '/古文/列子.json', slug: 'liezi', title: '列子', category: 'philosophy', author: '列御寇', era: '战国' },
  { path: '/古文/史记.json', slug: 'shiji', title: '史记', category: 'history', author: '司马迁', era: '西汉' },
];

interface RawClassic {
  chapter?: string;
  paragraphs?: string[];
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const r = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'string') return r[0]!;
  } catch {
    /* fall through */
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

async function fetchFile(path: string): Promise<RawClassic[]> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`unexpected JSON shape from ${url}`);
  return data as RawClassic[];
}

export async function buildClassics(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const file of CLASSIC_FILES) {
    let raw: RawClassic[];
    try {
      raw = await fetchFile(file.path);
    } catch (err) {
      // Soft-fail: log and continue. File may not exist upstream (some are guesses).
      console.warn(`[build-classics] skip ${file.slug}: ${(err as Error).message}`);
      continue;
    }
    const chunks = raw
      .filter((c) => Array.isArray(c.paragraphs) && c.paragraphs.length > 0)
      .map((c, i) => {
        const content = (c.paragraphs as string[]).map((s) => t2s(s));
        const pinyinArr = content.map(linePinyin);
        return {
          id: i + 1,
          label: String(c.chapter ?? `第${i + 1}篇`).slice(0, 32),
          content,
          pinyin: pinyinArr,
        };
      });
    if (chunks.length === 0) {
      console.warn(`[build-classics] skip ${file.slug}: no chapters after parsing`);
      continue;
    }
    await pool.execute(
      `INSERT INTO classics (slug, title, category, author, era, chunks, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         category = VALUES(category),
         author = VALUES(author),
         era = VALUES(era),
         chunks = VALUES(chunks),
         source = VALUES(source)`,
      [file.slug, file.title, file.category, file.author, file.era, JSON.stringify(chunks), SOURCE_TAG],
    );
    inserted++;
    console.log(`[build-classics] ${file.slug}: ${chunks.length} chapters`);
  }
  return inserted;
}

if (require.main === module) {
  buildClassics()
    .then((n) => {
      console.log(`[build-classics] inserted/updated ${n} classics`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-classics] failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add npm script**

Modify `package.json` — add to the `scripts` section:
```json
    "build:classics": "tsx scripts/build-classics.ts",
```

- [ ] **Step 3: Run on sandbox — expect soft-fail, document**

Run: `pnpm run build:classics 2>&1 | tail -30`
Expected: Fetch fails with DNS / network error in sandbox. Script logs `[build-classics] skip lunyu: fetch ... → ENOTFOUND` etc., then exits 0 (because soft-fail per-file continues). End log shows `[build-classics] inserted/updated 0 classics`.

Verify nothing was inserted:
```bash
mysql -uroot -pAdmin909217 piyin_dev -e "SELECT COUNT(*) FROM classics;"
```
Expected: `0`.

Document in the report file: "Sandbox has no network. Human must run `pnpm run build:classics` on a network host before browser smoke."

- [ ] **Step 4: Re-run `build-poems.ts` for 宋词 — verify the upstream path**

The existing `scripts/build-poems.ts` has the upstream path `/%E5%AE%8B%E8%AF%8D/%E5%AE%8B%E8%AF%8D%E4%B8%89%E7%99%BE%E9%A6%96.json` (URL-encoded `宋词/宋词三百首.json`). Test on sandbox (will soft-fail same way), document in report: "If path doesn't match upstream, swap to verified path in build-poems.ts and re-run on network host."

- [ ] **Step 5: Commit**

```bash
git add scripts/build-classics.ts package.json
git commit -m "feat(classics): build-classics.ts (chinese-poetry/古文 ingestion, network-bound soft-fail)"
```

---

## Task 5: `/ancient` list page + components + `/ancient-texts` redirect (TDD)

**Files:**
- Create: `app/ancient/page.tsx` (RSC)
- Create: `app/ancient-texts/page.tsx` (replace with redirect to `/ancient`)
- Create: `components/classics/ClassicCategoryNav.tsx`
- Create: `components/classics/ClassicCard.tsx`
- Create: `tests/unit/components/classics/ClassicCard.test.tsx`
- Modify: `lib/design.ts` (`NAV_LINKS` `/ancient-texts` → `/ancient`)
- Modify: `components/Header.tsx` — no code change needed if NAV_LINKS handles it (verify; if Header has hardcoded reference, update)

**Interfaces:**
- Consumes: `listClassics`, `countByCategory` from Task 2
- Produces: `/ancient` server-rendered list page with category nav + book cards + pagination + search

- [ ] **Step 1: Write the failing test for ClassicCard**

Create `tests/unit/components/classics/ClassicCard.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ClassicCard } from '@/components/classics/ClassicCard';

describe('ClassicCard', () => {
  it('renders title wrapped in 《》', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋', chunkCount: 20, charCount: 5000 }} />);
    expect(container.querySelector('h3')).toHaveTextContent('《论语》');
  });

  it('shows chunk and char counts', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: null, era: null, chunkCount: 20, charCount: 5000 }} />);
    expect(container.textContent).toMatch(/20 章/);
    expect(container.textContent).toMatch(/5000 字/);
  });

  it('links to /ancient/[slug]', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: null, era: null, chunkCount: 1, charCount: 100 }} />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/ancient/lunyu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/classics/ClassicCard.test.tsx 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ClassicCard**

Create `components/classics/ClassicCard.tsx`:
```tsx
import Link from 'next/link';
import type { ClassicListItem } from '@/lib/classics-types';

const CATEGORY_LABELS: Record<string, string> = {
  'four-books': '四书',
  'five-classics': '五经',
  'mengxue': '蒙学',
  'philosophy': '诸子',
  'history': '史书',
  'other': '其他',
};

export function ClassicCard({ item }: { item: ClassicListItem }) {
  return (
    <Link
      href={`/ancient/${item.slug}`}
      className="card-paper p-4 flex flex-col gap-2 hover:border-seal transition-colors group"
    >
      <h3 className="font-kai text-lg text-ink leading-tight group-hover:text-seal transition-colors">
        《{item.title}》
      </h3>
      <div className="text-xs text-ink-faint">
        {[item.author, item.era].filter(Boolean).join(' · ')}
      </div>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        <span className="text-xs text-ink-faint">
          {item.chunkCount} 章 · {item.charCount} 字
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/classics/ClassicCard.test.tsx 2>&1 | tail -15`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Implement ClassicCategoryNav**

Create `components/classics/ClassicCategoryNav.tsx`:
```tsx
import Link from 'next/link';

interface Props {
  current: string | 'all';
  counts: Record<string, number>;
}

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'four-books', label: '四书' },
  { value: 'five-classics', label: '五经' },
  { value: 'mengxue', label: '蒙学' },
  { value: 'philosophy', label: '诸子' },
  { value: 'history', label: '史书' },
];

export function ClassicCategoryNav({ current, counts }: Props) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-2 mb-6 border-b border-ink/10" aria-label="古籍分类">
      {CATEGORIES.map((c) => {
        const active = current === c.value;
        const href = c.value === 'all' ? '/ancient' : `/ancient?category=${c.value}`;
        const n = c.value === 'all'
          ? Object.values(counts).reduce((s, v) => s + v, 0)
          : (counts[c.value] ?? 0);
        return (
          <Link
            key={c.value}
            href={href}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
              active ? 'bg-seal text-white' : 'bg-paper-deep text-ink-soft hover:bg-ink/10'
            }`}
          >
            {c.label} <span className="ml-1 opacity-70">({n})</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Implement `/ancient` list page**

Create `app/ancient/page.tsx`:
```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicCategoryNav } from '@/components/classics/ClassicCategoryNav';
import { ClassicCard } from '@/components/classics/ClassicCard';
import { listClassics, countByCategory } from '@/lib/classics';
import type { ClassicCategory } from '@/lib/classics-types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '古籍 · 字·韵',
  description: '四书五经、弟子规 等经典文本,提供原文与拼音注释,可一键生成字帖。',
};

interface Props {
  searchParams: Promise<{ category?: string; q?: string; page?: string }>;
}

const VALID_CATS = new Set<ClassicCategory>(['four-books', 'five-classics', 'mengxue', 'philosophy', 'history', 'other']);

export default async function AncientListPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawCat = sp.category;
  const category: ClassicCategory | undefined = rawCat && VALID_CATS.has(rawCat as ClassicCategory) ? (rawCat as ClassicCategory) : undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const [result, counts] = await Promise.all([
    listClassics({ category, q: sp.q, page, pageSize: 12 }),
    countByCategory(),
  ]);

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-8 space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold text-ink font-kai">古籍 / Classical Texts</h1>
            <p className="text-sm text-ink-soft">
              四书五经、蒙学、诸子、史书 — 经典文本 + 拼音注释,可一键生成字帖。
            </p>
          </header>

          <ClassicCategoryNav current={category ?? 'all'} counts={counts} />

          <form action="/ancient" method="GET" className="flex gap-2">
            {category && <input type="hidden" name="category" value={category} />}
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="搜索书名 (如 论语, 弟子规)..."
              className="flex-1 rounded-md border border-ink/20 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-seal px-4 py-2 text-white text-sm hover:bg-seal/80">
              搜索
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="py-12 text-center text-ink-faint">
              暂无数据。先在网络主机跑 <code className="bg-paper-deep px-1 rounded">pnpm run build:classics</code> 导入。
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.items.map((item) => (
                <ClassicCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {result.total > result.pageSize && (
            <div className="flex items-center justify-center gap-2 pt-4">
              {page > 1 && (
                <a href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page - 1) }).toString()}`} className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep">
                  ← 上一页
                </a>
              )}
              <span className="text-sm text-ink-faint">
                第 {page} / {Math.ceil(result.total / result.pageSize)} 页
              </span>
              {page * result.pageSize < result.total && (
                <a href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page + 1) }).toString()}`} className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep">
                  下一页 →
                </a>
              )}
            </div>
          )}
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 7: Replace `/ancient-texts` placeholder with redirect**

Replace `app/ancient-texts/page.tsx` content:
```tsx
import { redirect } from 'next/navigation';

export default function AncientTextsRedirect() {
  redirect('/ancient');
}
```

- [ ] **Step 8: Update `NAV_LINKS`**

Modify `lib/design.ts` — change the ancient-texts entry:
```ts
  { href: '/ancient', label: '古籍' },
```

- [ ] **Step 9: tsc + manual smoke check**

Run: `pnpm tsc --noEmit 2>&1 | tail -10`
Expected: clean (no errors in new files).

Run: `pnpm build 2>&1 | tail -20` — verify build green.
Expected: exit 0, route count should be +2 (`/ancient`, `/api/classics/[slug]`) from G5's 129 ≈ 131.

Run a quick `curl http://localhost:4444/ancient` (dev server must be running) — expect 200 with empty list (DB is empty in sandbox).

- [ ] **Step 10: Commit**

```bash
git add app/ancient/page.tsx app/ancient-texts/page.tsx components/classics/ components/classics/ClassicCategoryNav.tsx tests/unit/components/classics/ lib/design.ts
git commit -m "feat(ancient): /ancient list page + ClassicCard/ClassicCategoryNav + /ancient-texts redirect"
```

---

## Task 6: `/ancient/[slug]` detail page + reader (TDD)

**Files:**
- Create: `app/ancient/[slug]/page.tsx`
- Create: `components/classics/ClassicChunkPicker.tsx`
- Create: `components/classics/ClassicReader.tsx`
- Create: `tests/unit/components/classics/ClassicReader.test.tsx`
- Modify: `lib/use-sutra-reading.ts` — accept `storageKey` arg

**Interfaces:**
- Consumes: `getClassicBySlug`, `stripPunct`, `buildBreakpoints` from prior tasks
- Produces: `/ancient/[slug]` server-rendered detail with chunk picker + pinyin reader + "生成字帖" CTA + 上一章/下一章

- [ ] **Step 1: Update `useSutraReading` to accept storageKey**

Modify `lib/use-sutra-reading.ts`:
```ts
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUTRA_READING, type SutraReading } from './sutra-reading';

function isValid(v: string | null): v is SutraReading {
  return v === 'horizontal' || v === 'vertical-rtl' || v === 'vertical-ltr';
}

export function useSutraReading(storageKey = 'pinyin:sutra-reading'): [SutraReading, (next: SutraReading) => void] {
  const [reading, setReading] = useState<SutraReading>(DEFAULT_SUTRA_READING);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(storageKey);
    setReading(isValid(v) ? v : DEFAULT_SUTRA_READING);
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && isValid(e.newValue)) {
        setReading(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const update = (next: SutraReading) => {
    setReading(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, next);
    }
  };

  return [reading, update];
}
```

- [ ] **Step 2: Write the failing test for ClassicReader**

Create `tests/unit/components/classics/ClassicReader.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ClassicReader } from '@/components/classics/ClassicReader';
import type { ClassicChunk } from '@/lib/classics-types';

const SAMPLE_CHUNK: ClassicChunk = {
  id: 1,
  label: '学而第一',
  content: ['子曰:学而时习之。不亦说乎。'],
  pinyin: [['zǐ', 'yuē', '', 'xué', 'ér', 'shí', 'xí', 'zhī', '', 'bù', 'yì', 'yuè', 'hū', '']],
};

describe('ClassicReader', () => {
  it('renders non-punct chars as char spans', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    const charSpans = container.querySelectorAll('.classic-char');
    expect(charSpans.length).toBe(9); // 子曰学而时习之不亦说乎
  });

  it('does not render punctuation as char spans', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    expect(container.textContent).not.toContain('。');
  });

  it('renders worksheet CTA link with prefill', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    const cta = container.querySelector('a[href*="/worksheet"]');
    expect(cta).not.toBeNull();
    // prefill should be the chars without punctuation
    expect(cta!.getAttribute('href')).toContain('source=ancient');
    expect(cta!.getAttribute('href')).toContain('book=lunyu');
    expect(cta!.getAttribute('href')).toContain('chapterIdx=0');
    expect(cta!.getAttribute('href')).toContain('prefill=');
    // The prefill should contain 子曰学而时习之不亦说乎
    const m = cta!.getAttribute('href')!.match(/prefill=([^&]+)/);
    expect(m).not.toBeNull();
    const decoded = decodeURIComponent(m![1]!);
    expect(decoded).toBe('子曰学而时习之不亦说乎');
  });

  it('disables 上一章 button on first chunk', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK, { ...SAMPLE_CHUNK, id: 2, label: '为政' }] }} />,
    );
    const prevBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('上一章'));
    expect(prevBtn).toBeDisabled();
  });

  it('disables 下一章 button on last chunk', () => {
    const chunks = [{ ...SAMPLE_CHUNK, id: 1, label: '学而' }, { ...SAMPLE_CHUNK, id: 2, label: '为政' }];
    const last = chunks[chunks.length - 1]!;
    const { container } = render(<ClassicReader chunk={last} book={{ slug: 'lunyu', title: '论语', chunks }} />);
    const nextBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('下一章'));
    expect(nextBtn).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/classics/ClassicReader.test.tsx 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement ClassicReader**

Create `components/classics/ClassicReader.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClassicChunk, ClassicDetail } from '@/lib/classics-types';
import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';
import { SUTRA_READING_LABELS, type SutraReading } from '@/lib/sutra-reading';
import { isPunct, stripPunct } from '@/lib/punctuation';

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

interface Props {
  chunk: ClassicChunk;
  book: Pick<ClassicDetail, 'slug' | 'title' | 'chunks'>;
}

export function ClassicReader({ chunk, book }: Props) {
  const [reading, setReading] = useSutraReading('pinyin:classic-reading');
  const isVertical = reading !== 'horizontal';

  const charsAndPinyin: Array<{ ch: string; py: string }> = [];
  for (let lineIdx = 0; lineIdx < chunk.content.length; lineIdx++) {
    const line = chunk.content[lineIdx]!;
    const linePinyin = chunk.pinyin[lineIdx] ?? [];
    Array.from(line).forEach((ch, i) => {
      if (isPunct(ch)) return;
      charsAndPinyin.push({ ch, py: linePinyin[i] ?? '' });
    });
  }

  const prefill = encodeURIComponent(charsAndPinyin.map(c => c.ch).join(''));
  const worksheetHref = `/worksheet?source=ancient&book=${book.slug}&chapterIdx=${chunk.id - 1}&prefill=${prefill}`;

  const currentIdx = chunk.id - 1;
  const prevChunk = currentIdx > 0 ? book.chunks[currentIdx - 1] : null;
  const nextChunk = currentIdx < book.chunks.length - 1 ? book.chunks[currentIdx + 1] : null;

  return (
    <div className="space-y-4">
      <div className="worksheet-no-print flex items-center justify-between gap-4 flex-wrap">
        <ReadingModePicker value={reading} onChange={setReading} />
        <span className="text-xs text-ink-faint">{SUTRA_READING_LABELS[reading]}</span>
      </div>

      <article
        className="font-serif text-lg sm:text-xl text-ink leading-loose"
        style={isVertical ? { writingMode: WRITING_MODE[reading] as 'vertical-rl' | 'vertical-lr' } : undefined}
      >
        {chunk.content.map((line, lineIdx) => (
          <p key={lineIdx} className={isVertical ? 'mx-3 inline-block' : 'my-1.5'}>
            {Array.from(line).map((ch, i) => {
              if (isPunct(ch)) return null;
              const py = chunk.pinyin[lineIdx]?.[i] ?? '';
              return (
                <span key={i} className="classic-char inline-block px-1.5 py-0.5">
                  <span className="block">{ch}</span>
                  <span className="block text-[0.65em] text-ink-faint text-center">{py}</span>
                </span>
              );
            })}
          </p>
        ))}
      </article>

      <div className="worksheet-no-print flex items-center justify-between gap-2 pt-4 border-t border-ink/10">
        <button
          type="button"
          disabled={!prevChunk}
          onClick={() => prevChunk && (window.location.href = `/ancient/${book.slug}?chunk=${prevChunk.id - 1}`)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← 上一章
        </button>
        <Link
          href={worksheetHref}
          className="rounded-md bg-seal px-4 py-2 text-white text-sm hover:bg-seal/80"
        >
          生成字帖
        </Link>
        <button
          type="button"
          disabled={!nextChunk}
          onClick={() => nextChunk && (window.location.href = `/ancient/${book.slug}?chunk=${nextChunk.id - 1}`)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下一章 →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement ClassicChunkPicker**

Create `components/classics/ClassicChunkPicker.tsx`:
```tsx
'use client';

import type { ClassicChunk } from '@/lib/classics-types';

interface Props {
  slug: string;
  chunks: Pick<ClassicChunk, 'id' | 'label'>[];
  activeId: number;
}

export function ClassicChunkPicker({ slug, chunks, activeId }: Props) {
  if (chunks.length <= 1) return null;
  return (
    <>
      <aside className="hidden md:block sticky top-4 w-48 shrink-0">
        <div className="card-paper p-3">
          <div className="text-xs text-ink-faint mb-2 px-1">章</div>
          <ul className="space-y-1 max-h-[28rem] overflow-y-auto">
            {chunks.map((c) => (
              <li key={c.id}>
                <a
                  href={`/ancient/${slug}?chunk=${c.id - 1}`}
                  className={`block px-2 py-1.5 rounded text-sm transition-colors ${
                    activeId === c.id
                      ? 'bg-seal/10 text-seal border-l-2 border-seal'
                      : 'text-ink-soft hover:bg-paper-deep'
                  }`}
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="md:hidden mb-4">
        <label className="block text-xs text-ink-faint mb-1">章</label>
        <select
          value={activeId}
          onChange={(e) => { window.location.href = `/ancient/${slug}?chunk=${Number(e.target.value) - 1}`; }}
          className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2"
        >
          {chunks.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Implement `/ancient/[slug]` page**

Create `app/ancient/[slug]/page.tsx`:
```tsx
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicChunkPicker } from '@/components/classics/ClassicChunkPicker';
import { ClassicReader } from '@/components/classics/ClassicReader';
import { getClassicBySlug } from '@/lib/classics';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chunk?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const c = await getClassicBySlug(slug);
  if (!c) return { title: '古籍 · 字·韵' };
  return { title: `${c.title} · 古籍 · 字·韵` };
}

export default async function ClassicDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const book = await getClassicBySlug(slug);
  if (!book) notFound();

  const requested = Number(sp.chunk ?? '0');
  const activeIdx = Number.isInteger(requested) && requested >= 0 && requested < book.chunks.length ? requested : 0;
  const activeChunk = book.chunks[activeIdx]!;

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-6 space-y-4">
          <div className="worksheet-no-print">
            <Link href="/ancient" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal">
              ← 返回古籍列表
            </Link>
          </div>
          <header className="worksheet-no-print">
            <h1 className="text-2xl font-bold text-ink font-kai">《{book.title}》</h1>
            <p className="text-sm text-ink-soft mt-1">
              {[book.author, book.era].filter(Boolean).join(' · ')}
              {book.chunks.length > 1 && ` · ${activeChunk.label}`}
            </p>
          </header>

          <div className="flex gap-6">
            <Suspense fallback={null}>
              <ClassicChunkPicker
                slug={book.slug}
                chunks={book.chunks.map(c => ({ id: c.id, label: c.label }))}
                activeId={activeChunk.id}
              />
            </Suspense>
            <div className="flex-1 min-w-0">
              <ClassicReader chunk={activeChunk} book={book} />
            </div>
          </div>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/classics/ClassicReader.test.tsx 2>&1 | tail -15`
Expected: PASS — 5 tests green.

- [ ] **Step 8: tsc + manual smoke**

Run: `pnpm tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Visit `http://localhost:4444/ancient/lunyu` (after Task 4 ingestion) — expect chapter picker + reader.

- [ ] **Step 9: Commit**

```bash
git add app/ancient/\[slug\]/page.tsx components/classics/ClassicChunkPicker.tsx components/classics/ClassicReader.tsx lib/use-sutra-reading.ts tests/unit/components/classics/ClassicReader.test.tsx
git commit -m "feat(ancient): /ancient/[slug] detail page + ClassicChunkPicker/ClassicReader"
```

---

## Task 7: Worksheet integration — separator rendering + source=ancient wiring (TDD)

**Files:**
- Modify: `components/worksheet/WorksheetPreview.tsx` (add `breakpoints` prop + separator render)
- Modify: `components/worksheet/WorksheetGenerator.tsx` (read `source/book/chapterIdx` query, fetch chunk, render 上一章/下一章 buttons, pass breakpoints to preview)
- Create: `tests/unit/components/worksheet/WorksheetPreview-breakpoints.test.tsx`
- Create: `tests/unit/components/worksheet/WorksheetGenerator-ancient.test.tsx`

**Interfaces:**
- Produces: `WorksheetPreview` accepts optional `breakpoints?: Set<number>` prop; renders separator divs BETWEEN cells (not inside) at those indices, with class `worksheet-cell-sep col-span-full print:hidden`
- Produces: `WorksheetGenerator` reads `source=ancient&book=<slug>&chapterIdx=<n>` from `useSearchParams`; when source=ancient, fetches `/api/classics/<slug>` on mount + chapter change; shows 上一章/下一章 buttons (only when source=ancient and prev/next chunk exist); passes breakpoints to WorksheetPreview

- [ ] **Step 1: Write failing test for WorksheetPreview separator**

Create `tests/unit/components/worksheet/WorksheetPreview-breakpoints.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';

const baseProps = {
  content: ['学', '而', '时', '习', '之', '不', '亦', '说', '乎'],
  cellStyle: 'pen-square' as const,
  paperSize: 'A4' as const,
  fontFamily: 'song' as const,
  showHeader: false,
};

describe('WorksheetPreview with breakpoints', () => {
  it('renders separator div at breakpoint index', () => {
    // Breakpoint BEFORE cell at index 5 (between "之" and "不") — mimics 。 after "之"
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set([5])} />,
    );
    const seps = container.querySelectorAll('.worksheet-cell-sep');
    expect(seps).toHaveLength(1);
    expect(seps[0]).toHaveClass('print:hidden');
    expect(seps[0]).toHaveClass('col-span-full');
  });

  it('renders no separator when breakpoints is empty', () => {
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set()} />,
    );
    expect(container.querySelectorAll('.worksheet-cell-sep')).toHaveLength(0);
  });

  it('does not render separator when breakpoints prop is omitted', () => {
    const { container } = render(<WorksheetPreview {...baseProps} />);
    expect(container.querySelectorAll('.worksheet-cell-sep')).toHaveLength(0);
  });

  it('separator is OUTSIDE any worksheet-cell div', () => {
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set([5])} />,
    );
    const sep = container.querySelector('.worksheet-cell-sep');
    expect(sep?.querySelector('.worksheet-cell')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/worksheet/WorksheetPreview-breakpoints.test.tsx 2>&1 | tail -15`
Expected: FAIL — breakpoints prop not accepted.

- [ ] **Step 3: Update `WorksheetPreview` to accept `breakpoints` prop**

Modify `components/worksheet/WorksheetPreview.tsx` — change `BaseProps` and the cells map:

Replace the `BaseProps` block (around lines 17-24):
```tsx
interface BaseProps {
  title?: string;
  content: string[];
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  showHeader?: boolean;
  breakpoints?: Set<number>;
}
```

Replace the cells map (around lines 96-100):
```tsx
          {cells.map((cell) => (
            <Fragment key={cell.index}>
              {props.breakpoints?.has(cell.index) && (
                <div className="worksheet-cell-sep col-span-full text-center text-xs text-ink-faint py-1 print:hidden" aria-hidden>
                  · 句 ·
                </div>
              )}
              <div className="worksheet-cell">
                <WorksheetCell char={cell.char} style={cell.style} size={cellSize} fontFamily={props.fontFamily} />
              </div>
            </Fragment>
          ))}
```

Add at the top of the file:
```tsx
import { Fragment } from 'react';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/worksheet/WorksheetPreview-breakpoints.test.tsx 2>&1 | tail -15`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Write failing test for WorksheetGenerator ancient wiring**

Create `tests/unit/components/worksheet/WorksheetGenerator-ancient.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Mock next/navigation so useSearchParams returns our params
const mockSearchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => mockSearchParams.get(k) ?? null }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/worksheet',
}));

// Mock /api/classics
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock the user store
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: any) => sel({ user: null }),
}));

import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';

describe('WorksheetGenerator with source=ancient', () => {
  beforeEach(() => {
    mockSearchParams.clear();
    mockFetch.mockReset();
  });

  it('preloads chars from /api/classics when source=ancient', async () => {
    mockSearchParams.set('source', 'ancient');
    mockSearchParams.set('book', 'lunyu');
    mockSearchParams.set('chapterIdx', '0');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋',
          chunks: [
            { id: 1, label: '学而第一', content: ['子曰:学而时习之。'], pinyin: [] },
          ],
        },
      }),
    });
    render(<WorksheetGenerator />);
    // Wait for fetch + render
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledWith('/api/classics/lunyu');
  });

  it('shows 上一章/下一章 buttons when source=ancient and chapter loaded', async () => {
    mockSearchParams.set('source', 'ancient');
    mockSearchParams.set('book', 'lunyu');
    mockSearchParams.set('chapterIdx', '0');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋',
          chunks: [
            { id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [] },
            { id: 2, label: '为政第二', content: ['子曰为政以德。'], pinyin: [] },
          ],
        },
      }),
    });
    render(<WorksheetGenerator />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: /下一章/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上一章/ })).toBeInTheDocument();
  });

  it('does NOT show 上一章/下一章 when source is not ancient', async () => {
    mockSearchParams.set('prefill', '你好');
    render(<WorksheetGenerator />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /下一章/ })).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/worksheet/WorksheetGenerator-ancient.test.tsx 2>&1 | tail -15`
Expected: FAIL — wiring not in place.

- [ ] **Step 7: Update WorksheetGenerator**

Modify `components/worksheet/WorksheetGenerator.tsx`. Add imports and state:

Add to imports (top of file):
```tsx
import type { ClassicDetail } from '@/lib/classics-types';
import { stripPunct } from '@/lib/punctuation';
```

Inside the component, after existing useState declarations (around line 36):
```tsx
  const [ancientBook, setAncientBook] = useState<ClassicDetail | null>(null);
  const [chapterIdx, setChapterIdx] = useState<number>(
    Number(sp.get('chapterIdx') ?? '0') || 0,
  );

  const source = sp.get('source');
  const bookSlug = sp.get('book');
  const isAncient = source === 'ancient' && !!bookSlug;
```

Add a useEffect to fetch the classic when source=ancient (after the existing useEffects around line 56):
```tsx
  // Ancient mode: fetch book once, then update content on chapter change
  useEffect(() => {
    if (!isAncient || !bookSlug) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/classics/${bookSlug}`);
      const data = await res.json();
      if (cancelled || !data.ok) return;
      const book: ClassicDetail = data.data;
      setAncientBook(book);
      const idx = Math.max(0, Math.min(chapterIdx, book.chunks.length - 1));
      const chunk = book.chunks[idx]!;
      const chars = chunk.content
        .flatMap(line => Array.from(stripPunct(line)));
      setContent(chars);
      setTab('text');
    })();
    return () => { cancelled = true; };
  }, [isAncient, bookSlug, chapterIdx]);
```

Add a `breakpoints` computation (after `canPreview` line):
```tsx
  const breakpoints = useMemo(() => {
    if (!isAncient || !ancientBook) return undefined;
    const chunk = ancientBook.chunks[chapterIdx];
    if (!chunk) return undefined;
    return buildBreakpoints(chunk);
  }, [isAncient, ancientBook, chapterIdx]);
```

Add `import { useMemo } from 'react'` to the imports.

Replace the `<WorksheetPreview ... />` props in the view='preview' branch to include `breakpoints`:
```tsx
      <WorksheetPreview
        title={title}
        content={content}
        cellStyle={composeCellStyle(tool, presentation)}
        paperSize={paperSize}
        fontFamily={fontFamily}
        breakpoints={breakpoints}
        onBack={() => setView('form')}
        onSave={handleSave}
        saving={saving}
        savedId={savedId}
      />
```

Add 上一章/下一章 buttons to the form view, visible only when `isAncient && ancientBook`. Add this inside the `.flex.flex-col.items-end.gap-2` div (around line 226), BEFORE the existing "生成字帖" button:
```tsx
        {isAncient && ancientBook && (
          <div className="flex gap-2 self-end">
            <button
              type="button"
              disabled={chapterIdx <= 0}
              onClick={() => setChapterIdx(i => i - 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              ← 上一章
            </button>
            <button
              type="button"
              disabled={chapterIdx >= ancientBook.chunks.length - 1}
              onClick={() => setChapterIdx(i => i + 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              下一章 →
            </button>
          </div>
        )}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/components/worksheet/WorksheetGenerator-ancient.test.tsx 2>&1 | tail -15`
Expected: PASS — 3 tests green.

- [ ] **Step 9: Run all tests + tsc + build**

Run: `pnpm tsc --noEmit 2>&1 | tail -10` — expect clean.
Run: `pnpm vitest run tests/unit tests/integration/api/classics.test.ts tests/unit/components/classics tests/unit/components/worksheet/WorksheetPreview-breakpoints.test.tsx 2>&1 | tail -20` — expect all green.
Run: `pnpm build 2>&1 | tail -15` — expect exit 0, +2 routes from G5.

- [ ] **Step 10: Commit**

```bash
git add components/worksheet/WorksheetPreview.tsx components/worksheet/WorksheetGenerator.tsx tests/unit/components/worksheet/
git commit -m "feat(worksheet): source=ancient wiring + inter-sentence separator rendering OUTSIDE cells"
```

---

## Task 8: Final verification + push to origin/main

**Files:** none new. Verification only.

**Goal:** tsc + tests + build clean; smoke-tested end-to-end on dev server with seeded data; push to origin.

- [ ] **Step 1: Run full verification suite**

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm build
```

Expected:
- tsc: clean
- vitest: 95%+ pass (pre-existing 1-2 fails unrelated — `etymology.test.ts`, `admin-extensions.test.ts`, `downloads.test.ts` per MEMORY)
- build: exit 0, ~131 routes (G5's 129 + `/ancient` + `/api/classics/[slug]`)

- [ ] **Step 2: Browser smoke checklist (human runs; document results in report)**

Start dev server (if not running):
```bash
pnpm dev
```

Human smoke (one-by-one):
1. Visit `/ancient` → see category tabs + book cards (empty if no data ingested; rebuild data on network host first via `pnpm run build:classics`).
2. After ingestion: see 论语/孟子/弟子规 etc. Click 论语 → chapter picker + reader with pinyin.
3. Click "生成字帖" → arrive at `/worksheet?source=ancient&book=lunyu&chapterIdx=0&prefill=...`. Switch tool to 毛笔 (allowed). Change font/paper.
4. Worksheet preview shows "· 句 ·" separators BETWEEN cells at `。！？` boundaries, OUTSIDE cells.
5. Print preview (Ctrl+P) → separators hidden via `print:hidden`.
6. Click "下一章" on worksheet → chars replace with next chapter's. Title/tool/font/paper preserved.
7. Visit `/poetry` → click 宋词 → see poems populated (after `pnpm build:poems` on network host).
8. Visit `/ancient-texts` → redirects to `/ancient`.

- [ ] **Step 3: If any smoke step fails, dispatch fix subagent per superpowers:subagent-driven-development**

If human smoke reveals a defect, dispatch ONE fix subagent with the full findings list. Do NOT bundle multiple fixes into this commit — each fix is its own commit.

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```

Expected: pushed 7 commits (plan + Task 1-7).

- [ ] **Step 5: Update MEMORY + progress ledger**

Add MEMORY entry: `Plan G6 — SHIPPED 2026-06-XX, awaiting human smoke`.

Update `.git/sdd/progress.md`:
- Mark all 8 tasks complete
- Record commit hashes from `git log --oneline main ^38d63ddc | head -10`
- Note pending smoke items + network-bound ingestion caveat

---

## Self-review checklist

- [x] Spec coverage: data model (Task 1) + ingestion (Task 4) + API (Task 3) + list page (Task 5) + detail page (Task 6) + worksheet integration (Task 7) all present
- [x] Placeholder scan: no TBD/TODO/FIXME
- [x] Type consistency: `ClassicChunk`, `ClassicDetail`, `ClassicListItem`, `ClassicListResult`, `ClassicCategory` defined in Task 1 used in Tasks 2, 3, 5, 6; `isPunct`/`buildBreakpoints`/`stripPunct` defined in Task 1 used in Tasks 2, 6, 7
- [x] File paths consistent with spec (`lib/classics-types.ts`, `lib/punctuation.ts`, `components/classics/*`, `app/ancient/*`)
- [x] All test files include `// @vitest-environment happy-dom` + `import '@testing-library/jest-dom/vitest'` pragma per project convention (7 worksheet test files use this pattern)
- [x] Migration file + init-db entry are both updated atomically in Task 1
- [x] Network-bound scripts soft-fail and document the requirement clearly (Task 4)
- [x] Punctuation filter list is identical between `lib/punctuation.ts` Task 1 and the spec's "Global Constraints" section
- [x] `useSutraReading` signature change is backwards-compatible (default arg); sutra callers unchanged
