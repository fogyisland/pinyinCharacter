# G5: Worksheet Tool/Presentation Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the conflated `cellStyle` enum into orthogonal `tool` (毛笔/钢笔) + `presentation` (田字格/米字格) so users can mix any tool with any presentation independently. All 9 fonts remain available regardless of tool. 描红 is OUT of scope (separate future plan).

**Architecture:** Composite `CellStyle = ${Tool}-${Presentation}` (e.g. `'brush-square'`, `'pen-cross'`) stored in the existing single `cell_style` ENUM column. New TypeScript types `Tool = 'brush' | 'pen'` and `Presentation = 'square' | 'cross'`. UI: separate `ToolPicker` + `PresentationPicker`; `PaperSizePicker` takes `tool` prop (brush → brush-12/24/28, pen → A3/A4/B5). `FontFamilyPicker` unchanged (9 fonts always available).

**Tech Stack:** Next.js 15, TypeScript, MySQL 5.7 (ENUM widening), React 19, vitest + @testing-library/react

## Global Constraints

- **Composite CellStyle format**: lowercase kebab composite `${tool}-${presentation}` — `'brush-square' | 'brush-cross' | 'pen-square' | 'pen-cross'`. 4 values, 2×2 matrix.
- **Backfill mapping** (4 old → 4 new): `brush → brush-cross` (preserves diagonal X which is the distinctive brush cell feature); `pen → pen-square`; `square → pen-square`; `cross → pen-cross`. Brush-backfill target is a design call; if the user prefers `brush → brush-square`, change Task 1 SQL.
- **DB ENUM is widened, not tightened**: migration adds the 4 new values; 4 old values remain in ENUM (so re-runs are idempotent) but Zod schema rejects them. Code never writes old values after migration.
- **All 9 fonts always available** under both tools (user explicit decision 2026-06-20 — system fonts coexist with both brush and pen).
- **Out of scope**: 描红 (tracing) — separate plan. Do NOT add `'tracing'` to the Presentation type.
- **Project conventions**: main branch, no feature branch, one commit per task. Commit messages follow conventional-commits style (`feat:` / `fix:` / `test:` / `docs:` / `chore:` / `refactor:`).
- **Cell rendering rule (preserved)**: WorksheetCell renders `presentation === 'cross'` → diagonals + horizontal; `presentation === 'square'` → horizontal only; vertical line is always drawn. (Old 'brush' = "diagonals only, no horizontal" pattern is gone; backfill maps to 'brush-cross' which has horizontal. Visual diff is +1 horizontal line on old brush worksheets — acceptable.)
- **Per-task `pnpm build`**: required when diff touches `app/**/page.tsx` or adds a new route. For this plan, only Task 5 touches page-adjacent code (WorksheetGenerator). Other tasks skip per-task build; final whole-branch review runs pnpm build once.

---

### Task 1: DB migration SQL + init-db.ts ENUM widening

**Files:**
- Create: `scripts/migrations/2026-06-20-worksheet-tool-presentation-split.sql`
- Modify: `scripts/init-db.ts:130` (cell_style ENUM line)

**Interfaces:**
- Consumes: existing `cell_style ENUM('brush','square','pen','cross') NOT NULL`
- Produces: widened `cell_style ENUM('brush','square','pen','cross','brush-square','brush-cross','pen-square','pen-cross') NOT NULL` with old rows backfilled

- [ ] **Step 1: Write the migration SQL**

Create `scripts/migrations/2026-06-20-worksheet-tool-presentation-split.sql`:

```sql
-- G5: Split cellStyle into composite ${tool}-${presentation} format
-- Idempotent: old values remain in ENUM so re-runs are safe.
--   brush    -> brush-cross  (preserves diagonal X distinctive to brush cells)
--   pen      -> pen-square
--   square   -> pen-square
--   cross    -> pen-cross

-- Step 1: widen ENUM to include 4 new composite values
ALTER TABLE worksheets
  MODIFY COLUMN cell_style
    ENUM('brush','square','pen','cross','brush-square','brush-cross','pen-square','pen-cross')
    NOT NULL;

-- Step 2: backfill old values to new composites (idempotent: re-runs find no matches)
UPDATE worksheets SET cell_style = 'brush-cross' WHERE cell_style = 'brush';
UPDATE worksheets SET cell_style = 'pen-square'  WHERE cell_style = 'pen';
UPDATE worksheets SET cell_style = 'pen-square'  WHERE cell_style = 'square';
UPDATE worksheets SET cell_style = 'pen-cross'   WHERE cell_style = 'cross';
```

