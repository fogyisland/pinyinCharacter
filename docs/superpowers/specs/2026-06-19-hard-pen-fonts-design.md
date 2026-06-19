# Hard-Pen Worksheet Font System

**Date:** 2026-06-19
**Status:** Draft (awaiting user review)
**Scope:** Add 4 hard-pen / modern fonts to the worksheet system, build-time subset the Chinese glyphs, upgrade the font picker to a dropdown, relax A4 default density, add a print-preview header, and document third-party licenses.

---

## Context

The 字帖 (worksheet) feature today ships with three system fonts (宋 / 楷 / 黑, all served by Noto SC + LXGW WenKai TC fallback). They look generic — Noto Serif SC is a low-contrast Songti that scans as a system default, and LXGW WenKai TC has 繁简 inconsistency with Simplified content. Users copy-pasting 古文 (classical text) into the worksheet get a noticeably less 手写 / 钢笔 feel than the rest of the app's 硬笔 (hard-pen) aesthetic.

Three deferred items compound this:

1. **FontFamilyPicker** is still a radio list (`components/worksheet/FontFamilyPicker.tsx:11`) — adding more fonts makes it longer without exposing groups.
2. **A4 density** is hardcoded at 96 cells (`lib/worksheet-page-count.ts:5`) — the rendered cells are physically cramped on the page; copyists have asked for slightly looser spacing.
3. **Print preview** has no header — printed sheets land without any site identity. Adding a Logo + 字体名 + a 「公益网站，请多关注」 line makes shared copies traceable and on-brand.

We also don't have a build-time subset pipeline. The Plan L fonts (74.6 MB across 5 TTF files) are full files served from `/fonts/`. For 4 new hard-pen fonts at 5-15 MB each, that's another 30-50 MB served uncompressed on every page load. Subset to the ~7000 GB2312 chars we'd ever need and serve as WOFF2.

The user has explicitly asked for a complete Plan G2 that ties these together:

> "在这里几类生成钢笔字帖的字体文件,然后修改"

---

## Goals

1. Worksheet users pick from 7 fonts grouped as 系统字体 (system) / 硬笔字体 (hard-pen), via a dropdown that takes the same horizontal space as the current radio.
2. Subset the 4 hard-pen fonts to a GB2312 char set (7000 chars + common symbols) at build time, so each font ships as ≤ 800 KB WOFF2 instead of 5-15 MB TTF.
3. A4 default drops from 96 → 88 cells/page, giving each cell a touch more breathing room for the 钢笔 practice grid.
4. Every printed sheet carries a header: site Logo + 当前字体名 + "公益网站，请多关注".
5. All third-party fonts have an OFL-compliant credit document (`THIRD_PARTY_LICENSES.md`) committed to the repo.

## Non-Goals

- No pinyin annotations on worksheets (user explicitly retracted this from the original brainstorm).
- No new free-tier / membership gating changes.
- No font-rendering UI in `/admin/fonts` — fonts are static build artifacts, not DB rows.
- No browser-side subsetting — runtime stays untouched; subsetting is a `pnpm fonts:subset` script.

---

## Design

### Section 1 — 4 new hard-pen fonts

Four fonts, all SIL Open Font License 1.1:

| Font | File under `public/fonts/` | Tailwind token | CSS `font-family` |
|---|---|---|---|
| LXGW WenKai GB (霞鹜文楷 GB) | `LXGWWenKaiGB-Regular.woff2` | `--font-lxgw-wenkai-gb` | `'LXGW WenKai GB', serif` |
| Yozai (悠哉) | `Yozai-Regular.woff2` | `--font-yozai` | `'Yozai', serif` |
| Iansui (芫荽) | `Iansui-Regular.woff2` | `--font-iansui` | `'Iansui', serif` |
| Zen Kaku Gothic Thin (思源ゴシック 极细) | `ZenKakuGothicNew-Thin.woff2` | `--font-zen-kaku-thin` | `'Zen Kaku Gothic New', sans-serif` |

Existing fonts keep their tokens (`--font-han-serif`, `--font-han-sans`, `--font-wenkai`).

#### `lib/worksheet-types.ts` — extend `FontFamily`

