# Poems + Classics File-Only Refactor — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming complete)
**Scope:** poems + classics. Chars unchanged.

## Goal

Make the `data/` directory the single source of truth for both poems and classics. Drop the `poems` MySQL table. All reads go through a manifest + on-demand detail load. Migration is one-shot and reversible until the DROP commit lands.

## Why

The existing pattern already proven by `data/classics/<slug>.json` (195 files, in production for months) is file-only. Keeping poems in MySQL while classics live in files splits the mental model and forces every read through `getPool()`. The 1161 poems are tiny static data — no writes, no joins, no transactions. Files win.

## Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | poems + classics (chars stay on DB) |
| 2 | Per-poem layout | one file per poem: `data/poems/<id>.json` |
| 3 | Query mechanism | manifest cached in memory + per-file on-demand reads |
| 4 | Migration path | one-shot script (idempotent), DROP table last |
| 5 | Poems table after migration | DROP TABLE poems |
| 6 | Existing 5 per-collection files (yuefu / shijiu / cifu / caocao / nalan) | discard — DB is source of truth for those 553 rows |
| 7 | Manifest regeneration | migration script writes it once + verify in CI |
| 8 | Form filter integration | filter manifest in-memory (no extra IO) |
| 9 | Sitemap + JSON-LD reads | manifest at build time (same pattern as classics) |
| 10 | Deferred print-blank-grids request | keep deferred — separate spec after this ships |

## Architecture

### Data layout

```
data/
  classics/
    <slug>.json          × 195     (existing, unchanged)
  poems/
    <id>.json            × 1161    (NEW — per-poem flat files)
    poems-manifest.json  (NEW — single source of truth index)
  classics-manifest.json (existing, unchanged)

(no poems table after migration)
```

### File schemas

**`data/poems/<id>.json`** — id is the auto-increment value from the dropped `poems` table, preserved for SEO URL stability (`/poetry/<id>`):

```json
{
  "id": 1,
  "title": "静夜思",
  "author": "李白",
  "dynasty": "唐",
  "category": "tang",
  "form": "五绝",
  "content": ["床前明月光，", "疑是地上霜。", "举头望明月，", "低头思故乡。"],
  "pinyin": [["chuáng","qián","míng","yuè","guāng"], ...],
  "appreciation": null,
  "source": "chinese-poetry:/唐诗三百首/json/001.json"
}
```

**`data/poems-manifest.json`** — single index, ~50–80 KB, cached at module scope:

```json
{
  "version": 1,
  "updatedAt": "2026-06-21T...",
  "count": 1161,
  "items": [
    {
      "id": 1,
      "title": "静夜思",
      "author": "李白",
      "dynasty": "唐",
      "category": "tang",
      "form": "五绝",
      "contentLineCount": 4
    }
  ]
}
```

Manifest items carry only the fields needed for list / filter / sitemap rendering. Detail reads go to the per-poem file.

### Components

| File | Responsibility |
|---|---|
| `lib/poetry/loader.ts` (NEW) | Read `data/poems-manifest.json` once (cached at module scope). Read one `<id>.json` on demand. Fail loud. |
| `lib/poetry/queries.ts` (NEW) | Pure functions over the manifest: `listPoems`, `getPoem`, `getRandomPoem`, `listForms`, `listDynasties`. |
| `lib/poetry/index.ts` (NEW) | Barrel re-exports + type re-exports. |
| `lib/poetry.ts` (DELETED) | Old DB code. `getPool()` import removed. |
| `lib/poetry/infer-form.ts` (UNCHANGED) | Pure logic, still useful for new ingests. |
| `lib/poetry-types.ts` (UNCHANGED) | `PoemListItem`, `PoemDetail`, `Dynasty`. |

### Page / route surface (unchanged URLs)

- `GET /api/poetry?dynasty=&q=&page=&pageSize=&form=` → list
- `GET /api/poetry/[id]` → detail
- `GET /api/poetry/random` → random one
- `GET /api/poetry/[id]/print` → print HTML
- `GET /api/poetry/forms` → form counts

All routes import from `@/lib/poetry` (now barrel to the new modules). `withErrorHandling` and Zod validators unchanged.

### Page changes

- `app/poetry/page.tsx` — unchanged client logic. URL contract preserved.
- `app/poetry/[id]/page.tsx` — unchanged RSC. Just the underlying route swaps DB for files.
- `app/sitemap.ts` (NEW or extended) — reads manifest at build, emits `/poetry/<id>` entries.
- `app/poetry/[id]/page.tsx` metadata (NEW) — `generateMetadata` calls `getPoem`, builds JSON-LD.

## Data flow

### List page (`/poetry`)