- [ ] **Step 2: Update init-db.ts to use the widened ENUM**

Modify `scripts/init-db.ts:130`:

```ts
     cell_style  ENUM('brush','square','pen','cross','brush-square','brush-cross','pen-square','pen-cross') NOT NULL,
```

- [ ] **Step 3: Run tsc to verify no type regression from ENUM widening**

Run: `pnpm tsc --noEmit`
Expected: exit 0 (the ENUM is a string column from the app's perspective; widening is metadata-only)

- [ ] **Step 4: Apply migration to local piyin_dev**

Run:
```bash
mysql -uroot -pAdmin909217 piyin_dev < scripts/migrations/2026-06-20-worksheet-tool-presentation-split.sql
mysql -uroot -pAdmin909217 piyin_dev -e "SELECT cell_style, COUNT(*) FROM worksheets GROUP BY cell_style"
```
Expected: 0 rows with old values; new rows in `'pen-square'` etc. (Existing user worksheets may be 0; that's fine — backfill is the contract.)

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/2026-06-20-worksheet-tool-presentation-split.sql scripts/init-db.ts
git commit -m "feat(worksheet): widen cell_style ENUM + backfill old values to composites"
```

---

### Task 2: Data model refactor (lib/worksheet-types.ts)

**Files:**
- Modify: `lib/worksheet-types.ts`
- Test: `tests/unit/lib/worksheet-types.test.ts` (update existing tests)

**Interfaces:**
- Consumes: current `CellStyle = 'brush' | 'square' | 'pen' | 'cross'`
- Produces: `Tool = 'brush' | 'pen'`, `Presentation = 'square' | 'cross'`, `CellStyle = 'brush-square' | 'brush-cross' | 'pen-square' | 'pen-cross'`, helpers `getTool`, `getPresentation`, `composeCellStyle`, `defaultToolFor`, `defaultPresentationFor`, `defaultFontFor` (updated signature)

- [ ] **Step 1: Update existing tests in `tests/unit/lib/worksheet-types.test.ts`**

Find the test cases for `defaultFontFor` and `cellStyleLabel`. Update as follows (write the new versions, then mark old ones `.skip` or delete; prefer delete + re-add for clarity):

```ts
import { describe, it, expect } from 'vitest';
import {
  composeCellStyle,
  getTool,
  getPresentation,
  defaultToolFor,
  defaultPresentationFor,
  defaultFontFor,
  isBrushSize,
  cellStyleLabel,
} from '@/lib/worksheet-types';

describe('worksheet-types', () => {
  describe('composeCellStyle / getTool / getPresentation', () => {
    it('round-trips brush-square', () => {
      const s = composeCellStyle('brush', 'square');
      expect(s).toBe('brush-square');
      expect(getTool(s)).toBe('brush');
      expect(getPresentation(s)).toBe('square');
    });
    it('round-trips pen-cross', () => {
      const s = composeCellStyle('pen', 'cross');
      expect(s).toBe('pen-cross');
      expect(getTool(s)).toBe('pen');
      expect(getPresentation(s)).toBe('cross');
    });
  });

  describe('defaultToolFor / defaultPresentationFor', () => {
    it('defaultToolFor() returns brush (matches G3 default)', () => {
      expect(defaultToolFor()).toBe('brush');
    });
    it('defaultPresentationFor() returns square', () => {
      expect(defaultPresentationFor()).toBe('square');
    });
  });

  describe('defaultFontFor', () => {
    it('brush tool → ma-shan-zheng', () => {
      expect(defaultFontFor('brush')).toBe('ma-shan-zheng');
    });
    it('pen tool → wenkai-gb', () => {
      expect(defaultFontFor('pen')).toBe('wenkai-gb');
    });
  });

  describe('isBrushSize', () => {
    it('brush-12/24/28 are brush sizes', () => {
      expect(isBrushSize('brush-12')).toBe(true);
      expect(isBrushSize('brush-24')).toBe(true);
      expect(isBrushSize('brush-28')).toBe(true);
    });
    it('A3/A4/B5 are not brush sizes', () => {
      expect(isBrushSize('A3')).toBe(false);
      expect(isBrushSize('A4')).toBe(false);
      expect(isBrushSize('B5')).toBe(false);
    });
  });

  describe('cellStyleLabel', () => {
    it('renders brush-square as 毛笔·田字格', () => {
      expect(cellStyleLabel('brush-square')).toBe('毛笔·田字格');
    });
    it('renders pen-cross as 钢笔·米字格', () => {
      expect(cellStyleLabel('pen-cross')).toBe('钢笔·米字格');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: FAIL — `composeCellStyle`, `getTool`, `getPresentation`, `defaultToolFor`, `defaultPresentationFor` are not exported; `defaultFontFor` still takes `CellStyle` not `Tool`.

- [ ] **Step 3: Refactor `lib/worksheet-types.ts`**

Replace the type block + helpers. Read the current file first (`lib/worksheet-types.ts:1-100`) to preserve unrelated exports (`cellsPerPage`, `generateLayout`, `validateWorksheetInput`, `PAPER_SIZES`, `FONT_FAMILIES`, `BRUSH_PAPER_SIZES`, `BrushPaperSize`, `paperSizeLabel`, `fontFamilyLabel`, `fontFamilyCssVar`).

Changes:

```ts
// At the top, after existing imports:
export type Tool = 'brush' | 'pen';
export type Presentation = 'square' | 'cross';
export type CellStyle = 'brush-square' | 'brush-cross' | 'pen-square' | 'pen-cross';

const ALL_TOOLS: readonly Tool[] = ['brush', 'pen'];
const ALL_PRESENTATIONS: readonly Presentation[] = ['square', 'cross'];
const ALL_CELL_STYLES: readonly CellStyle[] = [
  'brush-square', 'brush-cross', 'pen-square', 'pen-cross',
] as const;

// Compose / split helpers
export function composeCellStyle(tool: Tool, presentation: Presentation): CellStyle {
  return `${tool}-${presentation}` as CellStyle;
}

export function getTool(s: CellStyle): Tool {
  return s.split('-')[0] as Tool;
}

export function getPresentation(s: CellStyle): Presentation {
  return s.split('-')[1] as Presentation;
}

// Defaults
export function defaultToolFor(): Tool {
  return 'brush';  // matches G3 default
}

export function defaultPresentationFor(): Presentation {
  return 'square';
}

export function defaultFontFor(tool: Tool): FontFamily {
  return tool === 'brush' ? 'ma-shan-zheng' : 'wenkai-gb';
}
```

Update `cellStyleLabel`:
```ts
export function cellStyleLabel(s: CellStyle): string {
  const tool = getTool(s) === 'brush' ? '毛笔' : '钢笔';
  const pres = getPresentation(s) === 'square' ? '田字格' : '米字格';
  return `${tool}·${pres}`;
}
```

Replace the old `CellStyle` block (lines 3-8) and `defaultFontFor` (lines 74-81) with the above. Keep `FONT_FAMILIES` array as-is (9 fonts, all groups stay).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: all tests in this file PASS. Other test files that imported the old CellStyle type will fail compilation — that's Task 3's job to fix.

- [ ] **Step 5: Run tsc to see what else broke**

Run: `pnpm tsc --noEmit`
Expected: errors in files that use old `CellStyle` literals (`'brush' | 'square' | 'pen' | 'cross'`). List the errors — they are fixed in Tasks 3-5.

- [ ] **Step 6: Commit**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet-types.test.ts
git commit -m "refactor(worksheet): split cellStyle into Tool + Presentation composite"
```

---

### Task 3: Validators update (lib/validators.ts)

**Files:**
- Modify: `lib/validators.ts:46` (cellStyle enum in saveWorksheetSchema)
- Test: `tests/unit/lib/validators.test.ts` (update existing tests for cellStyle)

**Interfaces:**
- Consumes: `saveWorksheetSchema` with `cellStyle: z.enum(['brush', 'square', 'pen', 'cross'])`
- Produces: `cellStyle: z.enum(['brush-square', 'brush-cross', 'pen-square', 'pen-cross'])`

- [ ] **Step 1: Update `saveWorksheetSchema` cellStyle enum**

Modify `lib/validators.ts:46`:

```ts
  cellStyle: z.enum(['brush-square', 'brush-cross', 'pen-square', 'pen-cross']),
```

- [ ] **Step 2: Update validators tests**

In `tests/unit/lib/validators.test.ts`, find the `saveWorksheetSchema` test cases. Update any tests that use old cellStyle values:

```ts
describe('saveWorksheetSchema', () => {
  it('accepts brush-square', () => {
    const r = saveWorksheetSchema.safeParse({
      title: 'test',
      content: ['永', '字', '八', '法'],
      cellStyle: 'brush-square',
    });
    expect(r.success).toBe(true);
  });

  it('rejects old cellStyle "brush"', () => {
    const r = saveWorksheetSchema.safeParse({
      title: 'test',
      content: ['永'],
      cellStyle: 'brush',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown composite "pen-tracing"', () => {
    const r = saveWorksheetSchema.safeParse({
      title: 'test',
      content: ['永'],
      cellStyle: 'pen-tracing',
    });
    expect(r.success).toBe(false);
  });
});
```

Add these tests if they don't exist; update existing tests that use old cellStyle values.

- [ ] **Step 3: Run tests**

Run: `pnpm test tests/unit/lib/validators.test.ts`
Expected: PASS for the new tests; any old test using `cellStyle: 'brush'` etc. should now FAIL (that's the desired behavior — they're correctly rejected).

- [ ] **Step 4: Commit**

```bash
git add lib/validators.ts tests/unit/lib/validators.test.ts
git commit -m "feat(worksheet): update saveWorksheetSchema to composite cellStyle values"
```

---

### Task 4: Split StylePicker into ToolPicker + PresentationPicker

**Files:**
- Create: `components/worksheet/ToolPicker.tsx`
- Create: `components/worksheet/PresentationPicker.tsx`
- Modify-or-delete: `components/worksheet/StylePicker.tsx` (delete; no shim — all consumers are updated in Task 5)
- Test: `tests/unit/components/worksheet/ToolPicker.test.tsx` (new)
- Test: `tests/unit/components/worksheet/PresentationPicker.test.tsx` (new)

**Interfaces:**
- ToolPicker: `{ value: Tool; onChange: (v: Tool) => void }`
- PresentationPicker: `{ value: Presentation; onChange: (v: Presentation) => void }`

- [ ] **Step 1: Write ToolPicker test**

Create `tests/unit/components/worksheet/ToolPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolPicker } from '@/components/worksheet/ToolPicker';

describe('ToolPicker', () => {
  it('renders two radios: 毛笔 and 钢笔', () => {
    render(<ToolPicker value="brush" onChange={() => {}} />);
    expect(screen.getByLabelText('毛笔')).toBeInTheDocument();
    expect(screen.getByLabelText('钢笔')).toBeInTheDocument();
  });

  it('checks the radio matching value', () => {
    render(<ToolPicker value="pen" onChange={() => {}} />);
    expect(screen.getByLabelText('钢笔')).toBeChecked();
    expect(screen.getByLabelText('毛笔')).not.toBeChecked();
  });

  it('fires onChange with new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToolPicker value="brush" onChange={onChange} />);
    await user.click(screen.getByLabelText('钢笔'));
    expect(onChange).toHaveBeenCalledWith('pen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/ToolPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ToolPicker**

Create `components/worksheet/ToolPicker.tsx`:

```tsx
'use client';

import type { Tool } from '@/lib/worksheet-types';

interface Props {
  value: Tool;
  onChange: (v: Tool) => void;
}

export function ToolPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="tool"
          value="brush"
          checked={value === 'brush'}
          onChange={() => onChange('brush')}
        />
        <span>毛笔</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="tool"
          value="pen"
          checked={value === 'pen'}
          onChange={() => onChange('pen')}
        />
        <span>钢笔</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/ToolPicker.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 5: Write PresentationPicker test**

Create `tests/unit/components/worksheet/PresentationPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresentationPicker } from '@/components/worksheet/PresentationPicker';

describe('PresentationPicker', () => {
  it('renders two radios: 田字格 and 米字格', () => {
    render(<PresentationPicker value="square" onChange={() => {}} />);
    expect(screen.getByLabelText('田字格')).toBeInTheDocument();
    expect(screen.getByLabelText('米字格')).toBeInTheDocument();
  });

  it('fires onChange with new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PresentationPicker value="square" onChange={onChange} />);
    await user.click(screen.getByLabelText('米字格'));
    expect(onChange).toHaveBeenCalledWith('cross');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/PresentationPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement PresentationPicker**

Create `components/worksheet/PresentationPicker.tsx`:

```tsx
'use client';

import type { Presentation } from '@/lib/worksheet-types';

interface Props {
  value: Presentation;
  onChange: (v: Presentation) => void;
}

export function PresentationPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="presentation"
          value="square"
          checked={value === 'square'}
          onChange={() => onChange('square')}
        />
        <span>田字格</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="presentation"
          value="cross"
          checked={value === 'cross'}
          onChange={() => onChange('cross')}
        />
        <span>米字格</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify both pass**

Run: `pnpm test tests/unit/components/worksheet/ToolPicker.test.tsx tests/unit/components/worksheet/PresentationPicker.test.tsx`
Expected: all PASS.

- [ ] **Step 9: Delete old StylePicker**

```bash
git rm components/worksheet/StylePicker.tsx
rm -f tests/unit/components/worksheet/StylePicker.test.tsx
```

(If a StylePicker test file exists, remove it. If it doesn't, the `rm -f` is a no-op.)

- [ ] **Step 10: Commit**

```bash
git add components/worksheet/ToolPicker.tsx components/worksheet/PresentationPicker.tsx \
        tests/unit/components/worksheet/ToolPicker.test.tsx tests/unit/components/worksheet/PresentationPicker.test.tsx
git commit -m "refactor(worksheet): split StylePicker into ToolPicker + PresentationPicker"
```

---

### Task 5: WorksheetGenerator + PaperSizePicker refactor (wires everything together)

**Files:**
- Modify: `components/worksheet/WorksheetGenerator.tsx` (state + handlers + JSX)
- Modify: `components/worksheet/PaperSizePicker.tsx` (prop signature: `cellStyle` → `tool`)
- Modify: `components/worksheet/WorksheetCell.tsx` (use `getPresentation` for grid lines)
- Test: any existing component test that mounts `WorksheetGenerator` or `PaperSizePicker` — update

**Interfaces:**
- PaperSizePicker: `{ value: PaperSize; tool: Tool; onChange: (v: PaperSize) => void }` (was `cellStyle: CellStyle`)
- WorksheetGenerator state: `tool: Tool`, `presentation: Presentation` (was `cellStyle: CellStyle`)

- [ ] **Step 1: Update PaperSizePicker prop signature**

Modify `components/worksheet/PaperSizePicker.tsx`:

```tsx
'use client';
import type { Tool, PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES, isBrushSize } from '@/lib/worksheet-types';
import { BrushModePicker } from './BrushModePicker';

interface Props {
  value: PaperSize;
  tool: Tool;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, tool, onChange }: Props) {
  if (tool === 'brush') {
    if (!isBrushSize(value)) {
      // Defensive: same self-heal as before, just keyed on tool
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

- [ ] **Step 2: Update WorksheetCell to use getPresentation for grid lines**

Modify `components/worksheet/WorksheetCell.tsx`. Replace the old grid-line conditional (lines 22-30) with presentation-based logic:

```tsx
import { getPresentation, fontFamilyCssVar, type CellStyle, type FontFamily } from '@/lib/worksheet-types';
// (replace the existing import)

export function WorksheetCell({ char, style, size = 80, fontFamily = 'song' }: Props) {
  const stroke = '#bbb';
  const fontStack = `${fontFamilyCssVar(fontFamily)}, "Noto Serif SC", serif`;
  const guideFontSize = Math.round(size * 0.6);
  const presentation = getPresentation(style);  // 'square' | 'cross'
  const showDiagonals = presentation === 'cross';
  const showHorizontal = true;  // both new presentations have horizontal
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={stroke} strokeWidth={1} />
      <line x1={50} y1={2} x2={50} y2={98} stroke={stroke} strokeWidth={0.5} />
      {showDiagonals ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
        </>
      ) : null}
      {showHorizontal ? (
        <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
      ) : null}
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
}
```

- [ ] **Step 3: Update WorksheetGenerator state + handlers + JSX**

In `components/worksheet/WorksheetGenerator.tsx`:

Replace the state declarations (lines 29-31):
```tsx
  const [tool, setTool] = useState<Tool>(defaultToolFor());
  const [presentation, setPresentation] = useState<Presentation>(defaultPresentationFor());
  const [paperSize, setPaperSize] = useState<PaperSize>(
    defaultToolFor() === 'brush' ? 'brush-12' : 'A4',
  );
  const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor(defaultToolFor()));
```

Add new imports at top (next to the existing `worksheet-types` import):
```tsx
import { defaultToolFor, defaultPresentationFor, defaultFontFor, composeCellStyle, isBrushSize, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import type { Tool, Presentation } from '@/lib/worksheet-types';
```

Replace `handleCellStyleChange` (lines 53-61) with:
```tsx
  function handleToolChange(next: Tool) {
    setTool(next);
    if (next === 'brush' && !isBrushSize(paperSize)) {
      setPaperSize('brush-12');
    } else if (next === 'pen' && isBrushSize(paperSize)) {
      setPaperSize('A4');
    }
    // fontFamily is preserved (user explicit decision 2026-06-20)
  }

  function handlePresentationChange(next: Presentation) {
    setPresentation(next);
    // paperSize unchanged
  }
```

In the JSX, replace the `StylePicker` block (lines 171-177) with two pickers side-by-side:
```tsx
        <div>
          <label className="block text-sm font-medium text-ink-soft">工具</label>
          <div className="mt-2">
            <ToolPicker value={tool} onChange={handleToolChange} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">格子形式</label>
          <div className="mt-2">
            <PresentationPicker value={presentation} onChange={handlePresentationChange} />
          </div>
        </div>
```

Add imports at top of file:
```tsx
import { ToolPicker } from './ToolPicker';
import { PresentationPicker } from './PresentationPicker';
```

In `handleSave` (around line 79-83), update the body to use the new `cellStyle` composite:
```tsx
    const cellStyle = composeCellStyle(tool, presentation);
    const res = await fetch('/api/worksheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || `字帖 ${new Date().toLocaleDateString()}`, content, cellStyle, paperSize, fontFamily }),
    });
```

Update the preview branch (around line 100-114) and the `WorksheetPreview` JSX (around line 174-191) — `<PaperSizePicker>` now takes `tool` instead of `cellStyle`:
```tsx
            <PaperSizePicker value={paperSize} tool={tool} onChange={setPaperSize} />
```

In the `<WorksheetPreview>` calls (preview branch and detail page), pass `cellStyle={composeCellStyle(tool, presentation)}`. Both `WorksheetGenerator`'s preview branch and `app/worksheet/[id]/page.tsx` need this — but `app/worksheet/[id]/page.tsx` reads `ws.cellStyle` from DB directly, which is now a composite, so it Just Works.

Add `cellStyle={composeCellStyle(tool, presentation)}` to both `<WorksheetPreview>` invocations in this file.

- [ ] **Step 4: Update existing component tests**

Find any tests that import `StylePicker` or use `cellStyle: 'brush'` etc. as component prop:

- `tests/unit/components/worksheet/RandomTab.test.tsx` — likely unaffected (RandomTab is a child, doesn't render StylePicker)
- `tests/unit/components/worksheet/WorksheetGenerator.test.tsx` — if it exists, update state defaults + PaperSizePicker prop
- `tests/integration/api/*` — update cellStyle literals in test fixtures

For each, the conversion is mechanical:
- `cellStyle: 'brush'` → either `tool: 'brush', presentation: 'square'` (composed at call site) or `cellStyle: 'brush-cross'`
- `cellStyle: 'pen'` → `cellStyle: 'pen-square'`
- `cellStyle: 'square'` → `cellStyle: 'pen-square'`
- `cellStyle: 'cross'` → `cellStyle: 'pen-cross'`

- [ ] **Step 5: Run tsc + tests**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: tsc clean; all tests pass (after Step 4 updates).

- [ ] **Step 6: Run pnpm build (Task 5 touches page-adjacent code; per-task build required)**

Confirm no dev server on 4444 first:
```bash
cmd.exe //c "netstat -ano | findstr :4444"
```
If empty (no LISTENING), run `pnpm build`. If dev server alive, **skip pnpm build and report** — do not stomp the dev cache.

Run: `pnpm build`
Expected: exit 0, 128 routes preserved (or +1/+0 from the new pickers, but pickers don't add routes — count stays at 128).

- [ ] **Step 7: Commit**

```bash
git add components/worksheet/WorksheetGenerator.tsx components/worksheet/PaperSizePicker.tsx \
        components/worksheet/WorksheetCell.tsx \
        tests/  # any updated tests
git commit -m "feat(worksheet): wire tool + presentation pickers into WorksheetGenerator"
```

---

### Task 6: End-to-end smoke + final verification

**Files:** (no code changes; verification only)

- [ ] **Step 1: Browser smoke test the new UI**

With dev server already running on 4444 (started in earlier session), visit `http://localhost:4444/worksheet/new` and verify:

1. Default load shows two pickers: 工具 (毛笔 selected) + 格子形式 (田字格 selected)
2. FontFamilyPicker still shows all 9 fonts
3. PaperSizePicker shows 3 brush modes (12/24/28) when 工具 = 毛笔
4. Switch 工具 to 钢笔 → PaperSizePicker flips to A3/A4/B5 radios
5. Switch back to 毛笔 → PaperSizePicker returns to brush modes
6. Switch 格子形式 田字格 → 米字格 → 田字格 — paperSize and fontFamily are NOT reset
7. Pick any 12 chars, click 生成字帖, click 保存 → worksheet saves, lands on `/worksheet/[id]`
8. On detail page, verify cell grid: brush-square should show 田字格 (vertical + horizontal, no diagonals); brush-cross should show 米字格 (vertical + horizontal + diagonals)
9. Create another worksheet with cellStyle = pen-square → grid shows 田字格 + 钢笔 font (no brush font)
10. Create another worksheet with cellStyle = pen-cross → grid shows 米字格 + 钢笔 font

If any step fails, fix in a new commit (do not amend — project convention).

- [ ] **Step 2: Run final tsc + test + build**

```bash
pnpm tsc --noEmit
pnpm test
cmd.exe //c "netstat -ano | findstr :4444"   # confirm no dev server
pnpm build                                  # if 4444 free
```

Expected: tsc exit 0; tests all pass (target: 510+ tests, G3 27 + G4 5 + G5 ~10 new = ~40 net new); build exit 0 with 128 routes preserved.

- [ ] **Step 3: Commit (only if Step 1 had fix commits)**

If Step 1 needed fixes, those were committed in Step 1. Otherwise no commit needed for Task 6 itself.

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```

Then update `plan-g5-status.md` (memory) with final commit list and verification results.
