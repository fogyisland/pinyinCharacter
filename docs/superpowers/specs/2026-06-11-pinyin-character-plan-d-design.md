# Plan D Design — Rare Character Library + Worksheet Generator + Mini-Game

**Date:** 2026-06-11
**Status:** Draft (pending user review of written spec)
**Supersedes:** nothing (additive to Plan A + Plan B + Plan B+)
**Author:** brainstorming with user

---

## 1. Goal

Extend the existing 字 ↔ 拼音 工具 with three new feature groups, all serving the dual mission of **teaching** and **practice** for rare / out-of-daily-use Chinese characters:

1. **Rare character library** — a browsable catalog of ~1600 rare characters from the third tier of《通用规范汉字表》, each with pinyin, meaning, and a short story. Serves the teaching side.
2. **Worksheet generator** — converts a string of characters (free input or library selection) into a printable grid (毛笔格 or 田字格) for handwriting practice. Serves the practice side. Logged-in users can save worksheets to revisit.
3. **Drag-and-match mini-game** — 8 chars × 8 pinyin/meanings, drag pinyin/meaning onto the matching char. Reinforces recognition from the library.

Plus a **「今日一字」** banner on the library page that picks a deterministic char per day from the same dataset.

Builds on Plan B+ infrastructure: MySQL pool, JWT auth, audit log, existing `users` table, `init-db.ts` migration pattern, server component + client component split, zustand store for UI state.

## 2. Out of scope (deferred)

- Audio / TTS for character pronunciation (no `audio` column; stories are read silently)
- Worksheet "save as PDF" — users use the browser's native print → save as PDF
- Worksheet folders / categories / tagging
- 「今日一字」on the main `/` homepage
- Game leaderboards / score history
- Multiplayer / shared worksheets
- Admin UI for editing rare chars (data is imported by one-shot scripts; corrections are done via direct SQL)
- Word-by-word worksheets (v1 is whole chars; for now, 1 char = 1 cell, 2 chars = 2 cells)
- Handwriting recognition / scoring (the user writes on paper, we just print the grid)
- i18n (Chinese only, same as the rest of the app)

## 3. Data model

### 3.1 New table: `rare_chars`

