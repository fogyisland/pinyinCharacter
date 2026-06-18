# Spec: 抄经模式 (Scripture Copy Mode)

## Goal

Add an in-place "抄经" (scripture copying) interaction to `/sutra/[id]` that turns each 经文 character from faint grey into inked dark sepia as the user clicks/taps through them, then collapses the scroll and reveals a 朱砂印章 (vermillion seal) on completion. Reuses the existing `/sutra/[id]` page, honors the user's reading-direction preference, and persists progress per-user to MySQL.

## Background

- `/sutra/[id]` is an RSC at `app/sutra/[id]/page.tsx` that loads `SutraDetail` via `getSutra()` and renders `SutraChunkPickerClient` (left sidebar) + `SutraReadingClient` (text view).
- `SutraReadingClient` (`components/sutra/SutraReadingClient.tsx`) is a client component that owns the reading-mode picker (horizontal / vertical-rtl / vertical-ltr) via `useSutraReading()` and renders `SutraTextView`.
- `SutraTextView` (`components/sutra/SutraTextView.tsx`) renders lines from `chunk.content` as `<p>` blocks; supports 3 writing-modes via inline `style={{ writingMode }}`.
- `useSutraReading` (`lib/use-sutra-reading.ts`) persists the user's preferred reading direction in `localStorage` under `pinyin:sutra-reading`. Default: `horizontal`.
- Sutra data shape (`lib/sutra-types.ts`): `SutraChunk` has `content: string[]` (lines) + `pinyin: string[][]` (line → char → pinyin). 12 sutras × 1-10 chunks × 5-50 chars/line ≈ 3000 total chars max.
- `/sutra/[id]` is currently anonymous-readable; gated actions (save worksheet, print multi-page) require login via `requireUser()` in API handlers.
- No "copy mode" or progress table exists today.

User decisions confirmed in brainstorm:
1. Entry point = same-page toggle button on `/sutra/[id]` (not a separate route).
2. Reading direction = honor the user's existing preference from `useSutraReading` (no lock).
3. Persistence = DB-backed (`sutra_copy_progress` table), per-(user, sutra, chunk).
4. Login = required; anonymous users see a banner + disabled view.

## Design

### Components

**New:** `lib/sutra-copy-progress.ts` (`'server-only'`)
```ts
export interface CopyProgress {
  writtenChars: boolean[];   // flat array matching chunk.content joined
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
export async function getProgress(userId: number, sutraId: number, chunkIdx: number): Promise<CopyProgress | null>;
export async function upsertProgress(userId: number, sutraId: number, chunkIdx: number, writtenChars: boolean[]): Promise<void>;
export async function markComplete(userId: number, sutraId: number, chunkIdx: number): Promise<void>;
```

**New:** `migrations/2026-06-19-sutra-copy-progress.sql`
```sql
CREATE TABLE sutra_copy_progress (
  user_id INT UNSIGNED NOT NULL,
  sutra_id INT UNSIGNED NOT NULL,
  chunk_idx INT UNSIGNED NOT NULL,
  written_chars JSON NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (user_id, sutra_id, chunk_idx),
  INDEX idx_user_completed (user_id, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**New:** `app/api/sutra/[id]/copy-progress/route.ts`
```ts
// GET  /api/sutra/[id]/copy-progress?chunk=N  →  { progress: CopyProgress | null }
// POST /api/sutra/[id]/copy-progress  body: { chunkIdx, writtenChars, completed?: bool }
```
- Both routes require `requireUser()`; 401 to anonymous.
- POST is idempotent: upsert by `(user_id, sutra_id, chunk_idx)`.
- Validation: `chunkIdx` 0..chunks.length-1 (server-side lookup of sutra to enforce).

**New:** `components/sutra/SutraCopyView.tsx` (`'use client'`)
- Props: `{ chunk: SutraChunk; sutraId: number; userId: number | null; reading: SutraReading; onExit: () => void }`
- State: `writtenChars: boolean[]` (initialized from API GET on mount); `phase: 'copying' | 'collapsing' | 'sealed'`.
- Layout:
  - Top progress bar: `已抄 N / Total 字`
  - Body: each char rendered as `<span class="copy-char" data-idx={i}>` inside `<p>` lines matching `chunk.content`. CSS `writing-mode` matches `reading` prop. Pinyin `<span class="copy-pinyin">` underneath each char (same as SutraTextView).
  - When `userId === null`: render with class `copy-char--disabled` (pointer-events: none, no hover) and show banner "请登录后开始抄经，进度将自动保存"
  - Click handler (only if `userId`): toggle `writtenChars[idx] = true`; debounce POST 500ms; when all true → set `phase = 'collapsing'`.
- Collapse trigger: `useEffect` watching `phase === 'collapsing'` → add `.copy-view--collapse` class to root → after 1200ms → `setPhase('sealed')` + POST `{ completed: true }`.
- Sealed phase: replace body with `<CopySeal onReset={...} onExit={onExit} />`.

**New:** `components/sutra/CopySeal.tsx`
- Inline SVG: 80×80 viewBox `<circle cx=40 cy=40 r=36 stroke=#B22B2B strokeWidth=1.5 fill=none>` + `<text x=40 y=44 textAnchor=middle fontSize=10 fill=#B22B2B fontFamily="Noto Serif SC, serif">功德圆满</text>`. Centered in viewport via `fixed inset-0 flex items-center justify-center`.
- Below seal: two buttons "重新抄写" + "退出抄经".
- `onReset`: parent resets state via `setWrittenChars(new Array(N).fill(false))` + re-POST (clears completed_at via DELETE-then-POST or upsert with empty array).
- `onExit`: parent calls `onExit()` to switch back to SutraTextView.

