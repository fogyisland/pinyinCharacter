# Plan: Poems Init Pipeline — JSON-only Reader (drop GitHub fetch dependency)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the wizard's `/api/init/init-poems` GitHub fetch dependency by reading prebuilt `data/poems-manifest.json` + `data/poems/<id>.json` files (which already contain post-processed pinyin), mirroring the architecture `plan-sutras-json-reader` established for sutras.

**Architecture:** JSON is single source of truth. `buildPoems()` becomes a JSON→DB mirror (UPSERT only), reading the same 1160 per-poem files that `lib/poetry/loader.ts` already serves at runtime. No remote fetch, no pinyin regeneration, no t2s conversion. Three tasks total — smaller than the 5-task sutras refactor because poems JSONs already carry pinyin (no `enrich-pinyin` step needed).

**Tech Stack:** Next.js 15.5 / TypeScript / mysql2 / vitest / npm (per `project-uses-npm.md`)

## Global Constraints

- npm only (per `project-uses-npm.md`); commit timestamp suffix `[YYYY-MM-DD HH.MM]` (per `feedback-commit-timestamps.md`)
- Per-task `npx next build` required (per `feedback-per-task-build-check.md`) — diff touches scripts that build-poems runs from, but NOT `app/**/page.tsx`; lower-risk tier per `feedback-per-task-pnpm-build-gap.md`
- Commit messages in English; commit timestamps `[2026-07-09 HH.MM]`
- No `git push` (per `no-prod-env-2026-06-21.md`); user does manual Up/→prod sync
- Up/ rebundle via `python scripts/copy-to-up.py` (per `deploy-bundler-up.md`); EXCLUDE_DIRS excludes `public/strokes` only — `data/poems/` ships in Up/

---

## Context (root cause + user decisions)

**Symptom (2026-07-09)**: User ran wizard on prod, `导入古诗 (data/poems/)` phase returned `失败: fetch https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E5%85%A8%E5%94%90%E8%AF%97/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json → 503`. User asked "数据本地都有,为什么还去 GitHub 取?"

**Root cause**: `scripts/build-poems.ts:15-19` hardcodes `SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master'` and fetches `/全唐诗/唐诗三百首.json` + `/宋词/宋词三百首.json`. **The data fetched is functionally identical to what's already in `data/poems/`.** Per `lib/poetry/loader.ts`, the runtime already serves poems from `data/poems-manifest.json` + `data/poems/<id>.json` — 1160 per-poem files, all pre-processed (t2s 简体 + pinyin via pinyin-pro + id/title/author/dynasty/category/form/source/appreciation). The fetch is redundant and fragile (CDN rate-limit can 503).

**Side-effect of the redundancy**: `scripts/init-db.ts:110-127` still creates a `poems` MySQL table on every wizard run, even though `lib/poetry/queries.ts` already serves all reads from FS via `loadManifest()` + `loadPoem()`. The memory `plan-poems-classics-file-only-status.md` says "poems MySQL table DROPPED in piyin_dev" — but the DDL re-creates it on fresh init. This plan does NOT drop the DDL (mirrors sutras pattern where the table also stays as a mirror).

**Architecture comparison**:

| | Sutras (already refactored, commit 092a4135) | Poems (target) |
|---|---|---|
| Single source of truth | `data/sutras/{manifest.json, *.json}` ✅ | `data/poems/{manifest.json, *.json}` ✅ |
| Runtime reader | `lib/sutras-fs.ts` | `lib/poetry/loader.ts` |
| Init phase build script | `build-sutras.ts` reads local JSON ✅ | `build-poems.ts` **fetches GitHub** ❌ |
| Pre-processed pinyin in JSON? | Yes (after `enrich-sutra-pinyin.ts`) | **Yes already** (built once by build-poems-extra.ts) |

**User decisions**:
1. Keep `build-poems-extra.ts` untouched — it adds the 5 extra collections (汉乐府 / 古诗十九首 / 辞赋 / 曹操诗集 / 纳兰性德) and writes per-collection JSON files at `data/poems/<slug>.json`. Out of scope for this plan; those are intermediate and not consumed by the runtime loader anyway.
2. Don't drop the `poems` MySQL table DDL — mirrors the sutras pattern (table exists as a DB mirror even though FS is canonical).
3. Skip the `enrich-pinyin` step — pinyin is already in the JSON.

## Files

### Created

