# Spec B: 多页 / 批量打印 会员限制

## Goal

Gate the existing single-worksheet print + add batch (multi-worksheet) print, so that **monthly/annual members can print any number of worksheets in one batch and any number of pages per worksheet**, while **logged-in free users can only print one worksheet, first page only**.

## Background

- The existing `/api/worksheets/[id]/print` endpoint accepts any logged-in user and prints the worksheet via `window.print()`.
- `lib/membership.ts:9` defines `MembershipFeature = 'unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts'` — 4 existing keys, none of which touch print.
- `lib/membership.ts:88` `ALL_FEATURES` is iterated by `seedDefaultPlans()` to grant every feature to every new plan.
- `lib/worksheet-types.ts:35` declares `PAPER_SIZES = [{value:'A3', cellsPerPage:132}, {value:'A4', cellsPerPage:96}, {value:'B5', cellsPerPage:66}]` — currently used only by the `PaperSizePicker` UI hint.
- `components/common/PrintButton.tsx` is a generic client component that POSTs to the endpoint then calls `window.print()`. Currently no membership awareness.
- `components/worksheet/WorksheetHistoryList.tsx` lists saved worksheets as individual rows with per-row `PrintButton` + `DeleteWorksheetButton`. No multi-select, no batch action.

User decisions confirmed in brainstorm:
1. Monthly and annual members have **the same** unlimited capability (price/duration differ; feature does not).
2. Free users (logged in, no active membership) are **hard-rejected with upgrade prompt** when they exceed limits; UI pre-validates where possible.
3. The free limit applies to **print only**, not save (free users can save any-size worksheet; print truncates / blocks).
4. "Free" = logged-in user with no active membership row in `memberships` (with `revoked_at IS NULL AND expires_at > NOW()`).

## Design

### Feature key

Add one new value to `MembershipFeature`:

```ts
| 'multi_worksheet_print'
```

This single key unlocks BOTH capabilities for members:
- Print N worksheets in one batch (free limit: 1 worksheet per print action).
- Print all pages of a single worksheet (free limit: page 1 only).

Monthly and annual plans both get it (one feature, no per-tier differentiation).

### Page-count helper (single source of truth)

New file `lib/worksheet-page-count.ts`:

```ts
import type { PaperSize } from './worksheet-types';

const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 132,
  A4: 96,
  B5: 66,
};

export function cellsPerPage(paperSize: PaperSize): number {
  return CELLS_PER_PAGE[paperSize];
}

export function pageCountFor(contentLength: number, paperSize: PaperSize): number {
  const per = cellsPerPage(paperSize);
  return Math.max(1, Math.ceil(contentLength / per));
}

export function exceedsFreeLimit(contentLength: number, paperSize: PaperSize): boolean {
  return pageCountFor(contentLength, paperSize) > 1;
}
```

`lib/worksheet-types.ts:35-39` re-exports `cellsPerPage` (and `PaperSize` type stays in place) so the existing `PaperSizePicker` UI hint uses the same number — eliminates drift risk.

### Backend gates

**`POST /api/worksheets/print-batch` (NEW)**

Request: `{ worksheetIds: number[] }` (Zod-validated, `min(1)`, `max(50)`).

