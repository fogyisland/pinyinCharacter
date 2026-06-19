# Brush Worksheet System (毛笔格 + brush fonts + 12/24/28 mode)

**Date:** 2026-06-19
**Status:** Draft (awaiting user review)
**Scope:** Add a brush (毛笔) worksheet system — 2 new OFL brush fonts, a 12/24/28 char-per-page mode that replaces paper size when 毛笔格 is selected, larger brush cells (200/150/120 px), font auto-pick by cell style, and required title on the Random tab.

---

## Context

Plan G2 shipped 4 hard-pen (钢笔) fonts and a font picker dropdown (system / hard-pen groups). The worksheet system today:

- Has 4 cell styles (`brush` / `square` / `pen` / `cross`) but only one density regime (~60-88 cells per A4/B5 page).
- Has 7 fonts grouped as system / hard-pen; no brush (毛笔) fonts.
- The 毛笔格 (brush) cell style uses the SAME small (80px) cell as the other styles, so brush practice sheets are visually cramped — way too dense for traditional 临帖 (copying) practice.
- The Random tab has no title field; the title defaults to `字帖 <date>` on save.
- The font picker is decoupled from the cell style — picking 毛笔格 doesn't suggest a brush font.

Three deferred requirements from the G2 plan converge on this spec:

1. **Brush (毛笔) worksheet system** — 5+ brush fonts and 12/24/28 char-per-page mode. (User accepted the reuse-existing approach: 楷 stays in system + 2 new OFL brush fonts.)
2. **Brush/pen font switching** in random generation — pick font based on cell style.
3. **Title required** surfacing in random-tab flow.

This spec unifies those three.

---

## Goals

1. Add 2 new OFL brush fonts (Ma Shan Zheng 毛笔正书 + Long Cang 草书), subset via the G2 pipeline, exposed as a new `brush` font group in the picker.
2. Add a brush mode picker (12 字 / 24 字 / 28 字 per page) that **replaces** the A3/A4/B5 paper size picker when cell style is `brush`. Existing A3/A4/B5 picker still drives non-brush cell styles.
3. Render brush cells at larger sizes (200/150/120 px by mode) so each practice character gets the visual room it needs.
4. When the user changes cell style, auto-pick a font from the matching group (毛笔格 → first brush; 钢笔格 → first hard-pen; 田字格/米字格 → first system). User can still override.
5. Require a title on the Random tab before the user can click 随机生成. The 1-80 char limit matches the existing `validateWorksheetInput` rule.

## Non-Goals

- No new brush cell-style visual guides (毛笔格 keeps the existing border + vertical + diagonals SVG).
- No new paper sizes for non-brush modes (A3/A4/B5 unchanged).
- No pinyin annotations on worksheets (user retracted from earlier brainstorm).
- No brush font subsets bigger than GB2312-7000 chars (matches G2 charset builder).
- No CDN/font-host changes — fonts ship as static files under `public/fonts/`.
- No membership / paywall changes (covered by Spec B from plan worksheet-print-gating).
- No changes to `unlimited_history`, the worksheet history list, the random chars API, or the `/api/worksheets` endpoint shape (only the validated `paperSize` union widens).
- No G4 (profile + membership + homepage animation) or G5 (local CDN mirror) — separate specs.

---

## Design

### Section 1 — Type & schema

#### `lib/worksheet-types.ts`

Extend the `FontFamily` union and `FONT_FAMILIES` table:

```ts
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin'
  | 'ma-shan-zheng' | 'long-cang';

export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen' | 'brush';
}[] = [
  // existing 7 entries unchanged
  { value: 'song',            label: '宋体',         cssVar: 'var(--font-han-serif)',         group: 'system' },
  { value: 'kai',             label: '楷体',         cssVar: 'var(--font-wenkai)',            group: 'system' },
  { value: 'hei',             label: '黑体',         cssVar: 'var(--font-han-sans)',          group: 'system' },
  { value: 'wenkai-gb',       label: '霞鹜文楷 GB',  cssVar: 'var(--font-lxgw-wenkai-gb)',    group: 'hard-pen' },
  { value: 'yozai',           label: '悠哉',         cssVar: 'var(--font-yozai)',             group: 'hard-pen' },
  { value: 'iansui',          label: '芫荽',         cssVar: 'var(--font-iansui)',            group: 'hard-pen' },
  { value: 'zen-kaku-thin',   label: '思源极细黑',   cssVar: 'var(--font-zen-kaku-thin)',     group: 'hard-pen' },
  // NEW brush group
  { value: 'ma-shan-zheng',   label: '马善政体 (毛笔正书)', cssVar: 'var(--font-ma-shan-zheng)', group: 'brush' },
  { value: 'long-cang',        label: '龙藏体 (草书)',       cssVar: 'var(--font-long-cang)',      group: 'brush' },
];
```