1. **`tests/unit/build-poems.test.ts`** (~70 lines)
   - vitest default env (node), no DB
   - 4 cases mirroring `tests/unit/build-sutras.test.ts`:
     - `manifest has 1160 entries (count field matches items.length)`
     - `all 1160 manifest ids have matching data/poems/<id>.json files`
     - `every per-poem JSON has content/pinyin aligned (pinyin[i].length === Array.from(content[i]).length)`
     - `xinjing (id=1) — first poem title is "在岳咏蝉" (Tang, dyn=tang, form=五律, 4 lines)`

### Modified

2. **`scripts/build-poems.ts`** (rewrite, 167 → ~60 lines)
   - **Delete**: `pinyin` import (line 8), `OpenCC` import (line 9), `SOURCE_BASE` const (15), `FILES` array (16-19), `SOURCE_TAG` const (20), `FORM_TAG_RE` (23), `RawPoem` interface (25-34), `extractForm` (36-44), `charPinyin` (46-57), `linePinyin` (59-61), `fetchFile` (63-70), `PreparedPoem` interface (72-80), `prepare` (82-104)
   - **Add imports**: `readFileSync, readdirSync, statSync, mkdirSync` from `node:fs`; `join` from `node:path`; `readPoemsManifest` + `readPoemById` from a new helper (or inline — see below)
   - **Decision**: do NOT create `lib/poems-fs.ts` (mirror of `lib/sutras-fs.ts`) — `lib/poetry/loader.ts` already provides async `loadManifest` + `loadPoem`. New `build-poems.ts` uses sync `readFileSync` (matches `build-sutras.ts` pattern) for simplicity. If we later want a shared FS API, refactor both sutras and poems to share a common helper.
   - **Rewrite `buildPoems()`**:
     ```ts
     export async function buildPoems(): Promise<number> {
       const pool = getPool();
       const manifestPath = join(process.cwd(), 'data', 'poems-manifest.json');
       const poemsDir = join(process.cwd(), 'data', 'poems');
       const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PoemsManifest;
       let inserted = 0;
       for (const item of manifest.items) {
         const filePath = join(poemsDir, `${item.id}.json`);
         if (!existsSync(filePath)) {
           console.warn(`[build-poems] missing ${filePath}; skipping id=${item.id}`);
           continue;
         }
         const poem = JSON.parse(readFileSync(filePath, 'utf8')) as PoemDetail;
         await pool.execute(
           `INSERT INTO poems (dynasty, title, author, form, category, content, pinyin, appreciation, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              form = VALUES(form),
              content = VALUES(content),
              pinyin = VALUES(pinyin),
              appreciation = VALUES(appreciation),
              category = VALUES(category),
              source = VALUES(source)`,
           [
             poem.dynasty,
             poem.title,
             poem.author,
             poem.form,
             poem.category,
             JSON.stringify(poem.content),
             JSON.stringify(poem.pinyin),
             poem.appreciation,
             poem.source ?? 'prebuilt-json:data/poems',
           ]
         );
         inserted++;
       }
       return inserted;
     }
     ```
   - Keep `if (require.main === module)` CLI entry (operator can `npm run poetry:build` to repopulate after schema changes)
   - **NOTE**: schema UPSERT now includes `category` and uses `prebuilt-json:data/poems` as fallback source. Existing prod rows with `source='chinese-poetry/chinese-poetry@master'` will be updated on next run — that's intended.
   - **Top of file**: replace the existing "Pull 唐诗三百首 + 宋词三百首 from chinese-poetry/chinese-poetry GitHub repo" header with "Mirror `data/poems-manifest.json` + `data/poems/<id>.json` into the `poems` MySQL table. JSON is single source of truth (see `lib/poetry/loader.ts`); DB is a query-time mirror."

3. **`package.json:scripts`** (no changes)
   - `"poetry:build": "tsx scripts/build-poems.ts"` already exists. The rewritten build-poems.ts reads local JSON; the script name and behavior stay the same.

### Untouched but verified

- `lib/poetry/loader.ts` — already reads the same files, no changes needed
- `lib/poetry/queries.ts` — already uses FS via `loadManifest()`, no changes needed
- `scripts/init-db.ts:110-127` — `poems` table DDL stays (mirror pattern)
- `scripts/init-db.ts:503-519` — `initPoems()` stays (still calls `buildPoems()`)
- `scripts/build-poems-extra.ts` — adds 5 extra collections, separate flow, out of scope
- `app/api/init/init-poems/route.ts` — calls `initPoems()`, no changes
- `tests/integration/init-wizard.test.ts:73-79` — already iterates `init-poems/init-sutras/init-chars`, no changes

---

## Implementation Steps (TDD + per-task build check)

### Task 1: Refactor `scripts/build-poems.ts` to read local JSON

**Files:**
- Modify: `scripts/build-poems.ts` (full rewrite, 167 → ~60 lines)
- Test: `tests/unit/build-poems.test.ts` (new, ~70 lines)

**Interfaces:**
- Consumes: `data/poems-manifest.json` (PoemsManifest from `lib/poetry-types.ts:55-60`), `data/poems/<id>.json` (PoemDetail from `lib/poetry-types.ts:11-15`)
- Produces: `export async function buildPoems(): Promise<number>` — returns count of UPSERTs performed (idempotent: re-running yields inserted=manifest.items.length)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/build-poems.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PoemsManifest, PoemDetail } from '@/lib/poetry-types';