```sql
CREATE TABLE IF NOT EXISTS rare_chars (
  char          VARCHAR(1)     NOT NULL,
  pinyin        VARCHAR(64)    NOT NULL,
  meaning       TEXT           NOT NULL,        -- 10-30 char short definition
  story         TEXT           NOT NULL,        -- 50-200 char story or example sentence
  needs_review  TINYINT(1)     NOT NULL DEFAULT 1,
  generated_by  VARCHAR(64)    NULL,            -- e.g. "openai:gpt-4o-mini"; NULL for human
  generated_at  DATETIME       NULL,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (char),
  KEY idx_pinyin (pinyin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Why `VARCHAR(1)` not `CHAR(1)`:** with utf8mb4, `CHAR(1)` would still work for a single CJK char (max 4 bytes), but `VARCHAR(1)` is the conventional choice for variable-content columns and signals intent more clearly.

**`needs_review=1` is sticky:** when an admin edits a row (out-of-band), they manually flip it to 0. v1 does not expose this in the UI.

**`generated_by` provenance:** every AI-filled row records which provider + model generated the content. A future audit pass can re-run the same prompt to compare or refresh.

### 3.2 New table: `worksheets`

```sql
CREATE TABLE IF NOT EXISTS worksheets (
  id          INT            NOT NULL AUTO_INCREMENT,
  user_id     INT            NOT NULL,
  title       VARCHAR(80)    NOT NULL,
  content     JSON           NOT NULL,          -- array of chars, e.g. ["字","字","字"]
  cell_style  ENUM('brush','square') NOT NULL, -- 毛笔格 | 田字格
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_created (user_id, created_at DESC),
  CONSTRAINT fk_worksheets_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- `content` is a JSON array of single chars. Duplicates are kept (they reflect practice order — "写 3 遍这个字" is a real use case).
- `cell_style` is restricted to the two supported values at the DB level.
- Anonymous users can generate worksheets but cannot save them; their worksheets are never written to the DB.
- No folders / categories: just per-user list ordered by `created_at DESC`.

### 3.3 No new table for 「今日一字」

The daily char is a deterministic function over `(char_list, date_string)`:

```ts
import { createHash } from 'crypto';

export function pickDailyChar(chars: string[], dateStr: string): string {
  const hash = createHash('sha1').update(dateStr).digest('hex').slice(0, 8);
  const idx = parseInt(hash, 16) % chars.length;
  return chars[idx];
}
```

- `dateStr` is `YYYY-MM-DD` in server local time (we don't have multi-region users to justify UTC).
- The char list is cached in module memory on first call; refresh on process restart is fine.
- The same date yields the same char for all users (no per-user randomization).

### 3.4 New audit events

Added to `lib/audit.ts`'s `AuditEvent` union:

| `event` value | When | Metadata |
|---|---|---|
| `worksheet_saved` | Logged-in user saves a worksheet | `{ worksheetId, charCount, cellStyle }` |
| `worksheet_deleted` | Owner deletes a worksheet | `{ worksheetId }` |

No new events for game play, library browse, or daily char (read-only / uninteresting from an audit perspective).

## 4. Build pipeline (data import + AI content generation)

Three standalone scripts run in order, each idempotent. None of them touch the running app.

### 4.1 `scripts/fetch-rare-chars.ts`

- Fetches a publicly hosted 通用规范汉字表 third-tier char list (~1600 chars). Source: a public GitHub mirror of the Chinese national standard (URL is hard-coded; if the source dies, manual update).
- For each char:
  - Look up pinyin from existing `data/pinyin-hanzi.json` (Plan A dictionary). This covers most common chars in the standard.
  - If not found in the dictionary, fall back to `pinyin-pro`'s Node API for the single char.
  - Insert into `rare_chars` with `meaning=''`, `story=''`, `generated_by=NULL`, `generated_at=NULL`, `needs_review=1`.
- Idempotent: uses `INSERT ... ON DUPLICATE KEY UPDATE pinyin = VALUES(pinyin)`. The `ON DUPLICATE KEY` clause **only updates `pinyin`**, never overwrites an already-filled `meaning`/`story` from a previous run.
- Expected runtime: 1-2 minutes for 1600 chars (one INSERT each; no batching needed for that size).

### 4.2 `scripts/generate-stories.ts`

- CLI args (required, no defaults):
  - `--provider <name>` (e.g. `openai`, `claude`, `deepseek`)
  - `--model <id>` (e.g. `gpt-4o-mini`, `claude-haiku-4-5-20251001`)
- Reads all rows where `meaning = ''` from `rare_chars`.
- Batches 50 chars per LLM call. Prompt template (Chinese):
  ```
  你是一位小学语文老师。请为以下汉字分别写 1)简短释义(10-30字)
  2)一个适合 6-12 岁孩子的故事或例句(50-200字)。

  汉字列表:
  {chars.join('\n')}

  请按以下 JSON 格式返回(不要 markdown 代码块,不要任何额外文字):
  [{"char":"龘","pinyin":"dá","meaning":"古同'达'","story":"..."}]
  ```
- Writes back: `meaning`, `story`, `generated_by="{provider}:{model}"`, `generated_at=NOW()`, `needs_review=1`.
- Rate limiting: 1 batch per 2 seconds (avoids most API limits; total runtime ~60-90 sec for 1600 chars).
- Failure handling: if a batch fails twice, log the failed chars to stderr and continue with the next batch. The script is re-runnable: rows still having `meaning=''` are picked up on the next run.
- Reads `LLM_API_KEY`, `LLM_BASE_URL` from `.env`. The base URL lets the user point at any OpenAI-compatible endpoint (Azure, OpenRouter, local llama.cpp, etc.).
- The script is **not** called at runtime or build time of the app. It is run by the operator exactly once (or whenever they want to refresh content).

### 4.3 `scripts/show-stats.ts`

- Reads counts from `rare_chars` and prints a small report:
  ```
  总数:           1600
  拼音已填:       1600
  释义已填:       1580
  故事已填:       1580
  待复核:         1580
  来源分布:       openai:gpt-4o-mini = 1580
  ```
- Pure read; safe to run any time.

### 4.4 Environment variables (additions to `.env.example`)

```
# Plan D — AI content generation (only needed for scripts/generate-stories.ts)
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1   # or any OpenAI-compatible endpoint
# LLM_PROVIDER and LLM_MODEL are CLI args, not env vars
```

The app itself does not read these env vars at runtime.

## 5. Authentication / authorization

- **No new auth mechanisms.** Reuses `getCurrentUser` from `lib/auth.ts`.
- **Library pages are public** (no auth required to browse, search, view details, or generate worksheets).
- **Worksheet save/delete requires login** (uses `getCurrentUser` in the relevant API routes; 401 JSON if not logged in, same convention as Plan B+).
- **「今日一字」 is public** (deterministic, no user state).
- **Mini-game is public** (no score persistence in v1).

## 6. API routes

### 6.1 Rare characters (3 routes, public)

#### `GET /api/rare-chars?q=&page=`

- Query params: `q` optional (search string), `page` optional (default 1).
- `q` matches against `pinyin` (LIKE `%q%`) and `char` (= `q` for exact single-char match). OR-combined.
- Page size: 80. Returns `{ ok: true, data: { chars: RareChar[], total: number, page: number, pageSize: 80 } }`.
- Validation: `page ≥ 1` (clamped). `q` length ≤ 32 (clamped). 400 on bad input.

#### `GET /api/rare-chars/[char]`

- Param: `[char]` is a single CJK character (URL-decoded from `%E9%BE%98` etc.).
- Returns `{ ok: true, data: RareChar }`. 404 if not found.
- `char` is validated to be exactly 1 codepoint (after decode); 400 if not.

#### `GET /api/rare-chars/daily`

- Returns `{ ok: true, data: { char, pinyin, meaning, story, date } }`.
- `date` is the server's `YYYY-MM-DD` for today.
- The returned char is the one computed by `pickDailyChar(allChars, date)`. Same date → same char.

### 6.2 Worksheets (2 routes, login required)

#### `GET /api/worksheets`

- Lists the current user's worksheets: `{ ok: true, data: { worksheets: Worksheet[] } }` ordered by `created_at DESC`.
- No pagination in v1 (a user accumulating >100 saved worksheets is unrealistic for handwriting practice). Hard limit: return at most 200; UI shows "显示最近 200 张".

#### `POST /api/worksheets`

- Body: `{ title: string, content: string[], cellStyle: 'brush' | 'square' }` (validated by zod).
- Validation: `title.length ∈ [1, 80]`, `content.length ∈ [1, 500]`, every `content[i]` is a single CJK char.
- Behavior: insert row, write audit `worksheet_saved { worksheetId, charCount, cellStyle }`, return the new `id`.
- 401 if not logged in.

#### `GET /api/worksheets/[id]`

- Loads the worksheet by id. 404 if not found, 403 if `user_id !== session.userId` (admins also get 403 on worksheets they don't own — v1 simplification).
- Returns `{ ok: true, data: Worksheet }`.

#### `DELETE /api/worksheets/[id]`

- Same 404/403 rules.
- On success: DELETE, write audit `worksheet_deleted { worksheetId }`, return 204.

### 6.3 No new `/api/admin/*` routes

Worksheet management is per-user, not admin. Admin features (if ever needed) would go through the existing `lib/admin.ts` queries; out of scope for Plan D.

## 7. UI / pages

### 7.1 `/rare-chars` (server component)

- Layout:
  - Top: `DailyCharBanner` (today's featured char, links to its detail page)
  - Search input (client component, debounced 300ms, calls `/api/rare-chars?q=`)
  - Grid of `RareCharCard` (80 per page)
  - Pagination links (page numbers + prev/next)
- Empty state: when `total=0` or `q` returns nothing, show `EmptyState` with a "清除搜索" button.
- `dynamic = 'force-dynamic'` (depends on the daily char + search query).

### 7.2 `/rare-chars/[char]` (server component)

- Single-char detail view:
  - Big char (font-size: 8rem) centered
  - Pinyin (large, with tone marks)
  - Meaning
  - Story (in a quote block)
  - "加入字帖" button → navigates to `/worksheet?prefill={char}` (worksheet form pre-selects this char in the library tab and switches to that tab)
- 404 if char not in DB. URL-decoded properly.

### 7.3 `/worksheet` (single client page with two views)

- Two views controlled by client state `view: 'form' | 'preview'`:
  - **form view:** tabs (`TextInputTab` | `LibrarySelectTab`) + `StylePicker` + title input + 「生成字帖」button
  - **preview view:** `WorksheetPreview` (rendered cells) + 「打印」button + 「保存」button (only visible if logged in) + 「返回修改」button
- Internal state: `{ title, content: string[], cellStyle, view }`. No URL state — keeping the page a single client component avoids query-string size issues for long content.
- 「打印」 calls `window.print()`. The print stylesheet (`@media print` in `globals.css`) hides everything except the worksheet grid.
- 「保存」 calls `POST /api/worksheets`, on success shows a toast and switches back to the form view (or stays on preview — TBD; UX choice in implementation).

### 7.4 `/worksheet/history` (server component)

- 401 / redirect to login if not logged in.
- Lists the current user's saved worksheets: title, char count, cell style, created_at, "查看" link, "删除" button.
- Empty state: "还没有保存的字帖" with a link to `/worksheet`.

### 7.5 `/worksheet/[id]` (server component)

- 404 if not found, 403 if not the owner.
- Renders the saved worksheet: title (h1) + created_at (small) + `WorksheetPreview` with the saved `content` + `cellStyle`.
- 「打印」 + 「删除」 buttons.

### 7.6 `/game` (client component)

- Loads 8 random `rare_chars` rows with non-empty meaning via `/api/rare-chars?` (with `minMeaning=true` query param, see §6.1).
- Layout: 8 chars in a column on the left, 8 pinyins/meanings in a shuffled column on the right.
- User drags a pinyin/meaning onto a char drop zone. Match: green flash + locked. Mismatch: red flash + return to pool.
- Top: timer (mm:ss counting up). Bottom: 「放弃」 button.
- End state: when all 8 are matched (or user gives up), show a modal with: elapsed time, accuracy (1 - mismatches/totalAttempts), 「再来一局」 (reloads the page with a new game), 「返回首页」.
- No score persistence, no leaderboard. State is local to the component.

### 7.7 Header navigation

- 3 new links in the main nav, after the existing `字 ↔ 拼音` link:
  - `罕见字库` → `/rare-chars`
  - `字帖` → `/worksheet`
  - `游戏` → `/game`
- Mobile hamburger menu gets the same 3 entries.

### 7.8 「今日一字」 placement

- Only on `/rare-chars` (top of page).
- Not on the main `/` page. Not on the worksheet / game pages.

## 8. Component breakdown

### 8.1 Server components (default, no interactivity)

- `components/rare/RareCharCard.tsx` — single card (char + pinyin + truncated meaning)
- `components/rare/DailyCharBanner.tsx` — banner with today's char
- `components/rare/RareCharPagination.tsx` — prev / page-numbers / next
- `components/rare/RareCharDetail.tsx` — full detail view (used by `/rare-chars/[char]`)
- `components/worksheet/WorksheetCell.tsx` — pure render: takes `char` and `style: 'brush' | 'square'`, draws an inline `<svg>` for the cell guides + a `<text>` for the char. Server-renderable.
- `components/worksheet/WorksheetHistoryList.tsx` — table of saved worksheets
- `components/common/EmptyState.tsx` — shared empty state

### 8.2 Client components (interactive)

- `components/rare/RareCharSearch.tsx` — debounced 300ms, calls API, uses `useRouter` to update URL
- `components/worksheet/WorksheetGenerator.tsx` — top-level form state container (tabs + style + title)
- `components/worksheet/TextInputTab.tsx` — textarea, validates char count
- `components/worksheet/LibrarySelectTab.tsx` — search + multi-select grid
- `components/worksheet/StylePicker.tsx` — radio (毛笔格 / 田字格)
- `components/worksheet/WorksheetPreview.tsx` — renders a list of `WorksheetCell`, plus print + save buttons
- `components/game/DragMatchGame.tsx` — state machine (idle / playing / finished)
- `components/game/DraggablePinyin.tsx` — HTML5 draggable
- `components/game/CharDropZone.tsx` — drop target
- `components/common/LoadingSpinner.tsx` — shared loading indicator

### 8.3 Cell rendering (毛笔格 / 田字格)

- Each cell is an inline `<svg viewBox="0 0 100 100">` with the guides drawn as `<line>` or `<path>` elements.
- 毛笔格: outer border (rect), two diagonals, one vertical center line. **No horizontal center line** (this is what makes it "毛笔格" — gives a sense of vertical axis without being too constraining for brush writing).
- 田字格: outer border, one vertical center, one horizontal center. No diagonals.
- Character is drawn as `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="60">` so the cell shows the char as a faint guide.
- Stroke color for guides: a light gray (`#bbb`). When the user prints, the guides are still visible.
- Color for the char: also light gray (so the user can trace over it). On screen, both are visible at 100%; on print, both print as gray.

### 8.4 Drag-match game internals

- 8 chars + 8 pinyin/meaning pairs (pinyin and meaning alternate randomly? — implementation choice; default is pinyin for v1, can switch to meaning later)
- HTML5 drag-and-drop API. No external library.
- State: `{ pairs: Array<{ charId, pinyinId, status: 'pending' | 'matched' | 'mismatched' }>, elapsedMs: number, startedAt: number }`
- A `mismatched` state lasts 600ms (red flash) then the pinyin returns to the pool.
- Timer is a single `setInterval` that increments `elapsedMs` every 100ms; cleaned up on unmount.
- End modal appears when all 8 are matched or 「放弃」 is clicked.

## 9. File structure (additions)

### New files

```
lib/
  rare-chars.ts
  worksheet.ts
  llm.ts
  ai-rare-chars.ts
  validators.ts
  api-handler.ts
  api-rare-chars.ts
  api-worksheet.ts
app/
  rare-chars/page.tsx
  rare-chars/[char]/page.tsx
  worksheet/page.tsx
  worksheet/history/page.tsx
  worksheet/[id]/page.tsx
  game/page.tsx
  api/rare-chars/route.ts
  api/rare-chars/[char]/route.ts
  api/rare-chars/daily/route.ts
  api/worksheets/route.ts
  api/worksheets/[id]/route.ts
components/
  common/EmptyState.tsx
  common/LoadingSpinner.tsx
  rare/RareCharCard.tsx
  rare/RareCharSearch.tsx
  rare/RareCharPagination.tsx
  rare/DailyCharBanner.tsx
  rare/RareCharDetail.tsx
  worksheet/TextInputTab.tsx
  worksheet/LibrarySelectTab.tsx
  worksheet/StylePicker.tsx
  worksheet/WorksheetCell.tsx
  worksheet/WorksheetGenerator.tsx
  worksheet/WorksheetPreview.tsx
  worksheet/WorksheetHistoryList.tsx
  game/DragMatchGame.tsx
  game/DraggablePinyin.tsx
  game/CharDropZone.tsx
scripts/
  fetch-rare-chars.ts
  generate-stories.ts
  show-stats.ts
tests/unit/lib/
  rare-chars.test.ts
  worksheet.test.ts
  validators.test.ts
tests/integration/
  rare-chars.test.ts
  worksheets.test.ts
```

### Modified files

- `scripts/init-db.ts` — add `rare_chars` and `worksheets` DDL
- `lib/audit.ts` — add `worksheet_saved` and `worksheet_deleted` events
- `components/Header.tsx` — add 3 new nav links
- `app/globals.css` — add `@media print` block, plus styling for new components
- `.env.example` — add LLM env vars
- `README.md` — add "罕见字库 + 字帖生成器 + 识字游戏" section

## 10. Testing

### 10.1 Unit (always run, no DB)

- `rare-chars.test.ts`:
  - `pickDailyChar(chars, dateStr)` returns a char from the list; same date → same char; different date → possibly different char (test with 2 specific dates)
  - `searchChars()` SQL builder produces correct WHERE clauses for `q` matching pinyin vs char
- `worksheet.test.ts`:
  - `generateLayout(content, style)` returns one cell per char in order; supports empty content (returns `[]`)
  - `validateWorksheetInput({ title, content, cellStyle })` returns errors for empty title / oversized content / invalid char / wrong cellStyle
- `validators.test.ts`:
  - Each zod schema accepts good input and rejects bad input

### 10.2 Integration (skip if `DATABASE_URL_TEST` unset)

- `rare-chars.test.ts`:
  - Seed 3 chars; `GET /api/rare-chars` returns them paginated
  - `?q=` filters correctly (by pinyin and by char)
  - `GET /api/rare-chars/[char]` returns the char; unknown char → 404; URL-encoded char decoded correctly
  - `GET /api/rare-chars/daily` returns the same char on the same date, different chars on different dates
- `worksheets.test.ts`:
  - Anonymous POST → 401
  - Logged-in POST → 201, row in DB, audit entry written
  - GET list → returns user's own worksheets
  - GET other user's worksheet → 403
  - DELETE own → 204, row gone, audit entry
  - DELETE other user's → 403

### 10.3 Manual smoke (final task)

- Run `pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts` — verify 1600 rows inserted
- Run `pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini` — verify meaning + story filled, `generated_by` column populated
- Run `pnpm tsx --env-file=.env scripts/show-stats.ts` — verify counts
- `pnpm dev`, visit `/rare-chars` — see the daily char banner + the grid
- Click a card → detail page renders → click "加入字帖" → lands on `/worksheet` with that char pre-selected
- Switch to 「自由输入」 tab, type "你好世界" — preview shows 4 cells
- Switch cell style to 田字格 — preview updates
- Click "打印" — print preview shows the grid only (header / form hidden)
- Login, save the worksheet → see it in `/worksheet/history` → click → view → delete
- Visit `/game` — drag a pinyin onto a char — match → green, mismatch → red flash
- Complete a game (or give up) → see the end modal with elapsed time

## 11. Acceptance criteria

1. `pnpm test` — all unit + integration tests pass (integration skipped without `DATABASE_URL_TEST`)
2. `pnpm exec tsc --noEmit` — clean
3. `pnpm build` — builds successfully with the new routes (7 page routes + 5 API routes = 12 new)
4. `pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts` + `pnpm tsx --env-file=.env scripts/generate-stories.ts ...` — runs without error and fills the table
5. All 7 manual smoke steps pass
6. All commits on `main` branch
7. README has a "罕见字库 + 字帖生成器 + 识字游戏" section documenting the new features and the build-script workflow

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `通用规范汉字表` source URL goes dead | The URL is hard-coded in `fetch-rare-chars.ts`; if it 404s, the script fails fast with a clear error. Operator updates the URL. v1 does not auto-discover mirrors. |
| LLM generates inaccurate pinyin or offensive content for some chars | Every row is `needs_review=1`. The script writes a row per char; a separate SQL pass can correct errors. (v1 does not expose this in UI.) |
| LLM API rate limits kick in | Script processes 1 batch per 2s; total runtime ~90s for 1600 chars. If a provider is slower, the operator can lower the batch size or add sleep. |
| 拖拽小游戏 on touch devices doesn't work (HTML5 DnD is desktop-centric) | v1: documented as desktop-only. Mobile users see the page but can only read the chars; no touch-based game in v1. |
| Worksheet with 500 chars × ~3KB cell SVG = ~1.5MB DOM | Tested with 50 cells (≈150KB); 500 cells is the absolute upper limit. If real users hit performance issues, we'll add a "split into multiple pages" option. |
| Game's "8 random chars" picks 8 that look identical (e.g. 𠂉 vs 𠂊) | Acceptable for v1; could add a "distinct" filter in a later iteration. |
| Daily char picks an unfilled (`meaning=''`) char | We pick from `meaning <> ''` rows only. If a day has no fillable char (DB empty), return 503 — but this should never happen in practice. |
| LLM API key leaks via git | `.env` is in `.gitignore` (verified at Plan B+). Documented in README. |
| Anonymous users spam POST /api/worksheets to bloat DB | 401 prevents it (no auth, no save). Generate-only path has no DB writes. |
| `/api/rare-chars?q=` SQL injection | zod validates the input; parameterized queries via the existing `pool.execute`. |

## 13. Plan for the implementation phase

Estimated ~32 tasks, executed via the subagent-driven-development skill (same pattern as Plan B+):

- **Phase 1: Data foundation** (4 tasks) — DDL + `lib/rare-chars.ts` + `lib/worksheet.ts` + `lib/validators.ts` + `lib/api-handler.ts`
- **Phase 2: Build pipeline** (3 tasks) — LLM client + fetch script + generate script + stats script
- **Phase 3: API routes** (5 tasks) — 3 rare-char routes + 2 worksheet routes
- **Phase 4: Components** (8 tasks) — common → rare list cards → daily banner / search / pagination / detail → worksheet style picker + cell + tabs + generator + preview + history list
- **Phase 5: Game** (3 tasks) — drag primitives + state machine + client API wrappers
- **Phase 6: Pages + navigation** (5 tasks) — 5 page routes + Header + globals.css
- **Phase 7: Wrap up** (4 tasks) — manual smoke (data + UI) + README + final code review + merge

Estimated total: 32 commits, ~3-5 days of focused subagent execution at the pace Plan B+ used.

Out of scope for the implementation plan: any deferred item from §2.
