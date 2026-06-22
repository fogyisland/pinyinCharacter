# Poetry Expansion + Site-Wide SEO — V2 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes** `2026-06-21-poetry-expansion-seo-plan.md` (V1). The V1 plan was written before the file-only refactor and most of its Tasks 1, 3, 4, 5, 6, 8 are already shipped via commits between 2026-06-21 and 2026-06-22. This V2 covers ONLY the 4 remaining gaps.

**Goal:** Close the 4 remaining gaps from the poetry expansion + site-wide SEO effort: (A) ingest 训蒙骈句 as a new classics book, (B) build SEO infrastructure (config, metadata, JSON-LD, robots, sub-sitemaps), (C) wire generateMetadata + JSON-LD on the 3 detail-page surfaces (poetry, ancient, chars), (D) add the form/category filter to the `/poetry` browse page with API + UI.

**Architecture:**
- **File-first**: All new ingestion writes the source-of-truth JSON file + manifest entry first, then inserts the metadata row in `classics` / `chars` table. The content lives on disk (matching the post-`9f7763c4` poems file-only architecture). The classics table now has no `chunks` column (post `8b204b61`), so the pianwen ingest must NOT write to a `chunks` column.
- **SEO lib is a leaf module** with no DB dependencies — `lib/seo/{config,metadata,jsonld}.ts` reads from already-loaded data passed in by the caller (e.g., detail pages fetch the poem/classic/char first, then pass it to a JSON-LD builder). This keeps the lib testable without a DB and avoids double-fetching.
- **Sitemaps** are file-readers backed by `lib/poetry/loader.ts` and `lib/classics/loader.ts`, plus a query against the `chars` table (which is still DB-backed for 8105 chars). One sub-sitemap per content domain, an index at `app/sitemap.ts`.
- **Form filter** extends `lib/poetry/queries.ts::listPoems` with a `category` filter (which is the natural grouping for the 5 new collections) and a new `getAvailableForms(category)` function that returns the category-appropriate form list (诗类 fixed forms for 诗 / 词牌名 top 30 for 词 / `['小令', '套数']` for 元曲). The UI is a chip-based `FormFilterBar` client component with URL-synced `?form=` state.

**Tech Stack:** Next.js 15 (App Router, RSC) + TypeScript + MySQL 5.7 + vitest + pinyin-pro + OpenCC t2s + cheerio (for HTML parsing in scraper; already used by `lib/guwendao-scraper.ts`).

## Global Constraints

- **Schema migration must be idempotent**: every ALTER / INSERT checks INFORMATION_SCHEMA (or `SELECT 1`) first; re-running scripts does not error.
- **All new scripts must be idempotent**: `build-pianwen.ts` checks for existing `slug` row + file before writing; re-running is a no-op.
- **Run on piyin_dev FIRST** for every step. Only touch prod `piyin` after piyin_dev smoke + browser verify. (There is no prod env as of 2026-06-22 per memory `no-prod-env-2026-06-21.md`; this plan does not push to prod.)
- **Env var SITE_URL**: `NEXT_PUBLIC_SITE_URL` set in `.env.local` (dev) and prod env. Fallback to `http://localhost:3000` if missing. (Add a default in `.env.local` if not already set; if adding, use `http://localhost:4444` for dev — but read the file first and only add if missing.)
- **No new npm dependencies** beyond what's in `package.json`. Reuse pinyin-pro, mysql2, OpenCC, cheerio, vitest, @testing-library/react.
- **Per-task pnpm build** (per memory rule `feedback-per-task-build-check`): each task that touches `app/**/page.tsx`, `app/**/route.ts`, or `app/sitemap/**` must run `pnpm build` (not just `tsc --noEmit`) before commit. Tasks that are pure lib or pure script only need `tsc --noEmit` + targeted tests.
- **TDD**: unit tests written BEFORE implementation, verified to FAIL, then implementation makes them pass. Mark the failing test step with `Expected: FAIL` and the passing step with `Expected: PASS`.
- **Frequent commits**: each task ends with `git commit` (single task = single commit). Use `git -c user.email=claude@anthropic.com -c user.name=claude commit -m "..."` to avoid touching global config.
- **No emojis** in any file unless explicitly requested.
- **No documentation files** (README/CHANGELOG) created unless asked.
- **dev server pinned to port 4444** (per memory `dev-port.md`). Use `pnpm dev` not `pnpm start`.
- **Never run `pnpm build` while `pnpm dev` is alive on 4444** (per memory `dev-build-cache-stomp`). If a smoke needs a build, kill the dev server first.
- **No environment pollution**: only touch the seed characters (训蒙骈句) and the 3 detail pages. Do NOT bulk-rebuild the `chars` table, `classics` table, or poems manifest.
- **File paths in this plan use forward slashes** (Windows path) for tool compatibility. When passing paths to `mysql` via bash on MSYS, use the form `"/e/mysql/bin/mysql.exe"`.

---

## Already Shipped (Reference Only — Do NOT Re-do)

The following 10 of V1's 14 tasks are already on `main` between commits `9f7763c4` (2026-06-21 poems file-only) and `06a3937d4` (2026-06-21 5 new collections). Listed here so the implementer does not re-implement them and so reviewers do not flag the absence as a gap.

- V1 Task 3 — `lib/poetry/infer-form.ts` ships (5-char/7-char/4-line/8-line classification, source-tag merge). Tested by `tests/unit/lib/poetry/infer-form.test.ts`.
- V1 Task 5 — `lib/guwendao-scraper.ts` ships (4 primitives: `fetchChapterList`, `scrapeChapterContent`, `scrapePoemList`, `scrapePoemPage`). Tested.
- V1 Task 6 — `scripts/build-poems-extra.ts` ships. 537 new poems ingested across 5 collections (汉乐府 187 / 古诗十九首 19 / 骈文 47 / 魏 26 / 清 258). Written to `data/poems/<id>.json` files + manifest. Commit `06a3937d4` (locally, not pushed).
- V1 Tasks 1, 2, 4 — **OBSOLETE** by design. The `poems` table was dropped in `9f7763c4`; the `form` field is now in each `data/poems/<id>.json` file. The form-backfill is already done by `build-form-tags.ts` (manually run during the 9f7763c4 refactor). Do not re-implement the schema migration scripts.
- Partial V1 Task 8 — `lib/poetry/queries.ts::listPoems` already supports `form` filter, and `listForms()` exists. Missing: `category` filter on `listPoems`, and `getAvailableForms(category)` (the category-aware form list).
- Partial V1 Task 12 — `app/sitemap.ts` exists (basic version, lists 4 top-level routes). Missing: 3 sub-sitemap routes, `robots.txt`.
- Partial V1 Task 13 — `app/poetry/[id]/page.tsx` already has `generateMetadata` and an inline `buildPoemJsonLd` (in `./jsonld`). `app/ancient/[slug]/page.tsx` has `generateMetadata` (minimal) but NO JSON-LD. `app/dictionary/[char]/page.tsx` has NO `generateMetadata`, NO JSON-LD. (Note: chars page is at `/dictionary/[char]`, not `/chars/[char]`.)

---

### Task 1: 训蒙骈句 ingest (file-only — no `chunks` column)

**Files:**
- Create: `scripts/build-pianwen.ts`
- Test: `tests/integration/scripts/build-pianwen.test.ts`
- Modify: `data/classics-manifest.json` (auto-rebuilt by script)
- Modify: `data/classics/xunmeng-pianju.json` (created by script)
- Modify: `classics` row in piyin_dev (INSERT metadata only)

**Interfaces:**
- Consumes: `lib/guwendao-scraper.ts` (`fetchChapterList`, `scrapeChapterContent`), `lib/classics-types.ts` (`VolumeJson`).
- Produces: `buildPianwen()` — writes `data/classics/xunmeng-pianju.json` (1 entry in `classics-manifest.json`), inserts 1 row into `classics` table (metadata only, no `chunks` column).
- Category: `'pianwen'` — requires the `classics.category` ENUM to be widened to include this value. Check first; ALTER if needed.