**Modified:** `components/sutra/SutraReadingClient.tsx`
- Add state `copyMode: boolean`.
- Add button "进入抄经" / "退出抄经" next to the `ReadingModePicker` in the toolbar row.
- When `copyMode === true`: render `<SutraCopyView />` instead of `<SutraTextView />`.
- When entering copy mode for the first time per chunk: trigger GET progress and hydrate.
- When chunk changes (`chunk.id` via prop): SutraCopyView re-mounts with new chunk → fetch fresh progress.

**Modified:** `app/sutra/[id]/page.tsx`
- Pass `sutra.id` and `user?.id ?? null` to `SutraReadingClient` (currently only passes `chunk`).
- No DB query added; client component fetches its own progress.

### Visual specs

| Element | CSS |
|---------|-----|
| Unwritten char color | `rgba(0, 0, 0, 0.15)` |
| Written char color | `#2c251e` |
| Char transition | `color 0.4s ease-in-out` |
| Char container | inline-block, padding 4px 6px |
| Char hover (unwritten, interactive) | bg `rgba(222, 203, 183, 0.15)`, cursor pointer |
| Char disabled (anonymous) | cursor default, pointer-events none, hover unchanged |
| Progress bar | top fixed thin (4px) bar, fill `#B22B2B`, width = % written |
| Collapse animation | `transform: scale(X\|Y)(0); opacity: 0` over 1.2s `cubic-bezier(0.25, 1, 0.5, 1)`; `transform-origin: center`; direction = scaleX for `horizontal`, scaleY for `vertical-rtl`/`vertical-ltr` |
| Seal entrance | `transform: scale(0.5)` → `scale(1)` + `opacity: 0` → `opacity: 1`, 0.6s ease-out, `transform-origin: center` |
| Banner (anon) | `bg-paper-warm border-l-4 border-seal text-sm p-3`, text "请登录后开始抄经，进度将自动保存" + link to `/login?next=...` |

### Interaction flow

```
[Reading mode] user on /sutra/[id]
   ↓ click "进入抄经" button (next to ReadingModePicker)
[SutraReadingClient.copyMode = true]
   ↓ render SutraCopyView, mount → GET /api/sutra/[id]/copy-progress?chunk=N
[SutraCopyView phase=copying]
   - render chars with written[] from API (default all-false for new users)
   - if userId null: add .copy-char--disabled, show banner
   - click char (if userId): written[i]=true, schedule debounced POST
   - POST 500ms debounce → /api/sutra/[id]/copy-progress { chunkIdx, writtenChars }
   - all true? → phase = 'collapsing'
[phase=collapsing]
   - add .copy-view--collapse class
   - CSS animates scale(0)+opacity 0 over 1.2s
   - after 1200ms → setPhase('sealed') + POST { chunkIdx, completed: true }
[phase=sealed]
   - hide copy body, show <CopySeal>
   - Seal fades in (CSS class .copy-seal--enter) over 0.6s
   - buttons: "重新抄写" / "退出抄经"
[chunk switch via SutraChunkPickerClient]
   - SutraCopyView unmounts (key=chunk.id) → remounts → fresh GET
[click 重新抄写]
   - confirm("将清除本段抄经进度，确定？")
   - confirmed: setWrittenChars(all-false) + DELETE-then-POST pattern → phase=copying
[click 退出抄经]
   - onExit() → SutraReadingClient.copyMode=false → re-render SutraTextView
```