const DATA_DIR = join(process.cwd(), 'data', 'poems');
const MANIFEST_PATH = join(process.cwd(), 'data', 'poems-manifest.json');

describe('build-poems JSON-reader pipeline', () => {
  it('manifest has count field matching items.length', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    expect(manifest.count).toBe(manifest.items.length);
    expect(manifest.items.length).toBeGreaterThanOrEqual(1000);
  });

  it('every manifest id has a matching data/poems/<id>.json file', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    const files = new Set(
      readdirSync(DATA_DIR)
        .filter(f => /^\d+\.json$/.test(f))
        .map(f => Number(f.replace('.json', '')))
    );
    for (const item of manifest.items) {
      expect(files.has(item.id)).toBe(true);
    }
  });

  it('every per-poem JSON has pinyin aligned with content', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    let total = 0;
    for (const item of manifest.items) {
      const p = JSON.parse(readFileSync(join(DATA_DIR, `${item.id}.json`), 'utf8')) as PoemDetail;
      expect(Array.isArray(p.content)).toBe(true);
      expect(Array.isArray(p.pinyin)).toBe(true);
      expect(p.pinyin.length).toBe(p.content.length);
      for (let i = 0; i < p.content.length; i++) {
        expect(p.pinyin[i].length).toBe(Array.from(p.content[i]).length);
      }
      total++;
    }
    expect(total).toBeGreaterThanOrEqual(1000);
  });

  it('id=1 is 唐诗三百首 first poem (在岳咏蝉 by 骆宾王, form=五律)', () => {
    const p = JSON.parse(readFileSync(join(DATA_DIR, '1.json'), 'utf8')) as PoemDetail;
    expect(p.title).toBe('在岳咏蝉');
    expect(p.author).toBe('骆宾王');
    expect(p.dynasty).toBe('tang');
    expect(p.form).toBe('五律');
    expect(p.content.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these are data-shape tests, should already pass since `data/poems/` is already populated)

Run: `npx vitest run tests/unit/build-poems.test.ts`
Expected: 4/4 PASS

- [ ] **Step 3: Rewrite `scripts/build-poems.ts`**

Replace entire file with:
```ts
/**
 * Mirror data/poems-manifest.json + data/poems/<id>.json into the poems MySQL
 * table. JSON is single source of truth (see lib/poetry/loader.ts); DB is a
 * query-time mirror for tables that want SQL-side joins.
 *
 * Idempotent: re-running yields inserted=manifest.items.length (UNIQUE KEY
 * uniq_poem(dynasty,title,author) handles UPSERT).
 *
 * Previously this script did an HTTP fetch from chinese-poetry/chinese-poetry
 * GitHub. That dependency was removed 2026-07-09 — the JSONs in data/poems/
 * already contain post-processed pinyin + t2s-converted content, so a fresh
 * fetch was redundant and fragile (CDN 503 rate-limits could fail the wizard's
 * init phase on prod).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import type { PoemsManifest, PoemDetail } from '../lib/poetry-types';

const MANIFEST_PATH = join(process.cwd(), 'data', 'poems-manifest.json');
const POEMS_DIR = join(process.cwd(), 'data', 'poems');
const DEFAULT_SOURCE_TAG = 'prebuilt-json:data/poems';

export async function buildPoems(): Promise<number> {
  const pool = getPool();
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`build-poems: missing ${MANIFEST_PATH} — cannot mirror without a manifest`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
  let inserted = 0;
  for (const item of manifest.items) {
    const filePath = join(POEMS_DIR, `${item.id}.json`);
    if (!existsSync(filePath)) {
      console.warn(`[build-poems] missing ${filePath}; skipping id=${item.id}`);
      continue;
    }
    const poem = JSON.parse(readFileSync(filePath, 'utf8')) as PoemDetail;
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, form, category, content, pinyin, appreciation, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         form = VALUES(form),
         content = VALUES(content),
         pinyin = VALUES(pinyin),
         appreciation = VALUES(appreciation),
         category = VALUES(category),
         source = VALUES(source)`,
      [
        poem.dynasty,
        poem.title,
        poem.author,
        poem.form,
        poem.category,
        JSON.stringify(poem.content),
        JSON.stringify(poem.pinyin),
        poem.appreciation,
        poem.source ?? DEFAULT_SOURCE_TAG,
      ]
    );
    inserted++;
  }
  return inserted;
}