**Discovery (Step 0 — before writing code):**
- Read `lib/classics-types.ts` for the `VolumeJson` shape.
- Read `lib/guwendao-scraper.ts` for the `fetchChapterList(bookId)` and `scrapeChapterContent(bookId, chapterId)` signatures. (Both already exist.)
- Read the latest commit message for `scripts/build-classics-guwendao.ts` to see the post-`8b204b61` pattern (it writes JSON + manifest + 6-col INSERT, not 7-col).
- Run `"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SHOW COLUMNS FROM classics;"` and confirm no `chunks` column + the ENUM values for `category`.

- [ ] **Step 1: Widen `classics.category` ENUM (idempotent) + write failing test**

```ts
// tests/integration/scripts/build-pianwen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

const mockScraper = {
  fetchChapterList: vi.fn(),
  scrapeChapterContent: vi.fn(),
};
vi.mock('../../../lib/guwendao-scraper', () => mockScraper);

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...a: any[]) => mockWriteFile(...a),
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: (...a: any[]) => mockReadDir(...a),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 1000 }),
}));

describe('buildPianwen', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls fetchChapterList + scrapeChapterContent + writes JSON + INSERT', async () => {
    mockScraper.fetchChapterList.mockResolvedValueOnce(['c1', 'c2']);
    mockScraper.scrapeChapterContent
      .mockResolvedValueOnce({ title: '一东', paragraphs: ['天上双星会','人间此夜同'] })
      .mockResolvedValueOnce({ title: '二冬', paragraphs: ['春光正好','花影重重'] });
    mockQuery.mockResolvedValue([[]]); // no existing row + no manifest entry yet
    mockReadDir.mockReturnValue([]);  // manifest starts empty for the test
    mockReadFile.mockImplementation((p: string) => {
      if (p.endsWith('classics-manifest.json')) return JSON.stringify({ version: 1, updatedAt: '2026-06-22', books: [] });
      if (p.endsWith('xunmeng-pianju.json')) return JSON.stringify({ slug: 'xunmeng-pianju', chunks: [] });
      return '{}';
    });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { buildPianwen } = await import('../../../scripts/build-pianwen');
    const r = await buildPianwen();
    expect(r.chapters).toBe(2);
    expect(mockScraper.fetchChapterList).toHaveBeenCalledWith('427c5eea5943');
    expect(mockExecute.mock.calls.some((c: any) => c[0].startsWith('INSERT INTO classics'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `pnpm test tests/integration/scripts/build-pianwen.test.ts`
Expected: FAIL — module `scripts/build-pianwen` not found.

- [ ] **Step 3: Widen `classics.category` ENUM (idempotent)**

Append to `scripts/build-pianwen.ts` (top of file, before any function):

```ts
// scripts/build-pianwen.ts — top
import { getPool, closePool } from '../lib/db';

const PIANWEN_CATEGORY = 'pianwen';

async function ensurePianwenCategory(pool: any): Promise<'widened' | 'already'> {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'classics' AND COLUMN_NAME = 'category'`
  );
  const colType: string = rows?.[0]?.COLUMN_TYPE ?? '';
  if (colType.includes("'pianwen'")) return 'already';
  // Current ENUM: 'four-books','five-classics','mengxue','philosophy','history','other'
  await pool.query(
    `ALTER TABLE classics MODIFY COLUMN category
     ENUM('four-books','five-classics','mengxue','philosophy','history','other','pianwen')
     NOT NULL DEFAULT 'other'`
  );
  console.log('[build-pianwen] widened classics.category ENUM to include pianwen');
  return 'widened';
}
```

The rest of the script (in subsequent steps) calls `ensurePianwenCategory(pool)` first.

- [ ] **Step 4: Write minimal `build-pianwen.ts` body**

```ts
// scripts/build-pianwen.ts — full file
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { fetchChapterList, scrapeChapterContent } from '../lib/guwendao-scraper';
import type { VolumeJson } from '../lib/classics-types';

const DATA_DIR = join(process.cwd(), 'data', 'classics');
const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');
const BOOK_ID = '427c5eea5943';
const SLUG = 'xunmeng-pianju';
const SOURCE = 'guwendao.net/训蒙骈句';

const PIANWEN_CATEGORY = 'pianwen';

async function ensurePianwenCategory(pool: any): Promise<'widened' | 'already'> {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'classics' AND COLUMN_NAME = 'category'`
  );
  const colType: string = (rows as any[])?.[0]?.COLUMN_TYPE ?? '';
  if (colType.includes("'pianwen'")) return 'already';
  await pool.query(
    `ALTER TABLE classics MODIFY COLUMN category
     ENUM('four-books','five-classics','mengxue','philosophy','history','other','pianwen')
     NOT NULL DEFAULT 'other'`
  );
  console.log('[build-pianwen] widened classics.category ENUM to include pianwen');
  return 'widened';
}

function countChars(chunks: VolumeJson['chunks']): number {
  return chunks.reduce((n, c) => n + c.content.reduce((s, p) => s + Array.from(p).length, 0), 0);
}

export interface PianwenResult {
  chapters: number;
  bytes: number;
  categoryStatus: 'widened' | 'already';
}

export async function buildPianwen(): Promise<PianwenResult> {
  const pool = getPool();
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const categoryStatus = await ensurePianwenCategory(pool);

  // Idempotency: skip if file already exists + DB row already exists
  const filePath = join(DATA_DIR, `${SLUG}.json`);
  if (existsSync(filePath)) {
    const [rows] = await pool.query<any[]>(`SELECT 1 FROM classics WHERE slug = ? LIMIT 1`, [SLUG]);
    if ((rows as any[]).length > 0) {
      console.log(`[build-pianwen] ${SLUG} already on disk + DB, skipping`);
      return { chapters: 0, bytes: 0, categoryStatus };
    }
  }

  const chapterIds = await fetchChapterList(BOOK_ID);
  const chunks: VolumeJson['chunks'] = [];
  for (let i = 0; i < chapterIds.length; i++) {
    const { title, paragraphs } = await scrapeChapterContent(BOOK_ID, chapterIds[i]!);
    chunks.push({
      id: i + 1,
      label: title,
      content: paragraphs,
      pinyin: paragraphs.map(() => []),
    });
  }

  const vol: VolumeJson = {
    slug: SLUG,
    title: '训蒙骈句',
    category: 'pianwen',
    author: '萧良有/司祢',
    era: '明/清',
    source: SOURCE,
    bookId: BOOK_ID,
    bookTitle: '训蒙骈句',
    chapterRange: { from: 1, to: chunks.length },
    chunks,
  };
  const json = JSON.stringify(vol, null, 2);
  writeFileSync(filePath, json, 'utf8');

  // UPSERT metadata (NO chunks column — column was dropped in 8b204b61)
  await pool.execute(
    `INSERT INTO classics (slug, title, category, author, era, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       category = VALUES(category),
       author = VALUES(author),
       era = VALUES(era),
       source = VALUES(source)`,
    [SLUG, '训蒙骈句', PIANWEN_CATEGORY, '萧良有/司祢', '明/清', SOURCE]
  );

  // Rebuild manifest by appending this book (other entries preserved)
  const manifestRaw = readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const newEntry = {
    slug: SLUG, title: '训蒙骈句', source: SOURCE, category: PIANWEN_CATEGORY,
    author: '萧良有/司祢', era: '明/清', chapterCount: chunks.length,
    charCount: countChars(chunks), jsonFile: `data/classics/${SLUG}.json`,
    jsonBytes: statSync(filePath).size, bookId: BOOK_ID, bookTitle: '训蒙骈句',
  };
  // Replace if already present (idempotent), else append
  const idx = manifest.books.findIndex((b: any) => b.slug === SLUG);
  if (idx >= 0) manifest.books[idx] = newEntry;
  else manifest.books.push(newEntry);
  manifest.books.sort((a: any, b: any) => a.slug.localeCompare(b.slug));
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  const result: PianwenResult = { chapters: chunks.length, bytes: json.length, categoryStatus };
  console.log(`[build-pianwen] ${SLUG}: ${chunks.length} chapters, ${(json.length / 1024).toFixed(1)} KB → ${filePath}`);
  return result;
}

