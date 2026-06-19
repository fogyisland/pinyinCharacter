# G4 Polish — Sutra Back-link + pull-prod-to-dev + G3 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 6 pre-written polish changes on `main` as 6 focused commits — (1) trailing newlines in 3 files, (2) `getSutraBackLink` helper + 5 unit tests, (3) SutraCard + detail-page wiring + new link test, (4) RandomTab title error clears on input, (5) brush-mode `pageCountFor` test coverage, (6) one-off `pull-prod-to-dev` script.

**Architecture:** No new modules, no architectural changes. Each commit is self-contained and reviewable. Back-link uses a small pure-function helper (`getSutraBackLink(from)`) consumed by the existing RSC at `app/sutra/[id]/page.tsx`. SutraCard stamps the source into the URL via `?from=sutras`. RandomTab fix is a 1-line `useEffect` watching `title`. Brush-mode test addition extends the existing `worksheet-page-count.test.ts`. Pull-prod-to-dev is a stand-alone `mysql2` script using `INSERT IGNORE` for idempotency.

**Tech Stack:** Next.js 15 App Router, TypeScript, vitest + @testing-library/react, mysql2, React 19 `useEffect` (already used elsewhere in the project).

## Global Constraints

- **6 commits, one per logical change.** Commit 1 (newlines) is `chore`; commits 2 + 3 are `feat(sutra)` (helper before wiring); commit 4 is `fix(worksheet)`; commit 5 is `test(worksheet)`; commit 6 is `chore(scripts)`.
- **Project convention: main branch, no feature branch.** Push each commit to `origin/main` after it lands.
- **TDD for new code** (Tasks 2, 5). For 1-line fixes / pre-written helpers (Tasks 1, 4) and the one-off script (Task 6), regression checks + commit-by-commit verification are sufficient.
- **Dev server pinned to port 4444.** Never run `pnpm build` while `pnpm dev` is alive on 4444 (corrupts `.next/`, browser 404s). Per-task reviewers MUST run `pnpm build` (per MEMORY feedback) on their review pass.
- **No new dependencies.** The script reuses the already-installed `mysql2` from the project's existing scripts.
- **No new files outside the spec's file list.** The 5 modified + 1 new helper + 1 new test + 1 new script = exactly what's listed below.
- **Pre-existing test failures are NOT regressions**: 1) `tests/integration/api/sutras.test.ts` (sutras list perf, 30s+ timeout — MEMORY), 2) `tests/unit/lib/etymology.test.ts` (documented etymology test fail — MEMORY). Both are baseline noise; do not chase.
- **Chinese labels verbatim from the spec**: back-link label `'返回经文目录'` (sutras), `'返回字典'` (dictionary), `'返回罕见字库'` (rare-chars). RandomTab validation message `'请先填写字帖标题'` is already in place.
- **6-step human browser smoke (out of scope for this plan)**: `/sutras` → click a sutra → see `← 返回经文目录` link → click → return to list.

---

## File Structure

### New files
- `app/sutra/[id]/back-link.ts` — pure function `getSutraBackLink(from)` + `SutraBackSource` type. Task 2.
- `tests/unit/app/sutra/back-link.test.ts` — 5 vitest tests (3 valid sources, 1 unknown, 1 undefined). Task 2.
- `scripts/pull-prod-to-dev.ts` — one-off `mysql2` script. Task 6.

