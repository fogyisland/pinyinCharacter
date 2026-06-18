# Spec A: 米字格 (cross) cell style — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th worksheet cell style `cross` (= 米字格, rice-grid: box + horizontal + vertical + both diagonals) so users can print 米字格 in addition to the existing 钢笔 (`pen`) / 毛笔 (`brush`) / 田字格 (`square`).

**Architecture:** Small surgical change. Extend the `CellStyle` TS union (in `lib/worksheet-types.ts`) and the Zod schema (`lib/validators.ts`). Add a 4th radio in `StylePicker.tsx`. Add a new SVG branch in `WorksheetCell.tsx` for the cross grid. Extract `cellStyleLabel(s)` helper to replace fragile fallthrough chains at 2 display sites. Fix the stale `init-db.ts` enum + add a one-off ALTER migration for live DBs.

**Tech Stack:** TypeScript, Next.js 15 App Router, Zod, MySQL 5.7, Vitest.

## Global Constraints

- CellStyle value for 米字格 is `'cross'` (user-chosen; deviates from the Chinese-concept names `brush`/`square`/`pen`).
- SVG guide pattern for `cross`: outer border + vertical center + horizontal center + 2 diagonals (米 shape inside the box).
- Existing `brush` SVG (box + vertical + 2 diagonals) MUST keep rendering unchanged. Existing `square` (box + vertical + horizontal) MUST keep unchanged. Existing `pen` (box + vertical only) MUST keep unchanged.
- Existing `validateWorksheetInput` (`lib/worksheet-types.ts:68`) MUST keep accepting `brush`/`square`/`pen` AND must accept `cross`.
- Existing `saveWorksheetSchema.cellStyle` Zod enum (`lib/validators.ts:42`) MUST include `cross`.
- DB migration `ALTER TABLE worksheets MODIFY cell_style ENUM('brush','square','pen','cross') NOT NULL` is idempotent and non-destructive.
- `DEFAULT_CELL_STYLE` stays `'brush'` — new worksheets default to brush; users opt into 米字格.
- Verification skips any DB-backed integration tests if `piyin_test` access is denied (per project memory).
- No `pnpm build` while `pnpm dev` is alive on port 4444 (per project memory — corrupts `.next/`).

---

### Task 1: Extend CellStyle type + validateWorksheetInput to accept `cross`

**Files:**
- Modify: `lib/worksheet-types.ts:1` (CellStyle union)
- Modify: `lib/worksheet-types.ts:68-89` (`validateWorksheetInput` validator)
- Modify: `tests/unit/lib/worksheet.test.ts` (add 2 test cases to the existing `describe('validateWorksheetInput', ...)` block)

- [ ] **Step 1: Add the failing test cases to `tests/unit/lib/worksheet.test.ts`**

Inside the existing `describe('validateWorksheetInput', ...)` block (find the closing `});` of that block), add these two `it(...)` cases:

```ts
it('accepts cellStyle="cross"', () => {
  const result = validateWorksheetInput({
    title: 'My worksheet',
    content: ['你', '好'],
    cellStyle: 'cross',
  });
  expect(result).toEqual({
    ok: true,
    data: { title: 'My worksheet', content: ['你', '好'], cellStyle: 'cross' },
  });
});

it('rejects cellStyle="nonsense"', () => {
  const result = validateWorksheetInput({
    title: 'My worksheet',
    content: ['你', '好'],
    cellStyle: 'nonsense',
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe('cellStyle must be brush, square, pen, or cross');
  }
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm test tests/unit/lib/worksheet.test.ts`
Expected: 2 new tests FAIL. Existing tests still pass. Output should show `× accepts cellStyle="cross"` and `× rejects cellStyle="nonsense"`.

- [ ] **Step 3: Extend `CellStyle` union in `lib/worksheet-types.ts`**

Change line 1 from:
```ts
export type CellStyle = 'brush' | 'square' | 'pen';
```
to:
```ts
export type CellStyle = 'brush' | 'square' | 'pen' | 'cross';
```