1. `app/poetry/page.tsx` (client) calls `listPoemsRequest` → `GET /api/poetry?dynasty=&q=&page=&form=`
2. Route handler calls `loadManifest()` (cached, ~5 ms cold / 0 ms warm)
3. `listPoems({ dynasty, form, q, page })` filters + paginates in memory over 1161 items (~1 ms)
4. Returns `{ items, total, page, pageSize }` JSON

### Detail page (`/poetry/[id]`)

1. Route handler `getPoem(id)` → `loadPoem(id)` → reads `data/poems/<id>.json`
2. Returns full `PoemDetail` (content + pinyin + appreciation + source)

### Sitemap (`app/sitemap.ts`)

1. Next.js build-time call to `loadManifest()` (cached for the build)
2. Maps `items` → sitemap entries with `loc: /poetry/<id>`, `lastmod: manifest.updatedAt`
3. Same pattern as existing classics sitemap entries

### JSON-LD on `/poetry/[id]`

1. RSC `generateMetadata({ params })` calls `getPoem(id)`
2. Builds `<script type="application/ld+json">` with title, author, dynasty, content lines
3. Inject into `<head>` via metadata.other or a small client component (mirrors classics detail)

## Error handling

- **Manifest missing / unparseable** → throw at load time. `withErrorHandling` catches → 500. Migration script + CI test guard this.
- **Per-poem file missing for valid id** → CI consistency test asserts `manifest.items.length === count(data/poems/*.json)`. If a file vanishes mid-request, `getPoem` returns `null` → 404.
- **Per-poem file unparseable (corrupt JSON)** → throw → 500 with file path in error log.
- **Unknown id format** (non-numeric) → Zod validator rejects → 400.
- **Dev mode HMR** — no file watcher. Restart `pnpm dev` after bulk file ops. Add HMR cache invalidation only if it bites.

## Testing

| Layer | Test type | Coverage |
|---|---|---|
| `lib/poetry/queries.ts` | unit (vitest) | filter logic for dynasty/form/q; pagination math; edge cases (empty q, no results, page beyond total); `listForms` aggregation; `getRandomPoem` distribution |
| `lib/poetry/loader.ts` | unit (vitest, mocked `fs/promises`) | `loadManifest` caches second call; `loadPoem` returns null on ENOENT; throws on parse error; bad manifest propagates |
| `scripts/migrate-poems-to-files.ts` | integration (vitest, mocked DB + mocked fs) | N rows → N files + manifest; idempotent re-run = 0 writes, 0 diff; preserves all DB columns |
| Manifest consistency | CI script (`pnpm tsx scripts/check-poems-manifest.ts`) | `manifest.items.length === fs.readdir('data/poems').length - 1`; every manifest id has a file; every file is in manifest |
| `app/api/poetry/route.ts` | integration (existing, rewritten) | mock `lib/poetry/loader` + `queries`; assert same response shape as before |
| `app/api/poetry/[id]/route.ts` | integration (existing, rewritten) | 200 / 404 / 400 paths |

Per memory `feedback-per-task-build-check`: every task ends with `pnpm build` clean.

## Rollout

```
1. migration script + tests        (script writes 1161 files + manifest, idempotent)
2. lib/poetry/loader + queries     (pure functions, fully tested)
3. delete lib/poetry.ts            (DB import removed)
4. rewire app/api/poetry/* routes  (URL contracts unchanged)
5. sitemap + JSON-LD               (manifest-driven, build-time)
6. DROP poems table                (final commit, after smoke test passes)
7. delete 5 per-collection files   (yuefu/shijiu/cifu/caocao/nalan — no longer needed)
8. smoke test on dev               (list 1161 poems, open random detail, check sitemap.xml)
9. prod push                       (per memory, dev first then prod)
```

## Out of scope (deferred)

- Print-blank-grids (separate spec after this ships).
- 训蒙骈句 ingest (T7) — separate task after refactor lands. New ingest calls `regenerateManifest()`.
- T9 form filter UI work — this spec delivers `listForms()` + filter param plumbing. Component integration is one small follow-up task.

## Constraints (binding)

- Schema migration idempotent (`INFORMATION_SCHEMA` checks) — applies only to the DROP TABLE step
- All new scripts idempotent
- Run on `piyin_dev` FIRST, prod `piyin` after
- Env var `NEXT_PUBLIC_SITE_URL` (fallback `localhost:3000`) — for sitemap absolute URLs
- No new deps
- Per-task `pnpm tsc --noEmit` + `pnpm build` (per memory `feedback-per-task-build-check`)
- TDD: failing test first, then implement, then commit
- Frequent commits
- No emojis
- No docs unless asked (this spec is the exception per brainstorming skill convention)