if (require.main === module) {
  buildPianwen()
    .then((r) => console.log(`[done] chapters=${r.chapters} bytes=${r.bytes} categoryStatus=${r.categoryStatus}`))
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => closePool());
}
```

- [ ] **Step 5: Run test to verify PASS**

Run: `pnpm test tests/integration/scripts/build-pianwen.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Run on piyin_dev**

```bash
pnpm tsx --env-file=.env.local scripts/build-pianwen.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT slug, title, category, author, era FROM classics WHERE category='pianwen';"
```

Expected: 1 row inserted with `slug=xunmeng-pianju`, `category=pianwen`, `author=萧良有/司祢`, `era=明/清`. ~30 chapters, ~10-20 KB JSON. Manifest now has 195 books (was 194).

- [ ] **Step 7: Re-run to verify idempotent**

```bash
pnpm tsx --env-file=.env.local scripts/build-pianwen.ts
```

Expected: `[build-pianwen] xunmeng-pianju already on disk + DB, skipping` and `chapters=0 bytes=0 categoryStatus=already`.

- [ ] **Step 8: tsc + commit**

```bash
pnpm tsc --noEmit
git add scripts/build-pianwen.ts tests/integration/scripts/build-pianwen.test.ts data/classics/xunmeng-pianju.json data/classics-manifest.json
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(classics): ingest 训蒙骈句 (30 chapters, pianwen category)"
```

---

### Task 2: SEO lib foundation (config + metadata + jsonld)

**Files:**
- Create: `lib/seo/config.ts`
- Create: `lib/seo/metadata.ts`
- Create: `lib/seo/jsonld.ts`
- Test: `tests/unit/lib/seo/config.test.ts`
- Test: `tests/unit/lib/seo/metadata.test.ts`
- Test: `tests/unit/lib/seo/jsonld.test.ts`

**Interfaces:**
- `getSiteUrl(): string` — reads `NEXT_PUBLIC_SITE_URL`, falls back to `http://localhost:3000`. Strips trailing `/`.
- `buildCanonicalUrl(path: string): string` — returns absolute URL.
- `SITE_NAME`, `SITE_LOCALE` constants.
- `buildMetadata({ title, description, path, ogType?, image? }): Metadata` — generic Next.js metadata builder with canonical + OpenGraph + Twitter.
- `buildCreativeWork(p: PoemForJsonLd): object` — schema.org CreativeWork for poems.
- `buildBook(b: BookForJsonLd): object` — schema.org Book for classics.
- `buildDefinedTerm(t: TermForJsonLd): object` — schema.org DefinedTerm for chars.
- `buildBreadcrumbList(items: Array<{name, url}>): object` — schema.org BreadcrumbList.
- `buildOrganization(): object` — schema.org Organization for the homepage.
- `buildWebSite(): object` — schema.org WebSite with SearchAction.

**Design decisions:**
- `lib/seo/*` is **leaf and side-effect-free** (no DB calls, no React, no Next.js data fetchers). Detail pages fetch their data first, then call a builder with the data. This is the opposite of V1's design (which had `generatePoemMetadata` etc. that fetched from DB); we keep builders pure and let the caller (RSC) own the fetch.
- All builders return plain objects; the detail page is responsible for `JSON.stringify` + `dangerouslySetInnerHTML`.
- `lib/seo/config.ts` reads `process.env.NEXT_PUBLIC_SITE_URL` lazily inside `getSiteUrl()` (NOT at module top level) so the value can differ between `next build` (Vercel env) and `next dev` (`.env.local`).

- [ ] **Step 1: Write failing tests for `lib/seo/config.ts`**

```ts
// tests/unit/lib/seo/config.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('getSiteUrl', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

  it('returns env value when set, stripping trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://pinyin.example.com/';
    return import('@/lib/seo/config').then(m => {
      expect(m.getSiteUrl()).toBe('https://pinyin.example.com');
    });
  });

  it('returns fallback when env missing', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    return import('@/lib/seo/config').then(m => {
      expect(m.getSiteUrl()).toBe('http://localhost:3000');
    });
  });
});

describe('buildCanonicalUrl', () => {
  it('prepends site url and adds leading slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    return import('@/lib/seo/config').then(m => {
      expect(m.buildCanonicalUrl('/poetry/1')).toBe('https://x.com/poetry/1');
      expect(m.buildCanonicalUrl('poetry/1')).toBe('https://x.com/poetry/1');
    });
  });

  it('passes through absolute URLs unchanged', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    return import('@/lib/seo/config').then(m => {
      expect(m.buildCanonicalUrl('https://other.com/y')).toBe('https://other.com/y');
    });
  });
});
```

- [ ] **Step 2: Write failing tests for `lib/seo/jsonld.ts`**

```ts
// tests/unit/lib/seo/jsonld.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.resetModules(); process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com'; });

describe('buildCreativeWork', () => {
  it('has required schema.org fields', async () => {
    const { buildCreativeWork } = await import('@/lib/seo/jsonld');
    const j = buildCreativeWork({ title: '静夜思', author: '李白', dynasty: 'tang', content: ['床前明月光'] });
    expect(j['@context']).toBe('https://schema.org');
    expect(j['@type']).toBe('CreativeWork');
    expect(j.name).toBe('静夜思');
    expect(j.author).toEqual({ '@type': 'Person', name: '李白' });
    expect(j.inLanguage).toBe('zh-CN');
    expect(j.text).toBe('床前明月光');
  });
});

describe('buildBook', () => {
  it('includes era as datePublished', async () => {
    const { buildBook } = await import('@/lib/seo/jsonld');
    const j = buildBook({ title: '论语', author: '孔子', era: '春秋' });
    expect(j['@type']).toBe('Book');
    expect(j.datePublished).toBe('春秋');
  });
  it('omits datePublished when era null', async () => {
    const { buildBook } = await import('@/lib/seo/jsonld');
    const j = buildBook({ title: '佚名', author: null, era: null });
    expect(j.datePublished).toBeUndefined();
  });
});

describe('buildDefinedTerm', () => {
  it('includes char as name', async () => {
    const { buildDefinedTerm } = await import('@/lib/seo/jsonld');
    const j = buildDefinedTerm({ char: '学', meaning: '学习' });
    expect(j['@type']).toBe('DefinedTerm');
    expect(j.name).toBe('学');
    expect(j.description).toBe('学习');
  });
});

describe('buildBreadcrumbList', () => {
  it('maps items to ListItem with absolute URL', async () => {
    const { buildBreadcrumbList } = await import('@/lib/seo/jsonld');
    const j = buildBreadcrumbList([{ name: '首页', url: '/' }, { name: '字典', url: '/chars' }]);
    expect(j.itemListElement.length).toBe(2);
    expect(j.itemListElement[0].item).toBe('https://x.com/');
    expect(j.itemListElement[1].position).toBe(2);
  });
});

describe('buildWebSite', () => {
  it('includes SearchAction with target template', async () => {
    const { buildWebSite } = await import('@/lib/seo/jsonld');
    const j = buildWebSite();
    expect(j.potentialAction['@type']).toBe('SearchAction');
    expect(j.potentialAction.target.urlTemplate).toContain('{search_term_string}');
  });
});
```

- [ ] **Step 3: Run tests to verify both FAIL**

```bash
pnpm test tests/unit/lib/seo/config.test.ts tests/unit/lib/seo/jsonld.test.ts
```

Expected: both FAIL — modules not found.

- [ ] **Step 4: Write `lib/seo/config.ts`**

```ts
// lib/seo/config.ts
export const SITE_NAME = '字·韵';
export const SITE_LOCALE = 'zh_CN';
const FALLBACK = 'http://localhost:3000';

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || FALLBACK;
  return raw.replace(/\/+$/, '');
}

export function buildCanonicalUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const leading = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl()}${leading}`;
}
```

- [ ] **Step 5: Write `lib/seo/jsonld.ts`**

```ts
// lib/seo/jsonld.ts
import { getSiteUrl, SITE_NAME } from './config';

export interface PoemForJsonLd {
  title: string;
  author: string;
  dynasty: string;
  content: string[];
}

