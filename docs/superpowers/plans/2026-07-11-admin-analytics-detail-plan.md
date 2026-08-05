# Admin Analytics Detail (Wave 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/analytics` — the first detail page that consumes Wave 1 helpers (`parseRange`, `BarChartTop`) and adds a `getTopPaths` query helper, resolving the 404 from the page-views StatCard links.

**Architecture:** Server component reads `searchParams.range` → `parseRange` (Wave 1) → `rangeToDays` (Wave 1) → `getTopPaths(days, 20)` (NEW, single SELECT) → renders URL-driven range tabs + Wave 1 `BarChartTop` (left) + detail table (right). One client island (`<CopyPathCell/>`) for click-to-copy on path cells. Sidebar entry in 运维 group. REDEPLOY v8 → v9 since this is the first production-deployable wave since page-views v8.

**Tech Stack:** Next.js 15.5.19 App Router + React 19 + mysql2/promise + Wave 1 helpers (`lib/admin-range.ts`, `components/admin/charts/BarChartTop.tsx`) + Tailwind + lucide-react. **No new dependencies.**

**Commit strategy:** 3 commits (TDD-friendly, one per task) + 1 REDEPLOY doc commit, each with `[2026-07-11 HH.MM]` suffix per `feedback-commit-timestamps.md`. TDD discipline requires tests ship with their code.

## Global Constraints

- **package manager**: `npm` (per `project-uses-npm.md`); no new deps this wave
- **No `app/api/**` route** for this feature — single server component, no client roundtrip
- **server-side `searchParams`**: Next.js 15 — `searchParams` is `Promise<{...}>`, must `await`
- **mysql2**: select via `pool.query()` (text protocol, no supp-plane chars in `page_views.path`)
- **TypeScript strict**: no `any` leaks in exported interfaces; `Number(r.views)` casts in helper are deliberate
- **Tests**: vitest, mock-pool pattern from `tests/unit/lib/admin-activity.test.ts` (Wave 1) — single `queryLog` since `getTopPaths` uses `pool.query()` only (no `execute()`)
- **Commits**: append `[YYYY-MM-DD HH.MM]` per `feedback-commit-timestamps.md`
- **Branch**: local main only (no auto-push per `no-prod-env-2026-06-21.md`)
- **REDEPLOY**: bump `REDEPLOY-2026-07-09.md` v8 → v9 (this wave is **production-deployable** — first wave that activates a new route after page-views v8)
- **Naming**: components `PascalCase.tsx`; lib `kebab-case.ts`
- **Per-task review**: include `npm run build` output when diff touches `app/**/page.tsx` (per `feedback-per-task-build-check.md`)
- **Wave 1 follow-ups to consume in Wave 2** (per `progress.md` Wave 1 ledger):
  1. Move `wave1-foundation-report.md` from `.superpowers/sdd/` (gitignored) to `docs/superpowers/sdd/` — fold into Task 3 (REDEPLOY doc commit) as a side-effect git mv
  2. Trailing newlines on Wave 1 chart files (Sparkline, BarChartTop, index.ts) — fold into Task 1 commit as a side-effect trailing-newline fix
  3. **`BarChartTopProps.height` phantom prop** + **`router.push` over `window.location.href`** — NOT Wave 2's job (Wave 2 doesn't wire `BarChartTop.href`); defer to Wave 3
- **Sidebar**: 运维 group is at `components/admin/AdminSidebar.tsx:7-17`; add new entry at the END of that group's items array (after `{ href: '/admin/tts', label: '语音设置' }`)

### Schema notes (verified against Wave 0 init-db.ts)

`page_views` table (per `scripts/init-db.ts` + page-views plan):
```sql
id BIGINT, user_id BIGINT NULL, path VARCHAR(255), ip VARCHAR(45) NULL,
user_agent VARCHAR(255) NULL, created_at DATETIME(3),
KEY idx_pv_path_created (path, created_at DESC)
```

This means `WHERE created_at >= ... AND path IS NOT NULL GROUP BY path` can use `idx_pv_path_created` for the path part; the date filter uses `idx_pv_created`. Both indexes are present — single SELECT is fast.

---

### Task 1: `getTopPaths` helper (TDD)

**Files:**
- Modify: `lib/admin-pageviews.ts` (extend with `getTopPaths` + `TopPage` interface; preserve existing `getPageViewStats`)
- Create: `tests/unit/lib/admin-pageviews.test.ts` (~80 LoC, 5 cases)

