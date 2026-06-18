# Spec A: 米字格 (cross) cell style

## Goal

Add a 4th cell style to the worksheet generator so users can print 米字格 (rice-grid) in addition to the existing 钢笔 (`pen`) / 毛笔 (`brush`) / 田字格 (`square`).

## Background

`lib/worksheet-types.ts:1` defines `CellStyle = 'brush' | 'square' | 'pen'`. The UI in `components/worksheet/StylePicker.tsx` offers three radios. The `WorksheetCell.tsx` SVG renders three guide patterns. The user has requested the missing 4th style: 米字格 (米-character inside the box — horizontal center, vertical center, two diagonals).

Naming chosen by user: enum value `cross` (display label 米字格). This deviates from the Chinese-concept names of the existing three but the user picked it explicitly.

## Design

### Type & validator

`lib/worksheet-types.ts`
- Extend `CellStyle` union to include `'cross'`.
- Extend `validateWorksheetInput`'s `cellStyle` check to accept `'cross'`.

### SVG guides

`components/worksheet/WorksheetCell.tsx`
- Add a 4th branch `style === 'cross'` after `pen`:
  - outer border (existing)
  - vertical center line (existing — common to all)
  - horizontal center line (existing — currently under `square`)
  - both diagonals (existing — currently under `brush`)
- Keep the horizontal line under the `square` branch and render it again under the new `cross` branch (so `square` shows box + horizontal + vertical; `cross` shows box + horizontal + vertical + both diagonals). Vertical stays in the common block (already shared by all styles).

Final SVG layout:

| style   | border | vertical | horizontal | diagonal-1 | diagonal-2 |
|---------|--------|----------|------------|------------|------------|
| brush   | ✓      | ✓        |            | ✓          | ✓          |
| square  | ✓      | ✓        | ✓          |            |            |
| pen     | ✓      | ✓        |            |            |            |
| cross   | ✓      | ✓        | ✓          | ✓          | ✓          |

### Style picker UI

`components/worksheet/StylePicker.tsx`
- Add a 4th radio with `value="cross"` and label `米字格`. Match the existing layout (flex gap-4, same label/input pattern).

### Display labels (avoid fallthrough chains)

Currently `app/worksheet/[id]/page.tsx:44` and `components/worksheet/WorksheetHistoryList.tsx:26` use a ternary chain ending in `?: '钢笔格'` for `pen`. With a 4th style the chain becomes fragile. Extract a helper:

`lib/worksheet-types.ts`
- New export `cellStyleLabel(s: CellStyle): string` returning:
  - `brush` → `毛笔格`
  - `square` → `田字格`
  - `pen` → `钢笔格`
  - `cross` → `米字格`

Replace both call sites' ternary chains with `cellStyleLabel(ws.cellStyle)` and `cellStyleLabel(w.cellStyle)`.

### Schema migration

`scripts/init-db.ts:130` declares `cell_style ENUM('brush','square') NOT NULL` — already stale (missing `pen`). Two changes:

1. Update `init-db.ts` to declare `ENUM('brush','square','pen','cross')` so future fresh inits match prod.
2. New one-off migration file `scripts/migrations/2026-06-18-cell-style-cross.sql`:
   ```sql
   ALTER TABLE worksheets
     MODIFY cell_style ENUM('brush','square','pen','cross') NOT NULL;
   ```
   This is a non-destructive expansion: all existing values are still valid under the new enum. Apply to both prod (`piyin`) and dev (`piyin_dev`).

### Default unchanged

`lib/worksheet-append.ts:80` keeps `DEFAULT_CELL_STYLE = 'brush'`. New worksheets default to brush; users opt into 米字格 via the picker.

## Risks

- **R1 — ENUM migration:** If a worksheet row holds `cell_style='pen'` but the column hasn't been ALTERed to include `'cross'`, the new `cross` rows would fail to insert. Mitigation: apply the ALTER before any code reads/writes `cross`. Migration is idempotent (same column type, just wider).
- **R2 — fallback chains:** Adding `cross` without the helper would silently render as "钢笔格" via the existing fallthrough. Mitigation: introduce `cellStyleLabel()` and replace both call sites.
- **R3 — `data/content-manifest.json`** tracks char-content fields, not worksheet style, so no manifest update needed.

## Out of scope

- Any change to `font_family`, `paper_size`, line height, or line spacing.
- Any change to the `unlimited_history` membership feature (Spec B will touch membership).
- Bulk data backfill (Spec C).
- Any UI to highlight / animate the cell-style picker; just a 4th radio button.

## Verification

- `pnpm tsc --noEmit` → exit 0.
- New unit test in `tests/unit/lib/worksheet-types.test.ts` (or extend existing):
  - `validateWorksheetInput({title: 't', content: ['不'], cellStyle: 'cross'})` → `{ok: true, data: {...}}`
  - `validateWorksheetInput({title: 't', content: ['不'], cellStyle: 'nonsense'})` → `{ok: false, error: 'cellStyle must be brush, square, pen, or cross'}`
- New integration test or smoke: `POST /api/worksheets` with `cellStyle: 'cross'` returns 200; row in DB has `cell_style='cross'`; subsequent `GET /worksheet/<id>` page renders 米字格 SVG (smoke via curl HTML sniff or visual).
- Manual: `http://localhost:4444/worksheet/new?prefill=不` → pick 米字格 → 生成字帖 → preview shows box + cross guides.

## Commit plan

Single commit:
- `feat(worksheet): add 米字格 (cross) cell style`
- Files: `lib/worksheet-types.ts`, `components/worksheet/StylePicker.tsx`, `components/worksheet/WorksheetCell.tsx`, `app/worksheet/[id]/page.tsx`, `components/worksheet/WorksheetHistoryList.tsx`, `scripts/init-db.ts`, `scripts/migrations/2026-06-18-cell-style-cross.sql`, `tests/unit/lib/worksheet-types.test.ts` (or create if absent).