export function buildCreativeWork(p: PoemForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: p.title,
    author: { '@type': 'Person', name: p.author || '佚名' },
    inLanguage: 'zh-CN',
    text: p.content.join('\n'),
  };
}

export interface BookForJsonLd {
  title: string;
  author: string | null;
  era: string | null;
}

export function buildBook(b: BookForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: b.title,
    author: { '@type': 'Person', name: b.author || '佚名' },
    inLanguage: 'zh-CN',
    ...(b.era ? { datePublished: b.era } : {}),
  };
}

export interface TermForJsonLd {
  char: string;
  meaning: string | null;
}

export function buildDefinedTerm(t: TermForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: t.char,
    ...(t.meaning ? { description: t.meaning } : {}),
    inLanguage: 'zh-CN',
  };
}

export function buildBreadcrumbList(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${getSiteUrl()}${item.url.startsWith('/') ? item.url : '/' + item.url}`,
    })),
  };
}

export function buildOrganization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: getSiteUrl(),
    logo: `${getSiteUrl()}/logo.png`,
  };
}

export function buildWebSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: getSiteUrl(),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${getSiteUrl()}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}
```

- [ ] **Step 6: Run tests to verify PASS**

Run: `pnpm test tests/unit/lib/seo/config.test.ts tests/unit/lib/seo/jsonld.test.ts`
Expected: PASS (12+ tests).

- [ ] **Step 7: Write `lib/seo/metadata.ts` + failing test**

```ts
// tests/unit/lib/seo/metadata.test.ts
import { describe, it, expect, afterEach } from 'vitest';
afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = undefined; });

describe('buildMetadata', () => {
  it('includes title, description, canonical, openGraph, twitter', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    const { buildMetadata } = await import('@/lib/seo/metadata');
    const m = buildMetadata({ title: '静夜思', description: '床前明月光', path: '/poetry/1' });
    expect(m.title).toBe('静夜思');
    expect(m.description).toBe('床前明月光');
    expect(m.alternates?.canonical).toBe('https://x.com/poetry/1');
    expect(m.openGraph?.url).toBe('https://x.com/poetry/1');
    expect(m.twitter?.card).toBe('summary_large_image');
  });

  it('omits image when not provided', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    const { buildMetadata } = await import('@/lib/seo/metadata');
    const m = buildMetadata({ title: 't', description: 'd', path: '/x' });
    expect(m.openGraph?.images).toBeUndefined();
  });
});
```

```ts
// lib/seo/metadata.ts
import type { Metadata } from 'next';
import { buildCanonicalUrl } from './config';

export interface BuildMetadataArgs {
  title: string;
  description: string;
  path: string;
  ogType?: 'website' | 'article' | 'book';
  image?: string;
}

export function buildMetadata(args: BuildMetadataArgs): Metadata {
  const canonical = buildCanonicalUrl(args.path);
  const ogType = args.ogType ?? 'website';
  return {
    title: args.title,
    description: args.description,
    alternates: { canonical },
    openGraph: {
      title: args.title,
      description: args.description,
      url: canonical,
      type: ogType,
      ...(args.image ? { images: [{ url: args.image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: args.title,
      description: args.description,
      ...(args.image ? { images: [args.image] } : {}),
    },
  };
}
```

- [ ] **Step 8: Run test to verify PASS**

Run: `pnpm test tests/unit/lib/seo/metadata.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: tsc + commit**

```bash
pnpm tsc --noEmit
git add lib/seo/ tests/unit/lib/seo/
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): lib/seo module (config, metadata, jsonld) — pure leaf, no DB"
```

---

### Task 3: robots.txt + sitemap sub-routes + root sitemap refactor

**Files:**
- Create: `app/robots.ts`
- Create: `app/sitemap/poetry.xml/route.ts`
- Create: `app/sitemap/ancient.xml/route.ts`
- Create: `app/sitemap/chars.xml/route.ts`
- Modify: `app/sitemap.ts` (extend with references to sub-sitemaps)
- Test: `tests/integration/app/sitemap.test.ts`

**Interfaces:**
- `GET /robots.txt` → Next.js robots config.
- `GET /sitemap/poetry.xml` → XML with all poem URLs from `data/poems-manifest.json`.
- `GET /sitemap/ancient.xml` → XML with all classic URLs from `data/classics-manifest.json`.
- `GET /sitemap/chars.xml` → XML with all char URLs from a `SELECT char FROM chars` query (chars are DB-backed).
- `GET /sitemap.xml` → Next.js `MetadataRoute.Sitemap` index that includes the 3 sub-sitemap URLs.

**Design decisions:**
- Sub-sitemaps are **file-backed** (read from manifest) for poems and classics. The `chars` table is still DB-backed (8105 chars), so the chars sub-sitemap queries the DB.
- `app/sitemap/poetry.xml/route.ts` reads `data/poems-manifest.json` and emits one `<url>` per item. The `lastmod` is taken from `manifest.updatedAt` (single value for the whole manifest — manifest is rewritten as a whole each ingest).
- `revalidate = 3600` (1 hour) on all sitemap routes so Next.js caches.
- The `app/sitemap.ts` (root) is already a `MetadataRoute.Sitemap` index that includes high-level routes. Extend it to also include the 3 sub-sitemap URLs.

- [ ] **Step 1: Write failing test for sub-sitemap routes**

```ts
// tests/integration/app/sitemap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: (...a: any[]) => mockReadDir(...a),
  existsSync: vi.fn().mockReturnValue(true),
}));

const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: vi.fn() }),
}));

