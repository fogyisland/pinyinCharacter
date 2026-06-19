# Brush Worksheet System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brush (毛笔) worksheet system — 2 new OFL brush fonts (Ma Shan Zheng + Long Cang), a 12/24/28 char-per-page mode that replaces paper size when 毛笔格 is selected, larger brush cells (200/150/120 px), font auto-pick by cell style, and required title on the Random tab.

**Architecture:** Extend G2's existing font pipeline (`scripts/fonts/`) for 2 new brush fonts. Widen the `FontFamily` union (7→9) and `PaperSize` union (3→6) in `lib/worksheet-types.ts`. Add a `BrushModePicker` component shown conditionally by `PaperSizePicker` when `cellStyle === 'brush'`. Render brush cells at larger sizes via a `cellSizeFor()` helper. Auto-pick font by cell style via a `defaultFontFor()` helper. Surface a required title input on `RandomTab`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind v4, vitest + @testing-library/react, subset-font@2.5.0, MySQL 5.7, Prisma-free raw mysql2.

## Global Constraints

- **2 new OFL brush fonts only**: `Ma Shan Zheng` (毛笔正书) and `Long Cang` (草书). Both from github.com/google/fonts, OFL 1.1. No more.
- **`FontFamily` grows 7 → 9**: 3 system + 4 hard-pen (G2) + 2 brush (G3). The new `group` value is `'brush'`.
- **`PaperSize` grows 3 → 6**: `'A3' | 'A4' | 'B5' | 'brush-12' | 'brush-24' | 'brush-28'`. New values are brush-mode-only and used when `cellStyle === 'brush'`.
- **Brush cells: 200 / 150 / 120 px by mode** (12 / 24 / 28). Non-brush cells stay at 80 px (G2 default).
- **DB migration is non-destructive**: `ALTER TABLE worksheets MODIFY paper_size ENUM(...)` — all existing values remain valid under the new enum. Apply to both `piyin` (prod) and `piyin_dev` (dev).
- **Reuse G2's subset pipeline** (`scripts/fonts/`). No new npm dependencies. No new fonts pipeline scripts — just extend the existing `FONTS` and `TARGETS` arrays in the download + subset scripts.
- **`validateWorksheetInput` widens** to guard `paperSize` (currently unguarded; only `cellStyle` was guarded). **And** `lib/validators.ts` `saveWorksheetSchema` widens to match.
- **Test discipline**: TDD for every logic change (lib + components). Asset-only tasks (font pipeline, OFL.txt) are not TDD but use the same integration test pattern from G2.
- **Project convention**: main branch, no feature branch. One commit per task.
- **Dev server pinned to port 4444**. Never run `pnpm build` while `pnpm dev` is alive on 4444 (corrupts `.next/`).
- **Chinese labels**: `'毛笔字体'` (picker group), `'毛笔格'`, `'12 字 · 毛笔'`, `'请先填写字帖标题'` (validation message), `'马善政体 (毛笔正书)'` (font label), `'龙藏体 (草书)'` (font label).
- **No new pinyin / 注音 / 部首 annotations** on worksheets (user retracted).
- **No new brush cell-style visual guides** — brush mode reuses the existing `brush` cell style SVG (border + vertical + diagonals).

---

## File Structure

### New files
- `components/worksheet/BrushModePicker.tsx` — 3-button picker for `brush-12` / `brush-24` / `brush-28`.
- `components/worksheet/BrushModePicker.test.tsx` — render + onChange + selected-state tests.
- `scripts/migrations/2026-06-19-brush-paper-size.sql` — `ALTER TABLE worksheets MODIFY paper_size ENUM(...)`.
- `public/fonts/OFL-ma-shan-zheng.txt` — OFL 1.1 for Ma Shan Zheng (copied from upstream).
- `public/fonts/OFL-long-cang.txt` — OFL 1.1 for Long Cang (copied from upstream).
- `public/fonts/ma-shan-zheng.woff2` — subset WOFF2 output (produced by `pnpm fonts:subset` on network host).
- `public/fonts/long-cang.woff2` — subset WOFF2 output (produced by `pnpm fonts:subset` on network host).

