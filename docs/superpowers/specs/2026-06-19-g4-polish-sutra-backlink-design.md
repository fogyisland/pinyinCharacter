# Spec: G4 — Polish (经文回链 + pull-prod-to-dev + G3 follow-ups)

## Goal

Land 6 small, pre-written, independent changes on `main` as 6 focused commits:

1. Add a "back" link on `/sutra/[id]` so users coming from `/sutras` can return to the list (today there is no navigation back).
2. Add a one-off `pull-prod-to-dev` script to copy `chars` + `rare_chars` from prod to local `piyin_dev` for safe bulk-gen verification (the existing Plan wild-humming-globe path only handles data; this script populates it).
3. Land the G3 whole-branch-review follow-ups that were deferred: clear RandomTab title error on input (I4), trailing newlines in 3 files (M1), and brush-mode `pageCountFor` test coverage (M3).

No architectural changes, no new dependencies, no cross-coupling between commits.

## Background

- **经文回链 (Sutra back-link):** `/sutras` lists sutras via `SutraCard` (`components/sutra/SutraCard.tsx`). Clicking a card navigates to `/sutra/[id]`, which has no back button. Users who land on a sutra from the list must use browser back, losing their scroll position and chunk selection. 5 WIP files already implement the helper + wiring (see `app/sutra/[id]/back-link.ts`); they need review, any test gap fill, and commits.
- **pull-prod-to-dev:** Plan wild-humming-globe shipped `piyin_dev` schema + `/admin/chars/init` UI + `ai.mock_mode` (commit 03dc5bf), but copying prod data into the dev DB is still manual. Plan M3 (笔画顺序) and any future bulk-gen tests need a populated dev DB. The script `scripts/pull-prod-to-dev.ts` is written and untracked.
- **G3 polish (deferred from whole-branch review):** see `plan-g3-status.md` "Deferred follow-ups" section. I4 = RandomTab error doesn't clear on title input change (1-line `useEffect`). M1 = 3 files missing trailing newline. M3 = `pageCountFor` has no brush-mode coverage in the unit test (only `cellsPerPage` does).

### Out of scope (explicit)

- **I3** (fontFamily auto-pick wipes user override on cell-style change) — this is the G3 spec's documented behavior; do not change.
- **M2 / M4 / M5 / M6** — pre-existing no-ops or spec-allowable per the G3 review.
- **Dictionary / rare-chars 入口 (?from=dictionary / ?from=rare-chars)** — `getSutraBackLink` already supports them as future hooks, but no UI in those pages links to sutras today. Out of scope; can be a follow-up.
- **pull-prod-to-dev 自动化 / 定时** — script is one-off / manual; not part of any cron or CI.
- **G3 main review pre-existing failures** (sutras list perf, etymology test) — already documented in MEMORY; not this plan.

## Design

### 1. Trailing newlines (commit 1, `chore`)

3 files end without a final `\n` (POSIX text-file convention):

- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
- `tests/unit/lib/worksheet-types.test.ts`
- `scripts/migrations/2026-06-19-brush-paper-size.sql`

Append a single `\n` to each. No code change.

### 2. 经文回链 helper (commit 2, `feat(sutra)`)

**New:** `app/sutra/[id]/back-link.ts`

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

**New:** `tests/unit/app/sutra/back-link.test.ts` — 5 tests (3 valid sources, 1 unknown string, 1 undefined), pure function, no React env needed.

**Behavior:**
- `from = 'dictionary'` → `{ href: '/dictionary', label: '返回字典' }`
- `from = 'rare-chars'` → `{ href: '/rare-chars', label: '返回罕见字库' }`
- `from = 'sutras'` → `{ href: '/sutras', label: '返回经文目录' }`
- `from = 'garbage'` (or any other string) → defaults to `sutras`
- `from = undefined` → defaults to `sutras`

### 3. 经文回链 wiring (commit 3, `feat(sutra)`)

**Modify:** `components/sutra/SutraCard.tsx`

```tsx
href={`/sutra/${sutra.id}?from=sutras`}
```

**Modify:** `app/sutra/[id]/page.tsx`

- Read `from` from `searchParams` (already declared as `Promise<{ chunk?: string; from?: string }>`).
- Call `getSutraBackLink(sp.from)` after the chunk-resolution block.
- Render a back link above `<SutraMeta>` inside the `worksheet-no-print` div:

```tsx
<div className="worksheet-no-print mb-2">
  <Link href={backLink.href} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal transition-colors">
    <span aria-hidden="true">←</span> {backLink.label}
  </Link>
</div>
```

**New test in** `tests/unit/components/sutra/SutraCard.test.tsx` — verify the rendered anchor's `href` includes `?from=sutras`:

```ts
it('links to sutra detail with ?from=sutras so the back button works', () => {
  const { container } = render(<SutraCard sutra={{ id: 1, title: '心经', slug: 'xinjing', chunkCount: 1, charCount: 260 }} />);
  const link = container.querySelector('a');
  expect(link?.getAttribute('href')).toBe('/sutra/1?from=sutras');
});
```