describe('sub-sitemap routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('poetry.xml emits <urlset> with each manifest item', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-22T00:00:00Z', count: 2,
      items: [{ id: 1, title: 'a', author: 'b', dynasty: 'tang' }, { id: 2, title: 'c', author: 'd', dynasty: 'tang' }],
    }));
    const { GET } = await import('@/app/sitemap/poetry.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('<urlset');
    expect(text).toContain('https://x.com/poetry/1');
    expect(text).toContain('https://x.com/poetry/2');
  });

  it('ancient.xml emits <urlset> with each manifest book', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-22T00:00:00Z', books: [{ slug: 'lunyu' }, { slug: 'daxue' }],
    }));
    const { GET } = await import('@/app/sitemap/ancient.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/ancient/lunyu');
    expect(text).toContain('https://x.com/ancient/daxue');
  });

  it('chars.xml queries chars table and emits each char', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockQuery.mockResolvedValueOnce([[{ char: '学' }, { char: '习' }]]);
    const { GET } = await import('@/app/sitemap/chars.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('学'));
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('习'));
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/app/sitemap.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `app/sitemap/poetry.xml/route.ts`**

```ts
// app/sitemap/poetry.xml/route.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const raw = readFileSync(join(process.cwd(), 'data', 'poems-manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as { updatedAt: string; items: { id: number }[] };
  const base = getSiteUrl();
  const lastmod = new Date(manifest.updatedAt).toISOString();
  const urls = manifest.items
    .map((i) => `<url><loc>${base}/poetry/${i.id}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

- [ ] **Step 4: Write `app/sitemap/ancient.xml/route.ts`**

```ts
// app/sitemap/ancient.xml/route.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const raw = readFileSync(join(process.cwd(), 'data', 'classics-manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as { updatedAt: string; books: { slug: string }[] };
  const base = getSiteUrl();
  const lastmod = new Date(manifest.updatedAt).toISOString();
  const urls = manifest.books
    .map((b) => `<url><loc>${base}/ancient/${b.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

- [ ] **Step 5: Write `app/sitemap/chars.xml/route.ts`**

```ts
// app/sitemap/chars.xml/route.ts
import { getPool } from '@/lib/db';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT \`char\` FROM chars ORDER BY \`char\``);
  const base = getSiteUrl();
  const lastmod = new Date().toISOString();
  const urls = (rows as any[])
    .map((r) => `<url><loc>${base}/dictionary/${encodeURIComponent(r.char)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

Note: char URLs use `/dictionary/<char>` (not `/chars/<char>`) — verified by the current `app/dictionary/[char]/page.tsx`.

- [ ] **Step 6: Write `app/robots.ts`**

```ts
// app/robots.ts
import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/seo/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account'] }],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
```

- [ ] **Step 7: Extend `app/sitemap.ts` to include sub-sitemap references**

Read the current `app/sitemap.ts` first. If the existing file is the simple 4-route version, REPLACE it with:

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, priority: 1.0, changeFrequency: 'daily' },
    { url: `${base}/poetry`, priority: 0.9, changeFrequency: 'daily' },
    { url: `${base}/ancient`, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/dictionary`, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/sitemap/poetry.xml`, lastModified: now },
    { url: `${base}/sitemap/ancient.xml`, lastModified: now },
    { url: `${base}/sitemap/chars.xml`, lastModified: now },
  ];
}
```

(Adjust if the existing file has additional routes we want to keep — read it first.)

- [ ] **Step 8: Run test, verify PASS**

Run: `pnpm test tests/integration/app/sitemap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Smoke on dev server**

```bash
pnpm dev
# in another terminal:
curl -sI http://localhost:4444/robots.txt
curl -sI http://localhost:4444/sitemap.xml
curl -sI http://localhost:4444/sitemap/poetry.xml
curl -sI http://localhost:4444/sitemap/ancient.xml
curl -sI http://localhost:4444/sitemap/chars.xml
```

Expected: all 200 OK. `/sitemap.xml` should be a small XML index. `/sitemap/poetry.xml` should contain `<urlset>` with 1161 `<url>` entries.

- [ ] **Step 10: tsc + build + commit (per memory rule — touches new routes)**

```bash
pnpm tsc --noEmit
pnpm build
git add app/robots.ts app/sitemap/ app/sitemap.ts tests/integration/app/sitemap.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): robots.txt + 3 sub-sitemaps (poetry/ancient/chars) + root sitemap index"
```

---

### Task 4: Poetry detail page — replace inline JSON-LD with lib/seo + add canonical

**Files:**
- Modify: `app/poetry/[id]/page.tsx`
- Modify: `app/poetry/[id]/jsonld.ts` (delete — content moves to `lib/seo/jsonld.ts`)

**Interfaces:**
- `app/poetry/[id]/page.tsx` calls `buildMetadata()` (from `lib/seo/metadata.ts`) inside `generateMetadata`.
- Detail page injects 2 JSON-LD scripts: `buildCreativeWork(poem)` + `buildBreadcrumbList([...])`.
- Old `app/poetry/[id]/jsonld.ts` deleted.

**Design decisions:**
- The detail page already has `generateMetadata` returning minimal `{title, description}`. Replace the body with a call to `buildMetadata` for full OpenGraph + canonical + Twitter.
- The current JSON-LD is built by an inline `app/poetry/[id]/jsonld.ts` helper. Replace the import with `buildCreativeWork` + `buildBreadcrumbList` from `lib/seo/jsonld.ts`, and delete the local `jsonld.ts` file.

- [ ] **Step 1: Read current `app/poetry/[id]/page.tsx` and `app/poetry/[id]/jsonld.ts`**

```bash
cat "E:/ToolDevelop/PinYinCharacter/app/poetry/[id]/page.tsx"
cat "E:/ToolDevelop/PinYinCharacter/app/poetry/[id]/jsonld.ts"
```

Identify: (a) the existing `generateMetadata` return shape, (b) the existing `buildPoemJsonLd(poem)` call site, (c) where the `<script type="application/ld+json">` is rendered. Use these exact line numbers in the next step.

- [ ] **Step 2: Replace imports in `app/poetry/[id]/page.tsx`**

Find:
```ts
import { buildPoemJsonLd } from './jsonld';
```
Replace with:
```ts
import { buildMetadata } from '@/lib/seo/metadata';
import { buildCreativeWork, buildBreadcrumbList } from '@/lib/seo/jsonld';
```

- [ ] **Step 3: Replace the `generateMetadata` body**

Find the existing `generateMetadata` function (it returns `{ title, description }`). Replace the entire function with:

```tsx
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return {};
  const poem = await getPoem(id);
  if (!poem) return {};
  const excerpt = poem.content.slice(0, 2).join(' / ').slice(0, 80);
  return buildMetadata({
    title: `${poem.title} - ${poem.author}`,
    description: `${poem.author}《${poem.title}》: ${excerpt}`,
    path: `/poetry/${id}`,
    ogType: 'article',
  });
}
```

(Removes the existing inline `return { title, description }` block.)

- [ ] **Step 4: Replace the JSON-LD injection**

Find the existing `<script type="application/ld+json" ... dangerouslySetInnerHTML={{ __html: JSON.stringify(buildPoemJsonLd(poem)) }} />` line. Replace it with:

```tsx
<script
  type="application/ld+json"
  // eslint-disable-next-line react/no-danger
  dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCreativeWork(poem)) }}
/>
<script
  type="application/ld+json"
  // eslint-disable-next-line react/no-danger
  dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbList([
    { name: '首页', url: '/' },
    { name: '诗词', url: '/poetry' },
    { name: poem.title, url: `/poetry/${poem.id}` },
  ])) }}
/>
```

(If the existing JSON-LD is in a Fragment wrapper, place the 2 scripts adjacent to it.)

- [ ] **Step 5: Delete `app/poetry/[id]/jsonld.ts`**

```bash
rm "E:/ToolDevelop/PinYinCharacter/app/poetry/[id]/jsonld.ts"
```

- [ ] **Step 6: tsc + build + commit (per memory rule — touches page.tsx)**

```bash
pnpm tsc --noEmit
pnpm build
git add app/poetry/[id]/page.tsx
git rm app/poetry/[id]/jsonld.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "refactor(seo): /poetry/[id] use lib/seo (buildMetadata + buildCreativeWork + breadcrumb)"
```

---

### Task 5: Ancient detail page — extend generateMetadata + add JSON-LD

**Files:**
- Modify: `app/ancient/[slug]/page.tsx`

**Interfaces:**
- `generateMetadata` now returns full `buildMetadata` result with canonical + OpenGraph.
- Detail page injects `buildBook(classic)` + `buildBreadcrumbList([...])` JSON-LD scripts.

- [ ] **Step 1: Read `app/ancient/[slug]/page.tsx`**

```bash
cat "E:/ToolDevelop/PinYinCharacter/app/ancient/[slug]/page.tsx"
```

Identify: (a) existing `generateMetadata` body (currently minimal: `{ title: `${c.title} · 古籍 · 字·韵` }`), (b) the start of the JSX return.

- [ ] **Step 2: Replace imports**

Find the existing import block (after `notFound` from `next/navigation` and `getClassicBySlug` from `@/lib/classics`). Add:

```ts
import { buildMetadata } from '@/lib/seo/metadata';
import { buildBook, buildBreadcrumbList } from '@/lib/seo/jsonld';
```

- [ ] **Step 3: Replace `generateMetadata` body**

Find the existing `generateMetadata` function. Replace the entire body with:

```tsx
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const c = await getClassicBySlug(slug);
  if (!c) return { title: '古籍 · 字·韵' };
  const desc = `${c.title}${c.author ? ` - ${c.author}` : ''} (${c.era || ''}) 全文带拼音注音`;
  return buildMetadata({
    title: `${c.title} (${c.era || '古代'}) 全文 拼音 | 字·韵`,
    description: desc,
    path: `/ancient/${slug}`,
    ogType: 'book',
  });
}
```

- [ ] **Step 4: Add JSON-LD injection**

In the JSX return, find the opening `<>` (Fragment). Add immediately after the `<>` opening:

```tsx
<>
  <script
    type="application/ld+json"
    // eslint-disable-next-line react/no-danger
    dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBook({ title: book.title, author: book.author, era: book.era })) }}
  />
  <script
    type="application/ld+json"
    // eslint-disable-next-line react/no-danger
    dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbList([
      { name: '首页', url: '/' },
      { name: '古籍', url: '/ancient' },
      { name: book.title, url: `/ancient/${book.slug}` },
    ])) }}
  />
  <Suspense><Header /></Suspense>
  ...