Total: 9 fonts in 3 groups (3 system + 4 hard-pen + 2 brush).

Extend the `PaperSize` union and `PAPER_SIZES` table:

```ts
export type PaperSize = 'A3' | 'A4' | 'B5' | 'brush-12' | 'brush-24' | 'brush-28';

export const PAPER_SIZES: { value: PaperSize; label: string; cols: number; cellsPerPage: number }[] = [
  { value: 'A3',       label: 'A3 · 大',       cols: 12, cellsPerPage: cellsPerPage('A3') },
  { value: 'A4',       label: 'A4 · 标准',     cols: 8,  cellsPerPage: cellsPerPage('A4') },
  { value: 'B5',       label: 'B5 · 小',       cols: 6,  cellsPerPage: cellsPerPage('B5') },
  { value: 'brush-12', label: '12 字 · 毛笔',  cols: 4,  cellsPerPage: 12 },
  { value: 'brush-24', label: '24 字 · 毛笔',  cols: 6,  cellsPerPage: 24 },
  { value: 'brush-28', label: '28 字 · 毛笔',  cols: 7,  cellsPerPage: 28 },
];
```

`paperSizeLabel` and the helper used in `WorksheetPreview` (the `sizeClass = worksheet-grid--${paperSize.toLowerCase()}` line) automatically handle the new values.

#### `lib/worksheet-page-count.ts`

Extend the `cellsPerPage()` function:

```ts
export function cellsPerPage(size: PaperSize): number {
  switch (size) {
    case 'A3':        return 96;
    case 'A4':        return 88;
    case 'B5':        return 60;
    case 'brush-12':  return 12;
    case 'brush-24':  return 24;
    case 'brush-28':  return 28;
  }
}
```

The non-brush values are unchanged from G2 (A4 96→88 was set in G2; A3 96 carries over the legacy default).

#### `validateWorksheetInput`

No new fields to validate — `paperSize` is currently NOT validated in `validateWorksheetInput` (only `title`, `content`, `cellStyle` are). The new `paperSize` enum values flow through to the DB column's ENUM. **This is intentional: G2's worksheet-cross-cell-style-design spec also leaves `paperSize` to the DB column constraint.**

If we want belt-and-suspenders validation, we can add a switch in `validateWorksheetInput`:

```ts
const VALID_PAPER_SIZES = ['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28'] as const;
if (typeof input.paperSize !== 'string' || !(VALID_PAPER_SIZES as readonly string[]).includes(input.paperSize)) {
  return { ok: false, error: 'paperSize must be A3, A4, B5, brush-12, brush-24, or brush-28' };
}
```

Decision: include this guard. The POST `/api/worksheets` route already passes `paperSize` to the DB; a typed guard catches API callers that send invalid values before the DB throws.

#### Default font helper (new in `lib/worksheet-types.ts`)

```ts
export function defaultFontFor(cellStyle: CellStyle): FontFamily {
  switch (cellStyle) {
    case 'brush':   return 'ma-shan-zheng';
    case 'pen':     return 'wenkai-gb';
    case 'square':  return 'song';
    case 'cross':   return 'song';
  }
}
```

First brush = `ma-shan-zheng` (毛笔正书); first hard-pen = `wenkai-gb` (霞鹜文楷 GB); first system = `song` (宋体).

#### Brush-size type predicate (new in `lib/worksheet-types.ts`)