if (require.main === module) {
  buildPoems()
    .then((n) => {
      console.log(`[build-poems] mirrored ${n} poems`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-poems] failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Verify TypeScript clean**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 5: Run test suite to verify nothing broke**

Run: `npx vitest run tests/unit/build-poems.test.ts tests/unit/lib/sutras-fs.test.ts tests/unit/components/init/`
Expected: all pass (4 new + existing). Sutras-fs unchanged; init unchanged.

- [ ] **Step 6: per-task build check** (per `feedback-per-task-build-check.md` — lower-risk tier since diff doesn't touch `app/**/page.tsx`, but cheap to verify)

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds, route count preserved.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-poems.ts tests/unit/build-poems.test.ts
git commit -m "refactor(poems): replace GitHub fetch with data/poems/*.json reader [2026-07-09 HH.MM]"
```

---

### Task 2: Add wizard-level smoke (dev walkthrough confirms poems phase no longer fetches remote)

**Files:**
- Modify: none (manual verification only)
- Test: existing `tests/integration/init-wizard.test.ts` already covers `init-poems`

**Goal:** Confirm the wizard's `/api/init/init-poems` route no longer hits GitHub. Since `tests/integration/init-wizard.test.ts:73-79` already exercises the endpoint against a scratch DB, re-running it confirms the JSON-reader pipeline reaches `buildPoems()` without errors.

- [ ] **Step 1: Run integration test for the wizard's poems phase**

Run: `npx vitest run tests/integration/init-wizard.test.ts`
Expected: 1 test passes (or skip if DATABASE_URL not set; pre-existing import-hsk fail is unrelated).

- [ ] **Step 2: Manually verify the dev server's poems phase has zero outbound network calls**

Start dev server: `npx next dev -p 4444`
Reset DB to empty (mirror earlier walkthrough):
```bash
set -a && . ./.env && set +a
npx tsx -e "import('./lib/db').then(async ({getPool, closePool}) => { const p = getPool(); await p.query('DROP DATABASE IF EXISTS pinyin'); await p.query('CREATE DATABASE pinyin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await closePool(); process.exit(0); });"
```

Run the wizard's poems endpoint and observe no fetch attempt to `raw.githubusercontent.com`:
```bash
T0=$(date +%s)
curl -s -X POST http://localhost:4444/api/init/init-poems -b /tmp/jar.txt -c /tmp/jar.txt
T1=$(date +%s)
echo "elapsed: $((T1-T0))s"  # Should be < 5s (was 36s before — fetches 2×190KB files)
```

Expected: `{"ok":true,"data":{"inserted":1160,"skipped":false}}` with elapsed < 5s.

Verify DB has all 1160 rows:
```bash
set -a && . ./.env && set +a
npx tsx -e "import('./lib/db').then(async ({getPool, closePool}) => { const p = getPool(); const [[{cnt}]] = await p.query('SELECT COUNT(*) AS cnt FROM poems'); console.log('poems rows:', cnt); await closePool(); process.exit(0); });"
```

Expected: `poems rows: 1160`

Stop dev server.

- [ ] **Step 3: Commit** (no source changes — skip if Task 2 produced no diffs)

If Task 1 already committed everything, this task adds no commit. If any manual debug was needed, capture it in a follow-up commit.

---

### Task 3: Rebundle Up/ deploy bundle (per `deploy-bundler-up.md`)

**Files:**
- Modify: `Up/scripts/build-poems.ts`, `Up/tests/unit/build-poems.test.ts`, `Up/package.json` (regenerated by `copy-to-up.py`)

- [ ] **Step 1: Verify local main is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Run the bundler**

Run: `python scripts/copy-to-up.py 2>&1 | tail -3`
Expected: `Copied ~10331 files (~277.8 MB)` (same file count as before — poems tests are added, removed fetch refs are net ~neutral on file count).

- [ ] **Step 3: Verify Up/ has the new build-poems.ts and tests**

```bash
grep -c "raw.githubusercontent" Up/scripts/build-poems.ts  # Should be 0 (was 1+)
grep -c "prebuilt-json:data/poems" Up/scripts/build-poems.ts  # Should be 1
ls Up/tests/unit/build-poems.test.ts  # Should exist
ls Up/data/poems/1.json Up/data/poems-manifest.json  # Both exist
```

- [ ] **Step 4: Update Up/REDEPLOY-2026-07-09.md with the new commit**

Append a new section to `Up/REDEPLOY-2026-07-09.md`:
```markdown
## Addendum — plan-poems-json-reader (1 commit)

- `<hash>` refactor(poems): replace GitHub fetch with data/poems/*.json reader

The wizard's `导入古诗` phase no longer fetches from `raw.githubusercontent.com`. If
the previous redeploy showed a `failed: fetch ... → 503` for poems, this commit fixes it
without needing to re-run the wizard (data was already in `data/poems/`; the table now
gets mirrored from local JSON on next init).
```

- [ ] **Step 5: Commit the Up/ rebundle**

```bash
git add Up/
git commit -m "chore(deploy): rebundle Up/ with poems JSON-reader [2026-07-09 HH.MM]"
```

---

## Verification

### Automated

- `npx tsc --noEmit` — clean
- `npx vitest run` — 4 new + existing pass (1 pre-existing import-hsk fail unrelated)
- `npx next build` — 191 routes preserved

### Manual dev walkthrough (Task 2)

- Reset DB → run `/api/init/init-poems` → `inserted: 1160`, elapsed < 5s, no outbound network calls
- DB `poems` table count = 1160
- `source` column = `prebuilt-json:data/poems` (or original value preserved for any row already inserted from extra collections)

### Wizard smoke (user on prod)

1. SSH to prod, sync `Up/`
2. `cd Up && npm ci --legacy-peer-deps && npm run strokes:build && npm run build && npm start -- -p 4444`
3. Open `/init/execute` in browser
4. **Verify poems card** turns green ✓ with "新增 1160 行" detail (or "已跳过 (表内已有数据)" if previously initialized)
5. **No `503 fetch failed` in wizard detail** (was the symptom; should be impossible now)

## Commit Summary

2 commits on local main:

1. `refactor(poems): replace GitHub fetch with data/poems/*.json reader`
2. `chore(deploy): rebundle Up/ with poems JSON-reader`

Per `no-prod-env-2026-06-21.md`, NOT pushed. User syncs Up/ to prod manually.

## Notes / Risks

- **`source` column history**: existing prod rows with `source='chinese-poetry/chinese-poetry@master'` will be updated to `poem.source` value from the JSON (which is also `'chinese-poetry/chinese-poetry@master'` for the 300 唐诗 + 300 宋词, or the per-collection source tag for extras like `'guwendao:yuefu'`). Net: rows keep their original provenance tag (the JSON `source` field is preserved).
- **No pinyin regeneration**: if a future user finds a pinyin error in `data/poems/<id>.json`, the fix path is: edit the JSON → commit → re-run wizard (or `npm run poetry:build`) → DB UPSERTs the corrected pinyin. Same as how sutras pinyin corrections work today (plan-sutras-json-reader Task 2 enrich-sutra-pinyin.ts is the historical precedent for the enrichment step, but for poems pinyin is already pre-baked).
- **build-poems-extra.ts untouched**: the 5 extra collections (汉乐府 / 古诗十九首 / 辞赋 / 曹操诗集 / 纳兰性德) come in via `data/poems/<slug>.json` (collection shape, not PoemDetail). They are inserted to the `poems` table directly by `build-poems-extra.ts` with source tags like `'guwendao:yuefu'`. If/when extra collections need to be served by `lib/poetry/loader.ts`, those files need to be unrolled into per-poem `<id>.json` files and added to the manifest. Out of scope for this plan.
- **`initTables()` keeps `poems` DDL**: mirrors sutras pattern. The table exists as a DB mirror; runtime reads still go through FS via `lib/poetry/loader.ts`. Per memory `plan-poems-classics-file-only-status.md`, this is the current expected state ("poems table exists, but unused by runtime").
- **Wizard's soft-fail fix from commit `b2dc7163`** still applies — if the JSON-reader pipeline ever throws (e.g. `data/poems-manifest.json` missing), wizard will now show red ✗ instead of green ✓.