```

(Adjust to match the existing Fragment structure — read the file first.)

- [ ] **Step 5: tsc + build + commit (per memory rule — touches page.tsx)**

```bash
pnpm tsc --noEmit
pnpm build
git add app/ancient/[slug]/page.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): /ancient/[slug] full generateMetadata + Book + breadcrumb JSON-LD"
```

---

### Task 6: Chars detail page — add generateMetadata + JSON-LD

**Files:**
- Modify: `app/dictionary/[char]/page.tsx`

**Interfaces:**
- Add `generateMetadata` (uses file-based `getChar` if available, else falls back to `getPool().query('SELECT ... FROM chars')`).
- Inject `buildDefinedTerm(charInfo)` + `buildBreadcrumbList([...])` JSON-LD.

**Discovery (Step 0):**
- Read `app/dictionary/[char]/page.tsx` (currently 31 lines per earlier check) to know how it currently loads the char.
- The `chars` table is still DB-backed (8105 chars). The page likely already does `getPool().query('SELECT ... FROM chars WHERE char = ?')` or uses a helper in `lib/chars.ts`. Use whichever is the existing pattern.

- [ ] **Step 1: Read `app/dictionary/[char]/page.tsx`**

```bash
cat "E:/ToolDevelop/PinYinCharacter/app/dictionary/[char]/page.tsx"
```

- [ ] **Step 2: Read `lib/chars.ts` (or equivalent) for the data-fetching helper**

```bash
grep -nE "^export (async )?function getChar|^export const getChar" "E:/ToolDevelop/PinYinCharacter/lib/chars.ts"
```

Use the existing `getChar(char)` helper if it exists. If not, define one inline using `getPool().query('SELECT char, pinyin, level, radical, stroke_count, meaning_zh FROM chars WHERE char = ? LIMIT 1', [char])`.

- [ ] **Step 3: Add `generateMetadata` to the page**

After the existing imports, add:

```ts
import { buildMetadata } from '@/lib/seo/metadata';
import { buildDefinedTerm, buildBreadcrumbList } from '@/lib/seo/jsonld';

export async function generateMetadata({ params }: { params: Promise<{ char: string }> }) {
  const { char: encoded } = await params;
  const ch = decodeURIComponent(encoded);
  // Reuse the same data source as the page
  const charInfo = await getChar(ch);
  if (!charInfo) return { title: `${ch} | 字·韵` };
  const meaning = (charInfo.meaning_zh ?? '').slice(0, 80);
  return buildMetadata({
    title: `${ch} - 拼音 ${charInfo.pinyin} - 释义 | 字·韵`,
    description: `汉字「${ch}」的拼音 ${charInfo.pinyin}，释义：${meaning}`,
    path: `/dictionary/${encoded}`,
    ogType: 'article',
  });
}
```

(Adjust `getChar` reference if the file uses a different helper name.)

- [ ] **Step 4: Add JSON-LD injection in JSX**

In the page's JSX return, after the opening `<>` (or at the top of the container), add:

```tsx
<>
  <script
    type="application/ld+json"
    // eslint-disable-next-line react/no-danger
    dangerouslySetInnerHTML={{ __html: JSON.stringify(buildDefinedTerm({ char: charInfo.char, meaning: charInfo.meaning_zh ?? null })) }}
  />
  <script
    type="application/ld+json"
    // eslint-disable-next-line react/no-danger
    dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbList([
      { name: '首页', url: '/' },
      { name: '字典', url: '/dictionary' },
      { name: charInfo.char, url: `/dictionary/${encodeURIComponent(charInfo.char)}` },
    ])) }}
  />
  {/* existing page content */}
```

- [ ] **Step 5: tsc + build + commit (per memory rule — touches page.tsx)**

```bash
pnpm tsc --noEmit
pnpm build
git add app/dictionary/[char]/page.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): /dictionary/[char] generateMetadata + DefinedTerm + breadcrumb JSON-LD"
```

---

### Task 7: Form filter — query layer (`getAvailableForms` + `category` filter)

**Files:**
- Modify: `lib/poetry/queries.ts` (add `category` filter to `listPoems`, add `getAvailableForms`)
- Modify: `lib/api-poetry.ts` (add `category` + `forms` params to `listPoemsRequest`, add `getAvailableFormsRequest`)
- Modify: `app/api/poetry/route.ts` (accept `category` + `forms` query params)
- Create: `app/api/poetry/forms/route.ts`
- Modify: `lib/poetry-types.ts` (widen `Dynasty` to `string`)
- Test: `tests/unit/lib/poetry/queries.test.ts` (extend)

**Interfaces:**
- `listPoems(args)` now accepts `category?: string` in addition to existing `dynasty` and `form`.
- `getAvailableForms(category: string): Promise<string[]>` returns:
  - For 诗类 categories (`tang`, `汉乐府`, `古诗十九首`, `魏`, `骈文`): `SHI_FORMS` constant array `['五绝', '七绝', '五律', '七律', '五言古风', '七言古风', '杂言古风', '乐府']`.
  - For `song` or `qing`: top 30 most-common `form` values from the manifest for that category.
  - For `yuan`: `['小令', '套数']`.
  - Default: empty array.

- [ ] **Step 1: Read `lib/poetry/queries.ts` and `lib/poetry-types.ts` to know current signatures**

```bash
cat "E:/ToolDevelop/PinYinCharacter/lib/poetry/queries.ts"
cat "E:/ToolDevelop/PinYinCharacter/lib/poetry-types.ts"
```

- [ ] **Step 2: Widen `Dynasty` to `string` in `lib/poetry-types.ts`**

Find `export type Dynasty = 'tang' | 'song';` and replace with `export type Dynasty = string;`. This is needed because the 5 new collections use `汉`, `汉末`, `三国`, `清`, `mixed` as dynasty values (not just `tang`/`song`).

- [ ] **Step 3: Write failing test for `getAvailableForms` + `category` filter**

```ts
// tests/unit/lib/poetry/queries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockStat = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: vi.fn().mockReturnValue([]),
  existsSync: vi.fn().mockReturnValue(true),
  statSync: (...a: any[]) => mockStat(...a),
}));

describe('getAvailableForms', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns SHI_FORMS for 诗类 categories', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('tang')).toEqual(expect.arrayContaining(['五绝', '七绝', '五律', '七律']));
    expect(await getAvailableForms('汉乐府')).toEqual(expect.arrayContaining(['五绝', '乐府']));
  });

  it('returns top N forms from manifest for song/qing', async () => {
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      count: 4,
      items: [
        { id: 1, title: 'a', author: 'x', dynasty: 'song', form: '水调歌头' },
        { id: 2, title: 'b', author: 'x', dynasty: 'song', form: '水调歌头' },
        { id: 3, title: 'c', author: 'x', dynasty: 'song', form: '浣溪沙' },
        { id: 4, title: 'd', author: 'x', dynasty: 'song', form: null },
      ],
    }));
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    const forms = await getAvailableForms('song');
    expect(forms).toContain('水调歌头');
    expect(forms).toContain('浣溪沙');
    expect(forms[0]).toBe('水调歌头'); // most common first
  });

  it('returns 元曲 fixed forms for yuan', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('yuan')).toEqual(['小令', '套数']);
  });

  it('returns empty for unknown category', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('unknown_xyz')).toEqual([]);
  });
});

describe('listPoems with category filter', () => {
  it('filters by category when provided', async () => {
    mockReadFile.mockReset();
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      count: 4,
      items: [
        { id: 1, dynasty: 'tang', form: '五绝', title: 'a', author: 'x' },
        { id: 2, dynasty: 'song', form: '水调歌头', title: 'b', author: 'x' },
        { id: 3, dynasty: '汉',   form: '五言古风', title: 'c', author: 'x' },
        { id: 4, dynasty: 'song', form: '浣溪沙', title: 'd', author: 'x' },
      ],
    }));
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', category: 'tang' } as any);
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.id).toBe(1);
  });
});
```

- [ ] **Step 4: Run test, verify FAIL**

Run: `pnpm test tests/unit/lib/poetry/queries.test.ts`
Expected: FAIL — `getAvailableForms` not exported.

- [ ] **Step 5: Extend `lib/poetry/queries.ts`**

Append to the file (and add the new function to the imports/exports):

```ts
// lib/poetry/queries.ts — append