### 4. RandomTab title error clear (commit 4, `fix(worksheet)`)

**Modify:** `components/worksheet/RandomTab.tsx`

Add a `useEffect` that clears `err` whenever `title` changes:

```ts
useEffect(() => {
  setErr(null);
}, [title]);
```

Import `useEffect` from React (currently only `useState` is imported). Place the effect after the `useState` block. No new test (1-line effect, covered by manual browser smoke; existing 6 RandomTab tests remain green).

### 5. pageCountFor brush-mode coverage (commit 5, `test(worksheet)`)

**Modify:** `tests/unit/lib/worksheet-page-count.test.ts`

Append 3 tests inside the existing `describe('pageCountFor', ...)` block:

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

This fills the brush-mode gap in the existing `pageCountFor` coverage (only A3/A4/B5 are covered today).

### 6. pull-prod-to-dev helper (commit 6, `chore(scripts)`)

**New:** `scripts/pull-prod-to-dev.ts` (already written, untracked)

- Reads prod URL from `process.env.DATABASE_URL_REMOTE` (fallback: `mysql://piyin:Admin909217@139.5.108.245:3306/piyin`).
- Reads local URL from `process.env.DATABASE_URL` (required, no fallback).
- Opens two `mysql2` connections (prod + local), uses `utf8mb4` on local.
- For each of `chars` and `rare_chars`:
  - `SHOW COLUMNS` → derive column list dynamically.
  - `SELECT COUNT(*)` + `MIN(char)` / `MAX(char)` → log row count and codepoint range.
  - Stream rows in 500-row chunks keyed by `ORDER BY char LIMIT ? OFFSET ?`.
  - `INSERT IGNORE` into local table (idempotent on PK).
  - Log `pulled / inserted_new / skipped_existing` per table.
- Final summary: `local chars by level` + `local rare_chars` total.
- No tests (one-off script, idempotency guaranteed by `INSERT IGNORE`).

## Test Plan

| Commit | Test command | Expected |
|--------|--------------|----------|
| 1 (newlines) | `pnpm tsc --noEmit` | clean |
| 2 (helper) | `pnpm test tests/unit/app/sutra/back-link.test.ts` | 5/5 pass |
| 3 (wiring) | `pnpm test tests/unit/components/sutra/SutraCard.test.tsx` | 3/3 pass (2 existing + 1 new) |
| 3 (wiring) | `pnpm tsc --noEmit` | clean (page.tsx + SutraCard types) |
| 4 (I4 fix) | `pnpm test tests/unit/components/worksheet/RandomTab.test.tsx` | 6/6 pass (no test added; regression check) |
| 4 (I4 fix) | `pnpm tsc --noEmit` | clean |
| 5 (pageCountFor) | `pnpm test tests/unit/lib/worksheet-page-count.test.ts` | 12/12 pass (9 existing + 3 new) |
| 6 (script) | manual: `pnpm tsx scripts/pull-prod-to-dev.ts` against a real prod + dev DB | logs rows pulled / inserted |

Final verification (after all 6 commits):

```bash
pnpm tsc --noEmit           # must be clean
pnpm test                   # must show: 5 + 3 + 6 + 12 = 26 new/affected tests pass; pre-existing 3 fails unchanged
pnpm build                  # must succeed; 128 routes preserved
```

## Commit breakdown (final order, dependencies upstream)

| # | Hash (TBD) | Type | Scope | Message |
|---|------------|------|-------|---------|
| 1 | — | `chore` | (none) | `trailing newlines in 3 test/asset files` |
| 2 | — | `feat` | `sutra` | `back-link helper getSutraBackLink` |
| 3 | — | `feat` | `sutra` | `wire ?from=sutras through SutraCard + detail page` |
| 4 | — | `fix` | `worksheet` | `clear RandomTab title error on title change` |
| 5 | — | `test` | `worksheet` | `pageCountFor brush mode coverage` |
| 6 | — | `chore` | `scripts` | `add pull-prod-to-dev helper` |

Order rationale:
- **1 first** (no logic, no risk; sets a clean diff baseline for everything that follows).
- **2 before 3** (helper is a new file with its own tests; commit 3's wiring depends on it).
- **4, 5** are independent worksheet polish; either order works; do 4 (I4 fix) before 5 (test) to keep the worksheet area's diff grouped.
- **6 last** (script is unrelated to app code; a single "add tool" commit at the end keeps the worksheet/sutra changes bundled in earlier commits).

## Out of scope (re-stated)

- I3 (per-spec fontFamily override behavior)
- I4 UX nit (no need to also clear err on `count` / `difficulty` change — same useEffect, but adding is YAGNI)
- M2 / M4 / M5 / M6 (no-ops or spec-allowable)
- Dictionary / rare-chars pages → sutra back-link UI (helper is ready; future follow-up)
- pull-prod-to-dev automation / scheduling
- Sutras list perf (pre-existing) and etymology test (pre-existing)

## Status

All 6 changes are pre-written (3 modified, 1 new helper + 1 new test, 1 untracked script) and exist on the working tree. This plan is a commit-by-commit review-and-ship, not a from-scratch implementation.
