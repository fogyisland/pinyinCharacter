# Plan F: 抄佛经 (Sutra list/detail/chunk picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a /sutra list + /sutra/[id] detail page that renders ~12 Buddhist sutras as worksheets (米字格 + pinyin), chunked by 品/段落, with save-as-worksheet reusing the existing /worksheet system.

**Architecture:** Mirror the existing /poetry (唐诗宋词) structure — same WorksheetCell, same SaveAsWorksheetButton pattern, same /api/worksheets endpoint. New `sutras` table, new `lib/sutras.ts` server lib with `splitIntoChunks` helper, new client components under `components/sutra/`, new pages under `app/sutra/`. Build script `scripts/build-sutras.ts` fetches from `chinese-poetry/chinese-poetry@master/佛经/` and UPSERTs. Wire into existing `initDb` so the table auto-populates on first run.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MySQL (mysql2), zod, pinyin-pro, vitest, happy-dom.

**Reference:** Design spec at `docs/superpowers/specs/2026-06-12-buddhist-sutra-worksheet-design.md`. Mirror 唐诗宋词 implementation: `lib/poetry.ts`, `lib/poetry-types.ts`, `app/poetry/page.tsx`, `app/poetry/[id]/page.tsx`, `scripts/build-poems.ts`, `components/poetry/*`.

---

## File Structure

**New files (server):**
- `lib/sutra-types.ts` — shared types (SutraListItem, SutraChunk, SutraDetail, SutraListResult)
- `lib/sutras.ts` — listSutras, getSutra, splitIntoChunks
- `app/api/sutras/route.ts` — GET list
- `app/api/sutras/[id]/route.ts` — GET detail
- `scripts/build-sutras.ts` — fetch chinese-poetry 佛经/ + UPSERT

**New files (client):**
- `lib/api-sutras.ts` — client wrapper (listSutrasRequest, getSutraRequest)
- `components/sutra/SutraSearch.tsx`
- `components/sutra/SutraCard.tsx`
- `components/sutra/SutraPagination.tsx`
- `components/sutra/SutraMeta.tsx`
- `components/sutra/SutraChunkPicker.tsx`
- `components/sutra/SutraWorksheet.tsx`
- `app/sutra/page.tsx` (list)
- `app/sutra/[id]/page.tsx` (detail)
- `app/sutra/[id]/SaveAsWorksheetButton.tsx`

**Tests:**
- `tests/unit/lib/sutras.test.ts` — splitIntoChunks (纯函数 TDD)
- `tests/unit/lib/sutra-validators.test.ts` — zod schemas
- `tests/unit/components/sutra/SutraCard.test.tsx`
- `tests/unit/components/sutra/SutraWorksheet.test.tsx`
- `tests/integration/api/sutras.test.ts` — list, detail

**Modified files:**
- `scripts/init-db.ts` — add sutras DDL + auto-populate via build-sutras
- `lib/validators.ts` — add sutraListQuerySchema, sutraIdParamSchema
- `lib/design.ts` — add 佛经 to NAV_LINKS
- `app/page.tsx` — pass 经 item to BentoGrid (改 BentoGrid 接受 prop 或直接改)
- `components/BentoGrid.tsx` — add 经 tile
- `package.json` — add `sutras:build` script

---

## Task 1: DDL — add `sutras` table to init-db

**Files:**
- Modify: `scripts/init-db.ts` (append DDL string)
- Modify: `package.json` (add script)

- [ ] **Step 1: Add sutras DDL to init-db.ts**

Open `scripts/init-db.ts`. The DDL array ends with the `worksheets` table block. Add this new entry **immediately after the `worksheets` block** (so all `init-db.ts` `DDL` entries remain grouped, with `initDb()` and the `require.main` block untouched):