### Modified files
- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` — append trailing newline. Task 1.
- `tests/unit/lib/worksheet-types.test.ts` — append trailing newline. Task 1.
- `scripts/migrations/2026-06-19-brush-paper-size.sql` — append trailing newline. Task 1.
- `components/sutra/SutraCard.tsx` — change `href={`/sutra/${sutra.id}`}` to `href={`/sutra/${sutra.id}?from=sutras`}`. Task 3.
- `app/sutra/[id]/page.tsx` — read `sp.from`, call `getSutraBackLink(sp.from)`, render back link `<Link>` above `<SutraMeta>`. Task 3.
- `tests/unit/components/sutra/SutraCard.test.tsx` — add 1 test asserting the `href` attribute is `/sutra/1?from=sutras`. Task 3.
- `components/worksheet/RandomTab.tsx` — import `useEffect`; add `useEffect(() => { setErr(null); }, [title])` after the `useState` block. Task 4.
- `tests/unit/lib/worksheet-page-count.test.ts` — append 3 tests inside the existing `describe('pageCountFor', ...)` block: empty, exactly-full, one-over-threshold for brush-12/24/28. Task 5.

### Untouched (verified)
- `app/sutras/page.tsx` (and any other sutra list route) — already calls `<SutraCard>`; the only required change is inside `SutraCard` itself.
- `app/sutra/[id]/page.tsx` props interface already declares `from?: string` in `searchParams` — no signature change.
- All worksheet / font / DB code — unchanged.

---

## Tasks

### Task 1: Trailing newlines in 3 files (`chore`)

**Files:**
- Modify: `tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
- Modify: `tests/unit/lib/worksheet-types.test.ts`
- Modify: `scripts/migrations/2026-06-19-brush-paper-size.sql`

**Interfaces:**
- Consumes: (no logic dependencies)
- Produces: 3 files all end with a single `\n` byte (POSIX text-file convention).

- [ ] **Step 1: Verify each file currently lacks a trailing newline**

Run:
```bash
cd "E:/ToolDevelop/PinYinCharacter"
tail -c 1 tests/unit/components/worksheet/FontFamilyPicker.test.tsx | xxd
tail -c 1 tests/unit/lib/worksheet-types.test.ts | xxd
tail -c 1 scripts/migrations/2026-06-19-brush-paper-size.sql | xxd
```
Expected: each command prints `00000000: 0000` (a NUL byte placeholder from a missing final newline) OR shows a non-`0a` final byte. If a file already ends in `0a`, skip it and only modify the others.

(For SQL the current last byte is `;` = `0x3b`. For the two test files the last line is closing `});` or similar — confirm by visual check or `tail -c 1 | xxd`.)

- [ ] **Step 2: Append a newline to each file that needs it**

For each file missing a trailing `\n`, append one byte (`0x0a`). Use the Edit tool with `old_string` set to the last line and `new_string` set to the same line + `\n`. Example for the SQL file:

```ts
// Edit on scripts/migrations/2026-06-19-brush-paper-size.sql
old_string: "MODIFY COLUMN paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL;"
new_string: "MODIFY COLUMN paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL;\n"
```

For the two test files, pick the closing brace of the last `describe` (or last `});`) as the anchor and append `\n`.

- [ ] **Step 3: Verify trailing newlines now present**

Run:
```bash
cd "E:/ToolDevelop/PinYinCharacter"
tail -c 1 tests/unit/components/worksheet/FontFamilyPicker.test.tsx | xxd
tail -c 1 tests/unit/lib/worksheet-types.test.ts | xxd
tail -c 1 scripts/migrations/2026-06-19-brush-paper-size.sql | xxd
```
Expected: each command prints `00000000: 0a0a` (single `0a` byte).

- [ ] **Step 4: tsc clean**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add tests/unit/components/worksheet/FontFamilyPicker.test.tsx \
        tests/unit/lib/worksheet-types.test.ts \
        scripts/migrations/2026-06-19-brush-paper-size.sql
git commit -m "chore: trailing newlines in 3 test/asset files"
```

---

### Task 2: getSutraBackLink helper + unit tests (TDD)

**Files:**
- Create: `app/sutra/[id]/back-link.ts`
- Create: `tests/unit/app/sutra/back-link.test.ts`

**Interfaces:**
- Consumes: (no logic dependencies — pure function)
- Produces: `getSutraBackLink(from: string | undefined): { href: string; label: string }` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/app/sutra/back-link.test.ts` with this content (the helper does not exist yet → all 5 tests must fail with "not a function" / module-not-found):