```ts
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin';

export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen';
}[] = [
  // system
  { value: 'song', label: '宋体', cssVar: 'var(--font-han-serif)', group: 'system' },
  { value: 'kai',  label: '楷体', cssVar: 'var(--font-wenkai)',    group: 'system' },
  { value: 'hei',  label: '黑体', cssVar: 'var(--font-han-sans)',  group: 'system' },
  // hard-pen
  { value: 'wenkai-gb',     label: '霞鹜文楷 GB', cssVar: 'var(--font-lxgw-wenkai-gb)', group: 'hard-pen' },
  { value: 'yozai',         label: '悠哉',         cssVar: 'var(--font-yozai)',         group: 'hard-pen' },
  { value: 'iansui',        label: '芫荽',         cssVar: 'var(--font-iansui)',        group: 'hard-pen' },
  { value: 'zen-kaku-thin', label: '思源极细黑',   cssVar: 'var(--font-zen-kaku-thin)', group: 'hard-pen' },
];
```

`FONT_FAMILIES` entries gain a new `group: 'system' | 'hard-pen'` field. `fontFamilyLabel`, `fontFamilyCssVar` keep their current shape (single string).

#### `app/globals.css` — 4 new `@font-face` + token cascade

```css
@font-face {
  font-family: 'LXGW WenKai GB';
  src: url('/fonts/LXGWWenKaiGB-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Yozai';
  src: url('/fonts/Yozai-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Iansui';
  src: url('/fonts/Iansui-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Zen Kaku Gothic New';
  src: url('/fonts/ZenKakuGothicNew-Thin.woff2') format('woff2');
  font-weight: 100;
  font-display: swap;
}

:root {
  --font-lxgw-wenkai-gb: 'LXGW WenKai GB', serif;
  --font-yozai: 'Yozai', serif;
  --font-iansui: 'Iansui', serif;
  --font-zen-kaku-thin: 'Zen Kaku Gothic New', sans-serif;
}
```

Tokens also exposed in `@theme {}` so Tailwind utilities work:
```css
@theme {
  --font-lxgw-wenkai-gb: 'LXGW WenKai GB', serif;
  --font-yozai: 'Yozai', serif;
  --font-iansui: 'Iansui', serif;
  --font-zen-kaku-thin: 'Zen Kaku Gothic New', sans-serif;
}
```

For the WOFF2 files to actually load, Section 3 builds them. Source TTF/OTF is downloaded once via `pnpm fonts:download-hard-pen` into a staging dir (`scripts/fonts/staging/`, gitignored) and subset into `public/fonts/`.

### Section 2 — FontFamilyPicker: radio → dropdown

Replace the radio row in `components/worksheet/FontFamilyPicker.tsx` with a single `<select>` styled to match the project aesthetic. Layout stays the same height (≈ one row of controls).

```tsx
'use client';

import type { FontFamily } from '@/lib/worksheet-types';
import { FONT_FAMILIES, fontFamilyLabel } from '@/lib/worksheet-types';

interface Props {
  value: FontFamily;
  onChange: (v: FontFamily) => void;
}

const GROUPS = [
  { key: 'system', label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
] as const;

export function FontFamilyPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FontFamily)}
      className="rounded border border-ink/20 bg-paper px-3 py-1.5 text-sm"
    >
      {GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {FONT_FAMILIES.filter((f) => f.group === g.key).map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.cssVar }}>
              {fontFamilyLabel(f.value)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
```

The `style={{ fontFamily: f.cssVar }}` on `<option>` works in Chromium/Firefox/Safari — the option row previews the actual font. Keyboard navigation and screen-reader announcement behave like any other `<select>`.

The radio `name="fontFamily"` is removed; the underlying state and prop signatures are unchanged.

### Section 3 — Build-time subset

Add `subset-font` (Node, harfbuzzjs-based; zero native deps) as a devDependency. One CLI call per font, fed a GB2312 + common-symbol text file.

#### `scripts/fonts/gb2312-7000.txt` (NEW)

A static text file containing the ~7000 glyphs we want covered:

- 6763 GB2312 first-level + second-level hanzi (covers 99.5% of modern Simplified Chinese usage)
- 100 ASCII printable
- 200 common Chinese punctuation (`，。！？、；：「」『』（）…—《》`)
- 100 latin/symbol fillers (digits, math, currency)
- Total: ~7163 unique codepoints