```ts
  `CREATE TABLE IF NOT EXISTS sutras (
     id          INT             NOT NULL AUTO_INCREMENT,
     title       VARCHAR(80)     NOT NULL,
     slug        VARCHAR(80)     NOT NULL,
     chunks      JSON            NOT NULL,
     source      VARCHAR(120)    NULL,
     created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_sutra (slug)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
```

- [ ] **Step 2: Verify it parses**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No new errors. (init-db.ts uses DDL strings, no type impact.)

- [ ] **Step 3: Commit**

```bash
git add scripts/init-db.ts
git commit -m "feat(sutras): add sutras table DDL to init-db"
```

---

## Task 2: lib/sutra-types.ts (shared types)

**Files:**
- Create: `lib/sutra-types.ts`

- [ ] **Step 1: Write the types file**

Create `lib/sutra-types.ts`:

```ts
export interface SutraListItem {
  id: number;
  title: string;
  slug: string;
  chunkCount: number;
  charCount: number;
}

export interface SutraChunk {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

export interface SutraDetail {
  id: number;
  title: string;
  slug: string;
  chunks: SutraChunk[];
}

export interface SutraListResult {
  items: SutraListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sutra-types.ts
git commit -m "feat(sutras): add shared sutra types"
```

---

## Task 3: lib/sutras.ts — splitIntoChunks (pure function, TDD)

**Files:**
- Create: `tests/unit/lib/sutras.test.ts`
- Create: `lib/sutras.ts`

- [ ] **Step 1: Write failing test for splitIntoChunks — single-chunk case (心经)**

Create `tests/unit/lib/sutras.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from '@/lib/sutras';

describe('splitIntoChunks', () => {
  it('returns single chunk for sutra with no 品 markers', () => {
    const paragraphs = ['观自在菩萨,行深般若波罗蜜多时,照见五蕴皆空,度一切苦厄。', '舍利子,色不异空,空不异色,色即是空,空即是色。'];
    const chunks = splitIntoChunks('心经', paragraphs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.label).toBe('心经');
    expect(chunks[0]!.id).toBe(0);
    expect(chunks[0]!.content).toEqual(paragraphs);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/sutras.test.ts 2>&1 | tail -15`
Expected: FAIL — "Cannot find module '@/lib/sutras'"

- [ ] **Step 3: Implement splitIntoChunks (minimal — passes the one test)**

Create `lib/sutras.ts`:

```ts
import type { SutraChunk } from './sutra-types';

const PIN_MARKER_RE = /^第[一二三四五六七八九十百千零〇]+品/;

/**
 * Split a sutra's paragraphs into chunks based on 品 markers.
 * - If a paragraph starts with "第X品..." (e.g. 法会因由分第一), a new chunk begins.
 * - Otherwise, all paragraphs fold into a single chunk labelled by the sutra title.
 */
export function splitIntoChunks(title: string, paragraphs: string[]): SutraChunk[] {
  if (paragraphs.length === 0) return [];

  const chunks: SutraChunk[] = [];
  let current: { label: string; content: string[] } | null = null;

  for (const para of paragraphs) {
    if (PIN_MARKER_RE.test(para)) {
      if (current) chunks.push({ id: chunks.length, ...current });
      current = { label: para.slice(0, 32), content: [para] };
    } else {
      if (!current) current = { label: title, content: [para] };
      else current.content.push(para);
    }
  }
  if (current) chunks.push({ id: chunks.length, ...current });

  return chunks;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/sutras.test.ts 2>&1 | tail -10`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Add test for multi-chunk case (金刚经 32 品)**

Append to `tests/unit/lib/sutras.test.ts`:

```ts
  it('splits sutra with 品 markers into multiple chunks', () => {
    const paragraphs = [
      '如是我闻:一时,佛在舍卫国祇树给孤独园。',
      '法会因由分第一:尔时,世尊食时,著衣持钵,入舍卫大城乞食。',
      '善现启请分第二:时,长老须菩提在大众中即从座起,偏袒右肩,右膝着地。',
      '大乘正宗分第三:佛告须菩提:诸菩萨摩诃萨应如是降伏其心。',
    ];
    const chunks = splitIntoChunks('金刚经', paragraphs);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.label).toMatch(/如是我闻/);
    expect(chunks[1]!.label).toMatch(/法会因由分第一/);
    expect(chunks[2]!.label).toMatch(/善现启请分第二/);
    expect(chunks[0]!.id).toBe(0);
    expect(chunks[1]!.id).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(splitIntoChunks('心经', [])).toEqual([]);
  });

  it('truncates chunk label to 32 chars', () => {
    const longLabel = '第' + '一'.repeat(20) + '品:这是一段非常非常长的品名' + '啊'.repeat(30);
    const chunks = splitIntoChunks('测试经', [longLabel]);
    expect(chunks[0]!.label.length).toBeLessThanOrEqual(32);
  });
```

- [ ] **Step 6: Run all splitIntoChunks tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/sutras.test.ts 2>&1 | tail -10`
Expected: PASS — 4 tests passed.

- [ ] **Step 7: Commit**

```bash
git add lib/sutras.ts tests/unit/lib/sutras.test.ts
git commit -m "feat(sutras): splitIntoChunks with 品 marker detection + tests"
```

---

## Task 4: lib/sutras.ts — listSutras + getSutra (DB functions)

**Files:**
- Modify: `lib/sutras.ts`
- Create: `tests/integration/api/sutras-list.test.ts` (or defer to API test in Task 6)

For these DB-bound functions, the existing 唐诗 pattern uses no separate unit test — they're tested via the API integration test. Follow that pattern.

- [ ] **Step 1: Add listSutras + getSutra to lib/sutras.ts**

Append to `lib/sutras.ts`:

```ts
import { getPool } from './db';
import type { SutraListItem, SutraListResult, SutraChunk, SutraDetail } from './sutra-types';

const PAGE_SIZE = 12;

export interface ListSutrasArgs {
  q?: string;
  page?: number;
  pageSize?: number;
}

function buildSearchWhere(q: string): { where: string; params: string[] } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { where: '', params: [] };
  return {
    where: 'WHERE title LIKE ?',
    params: [`%${trimmed}%`],
  };
}

interface RawSutraRow {
  id: number;
  title: string;
  slug: string;
  chunks: string | SutraChunk[];
  source: string | null;
}

function mapListRow(r: RawSutraRow): SutraListItem {
  const chunks = typeof r.chunks === 'string' ? (JSON.parse(r.chunks) as SutraChunk[]) : r.chunks;
  const charCount = chunks.reduce(
    (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0),
    0
  );
  return {
    id: Number(r.id),
    title: r.title,
    slug: r.slug,
    chunkCount: chunks.length,
    charCount,
  };
}

export async function listSutras(args: ListSutrasArgs = {}): Promise<SutraListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(args.q ?? '');

  const sql = `SELECT id, title, slug, chunks FROM sutras
               ${where}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<any[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM sutras ${where}`,
    params
  );

  return {
    items: (rows as RawSutraRow[]).map(mapListRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getSutra(id: number): Promise<SutraDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, slug, chunks FROM sutras WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0] as RawSutraRow | undefined;
  if (!row) return null;

  const chunks = typeof row.chunks === 'string' ? (JSON.parse(row.chunks) as SutraChunk[]) : row.chunks;
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    chunks,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sutras.ts
git commit -m "feat(sutras): listSutras + getSutra DB functions"
```

---

## Task 5: validators (zod) for sutra list + id

**Files:**
- Modify: `lib/validators.ts` (append two schemas)
- Create: `tests/unit/lib/sutra-validators.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/lib/sutra-validators.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sutraListQuerySchema, sutraIdParamSchema } from '@/lib/validators';

describe('sutra validators', () => {
  it('sutraListQuerySchema accepts empty input', () => {
    expect(() => sutraListQuerySchema.parse({})).not.toThrow();
  });
  it('sutraListQuerySchema coerces page number', () => {
    const r = sutraListQuerySchema.parse({ page: '3' });
    expect(r.page).toBe(3);
  });
  it('sutraListQuerySchema rejects negative page', () => {
    expect(() => sutraListQuerySchema.parse({ page: '-1' })).toThrow();
  });
  it('sutraIdParamSchema coerces numeric id string', () => {
    const r = sutraIdParamSchema.parse({ id: '42' });
    expect(r.id).toBe(42);
  });
  it('sutraIdParamSchema rejects non-numeric', () => {
    expect(() => sutraIdParamSchema.parse({ id: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/sutra-validators.test.ts 2>&1 | tail -10`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Append schemas to lib/validators.ts**

Open `lib/validators.ts` and add at the end (after the existing `poemIdParamSchema`):

```ts
export const sutraListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const sutraIdParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/lib/sutra-validators.test.ts 2>&1 | tail -10`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/validators.ts tests/unit/lib/sutra-validators.test.ts
git commit -m "feat(sutras): zod validators for list + id params"
```

---

## Task 6: API routes — GET /api/sutras + /api/sutras/[id]

**Files:**
- Create: `app/api/sutras/route.ts`
- Create: `app/api/sutras/[id]/route.ts`
- Create: `tests/integration/api/sutras.test.ts`

- [ ] **Step 1: Create the list route**

Create `app/api/sutras/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listSutras } from '@/lib/sutras';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { sutraListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = sutraListQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listSutras(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 2: Create the detail route**

Create `app/api/sutras/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSutra } from '@/lib/sutras';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { sutraIdParamSchema } from '@/lib/validators';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: idStr } = await ctx.params;
    const parsed = sutraIdParamSchema.safeParse({ id: idStr });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const sutra = await getSutra(parsed.data.id);
    if (!sutra) return notFound();
    return NextResponse.json({ ok: true, data: sutra });
  });
}
```

- [ ] **Step 3: Write integration test**

Create `tests/integration/api/sutras.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { GET as listRoute } from '@/app/api/sutras/route';
import { GET as detailRoute } from '@/app/api/sutras/[id]/route';

const TEST_SLUG = 'xinjing';
let insertedId: number;

beforeAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM sutras WHERE slug = ?`, [TEST_SLUG]);
  const [result] = await pool.query<any>(
    `INSERT INTO sutras (title, slug, chunks) VALUES (?, ?, ?)`,
    [
      '心经',
      TEST_SLUG,
      JSON.stringify([
        { id: 0, label: '心经', content: ['观自在菩萨', '行深般若波罗蜜多时'], pinyin: [['guān'], ['xíng']] },
      ]),
    ]
  );
  insertedId = result.insertId;
});

afterAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM sutras WHERE slug = ?`, [TEST_SLUG]);
  await closePool();
});

describe('GET /api/sutras', () => {
  it('returns list with our test sutra', async () => {
    const req = new Request('http://test/api/sutras') as any;
    const res = await listRoute(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.items)).toBe(true);
    const found = j.data.items.find((s: any) => s.slug === TEST_SLUG);
    expect(found).toBeTruthy();
    expect(found.title).toBe('心经');
    expect(found.chunkCount).toBe(1);
  });

  it('filters by q', async () => {
    const req = new Request('http://test/api/sutras?q=心') as any;
    const res = await listRoute(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.items.some((s: any) => s.slug === TEST_SLUG)).toBe(true);
  });

  it('returns 400 on bad page', async () => {
    const req = new Request('http://test/api/sutras?page=-1') as any;
    const res = await listRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sutras/[id]', () => {
  it('returns sutra detail with chunks', async () => {
    const req = new Request('http://test') as any;
    const res = await detailRoute(req, { params: Promise.resolve({ id: String(insertedId) }) });
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('心经');
    expect(j.data.chunks).toHaveLength(1);
    expect(j.data.chunks[0].label).toBe('心经');
  });

  it('returns 404 for missing id', async () => {
    const req = new Request('http://test') as any;
    const res = await detailRoute(req, { params: Promise.resolve({ id: '9999999' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run integration test**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/integration/api/sutras.test.ts 2>&1 | tail -15`
Expected: PASS — 5 tests passed (requires DB up; use the same MySQL config as other integration tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/sutras/route.ts app/api/sutras/[id]/route.ts tests/integration/api/sutras.test.ts
git commit -m "feat(sutras): GET /api/sutras + /api/sutras/[id] with integration tests"
```

---

## Task 7: lib/api-sutras.ts (client wrapper)

**Files:**
- Create: `lib/api-sutras.ts`

- [ ] **Step 1: Create client wrapper**

Create `lib/api-sutras.ts`:

```ts
import type { SutraListResult, SutraDetail } from './sutra-types';

export async function listSutrasRequest(args: { q?: string; page?: number } = {}): Promise<SutraListResult> {
  const sp = new URLSearchParams();
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/sutras${sp.toString() ? '?' + sp.toString() : ''}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listSutras failed');
  return j.data;
}

export async function getSutraRequest(id: number): Promise<SutraDetail> {
  const res = await fetch(`/api/sutras/${id}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getSutra failed');
  return j.data;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api-sutras.ts
git commit -m "feat(sutras): client api wrappers"
```

---

## Task 8: scripts/build-sutras.ts (fetch chinese-poetry 佛经/)

**Files:**
- Create: `scripts/build-sutras.ts`
- Modify: `package.json` (add `sutras:build` script)

- [ ] **Step 1: Add script to package.json**

Open `package.json`. Find the `scripts` block and add (right after `poems:build` if present):

```json
    "sutras:build": "tsx scripts/build-sutras.ts",
```

(If `poems:build` doesn't exist, just add it in a sensible spot near other build scripts. Use the same script-runner — check how `poems:build` is registered and copy that line verbatim with `sutras:build` substituted.)

- [ ] **Step 2: Write build script**

Create `scripts/build-sutras.ts`:

```ts
/**
 * Pull 佛经/ from chinese-poetry/chinese-poetry GitHub repo,
 * split each sutra into chunks (by 品 markers), generate pinyin per char,
 * UPSERT into the `sutras` table.
 *
 * Idempotent: safe to re-run. Existing rows are updated, new rows are inserted.
 * Fails soft: missing slugs are skipped with a warning.
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';
import { splitIntoChunks } from '../lib/sutras';

// 佛经 source is mostly 繁体, normalize to 简体 for cn site
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const FOJING_DIR = `${SOURCE_BASE}/%E4%BD%9B%E7%BB%8F`;
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

const SLUGS: Array<{ slug: string; title: string }> = [
  { slug: 'xinjing', title: '心经' },
  { slug: 'jingang', title: '金刚经' },
  { slug: 'yaoshi', title: '药师经' },
  { slug: 'amituo', title: '阿弥陀经' },
  { slug: 'pumen', title: '观音菩萨普门品' },
  { slug: 'puxian', title: '普贤行愿品' },
  { slug: 'lengyan', title: '楞严经' },
  { slug: 'miaofa', title: '妙法莲华经' },
  { slug: 'weimo', title: '维摩诘经' },
  { slug: 'liuzu', title: '六祖坛经' },
  { slug: 'dabei', title: '大悲咒' },
  { slug: 'shishan', title: '十善业道经' },
];

interface RawSutra {
  title?: string;
  content?: string;
  paragraphs?: string[];
}

function extractParagraphs(raw: RawSutra): string[] {
  if (Array.isArray(raw.paragraphs)) return raw.paragraphs;
  if (typeof raw.content === 'string') {
    // Split on common sentence-ending punctuation, keep groups non-empty
    return raw.content
      .split(/[。！？]/u)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s + '。');
  }
  return [];
}

function calcChunkPinyin(label: string, paragraphs: string[]): { label: string; content: string[]; pinyin: string[][] } {
  const t2sParagraphs = paragraphs.map(p => t2s(p));
  const t2sLabel = t2s(label);
  const pinyinRows = t2sParagraphs.map(line =>
    Array.from(line).map(char => {
      const py = pinyin(char, { toneType: 'symbol' });
      return Array.isArray(py) && py.length > 0 ? py[0]! : '';
    })
  );
  return { label: t2sLabel, content: t2sParagraphs, pinyin: pinyinRows };
}

export async function buildSutras(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const { slug, title } of SLUGS) {
    const url = `${FOJING_DIR}/${encodeURIComponent(slug)}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[build-sutras] skip ${slug}: HTTP ${res.status}`);
        continue;
      }
      const raw = (await res.json()) as RawSutra;
      const paragraphs = extractParagraphs(raw);
      if (paragraphs.length === 0) {
        console.warn(`[build-sutras] skip ${slug}: no paragraphs`);
        continue;
      }
      const chunks = splitIntoChunks(raw.title ?? title, paragraphs).map(c =>
        calcChunkPinyin(c.label, c.content)
      );

      await pool.query(
        `INSERT INTO sutras (title, slug, chunks, source) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), chunks = VALUES(chunks), source = VALUES(source)`,
        [t2s(raw.title ?? title), slug, JSON.stringify(chunks), SOURCE_TAG]
      );
      console.log(`[build-sutras] upserted ${slug} (${chunks.length} chunks)`);
      inserted += 1;
    } catch (err) {
      console.warn(`[build-sutras] skip ${slug}: ${(err as Error).message}`);
    }
  }
  return inserted;
}

if (require.main === module) {
  buildSutras()
    .then((n) => { console.log(`done: ${n} sutras upserted`); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 3: Verify it parses**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-sutras.ts package.json
git commit -m "feat(sutras): build-sutras script fetching chinese-poetry 佛经/"
```

---

## Task 9: Wire build-sutras into initDb auto-populate

**Files:**
- Modify: `scripts/init-db.ts`

- [ ] **Step 1: Add auto-populate for sutras (mirror poems block)**

In `scripts/init-db.ts`, after the `try { ... } catch` block that handles poems auto-populate, add a second block:

```ts
  // Auto-populate sutras table if empty (fail-soft)
  try {
    const [[{ count: sCount }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM sutras`);
    if (Number(sCount) === 0) {
      const { buildSutras } = await import('./build-sutras');
      const n = await buildSutras();
      console.log(`[initDb] inserted ${n} sutras (auto-populate)`);
    } else {
      console.log(`[initDb] sutras table has ${sCount} rows, skip auto-populate`);
    }
  } catch (err) {
    console.warn('[initDb] sutras auto-populate failed (continuing):', (err as Error).message);
  }
```

Add this **inside** the existing `initDb()` function, **after** the existing poems try/catch block and **before** the closing `}` of `initDb()`.

- [ ] **Step 2: Verify it parses**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/init-db.ts
git commit -m "feat(sutras): auto-populate sutras via initDb"
```

---

## Task 10: Components — SutraSearch, SutraCard, SutraPagination, SutraMeta, SutraChunkPicker, SutraWorksheet

**Files:**
- Create: `components/sutra/SutraSearch.tsx`
- Create: `components/sutra/SutraCard.tsx`
- Create: `components/sutra/SutraPagination.tsx`
- Create: `components/sutra/SutraMeta.tsx`
- Create: `components/sutra/SutraChunkPicker.tsx`
- Create: `components/sutra/SutraWorksheet.tsx`
- Create: `tests/unit/components/sutra/SutraCard.test.tsx`
- Create: `tests/unit/components/sutra/SutraWorksheet.test.tsx`

- [ ] **Step 1: SutraSearch component**

Create `components/sutra/SutraSearch.tsx`:

```tsx
'use client';

interface Props {
  q: string;
  onQChange: (q: string) => void;
}

export function SutraSearch({ q, onQChange }: Props) {
  return (
    <input
      type="search"
      value={q}
      onChange={(e) => onQChange(e.target.value)}
      placeholder="搜索经名..."
      className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2 text-base focus:border-seal focus:outline-none"
    />
  );
}
```

- [ ] **Step 2: SutraCard component**

Create `components/sutra/SutraCard.tsx`:

```tsx
import Link from 'next/link';
import type { SutraListItem } from '@/lib/sutra-types';

export function SutraCard({ sutra }: { sutra: SutraListItem }) {
  return (
    <Link
      href={`/sutra/${sutra.id}`}
      className="card-paper p-4 flex flex-col gap-2 hover:border-seal transition-colors group"
    >
      <h3 className="font-kai text-lg text-ink leading-tight group-hover:text-seal transition-colors">
        《{sutra.title}》
      </h3>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {sutra.chunkCount > 1 ? `${sutra.chunkCount} 品` : '全文'}
        </span>
        <span className="text-ink-faint text-xs">{sutra.charCount} 字</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: SutraPagination component**

Create `components/sutra/SutraPagination.tsx`:

```tsx
'use client';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}

export function SutraPagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6 text-sm">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 border border-ink/20 rounded disabled:opacity-40 hover:border-seal"
      >
        上一页
      </button>
      <span className="text-ink-soft">第 {page} / {totalPages} 页</span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 border border-ink/20 rounded disabled:opacity-40 hover:border-seal"
      >
        下一页
      </button>
    </div>
  );
}
```

- [ ] **Step 4: SutraMeta component**

Create `components/sutra/SutraMeta.tsx`:

```tsx
interface Props {
  title: string;
  chunkLabel?: string | null;
}

export function SutraMeta({ title, chunkLabel }: Props) {
  return (
    <div className="text-center my-6">
      <div className="paper-rule mb-3" />
      <h1 className="font-kai text-3xl text-ink">《{title}》</h1>
      {chunkLabel && (
        <p className="text-sm text-ink-soft mt-2">{chunkLabel}</p>
      )}
      <div className="paper-rule mt-3" />
    </div>
  );
}
```

- [ ] **Step 5: SutraChunkPicker component (responsive: list on desktop, select on mobile)**

Create `components/sutra/SutraChunkPicker.tsx`:

```tsx
'use client';

import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  chunks: SutraChunk[];
  activeId: number;
  onChange: (id: number) => void;
}

export function SutraChunkPicker({ chunks, activeId, onChange }: Props) {
  if (chunks.length <= 1) return null;
  return (
    <>
      {/* Desktop: vertical list */}
      <aside className="hidden md:block sticky top-4 w-48 shrink-0">
        <div className="card-paper p-3">
          <div className="text-xs text-ink-faint mb-2 px-1">品块</div>
          <ul className="space-y-1">
            {chunks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c.id)}
                  className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                    activeId === c.id
                      ? 'bg-seal/10 text-seal border-l-2 border-seal'
                      : 'text-ink-soft hover:bg-paper-deep'
                  }`}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Mobile: dropdown */}
      <div className="md:hidden mb-4">
        <label className="block text-xs text-ink-faint mb-1">品块</label>
        <select
          value={activeId}
          onChange={(e) => onChange(Number(e.target.value))}
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

- [ ] **Step 6: SutraWorksheet component**

Create `components/sutra/SutraWorksheet.tsx`:

```tsx
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';
import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  chunk: SutraChunk;
}

export function SutraWorksheet({ chunk }: Props) {
  return (
    <div className="space-y-5 print:space-y-3 max-w-3xl mx-auto">
      {chunk.content.map((line, lineIdx) => (
        <div key={lineIdx} className="sutra-line flex flex-wrap items-end gap-2 justify-center">
          {Array.from(line).map((char, charIdx) => (
            <div key={charIdx} className="sutra-char flex flex-col items-center">
              <WorksheetCell char={char} style="brush" size={60} />
              {chunk.pinyin[lineIdx]?.[charIdx] && (
                <span className="text-[10px] text-ink-faint mt-0.5 leading-none">
                  {chunk.pinyin[lineIdx][charIdx]}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: SutraCard test**

Create `tests/unit/components/sutra/SutraCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SutraCard } from '@/components/sutra/SutraCard';

describe('SutraCard', () => {
  it('renders title and chunk count label', () => {
    const { container } = render(
      <SutraCard sutra={{ id: 1, title: '心经', slug: 'xinjing', chunkCount: 1, charCount: 260 }} />
    );
    expect(container.textContent).toContain('心经');
    expect(container.textContent).toContain('全文');
    expect(container.textContent).toContain('260 字');
  });

  it('shows "N 品" when chunkCount > 1', () => {
    const { container } = render(
      <SutraCard sutra={{ id: 1, title: '金刚经', slug: 'jingang', chunkCount: 32, charCount: 5000 }} />
    );
    expect(container.textContent).toContain('32 品');
  });
});
```

- [ ] **Step 8: SutraWorksheet test**

Create `tests/unit/components/sutra/SutraWorksheet.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SutraWorksheet } from '@/components/sutra/SutraWorksheet';

describe('SutraWorksheet', () => {
  it('renders a WorksheetCell for each char + pinyin beneath', () => {
    const chunk = {
      id: 0,
      label: '心经',
      content: ['观自在菩萨'],
      pinyin: [['guān', 'zì', 'zài', 'pú', 'sà']],
    };
    const { container } = render(<SutraWorksheet chunk={chunk} />);
    const cells = container.querySelectorAll('svg');
    expect(cells).toHaveLength(5);
    expect(container.textContent).toContain('guān');
  });
});
```

- [ ] **Step 9: Run all new tests**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run tests/unit/components/sutra/ 2>&1 | tail -10`
Expected: PASS — 3 tests passed.

- [ ] **Step 10: Commit**

```bash
git add components/sutra/ tests/unit/components/sutra/
git commit -m "feat(sutras): 6 client components + unit tests"
```

---

## Task 11: app/sutra/page.tsx (list page)

**Files:**
- Create: `app/sutra/page.tsx`

- [ ] **Step 1: Create the list page**

Create `app/sutra/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SutraSearch } from '@/components/sutra/SutraSearch';
import { SutraCard } from '@/components/sutra/SutraCard';
import { SutraPagination } from '@/components/sutra/SutraPagination';
import { listSutrasRequest } from '@/lib/api-sutras';
import type { SutraListItem } from '@/lib/sutra-types';

export default function SutraListPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<SutraListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const r = await listSutrasRequest({ q: q || undefined, page });
        if (!cancelled) {
          setItems(r.items);
          setTotal(r.total);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, page, tick]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="12 部经 · 分品块抄写">佛经选读</SectionTitle>
        <SutraSearch
          q={q}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        {error ? (
          <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState title="无匹配经文" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {items.map((s) => (
                <SutraCard key={s.id} sutra={s} />
              ))}
            </div>
            <SutraPagination
              page={page}
              pageSize={12}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/sutra/page.tsx
git commit -m "feat(sutras): /sutra list page"
```

---

## Task 12: app/sutra/[id]/page.tsx + SaveAsWorksheetButton (detail page)

**Files:**
- Create: `app/sutra/[id]/page.tsx`
- Create: `app/sutra/[id]/SaveAsWorksheetButton.tsx`

- [ ] **Step 1: Create SaveAsWorksheetButton (mirror the /poetry one with new flow)**

Create `app/sutra/[id]/SaveAsWorksheetButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  id: number;
  title: string;
  chunk: SutraChunk;
}

export function SaveAsWorksheetButton({ id, title, chunk }: Props) {
  const router = useRouter();
  const user = useAppStore(s => s.user);
  const setAuthOpen = useAppStore(s => s.setAuthOpen);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user) {
      setHint('需要登录才能保存');
      setAuthOpen(true);
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const chars = chunk.content.join('').split('');
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `《${title}》${chunk.label}`,
          content: chars,
          cellStyle: 'brush',
        }),
      });
      const data = await res.json();
      if (res.status === 401 || data.error?.code === 'unauthenticated') {
        setHint('需要登录才能保存');
        setAuthOpen(true);
        return;
      }
      if (!data.ok) {
        setHint(data.error?.message ?? '保存失败');
        return;
      }
      router.push(`/worksheet/${data.data.id}`);
    } catch (err) {
      setHint((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-seal px-5 py-2 text-white hover:bg-seal/80 disabled:bg-seal/40 disabled:cursor-not-allowed"
      >
        {saving ? '保存中…' : '保存到字帖'}
      </button>
      {hint && !user && (
        <span className="text-xs text-ink-soft">{hint}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the detail page**

Create `app/sutra/[id]/page.tsx`:

```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSutra } from '@/lib/sutras';
import type { SutraChunk } from '@/lib/sutra-types';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { SutraMeta } from '@/components/sutra/SutraMeta';
import { SutraWorksheet } from '@/components/sutra/SutraWorksheet';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import { PrintButton } from '@/app/poetry/[id]/PrintButton';
import { SutraChunkPickerClient } from './SutraChunkPickerClient';

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

  const requestedChunk = Number(sp.chunk ?? '0');
  const activeChunkId =
    Number.isInteger(requestedChunk) && requestedChunk >= 0 && requestedChunk < sutra.chunks.length
      ? requestedChunk
      : 0;
  const activeChunk = sutra.chunks[activeChunkId]!;

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <SutraMeta title={sutra.title} chunkLabel={sutra.chunks.length > 1 ? activeChunk.label : null} />
        </div>
        <div className="flex gap-6">
          <Suspense fallback={null}>
            <SutraChunkPickerClient sutraId={sutra.id} chunks={sutra.chunks as SutraChunk[]} activeId={activeChunkId} />
          </Suspense>
          <div className="flex-1 card-paper p-5 sm:p-8">
            <SutraWorksheet chunk={activeChunk} />
          </div>
        </div>
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <PrintButton />
          <SaveAsWorksheetButton id={sutra.id} title={sutra.title} chunk={activeChunk} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Create the client chunk-picker wrapper**

Create `app/sutra/[id]/SutraChunkPickerClient.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { SutraChunkPicker } from '@/components/sutra/SutraChunkPicker';
import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  sutraId: number;
  chunks: SutraChunk[];
  activeId: number;
}

export function SutraChunkPickerClient({ sutraId, chunks, activeId }: Props) {
  const router = useRouter();
  return (
    <SutraChunkPicker
      chunks={chunks}
      activeId={activeId}
      onChange={(id) => router.push(`/sutra/${sutraId}?chunk=${id}`)}
    />
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -30`
Expected: No errors. (The `import` after the function in page.tsx is a deliberate pattern; verify the linter is OK with it. If your ESLint config flags the placement, move the import to the top of the file.)

- [ ] **Step 5: Run full test suite**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm vitest run 2>&1 | tail -5`
Expected: All 136+ tests still pass; new sutras tests added.

- [ ] **Step 6: Commit**

```bash
git add app/sutra/[id]/
git commit -m "feat(sutras): /sutra/[id] detail page with chunk picker + save-as-worksheet"
```

---

## Task 13: Wire nav + BentoGrid + final smoke

**Files:**
- Modify: `lib/design.ts` (add 佛经 to NAV_LINKS)
- Modify: `components/BentoGrid.tsx` (add 经 tile)

- [ ] **Step 1: Add 佛经 to NAV_LINKS**

Open `lib/design.ts`. Find the `NAV_LINKS` array and add a new entry (place it after 诗词 / poem link if present):

```ts
  { href: '/sutra', label: '佛经' },
```

- [ ] **Step 2: Add 经 tile to BentoGrid**

Open `components/BentoGrid.tsx`. In the `ITEMS` array, add a new entry (place it after the existing items):

```ts
  { char: '经', title: '佛经选读', description: '12 部经分品抄写', href: '/sutra', variant: 'outline' },
```

- [ ] **Step 3: Verify build**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm tsc --noEmit 2>&1 | head -20 && pnpm vitest run 2>&1 | tail -5 && pnpm build 2>&1 | tail -10`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/design.ts components/BentoGrid.tsx
git commit -m "feat(sutras): add 佛经 to nav + 经 tile to BentoGrid"
```

---

## Task 14: Manual smoke (human in browser)

**Files:** None (manual)

- [ ] **Step 1: Start dev server**

Run: `cd "E:\ToolDevelop\PinYinCharacter" && pnpm dev`
Expected: Server starts on port 4444 (per `dev-port.md` memory).

- [ ] **Step 2: Verify initDb auto-populated sutras**

Watch server logs. On first start, should see:
- `[initDb] inserted N sutras (auto-populate)` (N between 8–12, depending on GitHub availability)
- or `[initDb] sutras table has N rows, skip auto-populate` on subsequent runs

- [ ] **Step 3: Browser smoke checklist**

- [ ] Open http://localhost:4444/ — see BentoGrid with 5 tiles including new 经
- [ ] Click 经 tile or Header 佛经 link → /sutra — see ~12 cards
- [ ] Search "金刚" — only 金刚经 shown
- [ ] Click 心经 → /sutra/[id] — single chunk, full text in worksheet
- [ ] Click 金刚经 → see chunk picker (right sidebar on desktop) with 32 items
- [ ] Click chunk #2 — URL becomes ?chunk=2, worksheet re-renders
- [ ] Click "保存到字帖" without login → AuthModal opens (no redirect)
- [ ] Login → redirected back, save → /worksheet/[id] shows the chunk content
- [ ] Resize to 375px — chunk picker becomes a dropdown above worksheet
- [ ] Open /sutra/9999 → 404 page
- [ ] /sutra/[id] print preview → only worksheet, no nav/buttons

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "fix(sutras): manual smoke fixes"  # only if changes
```

---

## Out of scope (intentionally not in this plan)

- 佛教背景介绍 / 白话翻译
- 功德/福报 framing
- 用户收藏 / 喜欢
- TTS 经文特化
- 多经对照阅读
- 离线 PWA

These can be added in future plans (Plan G/H/I/J) if requested.

---

## Spec coverage check

- [x] /sutra 列表页 (搜索 + 分页) — Task 11
- [x] /sutra/[id] 详情页 (chunk picker + 米字格 + 拼音) — Task 12
- [x] DB 存储 ~12 部经 — Task 1 (DDL) + Task 8 (build script) + Task 9 (auto-populate)
- [x] 两个 API: list, get — Task 6
- [x] Header 佛经导航 — Task 13
- [x] 首页 BentoGrid 经 tile — Task 13
- [x] 保存到我的字帖 — Task 12 (SaveAsWorksheetButton)
- [x] 按品/段落分块 (chunk model) — Task 3 (splitIntoChunks) + Task 12 (picker)
- [x] Unit + integration tests — Tasks 3, 4 (validators), 6 (integration), 10 (components)
- [x] Manual smoke — Task 14
- [x] Neutral voice (no religious terms) — implicit in copy; no strings mention 功德/福报/抄经

## Self-review notes

- No TBDs or placeholders in the plan
- All file paths absolute
- All commands include expected output
- Types are consistent: SutraListItem / SutraChunk / SutraDetail / SutraListResult flow from `lib/sutra-types.ts` → API → client → components → pages
- The `import` placement in Task 12 Step 2 is flagged as potentially needing lint adjustment
- splitIntoChunks label truncation (32 chars) is in the test in Task 3
- chunk page selection: server resolves `?chunk=N` and 404s are not used (out-of-range falls back to 0) — matches spec
