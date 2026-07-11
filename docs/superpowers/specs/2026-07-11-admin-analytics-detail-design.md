# Admin Analytics Detail (Wave 2 of 3) Design

> **For agentic workers:** This spec is Wave 2 of the 3-wave admin/overview plan. Wave 1 (foundation: `?range=` helper + recharts wrappers + `getRecentActivity`) shipped 2026-07-11 in 5 commits (`6712e955..03e16d98`). Wave 2 ships the first `/admin/analytics` detail page that consumes those helpers. Wave 3 (overview redesign + anomaly panel) follows after Wave 2.

**Goal:** Build `/admin/analytics` — a dedicated page that surfaces the top-N page-views data with a `?range=` filter, resolving the 404 from the page-views plan's dashboard StatCard links.

**Architecture:** Server-rendered list page driven by `searchParams.range` (parsed via Wave 1's `parseRange`). Single SELECT aggregation on `page_views` returns top 20 paths × {views, unique visitors}. Visualized by Wave 1's `BarChartTop` + a sortable detail table. No client JS except the small click-to-copy button. No new dependencies.

**Tech Stack:** Next.js 15.5.19 App Router + React 19 + mysql2/promise + Wave 1 helpers (`lib/admin-range.ts`, `components/admin/charts/*`) + Tailwind + lucide-react.

## Context

Wave 1 page-views plan (2026-07-10) added 3 PV StatCards on `/admin` that link to `/admin/analytics` (href target). That route is currently a **404**. Wave 2 makes it real.

This is "Wave 2" in the user's framing of a 3-wave admin/overview redesign from the original "我感觉从系统管理的角度，后台似乎还不够完整" feedback. Wave 2 is intentionally **narrow** — Top-20 paths + filter — to stay shippable in one focused plan. Future waves add trend chart, polling, anomaly panel.

User wants scoping questions to remain tight: **click row → copy to clipboard** (no new pages, no drill-down route), **3 columns** (Path / Views / Unique visitors), **URL-driven tabs** for the range selector, ~180 LoC across 4 files.

## Decomposition (3-wave recap)

| Wave | Scope | Status |
|---|---|---|
| 1 — Foundation | `?range=` helper + recharts wrappers + `getRecentActivity` | SHIPPED (`6712e955..03e16d98`) |
| 2 — `/admin/analytics` page (THIS SPEC) | Top-20 paths + range tabs + drill-by-copy + sidebar entry | spec stage |
| 3 — `/admin` redesign + anomaly | KPI grid + TrendChart + RecentActivity widget + AnomalyBanner + polling | future spec |

## Global Constraints (binding for Wave 2)

- **package manager**: `npm` (per `project-uses-npm.md`); no new deps this wave
- **No `app/api/**` route** for this feature — single server component, no client roundtrip
- **server-side `searchParams`**: `?range=` parsed in server component per Wave 1 pattern
- **mysql2**: select via `pool.query()` (text protocol, no supp-plane chars in `page_views.path`)
- **TypeScript strict**: no `any` leaks in exported interfaces
- **Tests**: vitest; extend page-views mock-pool pattern (`tests/unit/lib/page-views.test.ts` post-fix `bbe4b125` — separate `queryLog` + `executeLog`)
- **Commits**: append `[YYYY-MM-DD HH.MM]` per `feedback-commit-timestamps.md`
- **Branch**: local main only (no auto-push per `no-prod-env-2026-06-21.md`)
- **REDEPLOY**: bump `REDEPLOY-2026-07-09.md` v8 → v9 (this wave is **production-deployable** — first wave that activates a new route after page-views)
- **Sidebar**: add entry to 运维 group only; preserve existing layout
- **No retrfit** of `getPageViewStats`'s missing tests — Wave 2 ships a test for the NEW `getTopPaths` only

## Wave 2 — Detailed Design

### Architecture

```
[Browser: GET /admin/analytics?range=7d]
   ↓ server component
[app/admin/analytics/page.tsx]
   ├─ parseRange(searchParams.range) → '7d'    [lib/admin-range.ts]
   ├─ rangeToSinceClause('7d')                  [lib/admin-range.ts, applied as filter hint]
   ├─ rangeToDays('7d') = 7                     [lib/admin-range.ts]
   ├─ getTopPaths(7, 20)                        [lib/admin-pageviews.ts, NEW]
   └─ <RangeTabs/> + <BarChartTop/> + DetailTable

[Click row → fires client onClick → navigator.clipboard.writeText(path) + 1.5s toast]
```

### Files (4 operations, ~180 LoC)

| File | Action | LoC | Purpose |
|---|---|---|---|
| `lib/admin-pageviews.ts` | Modify (+~50) | 50 | Add `TopPage` interface + `getTopPaths(days, limit)` SELECT |
| `tests/unit/lib/admin-pageviews.test.ts` | Create | 80 | TDD: 5 cases for `getTopPaths` (mock-pool pattern) |
| `app/admin/analytics/page.tsx` | Create | 110 | Server component: header + RangeTabs + BarChartTop + table |
| `components/admin/AdminSidebar.tsx` | Modify (+1) | 1 | Add `{ href: '/admin/analytics', label: '访问分析' }` to 运维 group last position |
| `REDEPLOY-2026-07-09.md` | Modify (bump v8 → v9) | +30 | Add Wave 2 commit(s) |

### Key Interfaces

```ts
// lib/admin-pageviews.ts (extend)
export interface TopPage {
  path: string;
  views: number;        // COUNT(*) over range
  unique: number;       // COUNT(DISTINCT COALESCE(user_id, ip)) over range
}

export async function getTopPaths(days: number, limit: number): Promise<TopPage[]>;
```

```sql
-- Single SELECT, indexed via idx_pv_path_created (Wave 0)
SELECT
  path,
  COUNT(*) AS views,
  COUNT(DISTINCT COALESCE(user_id, ip)) AS unique_visitors
FROM page_views
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
GROUP BY path
ORDER BY views DESC
LIMIT ?
```

### Component Layout (server-rendered)

```
┌──────────────────────────────────────────────┐
│ <h1>访问分析</h1>                              │
│ <p class="text-ink-soft">近 N 天 · N paths</p>  │
├──────────────────────────────────────────────┤
│ <RangeTabs/>  [今日] [近7天*] [近30天] [近90天] │ ← active=7d
├──────────────────────────────────────────────┤
│ ┌── card ──────────┐  ┌── table ──────────┐  │
│ │ <BarChartTop     │  │ Path     │Views│UV│  │
│ │   data={TopPage} │  │ /chars/一│1234│89│  │ ← click Path cell → copy
│ │   href={lbl=>    │  │ /pinyin  │ 987│72│  │
│ │   "/admin/       │  │ ...              │  │
│ │    analytics?    │  └────────────────────┘  │
│ │    path=X"}      │                          │
│ │ />               │                          │
│ └──────────────────┘                          │
└──────────────────────────────────────────────┘
```

`href` on BarChartTop: clicking a bar auto-jumps to the same page with `?path=...` so admin can re-filter; spec leaves this inert for Wave 2 (drill-by-copy only); the optional href keeps Wave 3 free to wire up.

### RangeTabs Pattern

```tsx
const RANGE_TABS = [
  { range: '1d' as const, label: '今日' },
  { range: '7d' as const, label: '近7天' },
  { range: '30d' as const, label: '近30天' },
  { range: '90d' as const, label: '近90天' },
];

// Server component: <Link href="/admin/analytics?range=X"> with aria-current styling
```

Active state: compare `parseRange(searchParams.range)` to tab's range. CSS via existing Tailwind tokens (`bg-paper`, `text-ink`, `border-line`). No client JS for tabs.

### Click-to-copy (single client component)

A `<CopyPathCell>` client component wraps a `<button>` containing the path text:

```tsx
'use client';
export function CopyPathCell({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => {
      try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
    }} className="hover:bg-muted/50 ...">
      {copied ? '✓ 已复制' : path}
    </button>
  );
}
```

Tiny client island: ~15 LoC. Falls back silently on browsers without `navigator.clipboard` (HTTPS-only API; localhost dev OK). `try/catch` for permission denied.

### Data Flow

| Step | What | Where |
|---|---|---|
| 1 | User navigates `/admin/analytics?range=30d` | Browser |
| 2 | Server reads `searchParams.range`, falls back to `'7d'` if invalid | `parseRange()` Wave 1 |
| 3 | Server calls `getTopPaths(rangeToDays(current), 20)` | New helper, single SELECT |
| 4 | Server returns page (HTML SSR'd) | `app/admin/analytics/page.tsx` |
| 5 | Click on path cell → client side → clipboard copy | `<CopyPathCell/>` client island |
| 6 | Click on range tab → page reload with `?range=X` | `<Link>` (server-driven) |

### Error Handling

| Failure | Handling |
|---|---|
| `parseRange` unknown value | Returns `'7d'` (Wave 1 default), never throws |
| `getTopPaths` DB error | Server component lets it bubble → Next.js error boundary → default 500 (admin-only route, low blast radius) |
| `rangeToDays` invalid | TypeScript-level (Range type prevents) |
| `page_views` table empty | Empty array from `getTopPaths` → BarChartTop renders its existing "暂无数据" placeholder, table renders just headers |
| `clipboard API` unavailable | Silent fallback (no toast, no error) |
| User clicks cell with super-long path | Path text overflows with `truncate` Tailwind class |

### Testing (`tests/unit/lib/admin-pageviews.test.ts`)

5 vitest cases using mock-pool pattern from `tests/unit/lib/page-views.test.ts` (post-fix `bbe4b125` — separate `queryLog` + `executeLog`):

```ts
describe('getTopPaths', () => {
  it('queries FROM page_views with LIMIT and INTERVAL clause', async () => {
    await getTopPaths(7, 20);
    const q = queryLog.find(x => x.sql.includes('FROM page_views'));
    expect(q).toBeDefined();
    expect(q!.sql).toMatch(/GROUP BY path/);
    expect(q!.params).toEqual([7, 20]);
  });

  it('groups by path, orders by views DESC, applies LIMIT', async () => {
    queryResults['FROM page_views'] = [[
      { path: '/a', views: 100, unique_visitors: 50 },
      { path: '/b', views: 50, unique_visitors: 30 },
    ]];
    const result = await getTopPaths(7, 10);
    expect(result[0].path).toBe('/a');
    expect(result[0].views).toBe(100);
    expect(result[0].unique).toBe(50);
  });

  it('uses COUNT(DISTINCT COALESCE(user_id, ip)) for unique visitors', async () => {
    queryResults['FROM page_views'] = [[{ path: '/x', views: 5, unique_visitors: 3 }]];
    await getTopPaths(7, 10);
    expect(queryLog[0].sql).toMatch(/COUNT\(DISTINCT COALESCE\(user_id, ip\)\)/);
  });

  it('returns [] for empty result set', async () => {
    queryResults['FROM page_views'] = [[]];
    expect(await getTopPaths(7, 20)).toEqual([]);
  });

  it('respects limit parameter (cap at 100)', async () => {
    await getTopPaths(7, 100);
    expect(queryLog[0].params[1]).toBe(100);
  });
});
```

### Verification Checklist

```
[Helper layer]
  - npx tsc --noEmit                                            exit 0
  - npx vitest run tests/unit/lib/admin-pageviews.test.ts       5 pass
  - npx vitest run                                              full pass / 0 regressions

[Page layer]
  - npx tsc --noEmit                                            exit 0
  - npm run build                                               exit 0, 195+1=196 routes

[Manual smoke]
  - GET /admin/analytics (no params)                            200, default 7d tab active
  - GET /admin/analytics?range=1d                                200, 今日 tab active
  - GET /admin/analytics?range=garbage                           200, falls back to 7d
  - Click any path cell                                          clipboard contains path, toast 1.5s
  - Empty fresh DB                                               BarChartTop "暂无数据", empty table
  - Sidebar shows 访问分析 entry                                  yes, in 运维 group

[REDEPLOY]
  - REDEPLOY-2026-07-09.md v8 → v9 (1 commit entry)
```

### Commit Strategy

```
feat(admin-analytics-page): /admin/analytics top-20 paths + ?range= filter + sidebar entry [2026-07-11 HH.MM]
  - lib/admin-pageviews.ts: getTopPaths(days, limit) + TopPage {path, views, unique}
  - tests/unit/lib/admin-pageviews.test.ts: 5 cases (mock-pool)
  - app/admin/analytics/page.tsx: server component, RangeTabs + BarChartTop + detail table
  - components/admin/AdminSidebar.tsx: 访问分析 entry in 运维 group
  - components/admin/analytics/CopyPathCell.tsx: client island, clipboard + 1.5s toast
  - Single SELECT query (COUNT + COUNT DISTINCT COALESCE), idx_pv_path_created
  - URL-driven tabs (今日/近7天/近30天/近90天) via parseRange (Wave 1)
  - Resolves the 404 from page-views StatCard href

docs(redeploy): v9 — add Wave 2 SHA + admin/analytics section [2026-07-11 HH.MM+5]
  - REDEPLOY-2026-07-09.md v8 → v9
```

2 commits: feature + REDEPLOY doc. Tests ship with the feature (TDD discipline; same as Wave 1's per-task commits).

### Out of Scope (Wave 2 explicitly does NOT)

- ❌ Trend chart on this page (Wave 3 owns it)
- ❌ Realtime polling / refresh
- ❌ CSV export
- ❌ Pagination beyond top 20
- ❌ Path normalization (`/chars/一` and `/chars/人` are still 2 rows; known decision from page-views plan)
- ❌ Retro-testing existing `getPageViewStats` (shipped 2026-07-10 without tests; not Wave 2's job)
- ❌ BarChartTop drill-down (`href` prop is wired in Wave 1 but Wave 2 leaves it inert; Wave 3 may activate)
- ❌ Global sidebar range filter (page-local only; Wave 3 may unify)
- ❌ Image-to-char on `/pinyin` (separate user request, sequenced AFTER Wave 2 per user decision)

### Files Summary

| File | Action | LoC |
|---|---|---|
| `lib/admin-pageviews.ts` | Modify (+~50) | +50 |
| `tests/unit/lib/admin-pageviews.test.ts` | Create | +80 |
| `app/admin/analytics/page.tsx` | Create | +110 |
| `components/admin/AdminSidebar.tsx` | Modify (+1) | +1 |
| `components/admin/analytics/CopyPathCell.tsx` | Create | +15 |
| `REDEPLOY-2026-07-09.md` | Modify (v8 → v9) | +30 |

**Total: ~286 LoC across 6 files (5 source + 1 doc).**

### Risks / Notes

- **Single-query cost**: `COUNT(DISTINCT COALESCE(user_id, ip))` may scan more rows than `COUNT(*)`. On 90-day range with ~10k pageviews/day, expect ~900k row scan → sub-second with `idx_pv_path_created` (Wave 0 schema). Acceptable for admin-only page.
- **Sort stability**: `ORDER BY views DESC` is enough — no `path ASC` tiebreaker needed since `path` is the GROUP BY key. If two paths have equal counts, MySQL's order is undefined; not user-facing issue (Top-20 limited).
- **Path strings may be URL-encoded**: `usePathname()` may return `/chars/%E4%B8%80` instead of `/chars/一`. Wave 2 page reads from DB so it displays raw values (which were INSERT'd via the PageViewTracker fetch). For visual fidelity, the click-to-copy copies the DB raw value (URL-encoded) — admin can paste into browser to navigate. Acceptable for an internal admin tool.
- **No client analytics on this page**: not self-tracking pageviews of the analytics page itself (would inflate its own stats). The PageViewTracker `<ExcludedPrefixes>` stays `/admin/*` and ignores this page. Document in copy.
- **`RangeTabs` is server-rendered**: tabs are `<Link>`s — page reload on each range switch. SPA routing via `useRouter` is possible but unnecessary; ~50ms SSR is well within admin-tool expectations.
- **Wave 1 follow-ups tracked for Wave 2 ownership** (per `progress.md` Wave 1 ledger):
  1. Wave 2 should move `wave1-foundation-report.md` to a committed path (this spec doesn't address it; deferred to a tiny follow-up commit)
  2. Wave 2 should consider `router.push` over `window.location.href` — Wave 2's `BarChartTop` is invoked with NO `href` prop so this concern is moot for Wave 2; Wave 3 wiring activates it
- **Pre-existing test gap**: `import-hsk.test.ts` integration test fails with "Access denied for user 'root'@'localhost'" — not Wave 2 regression, documented separately.