The file is committed to git so the subset is reproducible. Generation source: a tiny `scripts/fonts/build-gb2312-7000.ts` that fetches the GB2312 table from a public source (or is hand-curated from the Wikipedia list) and emits the deduped text file once.

#### `scripts/fonts/subset-hard-pen-fonts.mjs` (NEW)

```js
import { subset } from 'subset-font';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const STAGING = resolve(ROOT, 'scripts/fonts/staging');
const OUT = resolve(ROOT, 'public/fonts');
const GLYPHS_FILE = resolve(__dirname, 'gb2312-7000.txt');

const TARGETS = [
  { in: 'LXGWWenKaiGB-Regular.ttf',     out: 'LXGWWenKaiGB-Regular.woff2',     family: 'LXGW WenKai GB' },
  { in: 'Yozai-Regular.ttf',            out: 'Yozai-Regular.woff2',            family: 'Yozai' },
  { in: 'Iansui-Regular.ttf',           out: 'Iansui-Regular.woff2',           family: 'Iansui' },
  { in: 'ZenKakuGothicNew-Thin.otf',    out: 'ZenKakuGothicNew-Thin.woff2',    family: 'Zen Kaku Gothic New' },
];

async function main() {
  const glyphs = await readFile(GLYPHS_FILE, 'utf8');
  for (const t of TARGETS) {
    const buf = await readFile(resolve(STAGING, t.in));
    const out = await subset(buf, t.family, glyphs, { targetFormat: 'woff2' });
    await writeFile(resolve(OUT, t.out), out);
    const kb = (out.length / 1024).toFixed(1);
    console.log(`✓ ${t.out} (${kb} KB)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

The script reads each source TTF/OTF from `scripts/fonts/staging/` (gitignored — populated by the download script below) and writes WOFF2 to `public/fonts/`.

#### `scripts/fonts/download-hard-pen-fonts.ts` (NEW)

Mirrors the pattern of `scripts/download-ancient-fonts.ts`. For each of the 4 fonts, downloads the upstream TTF/OTF to `scripts/fonts/staging/`, skipping files that already exist.

URL sources (all OFL 1.1; primary URL first, fallback URLs as belt-and-braces):

| Font | Primary URL |
|---|---|
| LXGW WenKai GB | `https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Regular.ttf` |
| Yozai | `https://github.com/lxgw/LxgwYozai/releases/latest/download/Yozai-Regular.ttf` |
| Iansui | `https://github.com/lxgw/LxgwIansui/releases/latest/download/Iansui-Regular.ttf` |
| Zen Kaku Gothic New Thin | `https://github.com/googlefonts/zen-kakugothic/releases/download/v1.0.0/ZenKakuGothicNew-Thin.otf` |

`pnpm fonts:download-hard-pen` runs the download; `pnpm fonts:subset` runs the subset; `pnpm fonts:hard-pen` chains both.

The `scripts/fonts/staging/` directory is in `.gitignore`. The downloaded source files (5-15 MB each) stay out of git — the WOFF2 outputs in `public/fonts/` are the only committed font artifacts.

#### `package.json` — new scripts + dep

```json
"scripts": {
  ...
  "fonts:download-hard-pen": "tsx scripts/fonts/download-hard-pen-fonts.ts",
  "fonts:subset": "node scripts/fonts/subset-hard-pen-fonts.mjs",
  "fonts:hard-pen": "pnpm fonts:download-hard-pen && pnpm fonts:subset"
},
"devDependencies": {
  ...
  "subset-font": "^2.4.0"
}
```

### Section 4 — A4 default 96→88 + print preview header

#### A4 cell density

In `lib/worksheet-page-count.ts:3-7`:

```ts
const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 132,
  A4: 88,   // was 96 — looser for hard-pen practice
  B5: 60,   // was 66 — proportional reduction
};
```

`cellsPerPage()`, `pageCountFor()`, `exceedsFreeLimit()` keep the same signatures. The `PAGE_SIZES` table in `lib/worksheet-types.ts:38-42` reads from `cellsPerPage()` automatically, so the UI hint updates without further code.

#### Print preview header

In `components/worksheet/WorksheetPreview.tsx`, add a header at the **top of the `.worksheet-grid` wrapper** (so it falls inside the existing `@media print` visibility-visible rule). On screen it's just a topbar above the cells; on print it appears once at the top of the worksheet block.