export const SHI_FORMS = ['五绝', '七绝', '五律', '七律', '五言古风', '七言古风', '杂言古风', '乐府'] as const;
const YUAN_FORMS = ['小令', '套数'] as const;
const SHI_CATEGORIES = new Set(['tang', '汉乐府', '古诗十九首', '魏', '骈文']);

export async function getAvailableForms(category: string): Promise<string[]> {
  if (category === 'yuan') return [...YUAN_FORMS];
  if (SHI_CATEGORIES.has(category)) return [...SHI_FORMS];
  if (category === 'song' || category === 'qing') {
    const manifest = await loadManifest();
    const counts = new Map<string, number>();
    for (const i of manifest.items) {
      if (i.dynasty !== category || !i.form) continue;
      counts.set(i.form, (counts.get(i.form) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([form]) => form);
  }
  return [];
}
```

Also modify `listPoems` to accept `category`:

```ts
// lib/poetry/queries.ts — modify listPoems signature + filter
export interface ListPoemsArgs {
  dynasty: Dynasty;
  category?: string | null;
  q?: string;
  form?: string | null;
  page?: number;
  pageSize?: number;
}

export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const manifest = await loadManifest();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, args.pageSize ?? DEFAULT_PAGE_SIZE));
  const filtered = manifest.items.filter(i =>
    i.dynasty === args.dynasty &&
    (args.category == null || i.dynasty === args.category) &&  // <-- new
    (args.form == null || i.form === args.form) &&
    matchesQ({ title: i.title, author: i.author }, args.q ?? '')
  );
  // ... rest unchanged
}
```

(Yes, `category === dynasty` is intentional for now — the manifest stores `dynasty` as the category discriminator for the 5 new collections. If a future collection uses both `dynasty` and `category` separately, split them then. See memory gap below.)

**Note (design gap):** the current `PoemManifestItem` does NOT have a separate `category` field — it has `dynasty` (e.g. `'汉'`, `'song'`, `'tang'`) and the test mock above uses `dynasty` to discriminate categories. This is consistent with how `build-poems-extra.ts` set `dynasty` to the collection label (`汉`, `魏`, `清`, etc.). For this task, `category` filter is treated as a synonym for `dynasty` to keep the existing schema unchanged. If a real category column is needed later, it can be added in a follow-up.

- [ ] **Step 6: Run test, verify PASS**

Run: `pnpm test tests/unit/lib/poetry/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Update `lib/api-poetry.ts` to add `category` + `forms` + `getAvailableFormsRequest`**

```ts
// lib/api-poetry.ts — modify listPoemsRequest signature
export async function listPoemsRequest(args: { dynasty: string; category?: string; q?: string; forms?: string[]; page?: number; pageSize?: number }): Promise<PoemListResult> {
  const sp = new URLSearchParams();
  sp.set('dynasty', args.dynasty);
  if (args.category) sp.set('category', args.category);
  if (args.forms && args.forms.length > 0) sp.set('forms', args.forms.join(','));
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/poetry?${sp.toString()}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listPoems failed');
  return j.data;
}

export async function getAvailableFormsRequest(category: string): Promise<string[]> {
  const res = await fetch(`/api/poetry/forms?category=${encodeURIComponent(category)}`);
  if (!res.ok) return [];
  const j = await res.json();
  return j.forms ?? [];
}
```