```ts
import { describe, it, expect } from 'vitest';
import { getSutraBackLink } from '@/app/sutra/[id]/back-link';

describe('getSutraBackLink', () => {
  it('returns dictionary link for from=dictionary', () => {
    expect(getSutraBackLink('dictionary')).toEqual({ href: '/dictionary', label: '返回字典' });
  });
  it('returns rare-chars link for from=rare-chars', () => {
    expect(getSutraBackLink('rare-chars')).toEqual({ href: '/rare-chars', label: '返回罕见字库' });
  });
  it('returns sutras link for from=sutras', () => {
    expect(getSutraBackLink('sutras')).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
  it('defaults to sutras for unknown source', () => {
    expect(getSutraBackLink('garbage')).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
  it('defaults to sutras for undefined', () => {
    expect(getSutraBackLink(undefined)).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/app/sutra/back-link.test.ts`
Expected: FAIL with `Failed to resolve import "@/app/sutra/[id]/back-link"` or `getSutraBackLink is not a function`. All 5 tests fail.

- [ ] **Step 3: Implement the helper**

Create `app/sutra/[id]/back-link.ts` with:

```ts
export type SutraBackSource = 'dictionary' | 'rare-chars' | 'sutras';

const BACK_LINKS: Record<SutraBackSource, { href: string; label: string }> = {
  dictionary: { href: '/dictionary', label: '返回字典' },
  'rare-chars': { href: '/rare-chars', label: '返回罕见字库' },
  sutras: { href: '/sutras', label: '返回经文目录' },
};

export function getSutraBackLink(from: string | undefined): { href: string; label: string } {
  if (from && (from as SutraBackSource) in BACK_LINKS) {
    return BACK_LINKS[from as SutraBackSource];
  }
  return BACK_LINKS.sutras;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/app/sutra/back-link.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: tsc clean**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add app/sutra/[id]/back-link.ts \
        tests/unit/app/sutra/back-link.test.ts
git commit -m "feat(sutra): back-link helper getSutraBackLink"
```

---

### Task 3: Wire ?from=sutras through SutraCard + detail page

**Files:**
- Modify: `components/sutra/SutraCard.tsx:6` (change href)
- Modify: `app/sutra/[id]/page.tsx:37,44-50` (call helper, render back link)
- Modify: `tests/unit/components/sutra/SutraCard.test.tsx:24-30` (add new test)

**Interfaces:**
- Consumes: `getSutraBackLink(from: string | undefined): { href: string; label: string }` from Task 2.
- Produces: clicking a SutraCard navigates to `/sutra/[id]?from=sutras`; the detail page renders a back link `<Link href={backLink.href}>{backLink.label}</Link>`.

- [ ] **Step 1: Update SutraCard href to include ?from=sutras**

In `components/sutra/SutraCard.tsx`, change line 6 from:
```tsx
href={`/sutra/${sutra.id}`}
```
to:
```tsx
href={`/sutra/${sutra.id}?from=sutras`}
```

- [ ] **Step 2: Add the failing test for the new href**

In `tests/unit/components/sutra/SutraCard.test.tsx`, append a third `it(...)` block (after the existing 2 tests, inside the `describe('SutraCard', ...)` block). The test file already has `// @vitest-environment happy-dom` at the top — do NOT add a second copy.

```tsx
  it('links to sutra detail with ?from=sutras so the back button works', () => {
    const { container } = render(
      <SutraCard sutra={{ id: 1, title: '心经', slug: 'xinjing', chunkCount: 1, charCount: 260 }} />
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/sutra/1?from=sutras');
  });
```

- [ ] **Step 3: Run the new test to verify it fails**

Run: `pnpm test tests/unit/components/sutra/SutraCard.test.tsx`
Expected: 1 fail (the new test); 2 pass (existing tests).