- [ ] **Step 4: Extend the validator check in `lib/worksheet-types.ts:82`**

Replace the existing validator body so `cross` is accepted and the error message lists all four. Find the `validateWorksheetInput` function (around line 68) and update the cellStyle check:

```ts
  if (
    input.cellStyle !== 'brush' &&
    input.cellStyle !== 'square' &&
    input.cellStyle !== 'pen' &&
    input.cellStyle !== 'cross'
  ) {
    return { ok: false, error: 'cellStyle must be brush, square, pen, or cross' };
  }
```

- [ ] **Step 5: Re-run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/worksheet.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet.test.ts
git commit -m "feat(worksheet): extend CellStyle union + validator with 'cross' (米字格)"
```

---

### Task 2: Add `cellStyleLabel()` helper + replace fallthrough chains at 2 display sites

**Files:**
- Modify: `lib/worksheet-types.ts` (add `cellStyleLabel()` next to `paperSizeLabel()` around line 47)
- Modify: `app/worksheet/[id]/page.tsx:44` (replace ternary chain)
- Modify: `components/worksheet/WorksheetHistoryList.tsx:26` (replace ternary chain)

- [ ] **Step 1: Add `cellStyleLabel` to `lib/worksheet-types.ts`**

Insert this immediately after `fontFamilyCssVar` (around line 55, before the `ValidationResult` type at line 57):

```ts
export function cellStyleLabel(s: CellStyle): string {
  switch (s) {
    case 'brush': return '毛笔格';
    case 'square': return '田字格';
    case 'pen': return '钢笔格';
    case 'cross': return '米字格';
  }
}
```

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Replace the ternary chain in `app/worksheet/[id]/page.tsx`**

Edit the file: in the import line near the top, add `cellStyleLabel` to the existing import from `@/lib/worksheet-types`:

Find:
```ts
import { paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
```
Replace with:
```ts
import { paperSizeLabel, fontFamilyLabel, cellStyleLabel } from '@/lib/worksheet-types';
```

Then in the body of the component (around line 44), find:
```tsx
{ws.cellStyle === 'brush' ? '毛笔格' : ws.cellStyle === 'square' ? '田字格' : '钢笔格'} ·{' '}
```
Replace with:
```tsx
{cellStyleLabel(ws.cellStyle)} ·{' '}
```

- [ ] **Step 4: Replace the ternary chain in `components/worksheet/WorksheetHistoryList.tsx`**

Edit the file: at the top, add `cellStyleLabel` to the import from `@/lib/worksheet-types`. (Check the existing import shape first; if it imports multiple names, extend the list. If it imports nothing from that path yet, add `import { cellStyleLabel } from '@/lib/worksheet-types';`.)

Then around line 26, find:
```tsx
{w.cellStyle === 'brush' ? '毛笔格' : w.cellStyle === 'square' ? '田字格' : '钢笔格'} ·{' '}
```
Replace with:
```tsx
{cellStyleLabel(w.cellStyle)} ·{' '}
```

- [ ] **Step 5: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/worksheet-types.ts app/worksheet/\[id\]/page.tsx components/worksheet/WorksheetHistoryList.tsx
git commit -m "refactor(worksheet): extract cellStyleLabel helper, replace ternary fallthroughs"
```

---

### Task 3: Add SVG branch for `cross` style in `WorksheetCell.tsx`

**Files:**
- Modify: `components/worksheet/WorksheetCell.tsx:21-28` (add 4th branch)

- [ ] **Step 1: Add the cross branch**

Open `components/worksheet/WorksheetCell.tsx`. The current SVG body around lines 21–28 looks like:

```tsx
{/* brush: two diagonals; square: horizontal center; pen: no inner lines (clean box) */}
{style === 'brush' ? (
  <>
    <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
    <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
  </>
) : style === 'square' ? (
  <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
) : null}
```

Replace with (the cross branch renders horizontal + both diagonals — vertical stays in the common block above):

```tsx
{/* brush: diagonals only; square: horizontal; pen: nothing extra; cross: horizontal + diagonals (米) */}
{style === 'brush' || style === 'cross' ? (
  <>
    <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
    <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
  </>
) : null}
{style === 'square' || style === 'cross' ? (
  <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
) : null}
```

(`pen` renders nothing extra — falls through both branches and produces just the outer border + vertical center line from the common block.)

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add components/worksheet/WorksheetCell.tsx
git commit -m "feat(worksheet): add 米字格 (cross) SVG branch — box + horizontal + vertical + diagonals"
```

---

### Task 4: Add `cross` radio button to `StylePicker.tsx`

**Files:**
- Modify: `components/worksheet/StylePicker.tsx` (add 4th `<label>` after the `pen` label, around line 42)

- [ ] **Step 1: Add the 4th radio**

Find the `pen` label block:

```tsx
<label className="flex cursor-pointer items-center gap-2">
  <input
    type="radio"
    name="cellStyle"
    value="pen"
    checked={value === 'pen'}
    onChange={() => onChange('pen')}
  />
  <span>钢笔格</span>
</label>
```

Immediately after it (before the closing `</div>` of the outer flex container at line 43), add:

```tsx
<label className="flex cursor-pointer items-center gap-2">
  <input
    type="radio"
    name="cellStyle"
    value="cross"
    checked={value === 'cross'}
    onChange={() => onChange('cross')}
  />
  <span>米字格</span>
</label>
```

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add components/worksheet/StylePicker.tsx
git commit -m "feat(worksheet): add 米字格 radio to StylePicker"
```

---

### Task 5: Update `saveWorksheetSchema` Zod enum to accept `cross`

**Files:**
- Modify: `lib/validators.ts:36-42` (`saveWorksheetSchema`)

- [ ] **Step 1: Find and extend the Zod enum**

Open `lib/validators.ts`. Find the `saveWorksheetSchema` definition (around line 36). It currently has `cellStyle: z.enum(['brush', 'square', 'pen'])`.

Replace:
```ts
cellStyle: z.enum(['brush', 'square', 'pen']),
```
with:
```ts
cellStyle: z.enum(['brush', 'square', 'pen', 'cross']),
```

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validators.ts
git commit -m "feat(worksheet): accept 'cross' cellStyle in saveWorksheetSchema"
```

---

### Task 6: DB migration — fix init-db.ts + add ALTER file for live DBs

**Files:**
- Modify: `scripts/init-db.ts:130` (extend ENUM definition)
- Create: `scripts/migrations/2026-06-18-cell-style-cross.sql`

- [ ] **Step 1: Create the migration SQL file**

Write `scripts/migrations/2026-06-18-cell-style-cross.sql` with exactly:

```sql
-- 2026-06-18: add 'cross' (= 米字格) to worksheets.cell_style enum
-- Idempotent: same column type, just wider. No data loss.
ALTER TABLE worksheets
  MODIFY cell_style ENUM('brush','square','pen','cross') NOT NULL;
```

- [ ] **Step 2: Update `scripts/init-db.ts:130`**

Find line 130 (`cell_style ENUM('brush','square') NOT NULL,`) and replace with:

```ts
     cell_style  ENUM('brush','square','pen','cross') NOT NULL,
```

(This keeps fresh `init-db.ts` runs in sync with prod.)

- [ ] **Step 3: Apply the ALTER to live dev DB `piyin_dev`**

Run:
```bash
DATABASE_URL=$(grep ^DATABASE_URL= .env | cut -d= -f2-) mysql -h 127.0.0.1 -u root -pAdmin909217 piyin_dev < scripts/migrations/2026-06-18-cell-style-cross.sql
```
Expected: no output. (MySQL prints nothing on success. If you see "ERROR", stop and investigate.)

Verify with:
```bash
DATABASE_URL=$(grep ^DATABASE_URL= .env | cut -d= -f2-) mysql -h 127.0.0.1 -u root -pAdmin909217 piyin_dev -e "SHOW COLUMNS FROM worksheets LIKE 'cell_style';"
```
Expected output shows `Type = enum('brush','square','pen','cross')`.

- [ ] **Step 4: Apply the ALTER to prod `piyin` (if accessible)**

If the dev host can reach prod MySQL (`139.5.108.245:3306`), apply the same ALTER:
```bash
mysql -h 139.5.108.245 -u piyin -pAdmin909217 piyin < scripts/migrations/2026-06-18-cell-style-cross.sql
```
(If prod is unreachable from this host, document this in the commit message and the spec's "What to verify next" — a human with prod access will run the ALTER manually.)

- [ ] **Step 5: Commit**

```bash
git add scripts/init-db.ts scripts/migrations/2026-06-18-cell-style-cross.sql
git commit -m "feat(worksheet): migrate cell_style enum to include 'cross' (米字格)"
```

---

### Task 7: Integration smoke + final verification

**Files:** none (smoke only)

- [ ] **Step 1: tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: All unit tests**

Run: `pnpm test tests/unit/lib/worksheet.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: HTTP smoke (dev server must be alive on 4444)**

Make sure `pnpm dev` is running on port 4444 (per project memory). If not, start it: `pnpm dev &`.

Then:
```bash
# Open worksheet creator with prefilled char
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4444/worksheet/new?prefill=%E4%B8%8D"
```
Expected: 200 or 307 (redirect to login is fine — the page exists).

Verify the 米字格 radio appears in the rendered HTML:
```bash
curl -s "http://localhost:4444/worksheet/new?prefill=%E4%B8%8D" | grep -o 'value="cross"\|米字格' | head -3
```
Expected: prints `value="cross"` and `米字格` at least once each.

- [ ] **Step 4: Manual browser smoke (per project memory, deferred to human)**

Document for the human: open `http://localhost:4444/worksheet/new?prefill=不` in browser, pick 米字格, click 生成字帖, verify preview shows 米-shape guides inside the cells. Then save → click 打印 → confirm print preview matches. This is the visual verification step that can't be automated.

- [ ] **Step 5: Final commit (only if any uncommitted drift)**

If tsc or tests surfaced nothing, no commit is needed. If you discovered a missing edge case and patched it, commit with a focused message. Otherwise this task closes the plan.

---

## Self-Review

**Spec coverage** — checked each requirement in `docs/superpowers/specs/2026-06-18-worksheet-cross-cell-style-design.md`:

| Spec requirement | Task |
|---|---|
| Extend `CellStyle` union | T1 |
| Extend `validateWorksheetInput` | T1 |
| Unit test for `cross` accepted | T1 |
| Unit test for invalid rejected with new error msg | T1 |
| `cellStyleLabel` helper | T2 |
| Replace `app/worksheet/[id]/page.tsx:44` chain | T2 |
| Replace `WorksheetHistoryList.tsx:26` chain | T2 |
| SVG branch in `WorksheetCell.tsx` | T3 |
| 4th radio in `StylePicker.tsx` | T4 |
| `saveWorksheetSchema` Zod enum | T5 |
| Fix `init-db.ts:130` stale enum | T6 |
| ALTER migration file | T6 |
| Apply ALTER to dev + prod | T6 |
| tsc + test verification | T7 |

**Placeholder scan** — no "TBD"/"TODO"/"implement later" found. Every code step shows actual code.

**Type consistency** — `CellStyle` union in `lib/worksheet-types.ts:1` and Zod enum in `lib/validators.ts:42` both updated to the same 4-element set (`brush`/`square`/`pen`/`cross`). `cellStyleLabel` switch covers all 4 cases with `case 'cross': return '米字格'` — TypeScript will error if a future style is added without updating this switch.

**Commit granularity** — 6 commits, each task-scoped, each independently revertable.