### Modified files
- `scripts/fonts/download-hard-pen-fonts.ts` — add 2 brush font entries to `FONTS` array.
- `scripts/fonts/subset-hard-pen-fonts.mjs` — add 2 entries to `TARGETS` array.
- `scripts/fonts/copy-ofl.ts` — add 2 font entries to copy list.
- `app/globals.css` — add 2 `@font-face` blocks + 2 tokens to `@theme` and `:root`; add 3 `.worksheet-grid--brush-NN` grid classes.
- `THIRD_PARTY_LICENSES.md` — add 2 brush font entries.
- `lib/worksheet-types.ts` — extend `FontFamily` union (add 2 values), extend `FONT_FAMILIES` (add 2 entries), extend `PaperSize` union (add 3 values), extend `PAPER_SIZES` (add 3 entries), add `BRUSH_PAPER_SIZES` const + `BrushPaperSize` type + `isBrushSize()` predicate, add `defaultFontFor()` helper, extend `validateWorksheetInput` to guard `paperSize`.
- `lib/worksheet-page-count.ts` — extend `CELLS_PER_PAGE` map with `brush-12/24/28: 12/24/28`.
- `lib/validators.ts` — extend `saveWorksheetSchema` `paperSize` enum to include 3 new values; extend `fontFamily` enum to include 7 new values (the 4 hard-pen from G2 weren't in the schema either; extend the schema to all 9).
- `scripts/init-db.ts` — widen `paper_size` column declaration to 6 values.
- `components/worksheet/PaperSizePicker.tsx` — accept `cellStyle` prop; render `<BrushModePicker>` when `cellStyle === 'brush'`, A3/A4/B5 radios otherwise.
- `components/worksheet/RandomTab.tsx` — add `title` and `onTitleChange` props; add required title input above the count/difficulty grid; guard `handleGenerate` with `title.trim() === ''` check.
- `components/worksheet/WorksheetGenerator.tsx` — change `setCellStyle` handler to `handleCellStyleChange` (auto-flip paper size + auto-pick font); change initial `fontFamily` state to `defaultFontFor('brush')`; pass `title`/`onTitleChange` to `<RandomTab>`.
- `components/worksheet/WorksheetCell.tsx` — replace fixed `fontSize={60}` with `Math.round(size * 0.6)`.
- `components/worksheet/WorksheetPreview.tsx` — add `cellSizeFor()` helper; pass `size={cellSizeFor(paperSize)}` to each `<WorksheetCell>`.
- `components/worksheet/FontFamilyPicker.tsx` — add `{ key: 'brush', label: '毛笔字体' }` to `GROUPS` constant.
- `tests/unit/lib/worksheet-types.test.ts` — update existing 4 tests for 9 fonts + 3 groups; add `defaultFontFor` tests; add `isBrushSize` tests; add `validateWorksheetInput` paperSize guard tests.
- `tests/unit/lib/worksheet-page-count.test.ts` — add brush mode tests.
- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` — update from 7 to 9 options, 3 optgroups.
- `tests/unit/components/worksheet/PaperSizePicker.test.tsx` (NEW) — render tests for both A3/A4/B5 and brush modes.
- `tests/unit/components/worksheet/RandomTab.test.tsx` — update existing test to pass `title` prop; add empty-title-blocks-generate test.

### Untouched (verified)
- `app/api/worksheets/route.ts` — uses `saveWorksheetSchema` (extended) + `validateWorksheetInput` (extended). No route-shape change.
- `app/api/chars/random/route.ts` — unchanged. Random tab still calls this.
- `app/worksheet/new/page.tsx` and `app/worksheet/[id]/page.tsx` — unchanged. They consume `Worksheet` and `WorksheetPreview` which handle the new types.
- `app/worksheet/history/page.tsx` — unchanged. Lists worksheets; the new `paper_size` values flow through `cellStyleLabel()` etc.

---

## Tasks

### Task 1: Brush font pipeline + assets (download, subset, copy OFL, license doc, @font-face, tokens)

**Files:**
- Modify: `scripts/fonts/download-hard-pen-fonts.ts` (add 2 `FONTS` entries)
- Modify: `scripts/fonts/subset-hard-pen-fonts.mjs` (add 2 `TARGETS` entries)
- Modify: `scripts/fonts/copy-ofl.ts` (add 2 font entries)
- Modify: `app/globals.css` (add 2 `@font-face` blocks + 2 tokens)
- Modify: `THIRD_PARTY_LICENSES.md` (add 2 entries)
- Create: `public/fonts/OFL-ma-shan-zheng.txt` (committed asset)
- Create: `public/fonts/OFL-long-cang.txt` (committed asset)
- Create: `public/fonts/ma-shan-zheng.woff2` (committed asset — produced by `pnpm fonts:subset` on a network host)
- Create: `public/fonts/long-cang.woff2` (committed asset — same)

**Interfaces:**
- Consumes: existing G2 download + subset + OFL-copy scripts (unchanged APIs).
- Produces: 2 new WOFF2 files in `public/fonts/`, 2 new OFL.txt files, 2 new @font-face declarations, 2 new Tailwind/font tokens.

**Asset-only task** — no new automated test (the existing `tests/unit/scripts/fonts/subset-hard-pen-fonts.test.mjs` from G2 covers the subset script's SKIP-when-missing behavior; both new fonts follow the same pattern).

- [ ] **Step 1: Add 2 brush fonts to `download-hard-pen-fonts.ts`**

Open `scripts/fonts/download-hard-pen-fonts.ts`. In the `FONTS` array (after the existing 4 entries), add 2 entries. Use the **same pattern** as the existing entries (FontEntry shape, urls array, label):

```ts
{
  filename: 'MaShanZheng-Regular.ttf',
  urls: [
    'https://github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf',
  ],
  label: 'Ma Shan Zheng (马善政体)',
},
{
  filename: 'LongCang-Regular.ttf',
  urls: [
    'https://github.com/google/fonts/raw/main/ofl/longcang/LongCang-Regular.ttf',
  ],
  label: 'Long Cang (龙藏体)',
},
```

- [ ] **Step 2: Add 2 brush fonts to `subset-hard-pen-fonts.mjs`**

Open `scripts/fonts/subset-hard-pen-fonts.mjs`. In the `TARGETS` array (after the existing 4 entries), add:

```js
{ in: 'MaShanZheng-Regular.ttf', out: 'ma-shan-zheng.woff2' },
{ in: 'LongCang-Regular.ttf',    out: 'long-cang.woff2' },
```

- [ ] **Step 3: Add 2 brush fonts to `copy-ofl.ts`**

Open `scripts/fonts/copy-ofl.ts`. The exact API depends on G2's existing implementation — read it first, then add 2 entries in the same shape:

- For `Ma Shan Zheng`: copy `OFL.txt` from the upstream directory (the OFL.txt ships next to the .ttf at `github.com/google/fonts/raw/main/ofl/mashanzheng/OFL.txt`) into `public/fonts/OFL-ma-shan-zheng.txt`.
- For `Long Cang`: copy `OFL.txt` from `github.com/google/fonts/raw/main/ofl/longcang/OFL.txt` into `public/fonts/OFL-long-cang.txt`.

(If the copy script uses a different convention — e.g., downloads via fetch — follow the same convention. The 4 G2 hard-pen OFL.txt files are already in `public/fonts/`, named `LXGWWenKaiGB-Regular.OFL.txt` etc. To stay consistent, name the new ones `MaShanZheng-Regular.OFL.txt` and `LongCang-Regular.OFL.txt`. **If the existing convention is the .OFL.txt suffix, use that — match the existing pattern, do not invent a new convention.**)

- [ ] **Step 4: Add 2 `@font-face` blocks to `globals.css`**

Open `app/globals.css`. Find the existing hard-pen `@font-face` blocks (around line 161-189, the 4 blocks for LXGW WenKai GB, Yozai, Iansui, Zen Kaku Gothic New). Add 2 more blocks AFTER them, in the same shape:

```css
@font-face {
  font-family: 'MaShanZheng';
  src: url('/fonts/ma-shan-zheng.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'LongCang';
  src: url('/fonts/long-cang.woff2') format('woff2');
  font-display: swap;
}
```

- [ ] **Step 5: Add 2 font tokens to `@theme` and `:root`**

In `app/globals.css`, find the `--font-lxgw-wenkai-gb` token inside the `@theme { ... }` block (line 23). Add 2 more entries in the same group:

```css
/* Brush fonts (Plan G3) */
--font-ma-shan-zheng: 'MaShanZheng', serif;
--font-long-cang: 'LongCang', serif;
```

Then find the matching tokens in the `:root { ... }` block (lines 134-137). Add 2 more in the same shape:

```css
--font-ma-shan-zheng: 'MaShanZheng', serif;
--font-long-cang: 'LongCang', serif;
```

- [ ] **Step 6: Add 2 entries to `THIRD_PARTY_LICENSES.md`**

Open `THIRD_PARTY_LICENSES.md`. After the existing 4 hard-pen entries, add 2 new sections following the same shape (Upstream URL, Copyright, License):

```markdown
## Ma Shan Zheng (马善政体)
- Upstream: https://github.com/google/fonts/tree/main/ofl/mashanzheng
- Copyright: © 2024 The Ma Shan Zheng Project Authors.
- License: SIL OFL 1.1

## Long Cang (龙藏体)
- Upstream: https://github.com/google/fonts/tree/main/ofl/longcang
- Copyright: © 2024 The Long Cang Project Authors.
- License: SIL OFL 1.1
```

(Adjust the © year + author strings by reading the actual OFL.txt content for each font — these are educated defaults; the OFL.txt is the source of truth.)

- [ ] **Step 7: Produce the WOFF2 + OFL.txt assets on a network host**

This step requires network access. The CI sandbox has no network (G2 task 6 verified this). The human must run the pipeline on a network-available host:

```bash
pnpm fonts:download-hard-pen     # adds 2 brush fonts to scripts/fonts/staging/
pnpm fonts:subset                 # subsets all 6 fonts to public/fonts/*.woff2
pnpm fonts:copy-ofl               # copies OFL.txt files (if script exists; otherwise manually copy)
```

Expected: 6 `[subset] OK` lines (4 existing + 2 new), 2 new OFL.txt files in `public/fonts/`. **If running locally with no network, the existing 4 fonts subset normally and the 2 new fonts are SKIPped — that's acceptable for tsc + tests, but the WOFF2 files are MISSING for the browser smoke.**

The plan-doc task is complete when the 2 source entries are added (Steps 1-3 + 4-6) — the WOFF2 outputs (Step 7) can be generated later by the human on a network host. The implementer should still attempt Step 7 locally; if it SKIPs, that's documented in the task report.

- [ ] **Step 8: Commit**

```bash
git add scripts/fonts/download-hard-pen-fonts.ts \
        scripts/fonts/subset-hard-pen-fonts.mjs \
        scripts/fonts/copy-ofl.ts \
        app/globals.css \
        THIRD_PARTY_LICENSES.md \
        public/fonts/ma-shan-zheng.woff2 \
        public/fonts/long-cang.woff2 \
        public/fonts/OFL-ma-shan-zheng.txt \
        public/fonts/OFL-long-cang.txt
git commit -m "feat(worksheet): add 2 OFL brush fonts (Ma Shan Zheng + Long Cang)"
```

(Note: if Step 7 SKipped and the WOFF2 files weren't produced, omit them from the `git add` — the commit only includes what's on disk.)

---

### Task 2: Extend FontFamily union + FONT_FAMILIES + FontFamilyPicker (TDD)

**Files:**
- Modify: `lib/worksheet-types.ts` (extend `FontFamily` union + `FONT_FAMILIES` array)
- Modify: `components/worksheet/FontFamilyPicker.tsx` (extend `GROUPS` constant)
- Modify: `tests/unit/lib/worksheet-types.test.ts` (update existing 4 tests for 9 fonts + 3 groups)
- Modify: `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` (update from 7 to 9 options, 3 optgroups)

**Interfaces:**
- Consumes: existing `FontFamily` union (7 values) and `FONT_FAMILIES` array (7 entries).
- Produces: extended `FontFamily` union (9 values) and `FONT_FAMILIES` array (9 entries with `group: 'system' | 'hard-pen' | 'brush'`). The picker shows 3 `<optgroup>`s.

- [ ] **Step 1: Update `FontFamily` union and `FONT_FAMILIES` in `worksheet-types.ts`**

Open `lib/worksheet-types.ts`. Change the `FontFamily` type (around line 5-7) to add the 2 new values:

```ts
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin'
  | 'ma-shan-zheng' | 'long-cang';
```

In the `FONT_FAMILIES` array (around line 46-59), change the `group` field type to include `'brush'`:

```ts
export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen' | 'brush';
}[] = [
  // existing 7 entries unchanged
  { value: 'song',          label: '宋体',         cssVar: 'var(--font-han-serif)',         group: 'system' },
  { value: 'kai',           label: '楷体',         cssVar: 'var(--font-wenkai)',            group: 'system' },
  { value: 'hei',           label: '黑体',         cssVar: 'var(--font-han-sans)',          group: 'system' },
  { value: 'wenkai-gb',     label: '霞鹜文楷 GB',  cssVar: 'var(--font-lxgw-wenkai-gb)',    group: 'hard-pen' },
  { value: 'yozai',         label: '悠哉',         cssVar: 'var(--font-yozai)',             group: 'hard-pen' },
  { value: 'iansui',        label: '芫荽',         cssVar: 'var(--font-iansui)',            group: 'hard-pen' },
  { value: 'zen-kaku-thin', label: '思源极细黑',   cssVar: 'var(--font-zen-kaku-thin)',     group: 'hard-pen' },
  // NEW brush group (G3)
  { value: 'ma-shan-zheng', label: '马善政体 (毛笔正书)', cssVar: 'var(--font-ma-shan-zheng)', group: 'brush' },
  { value: 'long-cang',     label: '龙藏体 (草书)',       cssVar: 'var(--font-long-cang)',      group: 'brush' },
];
```

- [ ] **Step 2: Update `tests/unit/lib/worksheet-types.test.ts`**

Update the 4 existing tests to reflect 9 entries / 3 groups. The new test (after the existing 4) checks the brush group is present:

```ts
import { describe, it, expect } from 'vitest';
import { FONT_FAMILIES, fontFamilyLabel, fontFamilyCssVar } from '@/lib/worksheet-types';
import type { FontFamily } from '@/lib/worksheet-types';

describe('FONT_FAMILIES (G3)', () => {
  it('has 9 entries: 3 system + 4 hard-pen + 2 brush', () => {
    expect(FONT_FAMILIES).toHaveLength(9);
  });

  it('groups entries by system, hard-pen, or brush', () => {
    const groups = new Set(FONT_FAMILIES.map((f) => f.group));
    expect(groups).toEqual(new Set(['system', 'hard-pen', 'brush']));
    const system = FONT_FAMILIES.filter((f) => f.group === 'system').map((f) => f.value);
    const hardPen = FONT_FAMILIES.filter((f) => f.group === 'hard-pen').map((f) => f.value);
    const brush = FONT_FAMILIES.filter((f) => f.group === 'brush').map((f) => f.value);
    expect(system).toEqual(['song', 'kai', 'hei']);
    expect(hardPen).toEqual(['wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin']);
    expect(brush).toEqual(['ma-shan-zheng', 'long-cang']);
  });

  it('covers the FontFamily union', () => {
    const values = new Set(FONT_FAMILIES.map((f) => f.value));
    const expected: FontFamily[] = [
      'song', 'kai', 'hei',
      'wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin',
      'ma-shan-zheng', 'long-cang',
    ];
    for (const e of expected) expect(values.has(e)).toBe(true);
  });

  it('label/cssVar lookups still work for all 9 values', () => {
    for (const f of FONT_FAMILIES) {
      expect(fontFamilyLabel(f.value)).toBe(f.label);
      expect(fontFamilyCssVar(f.value)).toBe(f.cssVar);
    }
  });
});
```

(The old test file had `(G2)` in describe — change to `(G3)` to reflect the new state.)

- [ ] **Step 3: Run worksheet-types test to verify it fails (now it should pass — but the test that fails is the FontFamilyPicker one in Step 5)**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: 4/4 pass (the FONT_FAMILIES table is in sync with the new union). The test file itself is updated to match the new state.

- [ ] **Step 4: Update `GROUPS` in `FontFamilyPicker.tsx`**

Open `components/worksheet/FontFamilyPicker.tsx`. Change the `GROUPS` constant (around line 11-14) to include the brush group:

```ts
const GROUPS = [
  { key: 'system',   label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
  { key: 'brush',    label: '毛笔字体' },
] as const;
```

The existing `FONT_FAMILIES.filter((f) => f.group === g.key)` loop (line 25) automatically picks up the 2 new brush fonts — no other code change.

- [ ] **Step 5: Update `tests/unit/components/worksheet/FontFamilyPicker.test.tsx`**

Update the existing 5 tests to expect 3 optgroups and 9 options:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontFamilyPicker } from '@/components/worksheet/FontFamilyPicker';

describe('FontFamilyPicker', () => {
  it('renders a <select> with 3 <optgroup>s: 系统字体, 硬笔字体, 毛笔字体', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const select = container.querySelector('select');
    expect(select).toBeInTheDocument();
    const groups = container.querySelectorAll('optgroup');
    expect(groups).toHaveLength(3);
    expect(groups[0]?.getAttribute('label')).toBe('系统字体');
    expect(groups[1]?.getAttribute('label')).toBe('硬笔字体');
    expect(groups[2]?.getAttribute('label')).toBe('毛笔字体');
  });

  it('renders 9 <option>s: 3 system + 4 hard-pen + 2 brush', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(9);
    const systemOptions = container.querySelectorAll('optgroup:nth-of-type(1) > option');
    const hardPenOptions = container.querySelectorAll('optgroup:nth-of-type(2) > option');
    const brushOptions = container.querySelectorAll('optgroup:nth-of-type(3) > option');
    expect(systemOptions).toHaveLength(3);
    expect(hardPenOptions).toHaveLength(4);
    expect(brushOptions).toHaveLength(2);
  });

  it('marks the current value as the selected option', () => {
    const { container } = render(<FontFamilyPicker value="yozai" onChange={vi.fn()} />);
    const select = container.querySelector('select')!;
    expect((select as HTMLSelectElement).value).toBe('yozai');
    const selected = container.querySelector('option[value="yozai"]');
    expect(selected?.getAttribute('value')).toBe('yozai');
  });

  it('calls onChange with the picked FontFamily', () => {
    const onChange = vi.fn();
    const { container } = render(<FontFamilyPicker value="song" onChange={onChange} />);
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'wenkai-gb' } });
    expect(onChange).toHaveBeenCalledWith('wenkai-gb');
  });

  it('shows brush font labels (马善政体 for ma-shan-zheng, 龙藏体 for long-cang)', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const m1 = container.querySelector('option[value="ma-shan-zheng"]');
    const m2 = container.querySelector('option[value="long-cang"]');
    expect(m1?.textContent).toBe('马善政体 (毛笔正书)');
    expect(m2?.textContent).toBe('龙藏体 (草书)');
  });
});
```

- [ ] **Step 6: Run FontFamilyPicker test to verify it fails, then update code, then re-run**

Run: `pnpm test tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
Expected: FAIL — the picker currently has 2 optgroups and 7 options; the test now expects 3 and 9. The previous test file (G2) had `toHaveLength(2)` and `toHaveLength(7)`. The new test file has `toHaveLength(3)` and `toHaveLength(9)`. The test was already updated in Step 5; the implementation is already updated in Step 4. Re-run to confirm it passes.

Re-run: `pnpm test tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
Expected: 5/5 pass.

- [ ] **Step 7: Commit**

```bash
git add lib/worksheet-types.ts \
        components/worksheet/FontFamilyPicker.tsx \
        tests/unit/lib/worksheet-types.test.ts \
        tests/unit/components/worksheet/FontFamilyPicker.test.tsx
git commit -m "feat(worksheet): extend FontFamily to 9 (add brush group)"
```

---

### Task 3: Widen PaperSize union + isBrushSize + cellsPerPage (TDD)

**Files:**
- Modify: `lib/worksheet-types.ts` (extend `PaperSize` union, `PAPER_SIZES` array, add `BRUSH_PAPER_SIZES` const + `BrushPaperSize` type + `isBrushSize()` predicate)
- Modify: `lib/worksheet-page-count.ts` (extend `CELLS_PER_PAGE` map)
- Modify: `tests/unit/lib/worksheet-page-count.test.ts` (add brush mode tests)
- Modify: `tests/unit/lib/worksheet-types.test.ts` (add `isBrushSize` + `BrushPaperSize` tests)

**Interfaces:**
- Consumes: existing `PaperSize` union (3 values), `PAPER_SIZES` array (3 entries), `cellsPerPage()` function.
- Produces: extended `PaperSize` union (6 values), `PAPER_SIZES` array (6 entries), `BRUSH_PAPER_SIZES` tuple, `BrushPaperSize` type, `isBrushSize()` type predicate, `cellsPerPage('brush-12')` returns 12 etc.

- [ ] **Step 1: Write failing test for `cellsPerPage` brush modes**

Open `tests/unit/lib/worksheet-page-count.test.ts`. Add a new `describe` block at the end:

```ts
describe('cellsPerPage (G3 brush modes)', () => {
  it('returns 12 for brush-12', () => {
    expect(cellsPerPage('brush-12')).toBe(12);
  });
  it('returns 24 for brush-24', () => {
    expect(cellsPerPage('brush-24')).toBe(24);
  });
  it('returns 28 for brush-28', () => {
    expect(cellsPerPage('brush-28')).toBe(28);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/lib/worksheet-page-count.test.ts`
Expected: FAIL — `'brush-12'`, `'brush-24'`, `'brush-28'` are not in `PaperSize` union, so `cellsPerPage` won't accept them.

- [ ] **Step 3: Extend `PaperSize` union + `PAPER_SIZES` + brush types in `worksheet-types.ts`**

Open `lib/worksheet-types.ts`. Change the `PaperSize` type (line 4):

```ts
export type PaperSize = 'A3' | 'A4' | 'B5' | 'brush-12' | 'brush-24' | 'brush-28';
```

Add the brush types/predicate after the `FONT_FAMILIES` array (around line 60, before `paperSizeLabel`):

```ts
export const BRUSH_PAPER_SIZES = ['brush-12', 'brush-24', 'brush-28'] as const;
export type BrushPaperSize = typeof BRUSH_PAPER_SIZES[number];

export function isBrushSize(p: PaperSize): p is BrushPaperSize {
  return (BRUSH_PAPER_SIZES as readonly string[]).includes(p);
}
```

Extend the `PAPER_SIZES` array (line 40-44) to include 3 new entries:

```ts
export const PAPER_SIZES: { value: PaperSize; label: string; cols: number; cellsPerPage: number }[] = [
  { value: 'A3',       label: 'A3 · 大',       cols: 12, cellsPerPage: cellsPerPage('A3') },
  { value: 'A4',       label: 'A4 · 标准',     cols: 8,  cellsPerPage: cellsPerPage('A4') },
  { value: 'B5',       label: 'B5 · 小',       cols: 6,  cellsPerPage: cellsPerPage('B5') },
  { value: 'brush-12', label: '12 字 · 毛笔',  cols: 4,  cellsPerPage: 12 },
  { value: 'brush-24', label: '24 字 · 毛笔',  cols: 6,  cellsPerPage: 24 },
  { value: 'brush-28', label: '28 字 · 毛笔',  cols: 7,  cellsPerPage: 28 },
];
```

- [ ] **Step 4: Extend `CELLS_PER_PAGE` map in `worksheet-page-count.ts`**

Open `lib/worksheet-page-count.ts`. Change the `CELLS_PER_PAGE` const (line 3-7) to include 3 new entries:

```ts
const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 132,
  A4: 88,
  B5: 60,
  'brush-12': 12,
  'brush-24': 24,
  'brush-28': 28,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-page-count.test.ts`
Expected: 9/9 pass (3 existing describe blocks + 1 new with 3 tests).

- [ ] **Step 6: Write failing test for `isBrushSize` and `BRUSH_PAPER_SIZES`**

Open `tests/unit/lib/worksheet-types.test.ts`. Add a new `describe` block at the end of the file:

```ts
import { BRUSH_PAPER_SIZES, isBrushSize } from '@/lib/worksheet-types';

describe('isBrushSize + BRUSH_PAPER_SIZES (G3)', () => {
  it('BRUSH_PAPER_SIZES contains the 3 brush values in order', () => {
    expect(BRUSH_PAPER_SIZES).toEqual(['brush-12', 'brush-24', 'brush-28']);
  });

  it('isBrushSize returns true for brush modes', () => {
    expect(isBrushSize('brush-12')).toBe(true);
    expect(isBrushSize('brush-24')).toBe(true);
    expect(isBrushSize('brush-28')).toBe(true);
  });

  it('isBrushSize returns false for A3/A4/B5', () => {
    expect(isBrushSize('A3')).toBe(false);
    expect(isBrushSize('A4')).toBe(false);
    expect(isBrushSize('B5')).toBe(false);
  });
});
```

(Add the `import` to the existing imports at the top of the file.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: 4 (existing FONT_FAMILIES) + 3 (isBrushSize) = 7 tests pass. The implementation is already in place from Step 3.

- [ ] **Step 8: Commit**

```bash
git add lib/worksheet-types.ts \
        lib/worksheet-page-count.ts \
        tests/unit/lib/worksheet-page-count.test.ts \
        tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): widen paper_size to 6 + brush type predicate + brush cellsPerPage"
```

---

### Task 4: BrushModePicker component (TDD)

**Files:**
- Create: `components/worksheet/BrushModePicker.tsx`
- Create: `tests/unit/components/worksheet/BrushModePicker.test.tsx`

**Interfaces:**
- Consumes: `BrushPaperSize` type from `lib/worksheet-types`.
- Produces: a 3-button picker component (`<button>` row) for `brush-12` / `brush-24` / `brush-28`. Visual pattern: same as `PaperSizePicker` A3/A4/B5 radios, but using buttons instead of radios (per the spec).

- [ ] **Step 1: Write failing test for `BrushModePicker`**

Create `tests/unit/components/worksheet/BrushModePicker.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrushModePicker } from '@/components/worksheet/BrushModePicker';

describe('BrushModePicker', () => {
  it('renders 3 buttons: 12 字, 24 字, 28 字', () => {
    render(<BrushModePicker value="brush-12" onChange={vi.fn()} />);
    expect(screen.getByText('12 字')).toBeInTheDocument();
    expect(screen.getByText('24 字')).toBeInTheDocument();
    expect(screen.getByText('28 字')).toBeInTheDocument();
  });

  it('marks the current value with the selected style (border-seal + bg-seal/10)', () => {
    const { container } = render(<BrushModePicker value="brush-24" onChange={vi.fn()} />);
    const selectedBtn = screen.getByText('24 字').closest('button')!;
    expect(selectedBtn.className).toContain('border-seal');
    expect(selectedBtn.className).toContain('bg-seal/10');
    expect(selectedBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('non-selected buttons do not have the selected style', () => {
    render(<BrushModePicker value="brush-12" onChange={vi.fn()} />);
    const otherBtn = screen.getByText('24 字').closest('button')!;
    expect(otherBtn.className).not.toContain('border-seal');
    expect(otherBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange with the picked brush mode when a button is clicked', () => {
    const onChange = vi.fn();
    render(<BrushModePicker value="brush-12" onChange={onChange} />);
    fireEvent.click(screen.getByText('28 字'));
    expect(onChange).toHaveBeenCalledWith('brush-28');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/BrushModePicker.test.tsx`
Expected: FAIL — `components/worksheet/BrushModePicker.tsx` does not exist; import throws "Cannot find module".

- [ ] **Step 3: Write the `BrushModePicker` component**

Create `components/worksheet/BrushModePicker.tsx`:

```tsx
'use client';
import type { BrushPaperSize } from '@/lib/worksheet-types';

const MODES: { value: BrushPaperSize; label: string; hint: string }[] = [
  { value: 'brush-12', label: '12 字', hint: '每页大字练习' },
  { value: 'brush-24', label: '24 字', hint: '每页中字练习' },
  { value: 'brush-28', label: '28 字', hint: '每页小字练习' },
];

interface Props {
  value: BrushPaperSize;
  onChange: (v: BrushPaperSize) => void;
}

export function BrushModePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => {
        const selected = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            aria-pressed={selected}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              selected
                ? 'border-seal bg-seal/10 text-seal font-medium'
                : 'border-ink/20 hover:bg-paper-deep'
            }`}
          >
            {m.label}
            <span className="ml-1 text-xs text-ink-faint">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/BrushModePicker.test.tsx`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add components/worksheet/BrushModePicker.tsx \
        tests/unit/components/worksheet/BrushModePicker.test.tsx
git commit -m "feat(worksheet): BrushModePicker (12/24/28 char modes)"
```

---

### Task 5: PaperSizePicker conditional (TDD)

**Files:**
- Modify: `components/worksheet/PaperSizePicker.tsx` (extend to accept `cellStyle`, branch on it)
- Create: `tests/unit/components/worksheet/PaperSizePicker.test.tsx`

**Interfaces:**
- Consumes: `CellStyle` + `PaperSize` types, `BrushModePicker` component, `isBrushSize()` predicate.
- Produces: When `cellStyle === 'brush'`, render `<BrushModePicker>`. Otherwise render the existing A3/A4/B5 radio group. Defensive narrowing for `value` not being a brush size when `cellStyle === 'brush'`.

- [ ] **Step 1: Write failing test for `PaperSizePicker` conditional rendering**

Create `tests/unit/components/worksheet/PaperSizePicker.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaperSizePicker } from '@/components/worksheet/PaperSizePicker';

describe('PaperSizePicker (G3)', () => {
  describe('non-brush cell styles', () => {
    it('renders A3, A4, B5 radios when cellStyle is "square"', () => {
      render(<PaperSizePicker value="A4" cellStyle="square" onChange={vi.fn()} />);
      expect(screen.getByText(/A3/)).toBeInTheDocument();
      expect(screen.getByText(/A4/)).toBeInTheDocument();
      expect(screen.getByText(/B5/)).toBeInTheDocument();
    });

    it('does NOT render brush mode buttons when cellStyle is "pen"', () => {
      render(<PaperSizePicker value="A4" cellStyle="pen" onChange={vi.fn()} />);
      expect(screen.queryByText('12 字')).not.toBeInTheDocument();
      expect(screen.queryByText('24 字')).not.toBeInTheDocument();
      expect(screen.queryByText('28 字')).not.toBeInTheDocument();
    });
  });

  describe('brush cell style', () => {
    it('renders 3 brush mode buttons when cellStyle is "brush"', () => {
      render(<PaperSizePicker value="brush-12" cellStyle="brush" onChange={vi.fn()} />);
      expect(screen.getByText('12 字')).toBeInTheDocument();
      expect(screen.getByText('24 字')).toBeInTheDocument();
      expect(screen.getByText('28 字')).toBeInTheDocument();
    });

    it('does NOT render A3/A4/B5 radios when cellStyle is "brush"', () => {
      render(<PaperSizePicker value="brush-12" cellStyle="brush" onChange={vi.fn()} />);
      expect(screen.queryByText(/A3 ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/A4 ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/B5 ·/)).not.toBeInTheDocument();
    });

    it('calls onChange with the picked brush size', () => {
      const onChange = vi.fn();
      render(<PaperSizePicker value="brush-12" cellStyle="brush" onChange={onChange} />);
      fireEvent.click(screen.getByText('24 字'));
      expect(onChange).toHaveBeenCalledWith('brush-24');
    });

    it('defensively falls back to brush-12 if value is not a brush size', () => {
      const onChange = vi.fn();
      render(<PaperSizePicker value="A4" cellStyle="brush" onChange={onChange} />);
      // Should self-heal: emits onChange('brush-12') and renders 12 字 as selected
      expect(onChange).toHaveBeenCalledWith('brush-12');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/PaperSizePicker.test.tsx`
Expected: FAIL — current `PaperSizePicker` does not accept `cellStyle` prop; TypeScript compile error in the test file.

- [ ] **Step 3: Update `PaperSizePicker.tsx` to accept `cellStyle` and branch**

Open `components/worksheet/PaperSizePicker.tsx`. Replace the entire file with:

```tsx
'use client';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES, isBrushSize } from '@/lib/worksheet-types';
import { BrushModePicker } from './BrushModePicker';

interface Props {
  value: PaperSize;
  cellStyle: CellStyle;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, cellStyle, onChange }: Props) {
  if (cellStyle === 'brush') {
    if (!isBrushSize(value)) {
      // Defensive: value should always be a brush size when cellStyle='brush',
      // because WorksheetGenerator's handleCellStyleChange auto-flips paper size
      // on cell-style change. If we land here, the parent forgot — self-heal.
      onChange('brush-12');
      return <BrushModePicker value="brush-12" onChange={onChange} />;
    }
    return <BrushModePicker value={value} onChange={onChange} />;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {PAPER_SIZES.filter((p) => !isBrushSize(p.value)).map((p) => (
        <label key={p.value} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="paperSize"
            value={p.value}
            checked={value === p.value}
            onChange={() => onChange(p.value)}
          />
          <span>{p.label} <span className="text-xs text-ink-faint">≈{p.cellsPerPage}字/页</span></span>
        </label>
      ))}
    </div>
  );
}
```

Note: the existing `PAPER_SIZES` array now has 6 entries (3 + 3 brush). The `.filter(p => !isBrushSize(p.value))` keeps the radio group showing only A3/A4/B5. The brush modes go through `BrushModePicker`.

Also: the existing `interface Props` (only `value` + `onChange`) needs the new `cellStyle` prop. **This is a breaking change to the prop signature.** The only consumer of `PaperSizePicker` is `WorksheetGenerator`, which is updated in Task 8.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/PaperSizePicker.test.tsx`
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add components/worksheet/PaperSizePicker.tsx \
        tests/unit/components/worksheet/PaperSizePicker.test.tsx
git commit -m "feat(worksheet): PaperSizePicker renders BrushModePicker when cellStyle='brush'"
```

---

### Task 6: DB migration + init-db + saveWorksheetSchema (TDD)

**Files:**
- Create: `scripts/migrations/2026-06-19-brush-paper-size.sql`
- Modify: `scripts/init-db.ts` (widen `paper_size` column declaration)
- Modify: `lib/validators.ts` (widen `saveWorksheetSchema` `paperSize` enum + `fontFamily` enum)
- Modify: `tests/unit/lib/worksheet-types.test.ts` (add `validateWorksheetInput` paperSize guard tests)

**Interfaces:**
- Consumes: existing DB schema (paper_size ENUM 3 values) + zod schema (paperSize enum 3 values, fontFamily enum 3 values).
- Produces: SQL migration (idempotent ALTER) + updated init-db.ts + widened zod schema (paperSize 6 values, fontFamily 9 values) + 3 new `validateWorksheetInput` tests.

- [ ] **Step 1: Write failing test for `validateWorksheetInput` paperSize guard**

Open `tests/unit/lib/worksheet-types.test.ts`. Add a new `describe` block at the end:

```ts
import { validateWorksheetInput } from '@/lib/worksheet-types';

describe('validateWorksheetInput (G3 paperSize guard)', () => {
  const base = { title: 't', content: ['不'], cellStyle: 'brush' as const };

  it('accepts paperSize brush-12', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-12' });
    expect(r.ok).toBe(true);
  });

  it('accepts paperSize brush-24', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-24' });
    expect(r.ok).toBe(true);
  });

  it('accepts paperSize brush-28', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-28' });
    expect(r.ok).toBe(true);
  });

  it('rejects paperSize "nonsense"', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'nonsense' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/paperSize must be/);
  });
});
```

(Add the `validateWorksheetInput` to the imports at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: FAIL — `validateWorksheetInput` does not currently check `paperSize` at all (it only checks `title`, `content`, `cellStyle`). The "nonsense" test fails first because there's no `paperSize` parameter in the function signature, and the "brush-12/24/28" tests fail because the function doesn't have a `paperSize` field in its result.

- [ ] **Step 3: Extend `validateWorksheetInput` in `worksheet-types.ts`**

Open `lib/worksheet-types.ts`. Find the `ValidationResult` type (line 79-81) and the `validateWorksheetInput` function (line 90-116). Change the function signature and body to accept + validate `paperSize`:

```ts
export type ValidationResult =
  | { ok: true; data: { title: string; content: string[]; cellStyle: CellStyle; paperSize: PaperSize } }
  | { ok: false; error: string };

const VALID_PAPER_SIZES = ['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28'] as const;

export function validateWorksheetInput(input: {
  title: unknown;
  content: unknown;
  cellStyle: unknown;
  paperSize?: unknown;
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
  if (
    input.cellStyle !== 'brush' &&
    input.cellStyle !== 'square' &&
    input.cellStyle !== 'pen' &&
    input.cellStyle !== 'cross'
  ) {
    return { ok: false, error: 'cellStyle must be brush, square, pen, or cross' };
  }
  // paperSize is optional in input but defaults to 'A4' for non-brush; brush defaults to 'brush-12'
  let paperSize: PaperSize;
  if (input.paperSize === undefined) {
    paperSize = input.cellStyle === 'brush' ? 'brush-12' : 'A4';
  } else if (
    typeof input.paperSize === 'string' &&
    (VALID_PAPER_SIZES as readonly string[]).includes(input.paperSize)
  ) {
    paperSize = input.paperSize as PaperSize;
  } else {
    return { ok: false, error: 'paperSize must be A3, A4, B5, brush-12, brush-24, or brush-28' };
  }
  return {
    ok: true,
    data: { title: input.title, content: input.content as string[], cellStyle: input.cellStyle, paperSize },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: 7 (existing) + 4 (new validateWorksheetInput) = 11 tests pass.

- [ ] **Step 5: Create the SQL migration file**

Create `scripts/migrations/2026-06-19-brush-paper-size.sql`:

```sql
-- 2026-06-19: add 'brush-12', 'brush-24', 'brush-28' to worksheets.paper_size enum
-- Idempotent: same column type, just wider. No data loss.
ALTER TABLE worksheets
  MODIFY paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL;
```

- [ ] **Step 6: Update `scripts/init-db.ts` to widen the column declaration**

Open `scripts/init-db.ts`. Find the `paper_size` column declaration for the `worksheets` table (around line 130). Change it to:

```sql
paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL,
```

(If the existing declaration has only 3 values, the wider 6-value version is what fresh inits use.)

- [ ] **Step 7: Update `lib/validators.ts` `saveWorksheetSchema`**

Open `lib/validators.ts`. Find the `saveWorksheetSchema` (lines 40-49). Change it to:

```ts
export const saveWorksheetSchema = z.object({
  title: z.string().min(1).max(80),
  content: z
    .array(z.string().regex(SINGLE_CJK))
    .min(1)
    .max(500),
  cellStyle: z.enum(['brush', 'square', 'pen', 'cross']),
  paperSize: z.enum(['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28']).default('A4'),
  fontFamily: z.enum([
    'song', 'kai', 'hei',
    'wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin',
    'ma-shan-zheng', 'long-cang',
  ]).default('song'),
});
```

The `paperSize` enum widens 3 → 6 (default unchanged). The `fontFamily` enum widens 3 → 9 (default unchanged).

- [ ] **Step 8: Commit**

```bash
git add scripts/migrations/2026-06-19-brush-paper-size.sql \
        scripts/init-db.ts \
        lib/validators.ts \
        lib/worksheet-types.ts \
        tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): widen paper_size to 6 (DB + zod + validateWorksheetInput)"
```

---

### Task 7: Larger brush cells (200/150/120 px) + grid classes

**Files:**
- Modify: `components/worksheet/WorksheetCell.tsx` (replace fixed `fontSize={60}` with `Math.round(size * 0.6)`)
- Modify: `components/worksheet/WorksheetPreview.tsx` (add `cellSizeFor()` helper, pass `size` to `<WorksheetCell>`)
- Modify: `app/globals.css` (add 3 new `.worksheet-grid--brush-NN` classes)

**Interfaces:**
- Consumes: existing `WorksheetCell` `size` prop (default 80), existing `WorksheetPreview` `paperSize` prop.
- Produces: `WorksheetCell` renders the practice char at `size * 0.6` font-size; `WorksheetPreview` passes `cellSizeFor(paperSize)` to each cell; 3 new CSS grid classes for 4/6/7 cols.

- [ ] **Step 1: Update `WorksheetCell` to scale guide font-size with cell size**

Open `components/worksheet/WorksheetCell.tsx`. Find the `<text>` element (around line 31-41). Change the `fontSize={60}` to a computed value:

```tsx
const guideFontSize = Math.round(size * 0.6);

return (
  <svg width={size} height={size} viewBox="0 0 100 100" className="block">
    {/* ... existing guides unchanged ... */}
    <text
      x={50}
      y={50}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={guideFontSize}
      fill={stroke}
      style={{ fontFamily: fontStack }}
    >
      {char}
    </text>
  </svg>
);
```

- [ ] **Step 2: Add `cellSizeFor` helper and use it in `WorksheetPreview`**

Open `components/worksheet/WorksheetPreview.tsx`. Add a helper function (above the `WorksheetPreview` function, or at the top of the file):

```tsx
import type { CellStyle, PaperSize, FontFamily } from '@/lib/worksheet-types';
import { generateLayout, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';
import { PrintButton } from '@/components/common/PrintButton';

function cellSizeFor(p: PaperSize): number {
  switch (p) {
    case 'brush-12': return 200;
    case 'brush-24': return 150;
    case 'brush-28': return 120;
    default:         return 80;   // A3/A4/B5 keep 80px (G2 default)
  }
}
```

Inside the `WorksheetPreview` component (line 26-27), compute `cellSize` and pass it to `<WorksheetCell>`:

```tsx
export function WorksheetPreview(props: Props) {
  const cells = generateLayout(props.content, props.cellStyle);
  const isFormView = 'onBack' in props;
  const sizeClass = `worksheet-grid--${props.paperSize.toLowerCase()}`;
  const cellSize = cellSizeFor(props.paperSize);
  // ... rest unchanged ...
  {cells.map((cell) => (
    <div key={cell.index} className="worksheet-cell">
      <WorksheetCell char={cell.char} style={cell.style} size={cellSize} fontFamily={props.fontFamily} />
    </div>
  ))}
}
```

- [ ] **Step 3: Add 3 new grid classes to `globals.css`**

Open `app/globals.css`. Find the existing `.worksheet-grid--a3/a4/b5` block (lines 110-112). Add 3 more classes right after:

```css
.worksheet-grid--brush-12 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.worksheet-grid--brush-24 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.worksheet-grid--brush-28 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
```

- [ ] **Step 4: Type-check + visually verify in browser**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

(Optional) Run: `pnpm dev` → `http://localhost:4444/worksheet/new` → pick 毛笔格 + 12 字 → preview shows 12 large cells. Switch to 24 → 24 medium cells. Switch to 钢笔格 + A4 → small cells (existing behavior). The smoke is the human's responsibility in Task 10.

- [ ] **Step 5: Commit**

```bash
git add components/worksheet/WorksheetCell.tsx \
        components/worksheet/WorksheetPreview.tsx \
        app/globals.css
git commit -m "feat(worksheet): larger brush cells (200/150/120 px by mode) + 3 new grid classes"
```

---

### Task 8: defaultFontFor + WorksheetGenerator auto-pick wiring (TDD)

**Files:**
- Modify: `lib/worksheet-types.ts` (add `defaultFontFor()` helper)
- Modify: `components/worksheet/WorksheetGenerator.tsx` (change `setCellStyle` to `handleCellStyleChange`, change initial `fontFamily` state)
- Modify: `tests/unit/lib/worksheet-types.test.ts` (add `defaultFontFor` tests)

**Interfaces:**
- Consumes: `CellStyle` + `FontFamily` types.
- Produces: `defaultFontFor(cellStyle)` returns the first font of the matching group; `WorksheetGenerator.handleCellStyleChange` flips `paperSize` and `fontFamily` based on the new cell style.

- [ ] **Step 1: Write failing test for `defaultFontFor`**

Open `tests/unit/lib/worksheet-types.test.ts`. Add a new `describe` block at the end:

```ts
import { defaultFontFor } from '@/lib/worksheet-types';

describe('defaultFontFor (G3)', () => {
  it('returns first brush font for brush', () => {
    expect(defaultFontFor('brush')).toBe('ma-shan-zheng');
  });
  it('returns first hard-pen font for pen', () => {
    expect(defaultFontFor('pen')).toBe('wenkai-gb');
  });
  it('returns first system font for square', () => {
    expect(defaultFontFor('square')).toBe('song');
  });
  it('returns first system font for cross', () => {
    expect(defaultFontFor('cross')).toBe('song');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: FAIL — `defaultFontFor` is not exported from `worksheet-types`.

- [ ] **Step 3: Add `defaultFontFor` to `worksheet-types.ts`**

Open `lib/worksheet-types.ts`. Add the helper next to `isBrushSize` (after the brush types block):

```ts
export function defaultFontFor(cellStyle: CellStyle): FontFamily {
  switch (cellStyle) {
    case 'brush':  return 'ma-shan-zheng';
    case 'pen':    return 'wenkai-gb';
    case 'square': return 'song';
    case 'cross':  return 'song';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: 11 (existing) + 4 (new defaultFontFor) = 15 tests pass.

- [ ] **Step 5: Update `WorksheetGenerator` to use `handleCellStyleChange` and `defaultFontFor`**

Open `components/worksheet/WorksheetGenerator.tsx`. Make these changes:

1. Update the import line (line 5-6) to add `defaultFontFor` and `isBrushSize`:
   ```tsx
   import type { CellStyle, PaperSize, FontFamily } from '@/lib/worksheet-types';
   import { defaultFontFor, isBrushSize, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
   ```

2. Change the initial `fontFamily` state (line 31) to use `defaultFontFor`:
   ```tsx
   const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor('brush'));
   ```

3. Add a `handleCellStyleChange` function inside the component (after the `useEffect` blocks, around line 53):
   ```tsx
   function handleCellStyleChange(next: CellStyle) {
     setCellStyle(next);
     if (next === 'brush' && !isBrushSize(paperSize)) {
       setPaperSize('brush-12');
     } else if (next !== 'brush' && isBrushSize(paperSize)) {
       setPaperSize('A4');
     }
     setFontFamily(defaultFontFor(next));
   }
   ```

4. Change the `<StylePicker>` props (line 160) from `onChange={setCellStyle}` to `onChange={handleCellStyleChange}`:
   ```tsx
   <StylePicker value={cellStyle} onChange={handleCellStyleChange} />
   ```

5. Change the `<PaperSizePicker>` props (line 171) to pass the new `cellStyle` prop:
   ```tsx
   <PaperSizePicker value={paperSize} cellStyle={cellStyle} onChange={setPaperSize} />
   ```

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/worksheet-types.ts \
        components/worksheet/WorksheetGenerator.tsx \
        tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): auto-pick font by cell style + defaultFontFor + handleCellStyleChange"
```

---

### Task 9: Title required on RandomTab (TDD)

**Files:**
- Modify: `components/worksheet/RandomTab.tsx` (add `title` + `onTitleChange` props, add input, guard `handleGenerate`)
- Modify: `components/worksheet/WorksheetGenerator.tsx` (pass `title` + `setTitle` to `<RandomTab>`)
- Modify: `tests/unit/components/worksheet/RandomTab.test.tsx` (update existing test to pass new props, add empty-title-blocks-generate test)

**Interfaces:**
- Consumes: existing `RandomTab` props (`onPicked`); existing `WorksheetGenerator` `title` state.
- Produces: `RandomTab` requires a `title` prop and emits `onTitleChange`. Empty title blocks `handleGenerate` with `请先填写字帖标题` error. `WorksheetGenerator` passes `title` + `setTitle` to `<RandomTab>`.

- [ ] **Step 1: Update `RandomTab` test to use new props + add empty-title test**

Open `tests/unit/components/worksheet/RandomTab.test.tsx`. Replace the entire file:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RandomTab } from '@/components/worksheet/RandomTab';

describe('RandomTab (G3 title required)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { chars: [{ char: '你' }, { char: '好' }] } }),
    }) as any;
  });

  it('renders a title input (必填) above the count/difficulty grid', () => {
    render(<RandomTab title="my sheet" onTitleChange={vi.fn()} onPicked={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText(/给字帖起个名字/);
    expect(titleInput).toBeInTheDocument();
    expect((titleInput as HTMLInputElement).value).toBe('my sheet');
  });

  it('clamps count to 1-100', async () => {
    render(<RandomTab title="t" onTitleChange={vi.fn()} onPicked={vi.fn()} />);
    const input = screen.getByDisplayValue('20') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('100');
  });

  it('blocks generate and shows 请先填写字帖标题 when title is empty', async () => {
    const onPicked = vi.fn();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    render(<RandomTab title="" onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
    expect(await screen.findByText('请先填写字帖标题')).toBeInTheDocument();
  });

  it('blocks generate when title is whitespace-only', async () => {
    const onPicked = vi.fn();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    render(<RandomTab title="   " onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('请先填写字帖标题')).toBeInTheDocument();
  });

  it('calls onPicked with chars from API when title is non-empty', async () => {
    const onPicked = vi.fn();
    render(<RandomTab title="my sheet" onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(['你', '好']));
  });

  it('calls onTitleChange when the title input changes (clamped to 80 chars)', () => {
    const onTitleChange = vi.fn();
    render(<RandomTab title="" onTitleChange={onTitleChange} onPicked={vi.fn()} />);
    const input = screen.getByPlaceholderText(/给字帖起个名字/) as HTMLInputElement;
    const longText = 'a'.repeat(120);
    fireEvent.change(input, { target: { value: longText } });
    expect(onTitleChange).toHaveBeenCalledWith('a'.repeat(80));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/RandomTab.test.tsx`
Expected: FAIL — current `RandomTab` does not accept `title`/`onTitleChange` props; TypeScript compile error in the test file (and missing `请先填写字帖标题` error UI).

- [ ] **Step 3: Update `RandomTab.tsx`**

Open `components/worksheet/RandomTab.tsx`. Replace the entire file:

```tsx
'use client';

import { useState } from 'react';

interface RandomChar {
  char: string;
  pinyin: string;
  meaningZh: string | null;
}

interface Props {
  title: string;
  onTitleChange: (v: string) => void;
  onPicked: (chars: string[]) => void;
}

const DIFFICULTY_LABELS = {
  easy: '简单 (level 1 常用字)',
  medium: '中等 (level 1+2)',
  hard: '困难 (level 1+2+3 全字库)',
} as const;

export function RandomTab({ title, onTitleChange, onPicked }: Props) {
  const [count, setCount] = useState(20);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleGenerate() {
    if (title.trim() === '') {
      setErr('请先填写字帖标题');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/chars/random?count=${count}&difficulty=${difficulty}`);
      const j = await res.json();
      if (!j.ok) { setErr(j.error?.message ?? '生成失败'); return; }
      const chars = (j.data.chars as RandomChar[]).map(c => c.char);
      onPicked(chars);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">从字库随机抽字,自动填入字帖。</p>
      <div>
        <label className="text-sm font-medium text-ink-soft">
          标题 <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => onTitleChange(e.target.value.slice(0, 80))}
          maxLength={80}
          placeholder="给字帖起个名字..."
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-ink-soft">字数 (1-100)</label>
          <input
            type="number" min={1} max={100} value={count}
            onChange={e => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-ink-soft">难度</label>
          <select
            value={difficulty} onChange={e => setDifficulty(e.target.value as any)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          >
            {(['easy', 'medium', 'hard'] as const).map(d => (
              <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={handleGenerate} disabled={busy}
        className="rounded-md bg-ink px-4 py-2 text-paper-soft hover:bg-ink/80 disabled:opacity-50"
      >
        {busy ? '抽字中…' : '随机生成'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update `WorksheetGenerator` to pass `title` + `setTitle` to `<RandomTab>`**

Open `components/worksheet/WorksheetGenerator.tsx`. Find the `<RandomTab>` usage (around line 137-143). Update it:

```tsx
<RandomTab
  title={title}
  onTitleChange={setTitle}
  onPicked={(chars) => {
    setContent(chars);
    setView('preview');
  }}
/>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/RandomTab.test.tsx`
Expected: 6/6 pass.

- [ ] **Step 6: Commit**

```bash
git add components/worksheet/RandomTab.tsx \
        components/worksheet/WorksheetGenerator.tsx \
        tests/unit/components/worksheet/RandomTab.test.tsx
git commit -m "feat(worksheet): title required on RandomTab (input + empty-title validation)"
```

---

### Task 10: Final verification (tsc + test + build + smoke)

**Files:** (no changes — verification only)

- [ ] **Step 1: Kill any running dev server on 4444**

Run: `cmd.exe //c "netstat -ano | findstr :4444"` (Windows) or `lsof -ti:4444` (Unix).
If a PID is found, kill it: `cmd.exe //c "taskkill /F /PID <pid>"` (Windows) or `kill <pid>` (Unix).

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: 475-485 passing tests + 1 pre-existing `etymology.test.ts` fail (documented in MEMORY, unrelated to G3). The G3-specific tests should all be green:
- `tests/unit/lib/worksheet-types.test.ts` (15 tests: 7 FONT_FAMILIES, 3 isBrushSize, 4 validateWorksheetInput, 4 defaultFontFor = wait, recount: 4 FONT_FAMILIES + 3 isBrushSize + 4 validateWorksheetInput + 4 defaultFontFor = 15 tests)
- `tests/unit/lib/worksheet-page-count.test.ts` (9 tests: 3 existing describe blocks + 3 new brush tests)
- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` (5 tests)
- `tests/unit/components/worksheet/BrushModePicker.test.tsx` (4 tests)
- `tests/unit/components/worksheet/PaperSizePicker.test.tsx` (6 tests)
- `tests/unit/components/worksheet/RandomTab.test.tsx` (6 tests)

Total G3 tests: ~45 new + ~30 existing = ~75 worksheet-related tests, all green.

- [ ] **Step 4: Run production build**

Run: `pnpm build`
Expected: build succeeds, 30+ routes.

- [ ] **Step 5: Manual browser smoke (for the human, per spec §Verification)**

Document these in the final summary message:

1. `pnpm dev` (port 4444)
2. Visit `http://localhost:4444/worksheet/new`
3. **Default**: cell style = 毛笔格, paper size = `12 字 · 毛笔`, font = `马善政体 (毛笔正书)`, cells rendered at 200px.
4. Switch to 钢笔格 → paper size flips to A4, font flips to `霞鹜文楷 GB`.
5. Switch to 田字格 → font flips to 宋体.
6. Click 随机生成 without title → see `请先填写字帖标题` error.
7. Type title, click 随机生成 → preview shows brush worksheet with brush font.
8. Change brush mode 12 → 24 → preview re-renders with smaller cells.
9. Open print preview → cells render correctly across pages.

**If `public/fonts/ma-shan-zheng.woff2` and `public/fonts/long-cang.woff2` are missing** (sandbox had no network in Task 1), the brush font won't render and the browser falls back to system fonts. The page still works; just the brush look is missing. The human can run `pnpm fonts:download-hard-pen && pnpm fonts:subset` on a network host to produce the WOFF2 files, then re-smoke.

**No commit** (verification only).

---

## Self-Review (post-write)

- **Spec coverage:**
  - §Section 1 (types + schema) → Tasks 2, 3, 6, 8 ✓
  - §Section 2 (font pipeline + picker) → Tasks 1, 2 ✓
  - §Section 3 (brush mode + cell sizing) → Tasks 3, 4, 5, 7 ✓
  - §Section 4 (auto-pick + title required) → Tasks 8, 9 ✓
  - Risks R1-R6: R1 (DB ENUM migration) → Task 6; R2 (subset errors) → Task 1; R3 (Long Cang coverage) → spec; R4 (print layout) → Task 7; R5 (defaultFontFor) → Task 8; R6 (validateWorksheetInput guard) → Task 6 ✓
  - Out of scope: nothing in scope ✓
  - Verification: tsc + tests + build + smoke → Task 10 ✓
- **Placeholder scan:** No "TBD", "TODO", "later", "implement later" in any step. Every step has concrete code or a run command.
- **Type consistency:**
  - `FontFamily` (7 → 9): consistent across `worksheet-types.ts`, `FontFamilyPicker.tsx`, `validators.ts`, tests ✓
  - `PaperSize` (3 → 6): consistent across `worksheet-types.ts`, `worksheet-page-count.ts`, `PaperSizePicker.tsx`, `validators.ts`, `init-db.ts`, migration, tests ✓
  - `BrushPaperSize` (3 values): defined in `worksheet-types.ts`, used by `BrushModePicker`, used by `isBrushSize` predicate, used by `PaperSizePicker` (conditional branch) ✓
  - `defaultFontFor`: defined in `worksheet-types.ts`, used by `WorksheetGenerator` (`handleCellStyleChange` + initial state) ✓
  - `cellSizeFor`: defined in `WorksheetPreview.tsx` (per the spec's "Add a helper inside the component" — not exported from worksheet-types to keep it close to its consumer) ✓
  - `handleCellStyleChange`: defined in `WorksheetGenerator.tsx`, called by `<StylePicker onChange={handleCellStyleChange}>` ✓
  - Migration SQL: matches `init-db.ts` declaration exactly ✓
- **Order of tasks:** Asset pipeline first (1), then types (2, 3, 6), then components (4, 5, 7), then wiring (8, 9), then verification (10). Each task is independently testable.
- **Breaking change in `PaperSizePicker` prop signature:** noted in Task 5 Step 3. The only consumer is `WorksheetGenerator`, updated in Task 8 Step 5.
- **Breaking change in `RandomTab` prop signature:** noted in Task 9 Step 3. The only consumer is `WorksheetGenerator`, updated in Task 9 Step 4.
- **DB migration timing (R1):** Task 6 commits the migration file. The human must apply it to both prod and dev BEFORE the code that writes `brush-12/24/28` ships. The plan's commit order is: Task 1 (assets), Task 2 (types), Task 3 (paper_size types), Task 4 (BrushModePicker), Task 5 (PaperSizePicker), Task 6 (DB migration + zod + validateWorksheetInput), Task 7 (cell sizing), Task 8 (auto-pick), Task 9 (title required), Task 10 (verify). The DB migration commits in Task 6 BEFORE the WorksheetGenerator wiring in Task 8 — so the migration can be applied between Task 6 and Task 8 if the human wants to test the wired-up code in a real DB.