(Note: we send `forms` as a CSV string because URLSearchParams doesn't natively support arrays. The route parses it back to an array.)

- [ ] **Step 8: Update `app/api/poetry/route.ts` to accept `category` + `forms`**

Read the current route first. Replace its GET handler to:

```ts
// app/api/poetry/route.ts
import { NextResponse } from 'next/server';
import { listPoems } from '@/lib/poetry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dynasty = url.searchParams.get('dynasty') || 'tang';
  const category = url.searchParams.get('category') || undefined;
  const formsParam = url.searchParams.get('forms');
  const forms = formsParam ? formsParam.split(',').filter(Boolean) : undefined;
  const q = url.searchParams.get('q') || undefined;
  const pageStr = url.searchParams.get('page');
  const page = pageStr ? Number(pageStr) : undefined;

  try {
    const result = await listPoems({
      dynasty, category, forms, q, page,
    } as any);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: (err as Error).message } }, { status: 500 });
  }
}
```

(Adjust the response shape to match the existing convention — `lib/api-poetry.ts` expects `j.data` for success and `j.error.message` for error. Read the existing route first to see if it wraps with `{ ok, data }` or returns the data directly.)

- [ ] **Step 9: Create `app/api/poetry/forms/route.ts`**

```ts
// app/api/poetry/forms/route.ts
import { NextResponse } from 'next/server';
import { getAvailableForms } from '@/lib/poetry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') || 'tang';
  try {
    const forms = await getAvailableForms(category);
    return NextResponse.json({ ok: true, forms });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: (err as Error).message }, forms: [] }, { status: 500 });
  }
}
```

- [ ] **Step 10: tsc + build + commit (per memory rule — adds new route)**

```bash
pnpm tsc --noEmit
pnpm build
git add lib/poetry/queries.ts lib/poetry-types.ts lib/api-poetry.ts app/api/poetry/ tests/unit/lib/poetry/queries.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): category filter + getAvailableForms(category) + /api/poetry/forms route"
```

---

### Task 8: FormFilterBar component + /poetry page integration

**Files:**
- Create: `components/poetry/FormFilterBar.tsx`
- Test: `tests/unit/components/poetry/FormFilterBar.test.tsx`
- Modify: `app/poetry/page.tsx` (add `useState` for selected forms, URL sync, render `FormFilterBar`)

**Interfaces:**
- `FormFilterBar({ category, availableForms, selectedForms, onChange }: Props): JSX.Element | null` — returns null if `availableForms` is empty.
- `/poetry` page reads `?form=` from URL, syncs to local state, fetches `availableForms` for the active category, and re-fetches list when forms change.

- [ ] **Step 1: Read `app/poetry/page.tsx` (currently 83 lines)**

```bash
cat "E:/ToolDevelop/PinYinCharacter/app/poetry/page.tsx"
```

Identify: (a) how `dynasty` is set (URL or state), (b) the existing fetch effect, (c) where the page header section is rendered.

- [ ] **Step 2: Write failing component test**

```tsx
// tests/unit/components/poetry/FormFilterBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormFilterBar } from '@/components/poetry/FormFilterBar';

describe('FormFilterBar', () => {
  it('renders chips for each available form', () => {
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝', '五律']}
        selectedForms={[]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('五绝')).toBeDefined();
    expect(screen.getByText('七绝')).toBeDefined();
    expect(screen.getByText('五律')).toBeDefined();
  });

  it('returns null when no forms', () => {
    const { container } = render(
      <FormFilterBar category="tang" availableForms={[]} selectedForms={[]} onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('toggles selection on click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('七绝'));
    expect(onChange).toHaveBeenCalledWith(['五绝', '七绝']);
  });

  it('removes selection on second click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝', '七绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('五绝'));
    expect(onChange).toHaveBeenCalledWith(['七绝']);
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

Run: `pnpm test tests/unit/components/poetry/FormFilterBar.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Write `components/poetry/FormFilterBar.tsx`**

```tsx
// components/poetry/FormFilterBar.tsx
'use client';

interface Props {
  category: string;
  availableForms: string[];
  selectedForms: string[];
  onChange: (forms: string[]) => void;
}

export function FormFilterBar({ category, availableForms, selectedForms, onChange }: Props) {
  if (availableForms.length === 0) return null;
  const toggle = (form: string) => {
    if (selectedForms.includes(form)) {
      onChange(selectedForms.filter((f) => f !== form));
    } else {
      onChange([...selectedForms, form]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 my-4" data-category={category}>
      <span className="text-sm text-ink-faint self-center mr-2">体裁：</span>
      {availableForms.map((form) => {
        const isSelected = selectedForms.includes(form);
        return (
          <button
            key={form}
            type="button"
            onClick={() => toggle(form)}
            className={`text-sm px-3 h-8 rounded-full border transition-colors ${
              isSelected
                ? 'bg-ink text-paper border-ink'
                : 'bg-paper text-ink border-ink-faint hover:bg-mist'
            }`}
          >
            {form}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test, verify PASS**

Run: `pnpm test tests/unit/components/poetry/FormFilterBar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Integrate into `app/poetry/page.tsx`**

Add these changes (do not rewrite the whole file unless needed):

1. **Imports** — add:
```ts
import { FormFilterBar } from '@/components/poetry/FormFilterBar';
import { getAvailableFormsRequest, listPoemsRequest } from '@/lib/api-poetry';
```

2. **State** — inside the page component, add:
```ts
const [selectedForms, setSelectedForms] = useState<string[]>([]);
const [availableForms, setAvailableForms] = useState<string[]>([]);
```

3. **Effect to fetch available forms when `dynasty` changes** — add:
```ts
useEffect(() => {
  let cancelled = false;
  getAvailableFormsRequest(dynasty).then((forms) => {
    if (!cancelled) setAvailableForms(forms);
  });
  return () => { cancelled = true; };
}, [dynasty]);
```

4. **Update the list-fetch effect** to pass `forms: selectedForms` to `listPoemsRequest`:
```ts
const r = await listPoemsRequest({ dynasty, q: q || undefined, forms: selectedForms.length > 0 ? selectedForms : undefined, page });
```

5. **JSX** — add `<FormFilterBar ... />` after the search box and before the list:
```tsx
<FormFilterBar
  category={dynasty}
  availableForms={availableForms}
  selectedForms={selectedForms}
  onChange={(forms) => { setSelectedForms(forms); setPage(1); }}
/>
```

(Adjust the exact placement to match the existing JSX structure — read the file first.)

- [ ] **Step 7: tsc + build + commit (per memory rule — touches page.tsx)**

```bash
pnpm tsc --noEmit
pnpm build
git add components/poetry/FormFilterBar.tsx tests/unit/components/poetry/FormFilterBar.test.tsx app/poetry/page.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): FormFilterBar chips UI + URL sync on /poetry"
```

---

### Task 9: Full regression + dev smoke

**Files:** none new; verification only.

- [ ] **Step 1: Run full type check + build + test suite**

```bash
pnpm tsc --noEmit
pnpm build
pnpm test
```

Expected: tsc clean; build green; vitest ≥ 600/600 (G6 baseline was 576/578 + 12 new SEO tests + 4 FormFilterBar + 5 queries + 1 build-pianwen = +22 net new tests; new pre-existing fails are OK if they're the 4 known fails per memory `plan-classics-file-only-status.md`: `admin-extensions`, `downloads`, `etymology`, `sutras`.)

- [ ] **Step 2: 6-step dev smoke (browser) — /poetry form filter**

```bash
# kill any running dev first
pkill -f "next dev" || true
pnpm dev
# in another terminal:
curl -sI "http://localhost:4444/poetry"
curl -s "http://localhost:4444/api/poetry/forms?category=tang" | head -c 200
curl -s "http://localhost:4444/api/poetry?dynasty=tang&forms=%E4%BA%94%E7%BB%9D" | head -c 200
```

In browser:
1. /poetry → dynasty=唐诗 → FormFilterBar shows 8 chips (五绝/七绝/五律/七律/五言古风/七言古风/杂言古风/乐府)
2. Click 五绝 → URL has `?form=五绝`, list filters
3. Click 七绝 → URL has `?form=五绝,七绝`, list shows both
4. Switch to 宋词 → chips become 词牌名 (top 30 from manifest)
5. Switch to 汉乐府 (if exposed in `PoemSearch`) → chips become 诗类, list shows ~200 poems

- [ ] **Step 3: 4-step dev smoke (browser) — detail-page SEO**

1. view-source:http://localhost:4444/poetry/1 → unique title with author, description has excerpt, `<link rel="canonical" href="https://.../poetry/1">`, 2 `<script type="application/ld+json">` (CreativeWork + BreadcrumbList)
2. view-source:http://localhost:4444/ancient/lunyu → unique title with era, Book + BreadcrumbList JSON-LD
3. view-source:http://localhost:4444/dictionary/学 → unique title with pinyin, DefinedTerm + BreadcrumbList JSON-LD
4. view-source:http://localhost:4444/ → Organization + WebSite JSON-LD (NOTE: this isn't in scope; the homepage doesn't get JSON-LD in this plan. Skip this step.)

- [ ] **Step 4: 4-step dev smoke (browser) — sitemaps + robots**

```bash
curl -sI "http://localhost:4444/robots.txt"
curl -sI "http://localhost:4444/sitemap.xml"
curl -sI "http://localhost:4444/sitemap/poetry.xml"
curl -sI "http://localhost:4444/sitemap/ancient.xml"
curl -sI "http://localhost:4444/sitemap/chars.xml"
curl -s "http://localhost:4444/robots.txt" | head -c 200
curl -s "http://localhost:4444/sitemap.xml" | head -c 500
```

Expected: 200 for all. `/robots.txt` contains `Sitemap: <site-url>/sitemap.xml`. `/sitemap.xml` lists 4 high-level routes + 3 sub-sitemap URLs. `/sitemap/poetry.xml` is a `<urlset>` with 1161 `<url>` entries. `/sitemap/ancient.xml` is a `<urlset>` with 195 `<url>` entries (194 + pianwen from Task 1). `/sitemap/chars.xml` is a `<urlset>` with 8105 `<url>` entries.

- [ ] **Step 5: Verify pianwen book visible on /ancient**

In browser: http://localhost:4444/ancient → search/filter for 训蒙骈句 → click → /ancient/xunmeng-pianju renders with all chunks (file-based).

- [ ] **Step 6: Final commit (if any doc updates)**

```bash
git status
# Update memory/plan-poetry-expansion-v2-status.md to mark COMPLETE
# Add: "[Plan poetry-expansion v2 — SHIPPED 2026-06-22](plan-poetry-expansion-v2-status.md) — A+B+C+D: 训蒙骈句 + SEO infra + 3 detail-page metadata+JSON-LD + form filter UI"
git add memory/ MEMORY.md
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "docs(memory): poetry-expansion v2 SHIPPED 2026-06-22" || echo "no memory changes"
```

## Verification Checklist (before claiming complete)

- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm build` exit 0
- [ ] `pnpm test` ≥ 598/602 (576 G6 baseline + 22 new V2 tests; 4 pre-existing fails are OK)
- [ ] `/api/poetry/forms?category=tang` returns `["五绝","七绝", ...]`
- [ ] `/api/poetry?dynasty=tang&forms=五绝` returns 4-line 5-char poems only
- [ ] /poetry UI: clicking chips updates URL `?form=...` and filters list
- [ ] view-source on /poetry/1, /ancient/lunyu, /dictionary/学: 2 JSON-LD scripts each + canonical
- [ ] /robots.txt has `Sitemap:` line; /sitemap.xml lists 3 sub-sitemap URLs
- [ ] /sitemap/ancient.xml contains xunmeng-pianju
- [ ] 训蒙骈句 30 chapters render on /ancient/xunmeng-pianju
- [ ] Memory file updated to SHIPPED

## Known Follow-Ups (not in this plan)

- **Homepage JSON-LD** (Organization + WebSite) — V1 Task 13 had this; V2 drops it as not critical for SEO. Add in a follow-up if needed.
- **Char URL convention** — currently `/dictionary/<char>`. The sub-sitemap emits `/dictionary/...`. If a `/chars/<char>` alias is added later, update the sub-sitemap route + canonical URLs.
- **Poem `category` vs `dynasty` distinction** — V2 treats them as synonyms to keep the existing manifest schema. If real-world data needs both fields, add a separate `category` column to the manifest in a follow-up.
- **OpenGraph image generation** — V2 has `image?: string` in `buildMetadata` but no image source is wired. Add a `/api/og` route or static images in a follow-up.
- **Prod push** — held back per memory `no-prod-env-2026-06-21.md`. Push when prod env exists.
- **Cleanup of 5 docs that reference old `chunks`/`chunk_count` schema** — `docs/superpowers/specs/2026-06-20-ancient-classics-design.md` and similar. Pure docs; can wait.
