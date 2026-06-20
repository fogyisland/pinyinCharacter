# Spec: 古籍模块 + 宋词补齐 (Ancient Classics Module + Song-ci Completion)

## Goal

Replace the `/ancient-texts` placeholder with a real 古籍 (classical texts) module that lets users browse classical Chinese books (四书五经、弟子规 等), read each chapter with pinyin annotation, and feed the text into the existing 字帖 (worksheet) generator — including brush and pen modes — with the standard next-chapter and random-generation flow. Also populate the empty 宋词 (Song ci) dynasty in the existing `poems` table.

## Background

- `/ancient-texts` exists as a placeholder RSC at `app/ancient-texts/page.tsx` (47 lines, says "筹备中"), wired into `Header` (`NAV_LINKS`), and gated behind `SafeModeToggle` (children mode hides it). We'll rename to `/ancient` per user's "/ancient" choice in brainstorm.
- `chinese-poetry/chinese-poetry` (GitHub) has a `古文/` directory with classical texts (论语, 孟子, 大学, 中庸, 诗经, 尚书, 礼记, 易经, 道德经, 弟子规, 千字文, 三字经, etc.) and a `宋词/` directory already used in `scripts/build-poems.ts`. The existing 唐诗 build path is the template.
- `poems` table already has `dynasty ENUM('tang','song')`; `dynasty='song'` returns 0 rows because the file path in `build-poems.ts` points to `宋词三百首.json` which the upstream repo has. Need to verify the upstream path and re-run.
- `/sutra/[id]` already implements the chapter-picker + pinyin-annotated reader pattern (`SutraChunkPicker`, `SutraTextView`, `useSutraReading`). The classics module will mirror this shape, NOT share it (independent table per user decision).
- `WorksheetGenerator` (`components/worksheet/WorksheetGenerator.tsx`) accepts a `?prefill=<chars>` URL param that auto-populates `content` state. The "从字库选 / 自由输入 / 随机生成" tabs are orthogonal to where the content came from. Reusing this mechanism means no WorksheetGenerator code changes are needed for classics content delivery — only the rendering layer needs the punctuation-separator rule (because classics have full sentences, not just chars).
- `WorksheetCell` (`components/worksheet/WorksheetCell.tsx`) takes one Chinese character per cell and renders the chosen tool+presentation grid pattern. It does NOT filter punctuation — currently callers strip punctuation upstream (chars list doesn't contain punctuation).
- `WorksheetPreview` line-breaks cells automatically based on `cellsPerPage(paperSize, cellStyle)`. There is no per-chapter layout awareness today.

User decisions confirmed in brainstorm:
1. Data source = public/open-source (`chinese-poetry/chinese-poetry` repo).
2. Mount as top-level menu `/ancient` (replaces placeholder `/ancient-texts`).
3. Separator handling = 行间标点 (inter-sentence punctuation) shown OUTSIDE the 田字格, not inside cells.
4. 宋词 population = in parallel with 古籍 (not deferred).
5. Architecture = independent `classics` table + `/ancient` route (NOT merged with `sutras`).
6. Chunk granularity = one chapter per chunk (e.g. 《论语·学而》 = one chunk).
7. Tool scope = 古籍 supports BOTH 毛笔 (brush) and 钢笔 (pen); no font lock.
8. Worksheet integration = classics content flows through existing WorksheetGenerator's `?prefill=...` mechanism. Next-chapter and random-generation UX must match the user's mental model of "和随机生成字帖一样" (just like random generation) — i.e. on `/ancient/[slug]` after picking a chapter, the user can step 上一章/下一章 (replace content in place) or jump to 字帖生成 to use the worksheet tool with that chapter pre-filled; the random tab in WorksheetGenerator can re-roll within the chapter pool.

## Design

### Data model

**New table: `classics`**
```sql
CREATE TABLE classics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  category ENUM(
    'four-books',        -- 四书:大学 中庸 论语 孟子
    'five-classics',     -- 五经:诗经 尚书 礼记 易经 春秋
    'mengxue',           -- 蒙学:弟子规 千字文 三字经 百家姓
    'philosophy',        -- 道家+诸子:道德经 论语 子 庄子 列子
    'history',           -- 史书:史记 资治通鉴 etc.
    'other'              -- 兜底
  ) NOT NULL DEFAULT 'other',
  author VARCHAR(64) NULL,    -- 孔子, 老子 etc. (NULL = 佚名)
  era VARCHAR(16) NULL,       -- 春秋, 汉, 唐 etc. (free-form; no enum)
  chunks JSON NOT NULL,       -- 见下:Array<{id,label,content,pinyin}>
  chunk_count INT UNSIGNED GENERATED ALWAYS AS (JSON_LENGTH(chunks)) STORED,
  char_count INT UNSIGNED GENERATED ALWAYS AS (
    (SELECT SUM(CHAR_LENGTH(j.value))
       FROM JSON_TABLE(chunks, '$[*].content[*]' COLUMNS(value TEXT PATH '$')) j)
  ) STORED,
  source VARCHAR(64) NOT NULL DEFAULT 'chinese-poetry@master',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug (slug),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Generated columns caveat:** `JSON_LENGTH(chunks)` works on MySQL 5.7+ for arrays. `JSON_TABLE` is MySQL 8.0+. Since the project targets MySQL 5.7 (per `lib/db.ts` and existing migrations), drop the `char_count` generated column and compute it on read in `lib/classics.ts` instead. `chunk_count` via `JSON_LENGTH` is MySQL 5.7-compatible.

Final DDL (no JSON_TABLE):
```sql
CREATE TABLE classics (
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

**Chunk shape (stored in `chunks` JSON column):**
```ts
interface ClassicChunk {
  id: number;          // 1-based, contiguous within book
  label: string;       // e.g. "学而第一", "第一篇", "乾"
  content: string[];   // lines of text including punctuation (句号, 逗号, etc.)
  pinyin: string[][];  // line-aligned pinyin; punctuation → "" entry
}
```

Pinyin is computed at ingest time with `pinyin-pro` (already a project dep, used by `scripts/build-poems.ts:8`).

**`poems` table:** no schema change. Re-run `scripts/build-poems.ts` to populate `dynasty='song'`. The path `/%E5%AE%8B%E8%AF%8D/%E5%AE%8B%E8%8D%A3%E4%B8%89%E7%99%BE%E9%A6%96.json` already matches what's in the repo.

### Routes

```
/ancient                  list — category tabs + book cards
/ancient/[slug]           book detail — header + chapter nav + chapter reader + CTA
/api/classics             GET  ?category=&q=&page=&pageSize=  → {items, total, page, pageSize}
/api/classics/[slug]      GET  → { id, slug, title, category, author, era, chunks, chunkCount, charCount }
/api/poetry               (existing) GET ?dynasty=song — no change; re-seed via build-poems
```

`/ancient-texts` becomes a 301-redirect to `/ancient` (one-time move).

### File structure

**New:**
- `migrations/2026-06-20-classics.sql` — CREATE TABLE
- `scripts/init-db.ts` — add CREATE TABLE for `classics` (so fresh local DBs get it)
- `scripts/build-classics.ts` — fetch from chinese-poetry/古文, parse, generate pinyin, UPSERT
- `lib/classics-types.ts` — `ClassicListItem`, `ClassicDetail`, `ClassicChunk`, `ClassicListResult`
- `lib/classics.ts` (`'server-only'`) — `listClassics()`, `getClassicBySlug()`, helpers
- `app/ancient/page.tsx` — list RSC
- `app/ancient/[slug]/page.tsx` — detail RSC
- `app/api/classics/route.ts` — list endpoint
- `app/api/classics/[slug]/route.ts` — detail endpoint
- `components/classics/ClassicCategoryNav.tsx` — category tab strip (client)
- `components/classics/ClassicCard.tsx` — book card (server)
- `components/classics/ClassicChunkPicker.tsx` — chapter picker (client, parallel to `SutraChunkPicker`)
- `components/classics/ClassicReader.tsx` — chapter text view with pinyin (client, parallel to `SutraReadingClient`)
- `components/classics/ClassicToWorksheetButton.tsx` — CTA: builds `/worksheet?prefill=...` URL with chunk chars (filtering punctuation)
- `tests/unit/lib/classics.test.ts` — DB + filter tests
- `tests/unit/components/classics/ClassicReader.test.tsx` — pinyin rendering test
- `tests/integration/api/classics.test.ts` — list/detail endpoint tests

**Modified:**
- `components/Header.tsx` — `NAV_LINKS` `/ancient-texts` → `/ancient`
- `app/ancient-texts/page.tsx` — replaced with redirect to `/ancient`
- `components/worksheet/WorksheetGenerator.tsx` — accept new query param `source=ancient&book=<slug>&chapter=<idx>`; preload only the chars (punctuation stripped); add "上一章/下一章" buttons visible when `source=ancient`
- `components/worksheet/WorksheetPreview.tsx` — when source is ancient and chapter has visible punctuation boundaries, render a small separator mark OUTSIDE cells between sentences (visual only — does NOT appear inside any cell). Default: no change for non-ancient sources.
- `lib/worksheet-types.ts` — add `source?: 'text' | 'library' | 'random' | 'ancient'` to a new optional `WorksheetSource` type (passed via prop drill, not URL state).
- `lib/validators.ts` — add `classicsListQuerySchema` for the API

### Components

**`ClassicCategoryNav.tsx`** (client)
- Props: `{ current: Category | 'all' }`
- Categories: 全部 / 四书 / 五经 / 蒙学 / 诸子 / 史书 (with counts from server-passed prop)
- Renders horizontal scrollable tab strip, click → navigates to `/ancient?category=<cat>` (RSC handles filter via sp)

**`ClassicCard.tsx`** (server)
- Props: `{ item: ClassicListItem }`
- Renders: title (大字), author · era (小字), chunkCount · charCount (footer)
- Wraps in `<Link href={`/ancient/${item.slug}`}>`

**`ClassicChunkPicker.tsx`** (client, mirrors `SutraChunkPicker.tsx`)
- Props: `{ chunks: {id,label}[]; current: number; slug: string }`
- Sidebar list of chapter labels
- Click → navigates to `/ancient/[slug]?chunk=<id>`

**`ClassicReader.tsx`** (client, mirrors `SutraReadingClient.tsx`)
- Props: `{ chunk: ClassicChunk; book: { slug, title, author, era, chunks: ClassicChunk[] } }`
- Renders the chunk text + pinyin annotations (one `<p>` per line; each char as `<span class="char"><span class="char-text">字</span><span class="char-pinyin">pīn</span></span>`)
- Reading-direction toggle: 横向 / 竖排从右到左 / 竖排从左到右 — reuse `useSutraReading` (it's a generic localStorage hook keyed by `'pinyin:sutra-reading'`; rename key to `'pinyin:classic-reading'` and make the hook accept the key as arg, OR keep the same key and accept shared preference — choose: shared preference because users will want one consistent reading direction across all classical content)
- CTA row: "生成字帖" (primary, → `/worksheet?source=ancient&book=<slug>&chapter=<id>`) + "上一章" / "下一章" (secondary, navigate within detail page when current ± 1 exists)

**`ClassicToWorksheetButton.tsx`** (server, internal helper if useful)
- Builds the URL: `content` = `chunk.content.flatMap(line => Array.from(line).filter(ch => !isPunct(ch))).join('')`; prefill = that string.
- Punctuation filter list: `。，！？；：、""''「」（）()…—`
- The button is a normal `<Link>` inside `ClassicReader` — no separate component file needed unless we want isolated logic. **Decision: keep inline in `ClassicReader`; no separate file.**

### WorksheetGenerator integration

Add to `WorksheetGenerator.tsx`:
- Read new search params: `source`, `book`, `chapterIdx`.
- When `source === 'ancient'`, on mount fetch `/api/classics/<slug>` to resolve slug → book, then on chapter change re-fetch the chars from the in-memory `chunks[chapterIdx].content`.
- Initialize `content` state with current chapter chars (punctuation stripped).
- Add "上一章" / "下一章" buttons (visible only when `source === 'ancient'` and there's a prev/next chunk). Click updates `chapterIdx` state and replaces `content` with the new chunk's chars.
- Existing `?prefill=<chars>` mechanism still works for the "random" tab — but in ancient mode, when the user clicks the "随机生成" tab, the count picker still uses the standard pool; we do NOT scope to current chapter (out of scope for v1; can be added later if requested).
- "标题(可选)" input stays visible (ancient books already have a title; this is for custom worksheet names).

When `source === 'ancient'` and `view === 'preview'`, pass a new prop `showSentenceSeparators: true` to `WorksheetPreview`. The preview then renders an inter-sentence separator OUTSIDE cells at punctuation boundaries. **Implementation:** the `cells` array returned by `generateLayout(content, cellStyle)` only contains Chinese chars (punctuation is filtered upstream). We need to also know WHERE in the sequence the original sentences break. Two options:
- **Option A:** Pass a parallel `breakpoints: number[]` array (cell indices where a separator should appear between cells N and N+1). WorksheetPreview renders `<div class="worksheet-sep">·</div>` between those cells.
- **Option B:** Render separators visually via CSS `gap` — group cells into flex rows with extra gap between sentence groups. Simpler but loses per-cell separator flexibility.

Choose **Option A** for v1: it's explicit, easy to test, and aligns with the user's "OUTSIDE 田字格" requirement.

**WorksheetPreview separator rendering:**
```tsx
{cells.map((cell, i) => (
  <Fragment key={cell.index}>
    {i > 0 && breakpoints.has(cell.index) && (
      <div className="worksheet-cell-sep col-span-full" aria-hidden>· 句 ·</div>
    )}
    <div className="worksheet-cell">
      <WorksheetCell ... />
    </div>
  </Fragment>
))}
```
The separator div uses `col-span-full` so it takes the full row of the worksheet grid; sits OUTSIDE any cell; styled as small grey text "· 句 ·". `print:hidden` so it doesn't pollute the printed worksheet.

### Visual specs

| Element | CSS |
|---------|-----|
| Classic char container | inline-block, padding 4px 6px, font-size per reading mode |
| Classic char text | `<span class="char-text">字</span>` — main color `#2c251e` |
| Classic char pinyin | `<span class="char-pinyin">pīn</span>` — color `rgba(0,0,0,0.45)`, font-size 0.7em, display block |
| Punctuation char | NOT rendered as a `<span class="char">`; instead, a single space (inline-block separator) so line breaks stay natural |
| Worksheet sentence separator | `text-xs text-ink-faint text-center py-1`, content `· 句 ·`; `print:hidden` |
| Category nav tab | Same visual as SutraChunkPicker tabs |
| ClassicCard hover | border → seal/30; lift via `hover:-translate-y-0.5` |

### Separator handling detail

The user said: "如果古籍和内容有分隔符，记得在田字格外面标记，不要在田字格内部"
("If classics has separators between chunks/segments, mark them OUTSIDE the 田字格, not inside.")

Two cases:
1. **Inter-chunk separator** (between two chunks of the same book): on `/ancient/[slug]`, the chapter reader only shows ONE chunk at a time, so this isn't an issue at the reader level. At the worksheet level, if the user picks the whole book, chunks would be concatenated — but the user always picks ONE chapter, so the worksheet is one chapter = one page. **No inter-chunk separator needed at v1.**
2. **Inter-sentence separator within a chapter**: Punctuation marks like `。` separate sentences. When rendered as worksheet cells, punctuation is filtered out. To preserve the sentence structure visually (without putting punctuation in cells), we render a row-level separator between cells that were originally in different sentences.

The "breakpoints" array is computed from the original `chunk.content` lines:
```ts
function buildBreakpoints(chunk: ClassicChunk): Set<number> {
  const set = new Set<number>();
  let cellIndex = 0;
  for (const line of chunk.content) {
    for (const ch of Array.from(line)) {
      if (isPunct(ch)) continue;
      // If the previous char (in the original line) was a sentence-ending punct,
      // mark a breakpoint BEFORE this cell.
      // (Implementation: precompute per-char flag from the original string.)
      cellIndex++;
    }
  }
  return set;
}
```

Actually simpler: scan once, track `lastWasSentenceEnd`, emit breakpoint at each non-punct char whose immediate predecessor was `。！？` (in the original string).

```ts
const SENT_END = new Set(['。', '！', '？']);
function buildBreakpoints(chunk: ClassicChunk): Set<number> {
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

The breakpoints `Set` keys are the cell index at which to insert a separator BEFORE. `cellIdx = 0` never has a separator (no preceding sentence).

### Data ingestion

**`scripts/build-classics.ts`** (new) — parallel to `scripts/build-poems.ts`:
- Fetch from `chinese-poetry/chinese-poetry@master/古文/论语.json`, `孟子.json`, etc.
- Map upstream filenames to our slug + category + author + era. The mapping is hard-coded (small set, not worth a config file):
  ```ts
  const CLASSIC_FILES: Array<{ path: string; slug: string; title: string; category: ...; author: string; era: string }> = [
    { path: '/古文/论语.json', slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋' },
    { path: '/古文/孟子.json', slug: 'mengzi', title: '孟子', category: 'four-books', author: '孟子', era: '战国' },
    // ...
  ];
  ```
- Upstream shape (chinese-poetry/古文) is `{ "chapter": "学而第一", "paragraphs": ["子曰:...", ...] }` per object in a JSON array. Convert each chapter into one chunk: `content = paragraphs`, `pinyin = paragraphs.map(linePinyin)`.
- Apply OpenCC t2s (same as build-poems).
- UPSERT into `classics` table by slug.

**`scripts/build-poems.ts`** (existing, no code change) — re-run to populate 宋词. We need to verify the upstream path `/宋词/宋词三百首.json` exists; if not, swap to `/宋词/宋词-三百首.json` or another known-good path. The user can confirm or this is verified at task time.

### Test plan

**Unit (`tests/unit/lib/classics.test.ts`):**
- `listClassics({ category: 'four-books' })` returns only rows in that category.
- `listClassics({ q: '论语' })` matches by title.
- `getClassicBySlug('lunyu')` returns the canonical detail.
- `buildBreakpoints(chunk)` marks the correct cell indices at `。！？` boundaries.
- `isPunct('。')` returns true; `isPunct('字')` returns false.

**Component (`tests/unit/components/classics/ClassicReader.test.tsx`):**
- Renders all non-punct chars from chunk content.
- Pinyin annotations rendered for each char.
- Punctuation not rendered as char span.
- "上一章" / "下一章" buttons have correct enabled state based on current chunk index.
- "生成字帖" link has correct `/worksheet?source=ancient&...` href.

**Integration (`tests/integration/api/classics.test.ts`):**
- `GET /api/classics?category=four-books` returns the expected filtered list.
- `GET /api/classics/lunyu` returns full detail with chunks.
- `GET /api/classics/nonexistent` returns 404.
- Pagination: `?page=2&pageSize=2` returns next page with correct total.

**Manual smoke:**
- Visit `/ancient` (post-rename) → see category tabs + book cards.
- Click 论语 → see book detail with chapter picker.
- Click a chapter → see text + pinyin.
- Click "生成字帖" → arrive at `/worksheet` with chars preloaded; switch tool to 毛笔 (allowed), change font, change paper.
- Worksheet preview shows inter-sentence separators OUTSIDE cells.
- Print preview: separators hidden via `print:hidden`.
- Click "下一章" on worksheet → chars replace with next chapter.
- Visit `/poetry` → click 宋词 tab → see poems populated.
- Verify `/ancient-texts` redirects to `/ancient`.

### Out of scope (v1)

- Cross-chunk separator (when user picks whole book). Single chapter per worksheet.
- Random generation scoped to current chapter pool (current "随机生成" tab uses standard L1-L3 pool).
- Original-text punctuation restoration in print (the separator is a visual hint, not a faithful print of the punctuation).
- Annotations / commentary / translation per chunk (chinese-poetry 古文 files don't have these; could be added later).
- Audio read-aloud (sutra has this via TTS; out of scope for v1).
- Print mode for 古籍 itself (the reader is for reading; print-as-worksheet is the use case).

## Migration

`migrations/2026-06-20-classics.sql` — single CREATE TABLE. Forward-compatible: no other tables touched. Run via existing `pnpm tsx scripts/migrate.ts` pipeline.

Also update `scripts/init-db.ts` to include the CREATE TABLE so fresh local DBs (e.g. `piyin_dev`) get it.

## Files touched (summary)

**New (12):**
- `migrations/2026-06-20-classics.sql`
- `scripts/build-classics.ts`
- `lib/classics-types.ts`
- `lib/classics.ts`
- `app/api/classics/route.ts`
- `app/api/classics/[slug]/route.ts`
- `app/ancient/page.tsx`
- `app/ancient/[slug]/page.tsx`
- `components/classics/ClassicCategoryNav.tsx`
- `components/classics/ClassicCard.tsx`
- `components/classics/ClassicChunkPicker.tsx`
- `components/classics/ClassicReader.tsx`
- Tests × 3 (above)

**Modified (6):**
- `components/Header.tsx` — nav link path
- `app/ancient-texts/page.tsx` → redirect
- `scripts/init-db.ts` — add classics CREATE TABLE
- `components/worksheet/WorksheetGenerator.tsx` — `source=ancient&book=&chapterIdx=` handling + 上一章/下一章 buttons
- `components/worksheet/WorksheetPreview.tsx` — `breakpoints` prop + inter-sentence separator rendering (print-hidden)
- `lib/validators.ts` — `classicsListQuerySchema`
- `lib/use-sutra-reading.ts` — accept `storageKey` arg so sutra + classic share the hook but keep independent storage keys (rename sutra key from `pinyin:sutra-reading` → `pinyin:sutra-reading` unchanged; add `pinyin:classic-reading`)

## Open questions for implementation (resolved in this spec)

- Q: Is `/ancient` or `/ancient-texts`? **A: `/ancient`** (rename).
- Q: How does "下一屏和随机生成字帖一样" map to UI? **A: 上一章/下一章 buttons on `/ancient/[slug]` + on WorksheetGenerator (when `source=ancient`). The "随机生成" tab in WorksheetGenerator is unchanged — it always uses the standard pool; if user wants chapter-scoped randomization, v2.**
- Q: Brush-only or pen-only for classics? **A: Both allowed — user explicit.**
- Q: Where do 宋词 go? **A: Existing `poems` table with `dynasty='song'` — re-run `build-poems.ts`. No new table.**

## Source data caveat

`chinese-poetry/古文/` contains JSON files in `{ "chapter": "label", "paragraphs": [...] }` shape for 论语, 孟子, etc. We do NOT need to scrape the full Chinese-poetry repo at runtime — we download once at build time via `scripts/build-classics.ts`. Network dependency at ingest only; runtime reads from MySQL. Sandbox has no network — `build-classics.ts` and `build-poems.ts` re-run must happen on a network host before browser smoke.