**Interfaces:**
- Produces: `TopPage` interface `{path: string; views: number; unique: number}` + `getTopPaths(days: number, limit: number): Promise<TopPage[]>` — consumed by Task 2's `app/admin/analytics/page.tsx`

- [ ] **Step 1: Write failing tests for `getTopPaths`**

Create `tests/unit/lib/admin-pageviews.test.ts` with this complete content:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let queryResults: Record<string, any[]> = {};
let queryLog: Array<{ sql: string; params: any[] }> = [];

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key];
      }
      return [[]];
    }),
  }),
}));

import { getTopPaths } from '@/lib/admin-pageviews';

beforeEach(() => {
  queryResults = {};
  queryLog = [];
});

describe('getTopPaths', () => {
  it('queries FROM page_views with INTERVAL clause + LIMIT', async () => {
    await getTopPaths(7, 20);
    const q = queryLog.find((x) => x.sql.includes('FROM page_views'));
    expect(q).toBeDefined();
    expect(q!.sql).toContain('GROUP BY path');
    expect(q!.sql).toContain('ORDER BY');
    expect(q!.sql).toContain('LIMIT ?');
    expect(q!.params).toEqual([7, 20]);
  });

  it('uses COUNT(DISTINCT COALESCE(user_id, ip)) for unique visitors', async () => {
    queryResults['FROM page_views'] = [[
      { path: '/x', views: 5, unique_visitors: 3 },
    ]];
    await getTopPaths(7, 10);
    expect(queryLog[0].sql).toMatch(/COUNT\(DISTINCT COALESCE\(user_id, ip\)\)/);
  });

  it('groups by path, orders by views DESC, maps {path, views, unique}', async () => {
    queryResults['FROM page_views'] = [[
      { path: '/a', views: 100, unique_visitors: 50 },
      { path: '/b', views: 50, unique_visitors: 30 },
    ]];
    const result = await getTopPaths(7, 10);
    expect(result).toEqual([
      { path: '/a', views: 100, unique: 50 },
      { path: '/b', views: 50, unique: 30 },
    ]);
  });

  it('returns [] for empty result set', async () => {
    queryResults['FROM page_views'] = [[]];
    expect(await getTopPaths(7, 20)).toEqual([]);
  });

  it('passes limit parameter as 2nd SQL param', async () => {
    await getTopPaths(30, 100);
    expect(queryLog[0].params).toEqual([30, 100]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail (helper not exported yet)**

Run: `npx vitest run tests/unit/lib/admin-pageviews.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/admin-pageviews"` (5 test errors)

- [ ] **Step 3: Add `getTopPaths` to `lib/admin-pageviews.ts`**

Modify `lib/admin-pageviews.ts` — append after the existing `getPageViewStats` function (do NOT modify `getPageViewStats` itself). Add this complete code block at the end of the file:

```ts
export interface TopPage {
  path: string;
  views: number;
  unique: number;
}

/**
 * Top-N page paths over the last `days` days, ordered by total views DESC.
 *
 * Single SELECT on `page_views` using `idx_pv_path_created` + `idx_pv_created`.
 * `unique` is COUNT(DISTINCT COALESCE(user_id, ip)) so logged-in users are
 * counted by id and anonymous users by IP — matches the same convention as
 * `getPageViewStats().todayUv`.
 */
export async function getTopPaths(days: number, limit: number): Promise<TopPage[]> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT
       path,
       COUNT(*) AS views,
       COUNT(DISTINCT COALESCE(user_id, ip)) AS unique_visitors
     FROM page_views
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY path
     ORDER BY views DESC
     LIMIT ?`,
    [days, limit],
  );
  return (rows as any[]).map((r) => ({
    path: r.path,
    views: Number(r.views),
    unique: Number(r.unique_visitors),
  }));
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/lib/admin-pageviews.test.ts`
Expected: PASS — `Tests 5 passed (5)`

- [ ] **Step 5: Verify tsc clean + fold Wave 1 cosmetic fixup**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Fold Wave 1 follow-up #4 into this commit (trailing newlines on 3 chart files):
- Read `components/admin/charts/Sparkline.tsx` — confirm missing trailing newline
- Read `components/admin/charts/BarChartTop.tsx` — confirm missing trailing newline
- Read `components/admin/charts/index.ts` — confirm missing trailing newline
- Append `\n` to each (Edit tool, replace the last line with itself + `\n`, or use `Write` to rewrite the file with trailing newline)

Document this fold-in in the commit message body. Do NOT fix the `BarChartTopProps.height` phantom prop here — that's Wave 3's job per `progress.md`.

- [ ] **Step 6: Commit**

```bash
git add lib/admin-pageviews.ts tests/unit/lib/admin-pageviews.test.ts \
        components/admin/charts/Sparkline.tsx components/admin/charts/BarChartTop.tsx \
        components/admin/charts/index.ts
git commit -m "feat(admin-pageviews): add getTopPaths(days, limit) + 5 unit tests [2026-07-11 HH.MM]

  - lib/admin-pageviews.ts: TopPage {path, views, unique} interface +
    getTopPaths(days, limit) — single SELECT with COUNT(*) views + 
    COUNT(DISTINCT COALESCE(user_id, ip)) unique, GROUP BY path 
    ORDER BY views DESC LIMIT ?; uses idx_pv_path_created + idx_pv_created
  - tests/unit/lib/admin-pageviews.test.ts: 5 cases (mock-pool pattern;
    SQL clause check, unique SQL check, mapping check, empty fallback,
    limit param check)
  - components/admin/charts/{Sparkline,BarChartTop,index}.ts: add missing
    trailing newlines (Wave 1 cosmetic follow-up)
  - Used by /admin/analytics page (Wave 2 Task 2)"
```

---

### Task 2: `/admin/analytics` page + `<CopyPathCell/>` client island

**Files:**
- Create: `app/admin/analytics/page.tsx` (~110 LoC)
- Create: `components/admin/analytics/CopyPathCell.tsx` (~15 LoC)

**Interfaces:**
- Consumes: `parseRange`, `rangeToDays` from `@/lib/admin-range` (Wave 1)
- Consumes: `getTopPaths` from `@/lib/admin-pageviews` (Task 1)
- Consumes: `BarChartTop` from `@/components/admin/charts` (Wave 1)
- Produces: `GET /admin/analytics?range=1d|7d|30d|90d` server-rendered page

- [ ] **Step 1: Create `components/admin/analytics/CopyPathCell.tsx`**

Create `components/admin/analytics/CopyPathCell.tsx` with this complete content:

```tsx
'use client';
import { useState } from 'react';

/**
 * Click-to-copy path cell for the /admin/analytics detail table.
 *
 * Tiny client island (~15 LoC). On click, writes `path` to the clipboard
 * via the navigator.clipboard API and shows a 1.5s toast feedback. Falls
 * back silently if clipboard API is unavailable (HTTPS-only / older
 * browsers) or permission denied — admin can still read the path text.
 */
export function CopyPathCell({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable or permission denied — silent fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-left text-ink hover:bg-muted/30 px-1 -mx-1 rounded font-mono text-xs"
      title="点击复制路径"
    >
      {copied ? '✓ 已复制' : path}
    </button>
  );
}
```

- [ ] **Step 2: Create `app/admin/analytics/page.tsx`**

Create `app/admin/analytics/page.tsx` with this complete content:

```tsx
import Link from 'next/link';
import { parseRange, rangeToDays } from '@/lib/admin-range';
import { getTopPaths } from '@/lib/admin-pageviews';
import { BarChartTop } from '@/components/admin/charts';
import { CopyPathCell } from '@/components/admin/analytics/CopyPathCell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RANGE_TABS = [
  { range: '1d', label: '今日' },
  { range: '7d', label: '近7天' },
  { range: '30d', label: '近30天' },
  { range: '90d', label: '近90天' },
] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const current = parseRange(params.range);
  const days = rangeToDays(current);
  const topPages = await getTopPaths(days, 20);

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-2xl font-serif text-ink">访问分析</h1>
        <p className="text-sm text-ink-soft mt-1">
          近 {days} 天 · 共 {topPages.length} 条路径
        </p>
      </header>

      <nav className="flex gap-2" aria-label="时间范围">
        {RANGE_TABS.map((tab) => {
          const active = tab.range === current;
          return (
            <Link
              key={tab.range}
              href={`/admin/analytics?range=${tab.range}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'px-4 py-2 rounded bg-paper border border-line text-ink font-medium'
                  : 'px-4 py-2 rounded bg-muted/30 border border-line/50 text-ink-soft hover:bg-muted/50'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-paper rounded border border-line p-4">
          <h2 className="text-base font-serif text-ink mb-3">Top 20 路径</h2>
          <BarChartTop data={topPages.map((p) => ({ label: p.path, value: p.views }))} />
        </section>

        <section className="bg-paper rounded border border-line p-4">
          <h2 className="text-base font-serif text-ink mb-3">详情表</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft text-left">
                <th className="py-2 pr-4">路径</th>
                <th className="py-2 pr-4 text-right">浏览量</th>
                <th className="py-2 pr-4 text-right">独立访客</th>
              </tr>
            </thead>
            <tbody>
              {topPages.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-ink-soft text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                topPages.map((p) => (
                  <tr key={p.path} className="border-b border-line/50">
                    <td className="py-2 pr-4 max-w-0">
                      <div className="truncate">
                        <CopyPathCell path={p.path} />
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.views.toLocaleString('zh-CN')}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.unique.toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npm run build`
Expected: `✓ Compiled successfully`. Route count goes from 195 → 196 (new `/admin/analytics` page). Confirm in output that `/admin/analytics` appears in the route list.

If the build fails with "Dynamic server usage" error: ensure both `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'` are at top of file (already in the snippet above).

- [ ] **Step 4: Manual smoke (dev server)**

Run:
```bash
npx next dev -p 4447 &
DEV_PID=$!
for i in {1..30}; do
  if curl -s http://localhost:4447/admin/analytics -o /dev/null -w "%{http_code}" | grep -q 307; then
    break
  fi
  sleep 1
done
```

Expected: HTTP 307 redirect to `/?auth=login` (admin auth gate at `/admin/layout.tsx`). This is correct — admin page requires login. To actually smoke the rendered HTML, use a logged-in admin cookie. If a dev session is active, fetch with `-b 'auth_token=...'` to confirm the page renders.

If full admin login isn't feasible in the smoke step, at minimum confirm the 307 redirect happens (route exists, no 404). A 404 would mean the page isn't registered.

After smoke:
```bash
kill $DEV_PID
```

Document the smoke result in the task report — note any unexpected HTTP codes.

- [ ] **Step 5: Commit**

```bash
git add app/admin/analytics/page.tsx components/admin/analytics/CopyPathCell.tsx
git commit -m "feat(admin-analytics-page): /admin/analytics top-20 paths + ?range= filter [2026-07-11 HH.MM+10]

  - app/admin/analytics/page.tsx: server component, parseRange(7d default)
    → getTopPaths(days, 20) → renders 4 URL-driven tabs + BarChartTop + 
    3-col detail table (Path/Views/Unique)
  - components/admin/analytics/CopyPathCell.tsx: ~15 LoC client island;
    navigator.clipboard.writeText + 1.5s toast, silent fallback on 
    unsupported browsers
  - No new deps; consumes Wave 1 helpers (parseRange, BarChartTop) + 
    Task 1 getTopPaths
  - All range tabs are <Link>s — server-rendered, no client JS for filter
  - Resolves the 404 from page-views StatCard href targets"
```

---

### Task 3: Sidebar entry + REDEPLOY v9 + Wave 1 report move

**Files:**
- Modify: `components/admin/AdminSidebar.tsx` (+1 LoC, sidebar entry)
- Modify: `REDEPLOY-2026-07-09.md` (v8 → v9, add Wave 2 commit SHA + section)
- Move: `.superpowers/sdd/wave1-foundation-report.md` → `docs/superpowers/sdd/wave1-foundation-report.md` (Wave 1 follow-up #1)

- [ ] **Step 1: Add sidebar entry**

Modify `components/admin/AdminSidebar.tsx`. Find the 运维 group items array (it's the first group in `GROUPS`, lines ~7-17). Add a new entry at the **end** of the items array, after the existing `{ href: '/admin/tts', label: '语音设置' }` line.

Read the file first to find the exact line context, then make this edit:

```diff
       { href: '/admin/tts', label: '语音设置' },
+      { href: '/admin/analytics', label: '访问分析' },
     ],
   },
```

Save the file. Verify `tsc --noEmit` still clean.

- [ ] **Step 2: Move Wave 1 foundation report (Wave 1 follow-up #1)**

The report exists at `.superpowers/sdd/wave1-foundation-report.md` (gitignored). Move it to a committable location:

```bash
mkdir -p docs/superpowers/sdd
git mv .superpowers/sdd/wave1-foundation-report.md docs/superpowers/sdd/wave1-foundation-report.md
```

If `git mv` fails because the file isn't tracked in git (it was created on disk but never committed — per Wave 1 report concern #3, `.superpowers/` is gitignored), use a regular `mv` and then add it to git manually:

```bash
mv .superpowers/sdd/wave1-foundation-report.md docs/superpowers/sdd/wave1-foundation-report.md
git add docs/superpowers/sdd/wave1-foundation-report.md
```

Verify the file is at the new path and the old path is gone:
```bash
ls docs/superpowers/sdd/wave1-foundation-report.md
ls .superpowers/sdd/wave1-foundation-report.md 2>&1 | grep -i 'no such'
```

- [ ] **Step 3: Update `REDEPLOY-2026-07-09.md` to v9**

Read the current doc first to find the right edit anchors. Two edits:

**Edit A** — bump version + commit count in the opening summary:

Current opening (per `REDEPLOY-2026-07-09.md` line 3):
```markdown
23 commits on local main to ship (5 wizard+poems + 2 worksheet color + 1 image fallback + 2 user-report fixes + 5 data-alignment + 3 wizard auto-seed + **5 page_views (仪表盘 PV/UV)**):
```

Replace with:
```markdown
25 commits on local main to ship (...previous sections... + 5 page_views + **3 admin-analytics Wave 2 (admin/analytics 详情页)**):

**Admin-analytics detail page (Wave 2 of 3-wave admin/overview plan)**
```

Then add this section **after the existing "Page views" section** (around line 50, before the "## Deploy" heading):

```markdown
**Admin analytics detail page (Wave 2 — `/admin/analytics` resolves the page-views 404)**

- `<task-1-sha>` feat(admin-pageviews): add getTopPaths(days, limit) + 5 unit tests
- `<task-2-sha>` feat(admin-analytics-page): /admin/analytics top-20 paths + ?range= filter
- `<task-3a-sha>` docs(redeploy): v9 — Wave 2 sidebar entry + report move + this section

(Fill the SHAs in with the actual commits from `git log --oneline`. The third SHA includes the sidebar + REDEPLOY update + report move; treat them as one commit per the spec.)
```

**Edit B** — add a verify-in-browser step. Add this after step 13 in the "Verify in browser" section (before "What changed for poems"):

```markdown
14. **NEW /admin/analytics check** — open `/admin/analytics` (login first as admin):
    - Default tab is "近7天" (no `?range=` query param). Tabs row shows 4 pills: 今日 / 近7天 / 近30天 / 近90天
    - Click "近30天" tab → URL becomes `/admin/analytics?range=30d`, page reloads with new top-20 data
    - Click any path cell in the detail table → clipboard contains the path string, cell briefly shows "✓ 已复制" (1.5s)
    - Top 20 paths bar chart (left) and detail table (right) show 3 columns: Path / 浏览量 / 独立访客
    - With fresh DB (no page_views rows), both bar chart and table show "暂无数据" placeholder (BarChartTop's built-in empty state for chart; explicit empty-row for table)
    - Sidebar shows new "访问分析" entry under 运维 group (last position, after "语音设置")
    - Note: this page is admin-only — `/admin/analytics` redirects to `/?auth=login` if not logged in
```

Save the file. Verify `tsc --noEmit` still clean (the doc change doesn't affect TS but check anyway).

- [ ] **Step 4: Final verification**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx vitest run tests/unit/lib/admin-pageviews.test.ts`
Expected: PASS — `Tests 5 passed (5)`

Run: `npm run build`
Expected: `✓ Compiled successfully`, 196 routes (no new routes added this task; just sidebar + doc + file move).

Run: `git status --short`
Expected: see only:
- `M REDEPLOY-2026-07-09.md`
- `M components/admin/AdminSidebar.tsx`
- `?? docs/superpowers/sdd/wave1-foundation-report.md` (new tracked file from move)
- (no `data/sutras/manifest.json` modification — pre-existing dirty state, NOT this wave)

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminSidebar.tsx REDEPLOY-2026-07-09.md docs/superpowers/sdd/wave1-foundation-report.md
git commit -m "feat(admin-sidebar+redeploy): Wave 2 sidebar entry + REDEPLOY v9 + Wave 1 report move [2026-07-11 HH.MM+15]

  - components/admin/AdminSidebar.tsx: 访问分析 entry in 运维 group 
    (last position after 语音设置). Links to /admin/analytics (Wave 2 page).
  - REDEPLOY-2026-07-09.md: v8 → v9 — add Wave 2 commit SHAs + verify step
    for /admin/analytics (defaults to 7d, 4 tabs, click-to-copy, empty state)
  - docs/superpowers/sdd/wave1-foundation-report.md: moved from 
    .superpowers/sdd/ (gitignored) so the Wave 1 implementation report 
    survives in git history (Wave 1 follow-up #1)
  - 25 commits on local main now ready to ship (was 22 in v8)"
```

---

## Final verification (after all 3 tasks)

Run these gates to confirm Wave 2 is ship-ready:

- [ ] **Final tsc**: `npx tsc --noEmit` → exit 0
- [ ] **Final vitest (focused)**: `npx vitest run tests/unit/lib/admin-pageviews.test.ts tests/unit/lib/admin-range.test.ts tests/unit/lib/admin-activity.test.ts` → 5 + 16 + 8 = 29 pass
- [ ] **Final vitest (full)**: `npx vitest run` → full pass / 0 regressions (Wave 1 baseline 418 pass / 6 skip / 1 pre-existing DB fail)
- [ ] **Final build**: `npm run build` → exit 0, 196 routes (Wave 2 added 1 new route, `/admin/analytics`)
- [ ] **Final git status**: only 3 new commits on local main; not pushed
- [ ] **REDEPLOY bump verified**: `grep 'v9' REDEPLOY-2026-07-09.md` shows the new section

## Files Summary

| File | Action | LoC |
|---|---|---|
| `lib/admin-pageviews.ts` | Modify (+50) | +50 |
| `tests/unit/lib/admin-pageviews.test.ts` | Create | +80 |
| `app/admin/analytics/page.tsx` | Create | +110 |
| `components/admin/analytics/CopyPathCell.tsx` | Create | +15 |
| `components/admin/AdminSidebar.tsx` | Modify (+1) | +1 |
| `REDEPLOY-2026-07-09.md` | Modify (v8 → v9) | +30 |
| `components/admin/charts/Sparkline.tsx` | Modify (trailing newline) | 0 |
| `components/admin/charts/BarChartTop.tsx` | Modify (trailing newline) | 0 |
| `components/admin/charts/index.ts` | Modify (trailing newline) | 0 |
| `.superpowers/sdd/wave1-foundation-report.md` → `docs/superpowers/sdd/wave1-foundation-report.md` | Move | 0 |

**Total: ~286 LoC across 6 new/modified code files + 1 doc + 3 cosmetic trailing-newline fixes + 1 file move.**

## Risks / Notes

- **`getTopPaths` SQL cost**: `COUNT(DISTINCT COALESCE(user_id, ip))` is more expensive than `COUNT(*)`. On 90-day range with ~10k pageviews/day, expect ~900k row scan. Sub-second with `idx_pv_path_created` (path index covers the GROUP BY) + `idx_pv_created` (date filter). Acceptable for admin-only page.
- **Sort stability**: `ORDER BY views DESC` is enough; no path tiebreaker needed since `path` is the GROUP BY key. If two paths have equal counts, MySQL's order is undefined — not user-visible (top-20 limited).
- **Path strings may be URL-encoded**: Wave 1's `PageViewTracker` sends `usePathname()` directly. Some browsers URL-encode non-ASCII (`/chars/%E4%B8%80` instead of `/chars/一`). DB stores the raw `pathname` value. For admin visual fidelity, table cells show whatever's in DB. Click-to-copy copies the same string — admin can paste into browser to navigate. Document in verify step.
- **No client analytics on this page**: `/admin/analytics` is itself under `/admin/*` which is in `PageViewTracker`'s `EXCLUDE_PREFIXES`. Self-tracking would inflate stats. Confirmed not a regression.
- **`BarChartTop` empty state**: when `data.length === 0`, BarChartTop renders its built-in "暂无数据" placeholder (per Wave 1 spec). Detail table handles empty separately with explicit empty-row. Both states verified.
- **No NEW tests for `getPageViewStats`**: Wave 2 ships tests only for the NEW `getTopPaths`. Retro-testing the existing `getPageViewStats` is out of scope per spec.
- **Sidebar refactor deferred**: range filter is page-local (not sidebar-global). Wave 3 may unify; not Wave 2's job.
- **`BarChartTopProps.height` + `router.push`**: NOT touched in Wave 2 (Wave 2 doesn't pass `href` prop). Remains in Wave 1's "tracked for Wave 3" list.
- **Pre-existing `import-hsk.test.ts` failure**: NOT Wave 2 regression (DB access denied, environment). Wave 1 already documented this.
- **REDEPLOY v9 is the first prod-deployable wave since v8**: prod now has a NEW route (`/admin/analytics`) that resolves the previously-404 StatCard link. Doc must include verify step for fresh-DB + existing-DB parity.