```tsx
<div className={`worksheet-grid mx-auto grid min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
  <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
    <div className="flex items-center gap-2">
      <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
      <span className="font-kai text-base text-ink">字·韵</span>
    </div>
    <div className="text-sm text-ink-soft">
      字体: <span className="font-medium text-ink">{fontFamilyLabel(props.fontFamily)}</span>
    </div>
    <div className="text-xs text-ink-faint">公益网站，请多关注</div>
  </div>
  {cells.map((cell) => (
    <div key={cell.index} className="worksheet-cell">
      <WorksheetCell char={cell.char} style={cell.style} fontFamily={props.fontFamily} />
    </div>
  ))}
</div>
```

Note: `col-span-full` works because all three current grid templates (`repeat(N, ...)`) put the header on its own implicit row spanning all columns. No additional CSS needed; the existing `@media print` rule already makes `.worksheet-grid` and its descendants visible.

The Logo path `/logo.svg` already exists in `public/`.

### Section 5 — `THIRD_PARTY_LICENSES.md`

A single markdown file at the repo root documenting every third-party font used. Format mirrors the existing `THIRD_PARTY_NOTICES.md` style (if present) or starts a new convention if not.

```markdown
# Third-Party Font Licenses

This project bundles the following fonts, all under the SIL Open Font License 1.1
(https://scripts.sil.org/OFL).

## LXGW WenKai GB (霞鹜文楷 GB)
- Version: ...
- Copyright: © 2020-2026 LXGW. All rights reserved.
- Source: https://github.com/lxgw/LxgwWenkaiGB
- License: SIL OFL 1.1 — see OFL.txt

## Yozai (悠哉)
- Version: ...
- Copyright: © 2022-2026 LXGW.
- Source: https://github.com/lxgw/LxgwYozai
- License: SIL OFL 1.1

## Iansui (芫荽)
- Version: ...
- Copyright: © 2021-2026 LXGW.
- Source: https://github.com/lxgw/LxgwIansui
- License: SIL OFL 1.1

## Zen Kaku Gothic New (思源ゴシック)
- Version: 1.0.0
- Copyright: © 2022 Adobe Inc., Google Inc.
- Source: https://github.com/googlefonts/zen-kakugothic
- License: SIL OFL 1.1

## BabelStone Han Basic + Extra
- Version: ...
- Copyright: © 2019 BabelStone.
- Source: https://www.babelstone.co.uk/Fonts/BabelStoneHan.html
- License: SIL OFL 1.1
```

Each new font ships with its full OFL.txt copied from upstream into `public/fonts/` (next to the WOFF2). The build script does not strip license files.

---

## File Inventory

### New files
- `scripts/fonts/gb2312-7000.txt` — static char-set text (committed)
- `scripts/fonts/build-gb2312-7000.ts` — one-shot generator (kept for regeneration)
- `scripts/fonts/download-hard-pen-fonts.ts` — TTF download
- `scripts/fonts/subset-hard-pen-fonts.mjs` — WOFF2 subset pipeline
- `public/fonts/LXGWWenKaiGB-Regular.woff2` + `LXGWWenKaiGB-Regular.OFL.txt`
- `public/fonts/Yozai-Regular.woff2` + `Yozai-Regular.OFL.txt`
- `public/fonts/Iansui-Regular.woff2` + `Iansui-Regular.OFL.txt`
- `public/fonts/ZenKakuGothicNew-Thin.woff2` + `ZenKakuGothicNew-Thin.OFL.txt`
- `THIRD_PARTY_LICENSES.md` (repo root)

### Modified files
- `app/globals.css` — 4 `@font-face` + 4 `:root` tokens + 4 `@theme` tokens
- `lib/worksheet-types.ts` — extend `FontFamily` union; add `group` to `FONT_FAMILIES`
- `lib/worksheet-page-count.ts` — A4: 96→88; B5: 66→60
- `components/worksheet/FontFamilyPicker.tsx` — radio → optgroup `<select>`
- `components/worksheet/WorksheetPreview.tsx` — print header
- `package.json` — 3 new scripts + `subset-font` devDep
- `.gitignore` — add `scripts/fonts/staging/`

### Tests (new)
- `tests/unit/lib/worksheet-types.test.ts` — `FONT_FAMILIES` has 7 entries with correct groups
- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` — renders 2 optgroups + 7 options; selecting dispatches `onChange`
- `tests/unit/components/worksheet/WorksheetPreview.test.tsx` — print header renders Logo + 字体名 + tagline

### Test updates
- `tests/unit/lib/worksheet-page-count.test.ts` (existing at `tests/unit/lib/worksheet-page-count.test.ts:7-8`) — update A4/B5 expected values to 88/60

---

## Verification

1. `pnpm tsc --noEmit` — clean
2. `pnpm test` — all tests pass, including 4 new + 1 updated
3. `pnpm fonts:hard-pen` — downloads + subsets 4 fonts, writes WOFF2 to `public/fonts/`, each ≤ 800 KB
4. `pnpm build` — succeeds; font assets present in `.next/static/...` or referenced from `/fonts/`
5. Browser: `/worksheet/new` — `<select>` shows 2 optgroups, picking 霞鹜文楷 GB renders text in that font on the preview grid
6. Browser: print preview — header shows Logo + "字体: 霞鹜文楷 GB" + "公益网站，请多关注"; A4 sheet fits 88 cells (was 96)

---

## Risk / Rollback

- **`subset-font` missing platform support**: harfbuzzjs is pure WASM, runs anywhere Node runs. No fallback path needed.
- **GB2312 misses a char the user pastes**: A4 fallback: `var(--font-han-serif)` from `:root` cascade takes the missing-glyph. The visual fallback is graceful (browser draws `.notdef` glyph); user can switch fonts manually.
- **Download URLs change**: same fallback pattern as `download-ancient-fonts.ts` — try primary, fall back to known mirror, soft-fail.
- **WOFF2 size > 800 KB**: log a warning in the subset script; do not fail the build. The 800 KB target is a heuristic, not a hard cap.

---

## Out of Scope / Future

- Adding Iansui variable / weight variants (only Regular for now)
- Latin-script font preview in `<option>` is already supported via `style={{ fontFamily: f.cssVar }}`; no further work
- Per-user font preference persistence (currently stored in worksheet rows already)
- A `/admin/fonts` page that triggers download + subset from the browser (UI is not the goal here)

---

## Task List (19 items, subagent-ready)

1. Decide char set + write `scripts/fonts/build-gb2312-7000.ts` + emit `gb2312-7000.txt`
2. Add `subset-font` to devDependencies + 3 new scripts to `package.json`
3. Write `scripts/fonts/download-hard-pen-fonts.ts`
4. Write `scripts/fonts/subset-hard-pen-fonts.mjs`
5. Run download + subset, verify 4 WOFF2 files in `public/fonts/`
6. Copy each upstream `OFL.txt` next to its WOFF2
7. Add 4 `@font-face` blocks + 4 `--font-*` tokens + 4 `@theme` tokens to `app/globals.css`
8. Extend `FontFamily` union + `FONT_FAMILIES` with `group` field in `lib/worksheet-types.ts`
9. Update `CELLS_PER_PAGE` in `lib/worksheet-page-count.ts` (A4: 96→88, B5: 66→60)
10. Rewrite `components/worksheet/FontFamilyPicker.tsx` to `<select>` with optgroups
11. Add print header to `components/worksheet/WorksheetPreview.tsx`
12. Write new tests: `FONT_FAMILIES` shape (7 entries, 2 groups)
13. Write new tests: `FontFamilyPicker` renders 2 optgroups + 7 options
14. Write new tests: `WorksheetPreview` print header shows Logo + 字体名 + tagline
15. Update existing `worksheet-page-count.test.ts` for new A4=88, B5=60 values
16. Write `THIRD_PARTY_LICENSES.md` with all 4 new fonts + BabelStone
17. Add `scripts/fonts/staging/` to `.gitignore`
18. Run `pnpm tsc --noEmit` + `pnpm test` — clean
19. Run `pnpm fonts:hard-pen` end-to-end + verify WOFF2 sizes

---

## Spec Self-Review (post-write)

- [x] No placeholders ("TBD", "TODO", "implement later")
- [x] Internal consistency: every font named in §1 appears in §3 (download + subset) and §5 (license); every file in `File Inventory` is referenced in §1-§5
- [x] Scope: one PR, ~20 tasks, no DB migrations, no API changes, no membership changes
- [x] Ambiguity: `FontFamily` union values match between §1 (CSS family strings) and §2 (option values); A4/B5 cell counts named once; print header components enumerated
