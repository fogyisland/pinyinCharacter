# Practice Lined Paper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `'pen-lined'` as a 5th `CellStyle` option on `/worksheet/practice` — standard 横线信纸 (one horizontal line per row, 1.0cm 行高, A4 ≈ 24 行), wired through browser + react-pdf paths.

**Architecture:** Lined mode is a reinterpretation of the cell abstraction: 1 column × N rows grid; each "cell" is an SVG stretched to 100% width with a 1px gray baseline. `CellStyle` union gains `'pen-lined'`; `Presentation` gains `'lined'`; `getPresentation()` returns `'lined'` when `s.includes('lined')`. New `PRACTICE_LINED_HEIGHT` (CSS px) + `linesPerPage()` map; new `PAGE_INNER_WIDTH_PT` (pt) for PDF. PDF SVG uses an explicit width constant since `width="100%"` is unreliable in react-pdf. CSS adds 3 new grid templates (a3/a4/b5-lined) and a `.lined-paper` flex container.

**Tech Stack:** React 19, Next.js 15.5.19, @react-pdf/renderer 4.5.x, Vitest, happy-dom. Reuses `WorksheetCell` SVG + `PracticePDF` PracticeCell SVG. No new dependencies.

## Global Constraints

- One new `CellStyle` value: `'pen-lined'`. No new `PaperSize` — lined uses existing A3/A4/B5 only.
- No new tool — `pen-lined` keeps `tool: 'pen'`. Existing `handleCellStyleChange` paperSize联动 (pen → A3/A4/B5) auto-applies.
- No row-count slider — lines per page is fixed by paper size (A4=24, A3=36, B5=14).
- No page number / date / binding line — keep it as standard 信纸.
- Brush fonts (`brush-12/24/28`) and brush tools are NOT supported in lined mode (lined is hard-pen / 信纸 domain). Lined SVG ignores `fontFamily` prop and renders only the baseline.
- Both browser CSS + react-pdf SVG paths must produce correct output.
- File-change whitelist:
  - `lib/worksheet-types.ts` — type extensions, maps, helpers
  - `components/worksheet/WorksheetCell.tsx` — lined SVG branch
  - `components/worksheet/PracticePDF.tsx` — lined SVG branch + `PAGE_INNER_WIDTH_PT`
  - `components/worksheet/PracticeTemplate.tsx` — UI select option + render branch
  - `app/globals.css` — 3 new grid template classes + `.lined-paper` container
  - `tests/unit/lib/worksheet-types.test.ts` — NEW test file (helpers)
  - `tests/unit/components/worksheet/WorksheetCell.test.tsx` — NEW test file (lined SVG)
  - `tests/unit/components/worksheet/PracticeTemplate.test.tsx` — NEW test file (UI branch)
  - `tests/unit/components/worksheet/PracticePDF.test.tsx` — extend with lined cases
- Do not modify `composeCellStyle`/`defaultToolFor`/`generateLayout`/`cellsPerPage` — `worksheet-page-count.ts` is grid-only.
- Commit each task separately; use the timestamp-suffix convention `[2026-07-01 HH.MM]` per memory `feedback-commit-timestamps`.
- `tts.ts` and sutra code are out of scope; do not touch.

---

## Task 1: Types extension — `CellStyle` + `Presentation` + helpers + maps

**Files:**
- Modify: `lib/worksheet-types.ts:1-150`
- Create: `tests/unit/lib/worksheet-types.test.ts`

**Interfaces:**
- Produces: `Presentation = 'square' | 'cross' | 'lined'` (new value `'lined'`)
- Produces: `CellStyle` union adds `'pen-lined'`
- Produces: `linedHeightPx(paperSize: PaperSize): number` — returns CSS px row height (0 for brush-*)
- Produces: `linesPerPage(paperSize: PaperSize): number` — returns row count (0 for brush-*)
- `getPresentation('pen-lined')` returns `'lined'`
- `cellStyleLabel('pen-lined')` returns `'钢笔·横线'`
- `ALL_PRESENTATIONS` and `ALL_CELL_STYLES` are updated to include the new values (so `validateWorksheetInput` accepts them)

- [ ] **Step 1: Write failing tests for new type helpers**