```ts
export const BRUSH_PAPER_SIZES = ['brush-12', 'brush-24', 'brush-28'] as const;
export type BrushPaperSize = typeof BRUSH_PAPER_SIZES[number];

export function isBrushSize(p: PaperSize): p is BrushPaperSize {
  return (BRUSH_PAPER_SIZES as readonly string[]).includes(p);
}
```

Used by `WorksheetGenerator.handleCellStyleChange` to detect when the current paper size is a brush mode and needs to auto-flip across the boundary, and by `PaperSizePicker` to defensively narrow `value` before passing to `BrushModePicker`.

#### DB schema

**`scripts/init-db.ts`** (for fresh inits) — widen the column declaration:

```sql
paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL
```

**`scripts/migrations/2026-06-19-brush-paper-size.sql`** (NEW, idempotent):

```sql
ALTER TABLE worksheets
  MODIFY paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL;
```

Apply to both prod (`piyin`) and dev (`piyin_dev`). Non-destructive — all existing values are still valid under the new enum.

#### `lib/validators.ts`

**Action required during implementation:** inspect the existing `worksheetInputSchema` (zod or similar) used by `POST /api/worksheets`. If it has a `paperSize` field, extend its union to include `'brush-12' | 'brush-24' | 'brush-28'`. If no such schema exists, the `validateWorksheetInput` guard added above is the only API-level validation.

### Section 2 — Brush font subset pipeline + FontFamilyPicker

#### Subset pipeline (extends G2)

G2 ships:
- `scripts/build-gb2312-charset.ts` — emits `data/gb2312-7000.txt` (7064 chars, 21 KB). **Unchanged.**
- `scripts/download-hard-pen-fonts.ts` — fetches TTF → `scripts/fonts/staging/`. **Renamed to `download-worksheet-fonts.ts` in this spec** (it now covers hard-pen + brush).
- `scripts/subset-fonts.ts` — subsets staged TTF → WOFF2 in `public/fonts/`. **Unchanged** — just add 2 entries to the `FONT_CONFIG` array.

**Font config additions** in `scripts/subset-fonts.ts`:

```ts
// Brush group (NEW)
{ name: 'ma-shan-zheng',  source: 'MaShanZheng-Regular.ttf',   weight: 400 },
{ name: 'long-cang',       source: 'LongCang-Regular.ttf',      weight: 400 },
```

Both fonts are single-weight from Google Fonts / github.com/google/fonts. Final WOFF2 files:
- `public/fonts/ma-shan-zheng.woff2` (~600 KB subset)
- `public/fonts/long-cang.woff2` (~300 KB subset)

#### Download script (new fonts)

Add to the existing download manifest (whichever file holds the font URLs):

| Font | Source | OFL |
|------|--------|-----|
| Ma Shan Zheng | github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf | OFL 1.1 |
| Long Cang | github.com/google/fonts/raw/main/ofl/longcang/LongCang-Regular.ttf | OFL 1.1 |

Both fonts have the OFL.txt in the same github folder. Copy to `public/fonts/OFL-ma-shan-zheng.txt` and `public/fonts/OFL-long-cang.txt`.

#### `@font-face` and Tailwind tokens

`app/globals.css` — add 2 `@font-face` blocks + 2 `:root` vars + 2 `@theme inline` entries, following the G2 pattern:

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

```css
:root {
  --font-ma-shan-zheng: 'MaShanZheng', 'Noto Serif SC', serif;
  --font-long-cang:      'LongCang',      'Noto Serif SC', serif;
}

@theme inline {
  --font-ma-shan-zheng: var(--font-ma-shan-zheng);
  --font-long-cang:      var(--font-long-cang);
}
```

#### `THIRD_PARTY_LICENSES.md`

Add 2 entries:

```markdown
### Ma Shan Zheng
- Source: https://github.com/google/fonts/tree/main/ofl/mashanzheng
- License: SIL Open Font License 1.1
- Used as: 毛笔正书 brush worksheet font

### Long Cang
- Source: https://github.com/google/fonts/tree/main/ofl/longcang
- License: SIL Open Font License 1.1
- Used as: 草书 brush worksheet font
```

#### `FontFamilyPicker` UI

The existing `<FontFamilyPicker>` already groups fonts via the `GROUPS` array. **No code change in the picker itself** — just extend the `GROUPS` constant:

```ts
const GROUPS = [
  { key: 'system',   label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
  { key: 'brush',    label: '毛笔字体' },
] as const;
```

The `FONT_FAMILIES.filter(f => f.group === g.key)` loop automatically picks up the 2 new brush fonts.

### Section 3 — Brush mode picker + cell sizing

#### `components/worksheet/BrushModePicker.tsx` (NEW)

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
    <div className="flex gap-2">
      {MODES.map(m => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            value === m.value
              ? 'border-seal bg-seal/10 text-seal font-medium'
              : 'border-ink/20 hover:bg-paper-deep'
          }`}
          aria-pressed={value === m.value}
        >
          {m.label}
          <span className="ml-1 text-xs text-ink-faint">{m.hint}</span>
        </button>
      ))}
    </div>
  );
}
```

Mirrors the visual pattern of `PaperSizePicker` (button row, selected state).

#### `components/worksheet/PaperSizePicker.tsx` (extend)

The current picker is a radio group of A3/A4/B5. Extend it to take `cellStyle` and branch:

```tsx
'use client';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { isBrushSize } from '@/lib/worksheet-types';
import { BrushModePicker } from './BrushModePicker';

interface Props {
  value: PaperSize;
  cellStyle: CellStyle;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, cellStyle, onChange }: Props) {
  if (cellStyle === 'brush') {
    // value is guaranteed to be a brush size by the parent's handleCellStyleChange.
    // The cast is safe at runtime; we narrow via isBrushSize defensively.
    if (!isBrushSize(value)) {
      // Defensive: should never happen if WorksheetGenerator's auto-flip ran.
      // Fall back to brush-12 to avoid rendering a non-brush value in the brush picker.
      onChange('brush-12');
      return <BrushModePicker value="brush-12" onChange={onChange} />;
    }
    return <BrushModePicker value={value} onChange={onChange} />;
  }
  // existing A3/A4/B5 radio group unchanged
  return ( /* existing JSX */ );
}
```

When `cellStyle === 'brush'`, the A3/A4/B5 radios are replaced with the brush mode picker. The current `value` (which may be `'A4'`, `'brush-12'`, etc.) flows through; if the value is not a brush mode, the parent WorksheetGenerator auto-fixes it on `cellStyle` change (see below).

#### `components/worksheet/WorksheetGenerator.tsx` — paper size auto-flip on cell style change

Currently the generator has separate `setCellStyle` and `setPaperSize` state. Add an effect (or update the `setCellStyle` handler) to auto-flip the paper size when the cell style crosses the brush boundary. Uses the `isBrushSize` predicate from `lib/worksheet-types.ts`:

```ts
import { defaultFontFor, isBrushSize } from '@/lib/worksheet-types';

function handleCellStyleChange(next: CellStyle) {
  setCellStyle(next);
  if (next === 'brush' && !isBrushSize(paperSize)) {
    setPaperSize('brush-12');     // default to smallest density (most breathing room)
  } else if (next !== 'brush' && isBrushSize(paperSize)) {
    setPaperSize('A4');           // existing default
  }
  setFontFamily(defaultFontFor(next));
}
```

The `setFontFamily` call is the auto-pick from Section 4. Both behaviors fire together.

Default state for a fresh worksheet:
- `cellStyle = 'brush'` (current default) → `paperSize = 'brush-12'`, `fontFamily = 'ma-shan-zheng'`.
- This is a behavior change: existing users who land on `/worksheet/new` will see a brush worksheet by default. The G2 spec already locks `cellStyle = 'brush'` as default; this just extends the default paper size and font.

#### `components/worksheet/WorksheetCell.tsx` — guide font-size scales with cell size

The current SVG renders the practice char at fixed `fontSize={60}`. For 200px brush cells, that's too small. Compute the guide size from the cell size:

```tsx
const guideFontSize = Math.round(size * 0.6);   // 200→120, 80→48, 60→36
```

(Replace the hard-coded `fontSize={60}` in the `<text>` element.)

The SVG guides (border + vertical + diagonals) are unchanged — they scale with the viewBox.

#### `components/worksheet/WorksheetPreview.tsx` — cell size mapping

Add a helper inside the component (or in `lib/worksheet-types.ts`):

```ts
function cellSizeFor(p: PaperSize): number {
  switch (p) {
    case 'brush-12': return 200;
    case 'brush-24': return 150;
    case 'brush-28': return 120;
    default:         return 80;   // A3/A4/B5 keep 80px (G2 default)
  }
}
```

Then in the render:

```tsx
const cellSize = cellSizeFor(props.paperSize);
// ...
{cells.map(cell => (
  <div key={cell.index} className="worksheet-cell">
    <WorksheetCell
      char={cell.char}
      style={cell.style}
      size={cellSize}
      fontFamily={props.fontFamily}
    />
  </div>
))}
```

#### CSS grid for brush modes

`app/globals.css` — add 3 new grid classes:

```css
.worksheet-grid--brush-12 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.worksheet-grid--brush-24 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.worksheet-grid--brush-28 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
```

Layout: 12=4×3, 24=6×4, 28=7×4. The `minmax(0, 1fr)` matches the existing grid pattern.

### Section 4 — UX wiring: auto-pick font + title required

#### Auto-pick font (in `WorksheetGenerator.tsx`)

The `handleCellStyleChange` function above already calls `setFontFamily(defaultFontFor(next))`. The initial state also uses the default:

```ts
const [cellStyle, setCellStyle] = useState<CellStyle>('brush');
const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor('brush'));  // 'ma-shan-zheng'
```

The font picker still shows all 9 fonts in 3 groups. The user can override the auto-picked font at any time. The next time they change cell style, the auto-pick fires again.

#### Title required on `RandomTab`

`components/worksheet/RandomTab.tsx` — add a title input + validation:

```tsx
interface Props {
  title: string;                    // NEW
  onTitleChange: (v: string) => void;  // NEW
  onPicked: (chars: string[]) => void;
}

export function RandomTab({ title, onTitleChange, onPicked }: Props) {
  // ...
  async function handleGenerate() {
    if (title.trim() === '') {
      setErr('请先填写字帖标题');
      return;
    }
    // ... existing fetch + onPicked logic
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
      {/* existing count + difficulty grid */}
    </div>
  );
}
```

The title state lives in `WorksheetGenerator` (already does). The Random tab consumes + emits; the parent owns the state. This keeps the existing `setTitle` flow intact for text/library tabs.

`WorksheetGenerator.tsx` — pass the new props to `<RandomTab>`:

```tsx
{tab === 'random' ? (
  <RandomTab
    title={title}
    onTitleChange={setTitle}
    onPicked={(chars) => { setContent(chars); setView('preview'); }}
  />
) : /* ... */}
```

#### Save flow (unchanged)

The save handler already sends `title || '字帖 <date>'` to `/api/worksheets`. After G3, the random-tab flow always has a non-empty title by the time the user reaches save, so the fallback is only triggered for the text/library tabs (where the title is still optional, matching today's behavior).

---

## Risks

- **R1 — DB ENUM migration timing:** If code reads/writes `paper_size='brush-12'` before the column is ALTERed, MySQL throws `Data truncated for column 'paper_size'`. Mitigation: apply the migration to both prod + dev first; commit code only after the migration runs successfully.
- **R2 — Brush fonts may not subset cleanly:** Long Cang and Ma Shan Zheng have very different glyph coverage from the hard-pen fonts. If the subset script hits an error, the build fails. Mitigation: run the download + subset scripts locally first; verify WOFF2 files exist with non-zero size before committing.
- **R3 — `Long Cang` has fewer CJK glyphs than `Ma Shan Zheng`:** Long Cang is a single 草书 (cursive) font with ~3,000 glyphs vs. ~7,000 in Ma Shan Zheng. If a user picks a rare char (level 3) with `long-cang`, the browser falls back to system fonts for that char. Acceptable; matches how existing fallback chains work for Yozai/Iansui.
- **R4 — Larger cells may break print layout:** A 200px cell × 4 cols × 3 rows + header doesn't fit a single A4 page. Mitigation: brush mode uses a "free-form" page (no `@page size: A4`); CSS `worksheet-grid--brush-12` etc. let the cells flow across multiple printed pages naturally. The existing `@page { size: ${paperSize} }` style in `WorksheetPreview` is kept but the brush modes don't constrain print size — the page is whatever the printer defaults to (typically A4). This matches the user's mental model of "大字 practice sheets are tall."
- **R5 — `defaultFontFor` hardcodes font names in the type union:** If we add a new brush font in the future, the switch must be updated. Mitigation: keep the function next to `FONT_FAMILIES` and add a unit test that asserts each cell style maps to a font in the matching group.
- **R6 — `validateWorksheetInput` widening `paperSize`:** The new guard catches API callers sending invalid values. If the test suite doesn't cover this guard, a future refactor could silently drop it. Mitigation: add a unit test in `tests/unit/lib/worksheet-types.test.ts` for the new error message.

## Out of scope

- No new cell style (e.g., 临帖格 with red baseline overlays) — brush mode uses the existing `brush` cell style SVG (border + vertical + diagonals).
- No brush font weight variants (e.g., Ma Shan Zheng Bold) — both fonts are single-weight.
- No brush font subsetting to user-chosen chars (always subsets to GB2312-7000).
- No pinyin / 注音 / 部首 annotations on brush worksheets.
- No print alignment adjustments specific to brush mode.
- No new API endpoint (the existing `POST /api/worksheets` accepts the widened `paperSize`).
- No changes to `/admin/fonts` (fonts are still static build artifacts).

## Verification

- `pnpm tsc --noEmit` → exit 0.
- `pnpm build` → green, 30+ routes.
- Unit tests:
  - `tests/unit/lib/worksheet-types.test.ts` — new:
    - `defaultFontFor('brush')` returns `'ma-shan-zheng'`
    - `defaultFontFor('pen')` returns `'wenkai-gb'`
    - `defaultFontFor('square')` returns `'song'`
    - `defaultFontFor('cross')` returns `'song'`
    - `validateWorksheetInput` with `paperSize: 'brush-12'` returns ok
    - `validateWorksheetInput` with `paperSize: 'nonsense'` returns the new error
  - `tests/unit/lib/worksheet-page-count.test.ts` (or extend existing) — `cellsPerPage('brush-12')` returns 12, etc.
  - `tests/unit/components/worksheet/BrushModePicker.test.tsx` (NEW) — 3 buttons render, onChange fires, selected highlighted.
  - `tests/unit/components/worksheet/RandomTab.test.tsx` (extend existing or NEW) — empty title blocks generate, valid title proceeds.
- Integration: `POST /api/worksheets` with `paperSize: 'brush-12'` returns 200; DB row has `paper_size='brush-12'`.
- Manual smoke:
  1. `pnpm dev` (port 4444)
  2. Visit `http://localhost:4444/worksheet/new`
  3. **Default**: cell style = 毛笔格, paper size = `12 字 · 毛笔`, font = `马善政体 (毛笔正书)`, cells rendered at 200px.
  4. Switch to 钢笔格 → paper size flips to A4, font flips to `霞鹜文楷 GB`.
  5. Switch to 田字格 → font flips to 宋体.
  6. Click 随机生成 without title → see `请先填写字帖标题` error.
  7. Type title, click 随机生成 → preview shows brush worksheet with brush font.
  8. Change brush mode 12 → 24 → preview re-renders with smaller cells.
  9. Open print preview → cells render correctly across pages.

## Commit plan

1. `feat(worksheet): add 2 OFL brush fonts (Ma Shan Zheng + Long Cang)` — subset pipeline + @font-face + tokens + license doc
2. `feat(worksheet): extend FontFamily to 9 (add brush group)` — types + FONT_FAMILIES + GROUPS
3. `feat(worksheet): widen paper_size to 6 (add brush-12/24/28)` — DB migration + BrushModePicker + PaperSizePicker conditional + cellsPerPage + validateWorksheetInput guard
4. `feat(worksheet): larger brush cells (200/150/120 px by mode)` — WorksheetCell guide font-size + WorksheetPreview cellSizeFor + globals.css grid classes
5. `feat(worksheet): auto-pick font by cell style + defaultFontFor()` — wiring in WorksheetGenerator
6. `feat(worksheet): title required on RandomTab` — input + validation

Final commit: verification (tsc + test + build, no commit).