- [ ] **Step 4: Run the new test to verify it passes (after Step 1's edit)**

(Step 1's edit is already in place.) Re-run:

Run: `pnpm test tests/unit/components/sutra/SutraCard.test.tsx`
Expected: 3/3 pass.

- [ ] **Step 5: Update app/sutra/[id]/page.tsx to render the back link**

The current file already imports `Link` from `next/link` and `getSutraBackLink` from `./back-link` (verify with a `grep`; if not, add the imports). The `searchParams` type already includes `from?: string` (line 19). Make two changes:

**Change 1** — after line 36 (`const activeChunk = sutra.chunks[activeChunkId]!;`), add the back-link resolution:

```tsx
  const backLink = getSutraBackLink(sp.from);
```

**Change 2** — after line 43 (`<div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>`), insert a new back-link block before the `字 · 韵` div (so it appears above the brand mark):

```tsx
        <div className="worksheet-no-print mb-2">
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal transition-colors"
          >
            <span aria-hidden="true">←</span> {backLink.label}
          </Link>
        </div>
```

Verify the final layout reads (top-to-bottom inside `<PageContainer>`): back-link → 字 · 韵 → SutraMeta → flex row.

- [ ] **Step 6: tsc clean**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Full worksheet/sutra test regression**

Run: `pnpm test tests/unit/components/sutra/ tests/unit/app/sutra/`
Expected: 3/3 SutraCard + 5/5 back-link = 8/8 pass.

- [ ] **Step 8: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add components/sutra/SutraCard.tsx \
        app/sutra/[id]/page.tsx \
        tests/unit/components/sutra/SutraCard.test.tsx
git commit -m "feat(sutra): wire ?from=sutras through SutraCard + detail page"
```

---

### Task 4: Clear RandomTab title error on title change (`fix(worksheet)`)

**Files:**
- Modify: `components/worksheet/RandomTab.tsx:1,28` (import + useEffect)

**Interfaces:**
- Consumes: existing `useState` import + `err` state + `title` prop.
- Produces: when the user types in the title input, the `err` state resets to `null` (the red error message disappears).

- [ ] **Step 1: Add useEffect import**

In `components/worksheet/RandomTab.tsx`, change line 1 from:
```tsx
import { useState } from 'react';
```
to:
```tsx
import { useEffect, useState } from 'react';
```

- [ ] **Step 2: Add the useEffect**

After the `const [err, setErr] = useState<string | null>(null);` line (currently line 27, immediately after the existing `useState` calls), add:

```tsx
  useEffect(() => {
    setErr(null);
  }, [title]);
```

(No JSX or other change.)

- [ ] **Step 3: Run the existing RandomTab test suite (regression)**

Run: `pnpm test tests/unit/components/worksheet/RandomTab.test.tsx`
Expected: 6/6 pass (no test added — pure regression check).

- [ ] **Step 4: tsc clean**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add components/worksheet/RandomTab.tsx
git commit -m "fix(worksheet): clear title error when user types"
```

---

### Task 5: pageCountFor brush-mode coverage (`test(worksheet)`)

**Files:**
- Modify: `tests/unit/lib/worksheet-page-count.test.ts` (append 3 tests)

**Interfaces:**
- Consumes: `pageCountFor(chars: number, size: PaperSize): number` (existing export, already covers A3/A4/B5).
- Produces: brush-mode coverage for `pageCountFor` matching the `cellsPerPage` brush tests added in G3.3.

- [ ] **Step 1: Append 3 tests inside the existing pageCountFor block**

Open `tests/unit/lib/worksheet-page-count.test.ts`. The file already has a `describe('pageCountFor', () => { ... });` block (around lines 12-30) followed by a `describe('exceedsFreeLimit', ...)` block and a `describe('cellsPerPage (G3 brush modes)', ...)`. Append 3 new `it(...)` blocks at the end of the `pageCountFor` describe (i.e., before its closing `});`):

```ts
  it('returns 1 for empty content on brush modes', () => {
    expect(pageCountFor(0, 'brush-12')).toBe(1);
    expect(pageCountFor(0, 'brush-24')).toBe(1);
    expect(pageCountFor(0, 'brush-28')).toBe(1);
  });
  it('returns 1 for exactly cellsPerPage chars on brush modes', () => {
    expect(pageCountFor(12, 'brush-12')).toBe(1);
    expect(pageCountFor(24, 'brush-24')).toBe(1);
    expect(pageCountFor(28, 'brush-28')).toBe(1);
  });
  it('returns 2 for one over the threshold on brush modes', () => {
    expect(pageCountFor(13, 'brush-12')).toBe(2);
    expect(pageCountFor(25, 'brush-24')).toBe(2);
    expect(pageCountFor(29, 'brush-28')).toBe(2);
  });
```

The default vitest environment is `node` for this file (no `@vitest-environment` directive at the top) — fine for pure-function tests; no env change needed.

- [ ] **Step 2: Run the test file to verify all tests pass (12 existing + 3 new = 15)**

Run: `pnpm test tests/unit/lib/worksheet-page-count.test.ts`
Expected: 15/15 pass. Breakdown: `cellsPerPage` (3 non-brush + 3 brush from G3.3) = 6; `pageCountFor` (4 non-brush existing + 3 brush new) = 7; `exceedsFreeLimit` (2) = 2. Total = 15. The 3 new are appended inside the existing `pageCountFor` block.

- [ ] **Step 3: tsc clean**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add tests/unit/lib/worksheet-page-count.test.ts
git commit -m "test(worksheet): pageCountFor brush mode coverage"
```

---

### Task 6: pull-prod-to-dev helper (`chore(scripts)`)

**Files:**
- Create: `scripts/pull-prod-to-dev.ts`

**Interfaces:**
- Consumes: `process.env.DATABASE_URL_REMOTE` (optional, fallback hard-coded) + `process.env.DATABASE_URL` (required, local target).
- Produces: rows from `chars` and `rare_chars` in prod copied to local DB via `INSERT IGNORE`. Idempotent.

- [ ] **Step 1: Verify the script file is on the working tree (untracked)**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && git status --short scripts/pull-prod-to-dev.ts`
Expected: `?? scripts/pull-prod-to-dev.ts` (untracked).

If the file is missing, create it with this content (use `cat` heredoc or `Write`):

```ts
/**
 * One-off: pull all chars + rare_chars from prod piyin to local piyin_dev.
 *
 * Idempotent: INSERT IGNORE on PK (chars.char, rare_chars.char). Re-runnable.
 *
 *   pnpm tsx scripts/pull-prod-to-dev.ts
 *
 * Reads prod URL from .env (DATABASE_URL_REMOTE or hard-coded fallback);
 * writes to whatever DATABASE_URL points to (piyin_dev in .env.local).
 */
import mysql from 'mysql2/promise';

const PROD_URL = process.env.DATABASE_URL_REMOTE
  ?? 'mysql://piyin:Admin909217@139.5.108.245:3306/piyin';
const LOCAL_URL = process.env.DATABASE_URL;
if (!LOCAL_URL) throw new Error('DATABASE_URL (local) is required');

const CHUNK = 500;

async function pull(prod: mysql.Connection, local: mysql.Connection, table: string, cols: string[]) {
  const colList = cols.map(c => '`' + c + '`').join(',');
  const placeholders = '(' + cols.map(() => '?').join(',') + ')';

  const [cnt] = await prod.query<any[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  console.log(`${table}: ${cnt[0].n} rows in prod`);

  const [minMax] = await prod.query<any[]>(`SELECT MIN(\`char\`) AS mn, MAX(\`char\`) AS mx FROM ${table}`);
  console.log(`  codepoint range: ${minMax[0].mn} (U+${minMax[0].mn.codePointAt(0)!.toString(16).toUpperCase()}) - ${minMax[0].mx} (U+${minMax[0].mx.codePointAt(0)!.toString(16).toUpperCase()})`);

  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  // Stream in chunks keyed by ordinal position to avoid collation-related sort issues on `char`.
  while (true) {
    const [rows] = await prod.query<any[]>(
      `SELECT ${colList} FROM ${table} ORDER BY \`char\` LIMIT ? OFFSET ?`,
      [CHUNK, offset],
    );
    if (rows.length === 0) break;
    pulled += rows.length;

    const values: any[] = [];
    for (const r of rows) {
      for (const c of cols) values.push(r[c]);
    }
    const flat = rows.map(r => cols.map(c => r[c]));
    const [res] = await local.query<any>(
      `INSERT IGNORE INTO ${table} (${colList}) VALUES ${flat.map(() => placeholders).join(',')}`,
      flat.flat(),
    );
    inserted += res.affectedRows;
    offset += CHUNK;
    if (rows.length < CHUNK) break;
  }
  console.log(`  pulled=${pulled} inserted_new=${inserted} skipped_existing=${pulled - inserted}`);
  return { pulled, inserted };
}

async function main() {
  const prod = await mysql.createConnection({uri: PROD_URL});
  const local = await mysql.createConnection({uri: LOCAL_URL, charset: 'utf8mb4'});

  console.log('=== CHARS ===');
  const [cCols] = await prod.query<any[]>('SHOW COLUMNS FROM chars');
  const charCols = cCols.map((c: any) => c.Field);
  await pull(prod, local, 'chars', charCols);

  console.log('=== RARE_CHARS ===');
  const [rCols] = await prod.query<any[]>('SHOW COLUMNS FROM rare_chars');
  const rareCols = rCols.map((c: any) => c.Field);
  await pull(prod, local, 'rare_chars', rareCols);

  // Final local counts
  const [lc] = await local.query<any[]>('SELECT level, COUNT(*) AS n FROM chars GROUP BY level');
  console.log('local chars by level:', JSON.stringify(lc));
  const [lr] = await local.query<any[]>('SELECT COUNT(*) AS n FROM rare_chars');
  console.log('local rare_chars:', lr[0].n);

  await prod.end();
  await local.end();
  console.log('DONE');
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
```

- [ ] **Step 2: tsc check on the new file (does it type-check standalone?)**

Run: `pnpm tsc --noEmit`
Expected: exit 0 (the script's `any` types keep it loose; tsc will be clean).

- [ ] **Step 3: Smoke-parse via tsx (no DB calls)**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm tsx scripts/pull-prod-to-dev.ts 2>&1 | head -5 || true`
Expected: either `DATABASE_URL (local) is required` (clean error path, since no `.env.local` is loaded) OR connection error within ~5s (network not available in sandbox). Either is acceptable — what matters is that the script does not crash with a parse/syntax error or module resolution error before reaching the env check.

If the output is `DATABASE_URL (local) is required`, that's the cleanest smoke. If it's a network error (e.g., `ECONNREFUSED`), the script is also valid — just record the actual error in the report.

- [ ] **Step 4: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git add scripts/pull-prod-to-dev.ts
git commit -m "chore(scripts): add pull-prod-to-dev helper"
```

---

## Final verification (after all 6 commits)

Run from `E:/ToolDevelop/PinYinCharacter`:

```bash
# 1. tsc clean
pnpm tsc --noEmit

# 2. full test suite
pnpm test

# 3. production build (per MEMORY: per-task reviewers already ran this; final pass confirms 128 routes preserved)
# DO NOT RUN if `pnpm dev` is alive on port 4444 — corrupts .next/ cache.
cmd.exe //c "netstat -ano | findstr :4444"   # if any PID matches, skip this step
pnpm build

# 4. git log shows 6 new commits on top of G3
git log --oneline e67d3a42..HEAD
```

Expected results:
- (1) tsc clean.
- (2) test suite: 502 (G3 baseline) + 5 (back-link) + 0 (SutraCard — its 3rd test is in the WIP file, not new in G4) + 3 (pageCountFor brush) = 510 passing, with the same 2 pre-existing failures (sutras list perf + etymology test) — totals still show 3 fail.
- (3) build green, route count still 128.
- (4) `git log --oneline e67d3a42..HEAD` shows exactly 6 new commits in the order specified by Tasks 1-6.

## Out of scope

- I3 (per-spec fontFamily override behavior) — not a bug, not a follow-up.
- I4 UX nit (clear err on `count` / `difficulty` change too) — YAGNI; user only complains about title.
- M2 / M4 / M5 / M6 — pre-existing no-ops or spec-allowable.
- Dictionary / rare-chars pages → sutra back-link UI — helper is ready; future follow-up.
- pull-prod-to-dev automation / scheduling.
- Sutras list perf (pre-existing) and etymology test (pre-existing) — not touched.

## Human smoke checklist (after this plan ships)

1. `pnpm dev` (port 4444)
2. Visit `http://localhost:4444/sutras`
3. Click any sutra card → land on `/sutra/[id]?from=sutras`
4. See `← 返回经文目录` link above the `字 · 韵` brand mark
5. Click it → return to `/sutras`
6. On `/worksheet/new`, Random tab: click `随机生成` without title → see `请先填写字帖标题`; start typing → error clears within one keystroke