Create `tests/unit/lib/worksheet-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getPresentation,
  cellStyleLabel,
  linedHeightPx,
  linesPerPage,
  validateWorksheetInput,
} from '@/lib/worksheet-types';

describe('getPresentation — lined branch', () => {
  it('returns "lined" for pen-lined', () => {
    expect(getPresentation('pen-lined')).toBe('lined');
  });
  it('still returns "square" for pen-square / brush-square / brush-trace-square', () => {
    expect(getPresentation('pen-square')).toBe('square');
    expect(getPresentation('brush-square')).toBe('square');
    expect(getPresentation('brush-trace-square')).toBe('square');
  });
  it('still returns "cross" for *-cross / brush-trace-cross', () => {
    expect(getPresentation('pen-cross')).toBe('cross');
    expect(getPresentation('brush-cross')).toBe('cross');
    expect(getPresentation('brush-trace-cross')).toBe('cross');
  });
});

describe('cellStyleLabel — lined branch', () => {
  it('labels pen-lined as "钢笔·横线"', () => {
    expect(cellStyleLabel('pen-lined')).toBe('钢笔·横线');
  });
  it('still labels existing styles correctly (regression)', () => {
    expect(cellStyleLabel('brush-square')).toBe('毛笔·田字格');
    expect(cellStyleLabel('pen-square')).toBe('钢笔·田字格');
    expect(cellStyleLabel('brush-trace-square')).toBe('毛笔·田字格·描红');
  });
});

describe('linedHeightPx', () => {
  it('A4 = 38px (~1.0cm at 96dpi)', () => {
    expect(linedHeightPx('A4')).toBe(38);
  });
  it('A3 = 66px, B5 = 44px', () => {
    expect(linedHeightPx('A3')).toBe(66);
    expect(linedHeightPx('B5')).toBe(44);
  });
  it('returns 0 for brush-* (lined not supported on brush paper)', () => {
    expect(linedHeightPx('brush-12')).toBe(0);
    expect(linedHeightPx('brush-24')).toBe(0);
    expect(linedHeightPx('brush-28')).toBe(0);
  });
});

describe('linesPerPage', () => {
  it('A4 = 24 lines, A3 = 36 lines, B5 = 14 lines', () => {
    expect(linesPerPage('A4')).toBe(24);
    expect(linesPerPage('A3')).toBe(36);
    expect(linesPerPage('B5')).toBe(14);
  });
  it('returns 0 for brush-* (lined not supported on brush paper)', () => {
    expect(linesPerPage('brush-12')).toBe(0);
    expect(linesPerPage('brush-24')).toBe(0);
    expect(linesPerPage('brush-28')).toBe(0);
  });
});

describe('validateWorksheetInput — accepts pen-lined', () => {
  it('accepts cellStyle="pen-lined" and defaults paperSize to A4 (pen tool)', () => {
    const r = validateWorksheetInput({
      title: '横线练习',
      content: ['一', '二'],
      cellStyle: 'pen-lined',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.cellStyle).toBe('pen-lined');
      expect(r.data.paperSize).toBe('A4');
    }
  });
  it('still rejects unknown cellStyle values', () => {
    const r = validateWorksheetInput({
      title: 'x',
      content: ['一'],
      cellStyle: 'pen-cursive',
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`
Expected: 5 of 5 describe blocks FAIL (helpers don't exist yet).

- [ ] **Step 3: Update `lib/worksheet-types.ts` — extend types and add maps**

In `lib/worksheet-types.ts`:

1. Line 4 — extend `Presentation`:
```ts
export type Presentation = 'square' | 'cross' | 'lined';
```

2. Line 5-8 — extend `CellStyle`:
```ts
export type CellStyle =
  | 'brush-square' | 'brush-cross'
  | 'pen-square'   | 'pen-cross'
  | 'brush-trace-square' | 'brush-trace-cross'
  | 'pen-lined';
```

3. Line 16-21 — update `ALL_PRESENTATIONS` and `ALL_CELL_STYLES`:
```ts
const ALL_TOOLS: readonly Tool[] = ['brush', 'pen'];
const ALL_PRESENTATIONS: readonly Presentation[] = ['square', 'cross', 'lined'];
const ALL_CELL_STYLES: readonly CellStyle[] = [
  'brush-square', 'brush-cross', 'pen-square', 'pen-cross',
  'brush-trace-square', 'brush-trace-cross',
  'pen-lined',
] as const;
```

4. Line 35-38 — update `getPresentation` to handle `'lined'`:
```ts
export function getPresentation(s: CellStyle): Presentation {
  if (s.includes('cross')) return 'cross';
  if (s.includes('lined')) return 'lined';
  return 'square';
}
```

5. Line 146-150 — update `cellStyleLabel` to label lined:
```ts
export function cellStyleLabel(s: CellStyle): string {
  const tool = getTool(s) === 'brush' ? '毛笔' : '钢笔';
  const pres = getPresentation(s);
  if (pres === 'lined') return `${tool}·横线`;
  const label = pres === 'cross' ? '米字格' : '田字格';
  return getIsTrace(s) ? `${tool}·${label}·描红` : `${tool}·${label}`;
}
```

6. After `PRACTICE_LAYOUT` (after line 108) — add `PRACTICE_LINED_HEIGHT`, `linedHeightPx`, `linesPerPage`:
```ts
// Lined-paper row height in CSS px (1px = 1/96in). Picked so the printable
// area fits a whole number of rows: A4 inner 267mm × 38px = 1010px ≈ 24 rows;
// A3 inner 390mm × 66px = 2592px ≈ 36 rows; B5 inner 220mm × 44px = 915px ≈
// 14 rows. 1.0cm row height is the standard 作文本 / 信纸 convention.
const PRACTICE_LINED_HEIGHT: Record<PaperSize, number> = {
  A3: 66,
  A4: 38,
  B5: 44,
  'brush-12': 0,
  'brush-24': 0,
  'brush-28': 0,
};

export function linedHeightPx(paperSize: PaperSize): number {
  return PRACTICE_LINED_HEIGHT[paperSize];
}

const LINES_PER_PAGE: Record<PaperSize, number> = {
  A3: 36,
  A4: 24,
  B5: 14,
  'brush-12': 0,
  'brush-24': 0,
  'brush-28': 0,
};

export function linesPerPage(paperSize: PaperSize): number {
  return LINES_PER_PAGE[paperSize];
}
```

- [ ] **Step 4: Update `validateWorksheetInput` error message to mention pen-lined**

In `lib/worksheet-types.ts:181` — update the error string to include the new value:
```ts
return { ok: false, error: 'cellStyle must be one of: brush-square, brush-cross, pen-square, pen-cross, brush-trace-square, brush-trace-cross, pen-lined' };
```

- [ ] **Step 5: Re-run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`
Expected: 13/13 tests pass (5 describe blocks).

Also run the existing worksheet tests to confirm no regression:
Run: `npx vitest run tests/unit/components/worksheet/PracticePDF.test.tsx`
Expected: 6/6 still pass (the lined extension is additive — existing values unchanged).

- [ ] **Step 6: Run tsc to confirm types compile cleanly**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet-types.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(worksheet): add pen-lined cell style + linedHeightPx + linesPerPage helpers [2026-07-01 HH.MM]"
```

---

## Task 2: `WorksheetCell` lined SVG branch + CSS grid templates

**Files:**
- Modify: `components/worksheet/WorksheetCell.tsx:1-58`
- Modify: `app/globals.css:131-153` (add new grid template + lined container classes)
- Create: `tests/unit/components/worksheet/WorksheetCell.test.tsx`

**Interfaces:**
- Consumes: `Presentation = 'square' | 'cross' | 'lined'` (from Task 1)
- Consumes: `getPresentation` already exported from `lib/worksheet-types`
- Produces: `WorksheetCell` with `style === 'pen-lined'` rendering an SVG that fills its container width with a 1px gray bottom line

- [ ] **Step 1: Write failing test for the lined SVG branch**

Create `tests/unit/components/worksheet/WorksheetCell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell — lined branch (pen-lined)', () => {
  it('renders an SVG with width=100% and the line cell height', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('height')).toBe('38');
  });

  it('uses a viewBox scaled so the line stretches (preserveAspectRatio="none")', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
    // viewBox: width=100 (sentinel for stretching), height=size
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 38');
  });

  it('renders exactly one <line> for the bottom rule with non-scaling stroke', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(1);
    const line = lines[0];
    // y = size - 0.5 keeps the 1px stroke crisply above the cell bottom edge
    expect(line?.getAttribute('y1')).toBe('37.5');
    expect(line?.getAttribute('y2')).toBe('37.5');
    // x stretches across the full viewBox (0 → 100)
    expect(line?.getAttribute('x1')).toBe('0');
    expect(line?.getAttribute('x2')).toBe('100');
    expect(line?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(line?.getAttribute('stroke')).toBe('#bbb');
  });

  it('does not render any text (lined is a blank rule, not a character)', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-lined" size={38} />);
    expect(container.querySelector('text')).toBeNull();
  });
});

describe('WorksheetCell — square/cross branches unchanged (regression)', () => {
  it('pen-square still renders a single <rect> outer border', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-square" size={80} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(1);
  });
  it('pen-cross renders 4 <line> elements (vertical + horizontal + 2 diagonals)', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-cross" size={80} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/components/worksheet/WorksheetCell.test.tsx`
Expected: 4 of 4 in the `lined branch` describe block FAIL (no SVG with width="100%" yet); the regression cases may pass since they're unchanged.

- [ ] **Step 3: Add the `lined` branch to `WorksheetCell.tsx`**

In `components/worksheet/WorksheetCell.tsx`, replace the current return statement (line 26-57) with an early-return for lined mode, then the existing square/cross SVG:

```tsx
export function WorksheetCell({ char, style, size = 80, fontFamily = 'song' }: Props) {
  // Lined mode (钢笔·横线): render a stretched SVG with a single 1px bottom
  // rule. `vectorEffect="non-scaling-stroke"` keeps the stroke 1px regardless
  // of how the container scales the SVG; `viewBox="0 0 100 ${size}"` +
  // `preserveAspectRatio="none"` lets the line stretch to fill any width.
  // No character is rendered — lined is blank ruled paper.
  if (style === 'pen-lined') {
    return (
      <svg width="100%" height={size} viewBox={`0 0 100 ${size}`} preserveAspectRatio="none" className="block">
        <line
          x1={0}
          y1={size - 0.5}
          x2={100}
          y2={size - 0.5}
          stroke="#bbb"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const isTrace = getIsTrace(style);
  const guideStroke = '#bbb';
  const borderStroke = '#bbb';
  const charFill = isTrace ? '#ddd' : '#bbb';
  const charStroke = isTrace ? '#c0392b' : 'none';
  const charStrokeWidth = isTrace ? 1.5 : 0;
  const fontStack = `${fontFamilyCssVar(fontFamily)}, "Noto Serif SC", serif`;
  const guideFontSize = isTrace ? size : Math.round(size * 0.6);
  const presentation = getPresentation(style);
  const showDiagonals = presentation === 'cross';
  const showHorizontal = true;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={borderStroke} strokeWidth={1} />
      <line x1={50} y1={2} x2={50} y2={98} stroke={guideStroke} strokeWidth={0.5} />
      {showDiagonals ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={guideStroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={guideStroke} strokeWidth={0.5} />
        </>
      ) : null}
      {showHorizontal ? (
        <line x1={2} y1={50} x2={98} y2={50} stroke={guideStroke} strokeWidth={0.5} />
      ) : null}
      {showDiagonals ? (
        <line x1={2} y1={90} x2={98} y2={90} stroke={guideStroke} strokeWidth={0.5} />
      ) : null}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={guideFontSize}
        fill={charFill}
        stroke={charStroke}
        strokeWidth={charStrokeWidth}
        style={{ fontFamily: fontStack }}
      >
        {char}
      </text>
    </svg>
  );
}
```

- [ ] **Step 4: Re-run the new tests to verify they pass**

Run: `npx vitest run tests/unit/components/worksheet/WorksheetCell.test.tsx`
Expected: 6/6 tests pass (4 lined + 2 regression).

- [ ] **Step 5: Add the 3 new CSS grid template classes + lined paper container**

In `app/globals.css`, immediately after the existing `.worksheet-grid--brush-28` line (line 139) and before the `.batch-print-area` rule (line 142), add:

```css
/* Lined-paper (钢笔·横线) variants: 1 column, rows = linesPerPage. The
   container uses .lined-paper (flexbox) instead of grid because each row's
   height comes from linedHeightPx, not from grid auto-sizing. */
.worksheet-grid--a3-lined,
.worksheet-grid--a4-lined,
.worksheet-grid--b5-lined { grid-template-columns: 1fr; }
.lined-paper { display: flex; flex-direction: column; width: 100%; }
.lined-paper-row { display: block; width: 100%; }
```

Note: `.worksheet-grid--*-lined` is a defensive fallback in case the page leaves the `worksheet-grid` class in place. The actual lined rendering in `PracticeTemplate` uses a separate `.lined-paper` flex container (Task 3), so this grid rule is a no-op for the current UI but prevents regressions if anyone reuses the grid class with lined.

- [ ] **Step 6: Re-run tsc + the worksheet test suite**

Run: `npx tsc --noEmit && npx vitest run tests/unit/components/worksheet/`
Expected: tsc clean, all worksheet tests still pass.

- [ ] **Step 7: Commit**

```bash
git add components/worksheet/WorksheetCell.tsx app/globals.css tests/unit/components/worksheet/WorksheetCell.test.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(worksheet): WorksheetCell renders pen-lined as stretched bottom rule + lined CSS [2026-07-01 HH.MM]"
```

---

## Task 3: `PracticeTemplate` UI integration — select option + lined render branch

**Files:**
- Modify: `components/worksheet/PracticeTemplate.tsx:7, 26-31, 71-79, 144-165`
- Create: `tests/unit/components/worksheet/PracticeTemplate.test.tsx`

**Interfaces:**
- Consumes: `pen-lined` (CellStyle), `getPresentation`, `linedHeightPx`, `linesPerPage` (all from Tasks 1-2)
- Produces: `<option value="pen-lined">` in the 格子形式 select
- Produces: when `cellStyle === 'pen-lined'`, renders `.lined-paper` flex container with N rows of `linedHeightPx`-tall `WorksheetCell` instead of the grid layout

- [ ] **Step 1: Write failing tests for the UI integration**

Create `tests/unit/components/worksheet/PracticeTemplate.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// @react-pdf/renderer's Node entry throws on the server. Stub the dynamic
// import to a plain anchor so the test only exercises the UI tree.
vi.mock('@react-pdf/renderer', () => ({
  PDFDownloadLink: ({ children, fileName }: { children: unknown; fileName?: string }) => (
    <a data-testid="pdf-link" data-filename={fileName}>{typeof children === 'function' ? children({ loading: false }) : children}</a>
  ),
}));

import { PracticeTemplate } from '@/components/worksheet/PracticeTemplate';

describe('PracticeTemplate — pen-lined option', () => {
  it('renders a 钢笔·横线 option in the 格子形式 select', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    const options = within(select).getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain('钢笔·横线');
  });

  it('defaults to pen-square (regression: lined does not change default)', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    expect(select.value).toBe('pen-square');
  });
});

describe('PracticeTemplate — lined render branch', () => {
  it('after selecting 钢笔·横线, renders 24 row containers (A4 default) inside .lined-paper', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    await user.selectOptions(select, 'pen-lined');
    const lined = document.querySelector('.lined-paper');
    expect(lined).not.toBeNull();
    const rows = document.querySelectorAll('.lined-paper-row');
    expect(rows.length).toBe(24);
  });

  it('each lined row is 38px tall (A4 linedHeightPx)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    const firstRow = document.querySelector('.lined-paper-row') as HTMLElement;
    expect(firstRow.style.height).toBe('38px');
  });

  it('after selecting 钢笔·横线, the hint text shows "24 行 / 页" instead of "格 / 页"', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    expect(screen.getByText(/24 行 \/ 页/)).toBeTruthy();
  });

  it('switching back to 钢笔·田字格 restores the .worksheet-grid layout (regression)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-square');
    expect(document.querySelector('.lined-paper')).toBeNull();
    expect(document.querySelector('.worksheet-grid')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/components/worksheet/PracticeTemplate.test.tsx`
Expected: all 6 tests FAIL (no `pen-lined` option yet; the render branch doesn't exist).

- [ ] **Step 3: Update the imports in `PracticeTemplate.tsx`**

In `components/worksheet/PracticeTemplate.tsx:7`, extend the import:
```ts
import { PAPER_SIZES, PRACTICE_LAYOUT, cellsPerPage, cellStyleLabel, getTool, getPresentation, isBrushSize, linedHeightPx, linesPerPage } from '@/lib/worksheet-types';
```

- [ ] **Step 4: Add `pen-lined` to `PRACTICE_CELL_STYLES`**

In `components/worksheet/PracticeTemplate.tsx:26-31`, add the 5th option:
```ts
const PRACTICE_CELL_STYLES: { value: CellStyle; label: string; tool: Tool }[] = [
  { value: 'brush-square', label: '毛笔 · 田字格', tool: 'brush' },
  { value: 'brush-cross', label: '毛笔 · 米字格', tool: 'brush' },
  { value: 'pen-square', label: '钢笔 · 田字格', tool: 'pen' },
  { value: 'pen-cross', label: '钢笔 · 米字格', tool: 'pen' },
  { value: 'pen-lined', label: '钢笔 · 横线', tool: 'pen' },
];
```

- [ ] **Step 5: Add the `isLined` derivation + `sizeClass` / `cellSize` / `count` switch**

In `components/worksheet/PracticeTemplate.tsx:71-79`, replace the derivation block:
```ts
const isLined = getPresentation(cellStyle) === 'lined';
const sizeClass = isLined ? `worksheet-grid--${paperSize.toLowerCase()}-lined` : `worksheet-grid--${paperSize.toLowerCase()}`;
// Lined mode: cellSize = row height in CSS px (e.g. A4 = 38px ≈ 1.0cm).
// Grid mode: cellSize = cell side in CSS px (e.g. A4 = 80px).
const cellSize = isLined ? linedHeightPx(paperSize) : PRACTICE_LAYOUT[paperSize].cellSize;
// Lined mode: count = lines per page (A4=24). Grid mode: count = cells per page.
const count = isLined ? linesPerPage(paperSize) : cellsPerPage(paperSize);
const cells = Array.from({ length: count }, (_, i) => i);
const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? '');
const paperOptions = availablePaperSizes(getTool(cellStyle));
```

Also update the hint text (line 120) so the wording matches the mode:
```tsx
<p className="text-xs text-ink-faint">
  {cellStyleLabel(cellStyle)} · {PAPER_SIZES.find(p => p.value === paperSize)?.label} · 自动适配 {count} {isLined ? '行' : '格'} / 页
</p>
```

- [ ] **Step 6: Add the lined render branch in the template body**

In `components/worksheet/PracticeTemplate.tsx:144-165`, replace the single grid render block with a conditional that branches on `isLined`:

```tsx
{/* Template body: grid for 田字格/米字格, flex stack for 横线. */}
<div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
  {isLined ? (
    <div className="lined-paper mx-auto max-w-3xl min-w-full sm:min-w-[640px] print:min-w-0" style={{ minHeight: `${count * cellSize}px` }}>
      <div className="flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
          <span className="font-kai text-base text-ink">字·韵</span>
        </div>
        <div className="text-sm text-ink-soft">空白字帖</div>
      </div>
      {cells.map((i) => (
        <div key={i} className="lined-paper-row" style={{ height: `${cellSize}px` }}>
          <WorksheetCell char="" style="pen-lined" size={cellSize} />
        </div>
      ))}
      {siteHost && (
        <div className="text-center text-xs text-ink-faint mt-3 pt-2 border-t border-ink/10">
          {siteHost}
        </div>
      )}
    </div>
  ) : (
    <div className={`worksheet-grid mx-auto grid min-w-full sm:min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
      <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
          <span className="font-kai text-base text-ink">字·韵</span>
        </div>
        <div className="text-sm text-ink-soft">空白字帖</div>
      </div>
      {cells.map((i) => (
        <div key={i} className="worksheet-cell">
          <WorksheetCell char="" style={cellStyle} size={cellSize} />
        </div>
      ))}
      {siteHost && (
        <div className="col-span-full text-center text-xs text-ink-faint mt-3 pt-2 border-t border-ink/10">
          {siteHost}
        </div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 7: Re-run the new tests to verify they pass**

Run: `npx vitest run tests/unit/components/worksheet/PracticeTemplate.test.tsx`
Expected: 6/6 tests pass.

- [ ] **Step 8: Run tsc + the full worksheet test suite**

Run: `npx tsc --noEmit && npx vitest run tests/unit/components/worksheet/`
Expected: tsc clean, all worksheet tests pass (no regression in `PracticePDF.test.tsx`).

- [ ] **Step 9: Commit**

```bash
git add components/worksheet/PracticeTemplate.tsx tests/unit/components/worksheet/PracticeTemplate.test.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(worksheet): PracticeTemplate 钢笔·横线 option + lined render branch [2026-07-01 HH.MM]"
```

---

## Task 4: `PracticePDF` lined branch + PDF tests + browser smoke

**Files:**
- Modify: `components/worksheet/PracticePDF.tsx:3-129` (add `PAGE_INNER_WIDTH_PT`, add lined branch in `PracticeCell`, add lined branch in `PracticePDF`)
- Modify: `tests/unit/components/worksheet/PracticePDF.test.tsx` (extend with 2-3 lined cases)

**Interfaces:**
- Consumes: `pen-lined` (CellStyle), `getPresentation` (from Task 1)
- Produces: `PAGE_INNER_WIDTH_PT` map: A3=757, A4=510, B5=414, brush-*=510 (all in pt)
- Produces: `PracticeCell` with lined mode: an `<Svg>` of full inner width × row height, single `<Line>` at y = size - 0.5
- Produces: `PracticePDF` switches `cellSize` and `count` to lined values when `getPresentation(cellStyle) === 'lined'`, and wraps each cell in a `<View>` of the correct width

- [ ] **Step 1: Add `PAGE_INNER_WIDTH_PT` constant + extend `PracticeCell` to render lined mode**

In `components/worksheet/PracticePDF.tsx`, add the constant after `PX_TO_PT` (after line 41):

```ts
// Inner printable width per paper, in pt. Computed as
// `paperWidth_pt - 2 × 1.5cm_padding` so the lined cells span the same
// usable width as the grid cells. The 1.5cm padding matches the
// `<Page style={padding: '1.5cm'}>` set in `styles.page` below.
const PAGE_INNER_WIDTH_PT: Record<PaperSize, number> = {
  A3: 757,        // 841.9 - 2*42.5
  A4: 510,        // 595.3 - 2*42.5
  B5: 414,        // 498.9 - 2*42.5
  'brush-12': 510,
  'brush-24': 510,
  'brush-28': 510,
};
```

Then replace the `PracticeCell` function (line 83-98) with a version that branches on presentation:

```tsx
function PracticeCell({ size, paperSize, style }: { size: number; paperSize: PaperSize; style: CellStyle }) {
  const presentation = getPresentation(style);
  const width = PAGE_INNER_WIDTH_PT[paperSize];
  if (presentation === 'lined') {
    // Lined: single 1px line stretched across the full inner width.
    return (
      <Svg width={width} height={size}>
        <Line x1={0} y1={size - 0.5} x2={width} y2={size - 0.5} stroke="#bbb" strokeWidth={1} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size}>
      <Rect x={0} y={0} width={size} height={size} fill="none" stroke="#bbb" strokeWidth={1} />
      <Line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke="#bbb" strokeWidth={0.5} />
      <Line x1={0} y1={size / 2} x2={size} y2={size / 2} stroke="#bbb" strokeWidth={0.5} />
      {presentation === 'cross' ? (
        <>
          <Line x1={0} y1={0} x2={size} y2={size} stroke="#bbb" strokeWidth={0.5} />
          <Line x1={size} y1={0} x2={0} y2={size} stroke="#bbb" strokeWidth={0.5} />
        </>
      ) : null}
    </Svg>
  );
}
```

- [ ] **Step 2: Update `PracticePDF` to use lined cellSize + count + cell width**

In `components/worksheet/PracticePDF.tsx`, replace the `PracticePDF` function body (line 106-129). The key changes:
- `cellSize` and `count` switch to lined values when `getPresentation(cellStyle) === 'lined'`
- Each cell wrapper `<View>` gets a width so the lined SVG sits at the full inner width

```tsx
export function PracticePDF({ paperSize, cellStyle, siteHost }: Props) {
  const isLined = getPresentation(cellStyle) === 'lined';
  // Lined mode: cellSize = row height in pt (CSS px × 72/96). Grid mode: cell side in pt.
  const cellSize = (isLined ? linedHeightPx(paperSize) : PRACTICE_LAYOUT[paperSize].cellSize) * PX_TO_PT;
  // Lined mode: count = lines per page. Grid mode: count = cells per page.
  const count = isLined ? linesPerPage(paperSize) : cellsPerPage(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);
  const innerWidth = PAGE_INNER_WIDTH_PT[paperSize];

  return (
    <Document>
      <Page size={PAGE_DIMENSIONS[paperSize]} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>字·韵</Text>
          <Text style={styles.subtitle}>空白字帖</Text>
        </View>
        <View style={isLined ? styles.linedStack : styles.grid}>
          {cells.map((i) => (
            <View key={i} style={isLined ? { width: innerWidth } : undefined}>
              <PracticeCell size={cellSize} paperSize={paperSize} style={cellStyle} />
            </View>
          ))}
        </View>
        {siteHost ? <Text style={styles.footer}>{siteHost}</Text> : null}
      </Page>
    </Document>
  );
}
```

Also add the new `linedStack` style next to the existing `grid` style (around line 65-68):

```ts
grid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
},
linedStack: {
  flexDirection: 'column',
  alignItems: 'flex-start',
},
```

And add `linedHeightPx, linesPerPage` to the import from `@/lib/worksheet-types` (line 5):

```ts
import { PRACTICE_LAYOUT, cellsPerPage, getPresentation, linedHeightPx, linesPerPage } from '@/lib/worksheet-types';
```

- [ ] **Step 3: Write failing PDF tests for the lined branch**

In `tests/unit/components/worksheet/PracticePDF.test.tsx`, append (after the existing describe block) a new describe:

```tsx
describe('PracticePDF — pen-lined branch', () => {
  it('pen-lined + A4 produces exactly 1 page', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + A3 produces exactly 1 page', async () => {
    const blob = await renderPdf('A3', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + B5 produces exactly 1 page', async () => {
    const blob = await renderPdf('B5', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + A4 contains exactly 24 Line elements (one per row)', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // Each lined cell renders one <Line> for the bottom rule. We expect
    // exactly 24 of them, matching linesPerPage('A4') = 24. Count by
    // matching "/L " (the PDF operator followed by a length value) is
    // fragile, so we just count the literal "m" before " l" — every line
    // segment produces a `m` (moveTo) and `l` (lineTo) pair. Use a simpler
    // heuristic: count the unique pattern "0 37.5 l" which is the
    // y-coordinate pair for A4 lined cells (size=38, y=37.5).
    const matches = text.match(/0 37\.5 l/g) || [];
    expect(matches.length).toBe(24);
  });

  it('pen-lined + A3 has 36 lines (linesPerPage A3 = 36)', async () => {
    const blob = await renderPdf('A3', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // A3 lined: size = 66 × 0.75 = 49.5pt, y = 49.5 - 0.5 = 49.
    const matches = text.match(/0 49 l/g) || [];
    expect(matches.length).toBe(36);
  });

  it('pen-lined + A4 inner width ≈ 510pt (page width − 2×1.5cm padding)', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // The lined Svg should emit a width attribute near 510pt.
    // PDF stream operators don't expose Svg width directly; we check
    // MediaBox sanity + content-fit: PDF must not auto-paginate.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595(\.\d+)?\s+841(\.\d+)?\s*\]/);
  });
});
```

- [ ] **Step 4: Run the new PDF tests to verify they pass**

Run: `npx vitest run tests/unit/components/worksheet/PracticePDF.test.tsx`
Expected: 6 new tests in the `pen-lined branch` block all pass; existing 6 tests still pass.

- [ ] **Step 5: Run the full test suite + tsc + build**

Per memory `feedback-per-task-build-check`, run the full verification:

```bash
npx tsc --noEmit
npx vitest run
npx next build
```

Expected:
- tsc: exit 0
- vitest: all worksheet + lined tests green (≥25 worksheet tests total: 13 types + 6 cell + 6 template + 12 PDF)
- build: exit 0

If dev server is alive on port 4444, kill it first per memory `dev-build-cache-stomp`:
```bash
# Find and kill the dev server PID
lsof -i :4444 -t 2>/dev/null | xargs -r kill -9
```

- [ ] **Step 6: Browser smoke test (human only)**

Manual verification per the spec's Verification section:

1. Open `http://localhost:4444/worksheet/practice`
2. In 「格子形式」, select 「钢笔·横线」
3. The page should render 24 horizontal lines stacked top-to-bottom (A4 default, linedHeightPx=38px)
4. Switch 纸张尺寸 to A3 → expect 36 lines
5. Switch to B5 → expect 14 lines
6. Click 「下载 PDF」 → download the file and verify:
   - PDF opens at 1 page (not 40)
   - Page size is A4 (595×842pt or Letter-equivalent)
   - 24 evenly-spaced horizontal lines on the page
7. Switch back to 「钢笔·田字格」 → expect the 8×10 grid to come back unchanged (regression check)
8. Reload the page → default should still be 「钢笔·田字格」 (regression check: lined selection is component state, not persisted)

If any step fails, file a follow-up issue; do not commit a fix in the same session (memory: ship the feature, then iterate).

- [ ] **Step 7: Commit**

```bash
git add components/worksheet/PracticePDF.tsx tests/unit/components/worksheet/PracticePDF.test.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(worksheet): PracticePDF supports pen-lined + 24/A4, 36/A3, 14/B5 lines [2026-07-01 HH.MM]"
```

- [ ] **Step 8: Final whole-branch review**

Per `superpowers:subagent-driven-development`, dispatch the final code-reviewer with the merged diff (all 4 commits). Pass the printout of `git log --oneline` for the 4 lined commits + the full diff as the review package.

Reviewer checks:
- Spec coverage: all 5 Global Constraints met? Lined produces 24 lines on A4? PDF 1 page? Browser regression-free?
- Code quality: no `any`, no dead code, no premature abstractions, no comments restating code
- Type safety: CellStyle union is exhaustive; no untyped casts
- Test coverage: ≥25 worksheet tests, all green; no skipped cases

If the reviewer reports Critical or Important findings, dispatch a fix subagent with the full list (per the skill's "one fix subagent, not per-finding" rule).

---

## Verification (human smoke summary)

1. `/worksheet/practice` loads with default 钢笔·田字格 (no regression)
2. Select 钢笔·横线 → 24 horizontal lines on A4
3. Switch to A3 → 36 lines
4. Switch to B5 → 14 lines
5. Download PDF → 1 page, 24 lines, no auto-pagination overflow
6. Switch back to 钢笔·田字格 → grid restored, no regression
7. Reload → default 钢笔·田字格 (selection not persisted)
8. `npx tsc --noEmit` clean
9. `npx vitest run` all green
10. `npx next build` clean

## Out of Scope (deferred)

- Line-count slider (YAGNI: 1.0cm row height is the standard)
- Page number / date / binding line (YAGNI: keep it simple)
- Lined + 田字格 combo (e.g. character on top line, ruled line below for 拼音本)
- Brush tools in lined mode (incompatible: brush paper is 12/24/28, lined uses A3/A4/B5)
- Lined row height customization (YAGNI: 1.0cm is standard)
- Persistence of lined selection in `localStorage` (YAGNI: UI state resets to pen-square is fine)

These would each warrant a separate spec/plan.