### Edge cases

- **Anonymous enters copy mode:** button is always clickable; entering copy mode with `userId === null` shows the disabled view (banner + non-interactive chars). The banner links to `/login?next=/sutra/[id]&chunk=N`. After login + return, user re-enters copy mode and progress view loads normally. There is no auto-redirect on entering copy mode — anonymous reading must not be broken.
- **Anonymous click on char:** banner shown, click is no-op (pointer-events: none on disabled class).
- **Network failure on POST:** toast error "进度保存失败"; state stays in-memory until next click triggers retry.
- **Chunk switch mid-collapse:** if user clicks chunk picker while `phase=collapsing` or `phase=sealed`, the cancel resets state in the parent and re-mounts SutraCopyView with the new chunk's progress. In-flight POSTs for the old chunk still resolve (server is idempotent).
- **Sealed chunk revisited:** GET returns `{ completedAt: '...' }`; SutraCopyView starts in `phase=sealed` directly (shows seal without re-collapse).
- **Reset clears completed_at:** server-side, `POST { chunkIdx, writtenChars: all-false }` followed by `UPDATE ... SET completed_at = NULL WHERE ...`; or simpler: `DELETE` row + `INSERT` on next click. v1: do the latter (DELETE on reset).
- **Login redirect:** anonymous click on "进入抄经" prompts login modal that returns to current URL; do not auto-redirect on page load (don't break anonymous reading).
- **Print button:** when `copyMode=true`, hide the Print button + SaveAsWorksheetButton (they don't make sense in copy mode). Keep ReadAloud (audio still works).

### Out of scope (v1)

- 功德圆满 animations beyond seal fade (no 印 flash, no 回向文 input, no haptic).
- Stats / leaderboard / sharing ("今日全站 N 段抄经完成").
- Exporting inked copy as image / PDF.
- Tracking which chars took longest to copy.
- Multi-user collaborative copy of the same chunk.

## Test plan

**Unit** (`tests/unit/lib/sutra-copy-progress.test.ts`):
- `getProgress` returns null for fresh user.
- `upsertProgress` inserts a row, idempotent on (user, sutra, chunk).
- `markComplete` sets completed_at only when writtenChars all true; no-op if any false.

**Integration** (`tests/integration/api/sutra-copy-progress.test.ts`):
- GET anonymous → 401.
- POST anonymous → 401.
- GET authenticated new user → 200 with `progress: null`.
- POST with valid writtenChars → 200; subsequent GET returns same array.
- POST with invalid chunkIdx → 400.

**Component** (`tests/unit/components/sutra/sutra-copy-view.test.tsx`):
- Renders all chars in faint color by default.
- Click on char (with userId) → DOM class `copy-char--written`.
- After last click → root has `copy-view--collapse` class after 500ms.
- Anonymous user → chars have `copy-char--disabled` class + banner visible.
- Sealed phase → renders CopySeal with reset/exit buttons.

**Manual smoke:**
- `/sutra/1` with logged-in user → click "进入抄经" → all chars faint → click through to last → seal fades in → click "退出抄经" → back to reading view.
- Reload page mid-copy → progress persists (chars previously clicked show as inked).
- Switch chunks → fresh progress loads for new chunk.
- Logout → click "进入抄经" → banner shown, clicks no-op.

## Migration

`migrations/2026-06-19-sutra-copy-progress.sql` — single CREATE TABLE. Forward-compatible: no other tables touched. Run via existing `pnpm tsx scripts/migrate.ts` pipeline.

## Files touched

**New (6):**
- `migrations/2026-06-19-sutra-copy-progress.sql`
- `lib/sutra-copy-progress.ts`
- `app/api/sutra/[id]/copy-progress/route.ts`
- `components/sutra/SutraCopyView.tsx`
- `components/sutra/CopySeal.tsx`
- Tests: `tests/unit/lib/sutra-copy-progress.test.ts`, `tests/unit/components/sutra/sutra-copy-view.test.tsx`, `tests/integration/api/sutra-copy-progress.test.ts`

**Modified (2):**
- `components/sutra/SutraReadingClient.tsx` (add copyMode state, toggle button, swap view)
- `app/sutra/[id]/page.tsx` (pass userId + sutraId to client)