Server logic:
1. `requireUser` — 401 if not logged in.
2. Load all rows: `SELECT id, title, content, paper_size FROM worksheets WHERE user_id = ? AND id IN (?)`.
3. If any requested ID is missing from result → 404 (don't leak which IDs exist).
4. If user has `multi_worksheet_print` feature (`hasFeature(user.id, 'multi_worksheet_print')`):
   - return `{ ok: true, data: { worksheets: [{id, title, content, paperSize, cellStyle, fontFamily}, ...] } }`
   - log `worksheet_batch_printed` audit event with `{count: N, ids: [...]}`
   - log download event per worksheet (`format: 'print'`, `sourceType: 'worksheet'`)
5. Else (free user):
   - If `worksheetIds.length > 1` → 403 `{ code: 'membership_required', reason: 'batch', upgradeUrl: '/membership' }`
   - Else (single worksheet), compute `pageCountFor(content.length, paperSize)`:
     - If > 1 → 403 `{ code: 'membership_required', reason: 'multi_page', upgradeUrl: '/membership' }`
     - Else → 200 with same payload shape (free user can print 1-page worksheets)
6. Error code `membership_required` is new in `lib/api-handler.ts` (added if not present; same shape as existing `forbidden`/`unauthorized`).

**`POST /api/worksheets/[id]/print` (MODIFIED)**

Same logic for the **single** path:
1. Existing checks (auth, ownership).
2. **New gate:** if user lacks `multi_worksheet_print` AND `pageCountFor(content.length, paperSize) > 1` → 403 `{ code: 'membership_required', reason: 'multi_page', upgradeUrl: '/membership' }`.
3. Otherwise existing behavior unchanged (log download + audit, return ok).

**`GET /api/worksheets/[id]/can-print` (NEW, tiny pre-check endpoint)**

Used by the detail-page `PrintButton` to decide whether to render the button or the upgrade hint, without firing a full print attempt.

Response: `{ ok: true, data: { canPrint: boolean, reason?: 'multi_page' | 'batch', upgradeUrl: '/membership' } }`

Cheap query: `SELECT content, paper_size FROM worksheets WHERE id = ? AND user_id = ?` + a feature check (cached via `getMyFeatures`).

### Frontend UX

**`/worksheet` history list (`WorksheetHistoryList.tsx`)**

- Add a leading checkbox column: `<input type="checkbox" checked={selected.has(w.id)} onChange={...} />`.
- Track `selected: Set<number>` in component state.
- Add a sticky action bar at the top:
  - If user has `multi_worksheet_print`: `<BatchPrintButton worksheets={selectedWorksheets} />`
  - Else: disabled button "批量打印 (N) — 需会员" that links to `/membership`
- Each row's existing single `PrintButton` is preserved (free users can still print 1-page worksheets individually).

**`/worksheet/[id]` detail page (`PrintButton.tsx`)**

- New optional prop `gate: 'multi_page' | null` (default null).
- If `gate === 'multi_page'` and user lacks feature, on mount call `/api/worksheets/[id]/can-print` and:
  - If `canPrint: true` → render the normal print button (current behavior).
  - If `canPrint: false` → render an upgrade card: "本字帖有 N 页 · 升级会员可打印全部页面" with link to `/membership`. Button hidden.
- If `gate === null`, the existing behavior is unchanged (used by `/worksheet/new` preview which always renders free).

**`BatchPrintButton.tsx` (NEW)**

- Receives the full worksheet payload (from the print-batch endpoint success response).
- Renders an off-screen `<BatchPrintPreview>` (also NEW) — a `<div class="batch-print-area">` containing N worksheet sections, each separated by `<div style="page-break-after: always" />`.
- Calls `window.print()` once.
- Style: `.batch-print-area { position: absolute; left: -10000px; top: 0; }` so it's invisible on screen but visible to the print media query.
- After print dialog closes (or on cancel), the div stays (no teardown needed; off-screen).

**Upgrade hint UX (everywhere)**

Standard helper `<UpgradeHint reason="batch" | "multi_page" />` rendering a small inline `<Link href="/membership">升级会员 → </Link>` block. Reused by:
- `PrintButton` upgrade-card path
- `BatchPrintButton` disabled state
- 403 toast in `lib/api-worksheet.ts` client helper

### Audit event

`lib/audit-format.ts`:
- Add `'worksheet_batch_printed'` to `AuditEvent` union.
- Add formatLogMessage case:
  ```ts
  case 'worksheet_batch_printed':
    return `批量打印 ${num(m.count) || '?'} 张字帖 (${arr(m.ids)?.map(String).join(', ') || '?'})`;
  ```

### Plan feature display

`components/membership/PlanCard.tsx` and `components/admin/memberships/PlanRow.tsx`:
- Add to `FEATURE_LABELS`: `multi_worksheet_print: '批量 / 多页打印'`.

`scripts/migrations/2026-06-18-multi-worksheet-print-feature.sql` (NEW):
```sql
-- 2026-06-18: grant 'multi_worksheet_print' to all existing plans (idempotent)
INSERT IGNORE INTO membership_plan_features (plan_id, feature_key)
SELECT id, 'multi_worksheet_print' FROM membership_plans;
```
Apply to both dev and prod.

### Validity / validator

`lib/validators.ts`:
- New `printBatchSchema`: `z.object({ worksheetIds: z.array(z.number().int().positive()).min(1).max(50) })`.
- New (if not present) `forbidden` helper or use existing `forbidden('membership_required', message)` in `lib/api-handler.ts`.

### Free user save behavior (unchanged)

Free users can still `POST /api/worksheets` with any `content.length`. The save path is not gated. The gate is print-only.

## Risks

- **R1 — paper-size enum drift.** Mitigation: `cellsPerPage` lives in one file; both backend gate and UI hint import from it.
- **R2 — composite print CSS.** `@media print { .batch-print-area { position: static; } }` plus `page-break-after: always` between worksheets. Manual smoke required (no automated browser test infrastructure).
- **R3 — orphan rows.** If a worksheet is deleted between fetch and render, UI silently drops it (acceptable; logged).
- **R4 — batch cap of 50.** Documented in the validator message; UI shows hint when more are selected ("仅会打印前 50 张").
- **R5 — backfill migration.** `seedDefaultPlans` only runs on fresh `init-db.ts`; this migration inserts into existing plan rows.
- **R6 — `hasFeature` cost.** `getMyFeatures` is `cache()`-wrapped; per-gate check is one cached query (or one direct query if cache miss). Acceptable.

## Out of scope

- Server-side PDF generation.
- Scheduled / delayed prints.
- Shareable print links (e.g., `/print/<token>` for grandparents).
- Print history dashboard beyond the existing `logDownload` audit.
- Per-tier feature differentiation (monthly vs annual have identical print capability per user choice).
- Touching Spec A (米字格) or Spec C (etymology) — separate specs.

## Verification

- `pnpm tsc --noEmit` exit 0.
- `pnpm test tests/unit/lib/worksheet-page-count.test.ts` — all cases pass.
- `pnpm test tests/unit/lib/audit.test.ts` — all cases (35 after bump) pass.
- Manual smoke (3 paths):
  1. Free user, 200-char A4 worksheet, detail page → print button hidden, upgrade card visible with link to `/membership`.
  2. Member, 5 saved worksheets, history list → multi-select 3 → click 批量打印 (3) → browser print preview shows all 3 in sequence.
  3. Free user → checkboxes visible in history, batch button reads "批量打印 (N) — 需会员" and is disabled.

## Commit plan (3 logical commits)

1. `feat(membership): add multi_worksheet_print feature + page-count helper + DB migration` — types, helpers, migration file, applied to dev + prod.
2. `feat(worksheet-print): gate single + add batch print endpoint` — print route gate, new print-batch route, validators, audit event + tests.
3. `feat(worksheet-history): multi-select + batch print UI + upgrade hints` — WorksheetHistoryList changes, BatchPrintButton + BatchPrintPreview, PrintButton gate prop, PlanCard/PlanRow label.