# Site Optimization Wave 1 — SEO + 数据完整性 + 代码质量 Design

> **For agentic workers:** This spec is **Wave 1 of 3** for the "极度优化" project-wide optimization request. Wave 1 ships **low-risk quick wins across SEO + one critical data-integrity fix + code hygiene**. Wave 2 covers font/image/bundle + cache + missing indexes; Wave 3 covers file splits + `useApiQuery` hook + `noUncheckedIndexedAccess` + heavy font subsetting. Do NOT touch anything reserved for Wave 2/3.

**Goal:** Ship 9 atomic fixes (5 SEO + 1 mysql2 protocol migration + 3 code-hygiene) that produce visible SEO improvements + eliminate the supp-plane character silent corruption + establish a working ESLint baseline. No schema changes, no deploy-shape changes, no public-API behavior changes.

**Architecture:** 3 independent sub-features wrapped into 1 plan (low risk per task, simple review):
- **A. SEO 完整化**: robots.txt `/init` disallow + `/sutra/[id]` JSON-LD (Book + BreadcrumbList) + new `/etymology/[char]` sub-sitemap + metadata for 4 list pages (`/pinyin`, `/dictionary`, `/rare-chars`, `/game`) + site-wide Organization + WebSite JSON-LD in root layout.
- **B. `.execute()` → `.query()` 全量替换**: ~30+ sites across `lib/admin*`, `lib/membership`, `lib/playlists`, `lib/email-*`, `lib/audit`, `lib/password-reset`, `lib/page-views`, `lib/payment-orders`, `lib/audio-tracks`, `lib/activation`, `lib/ai-rare-chars`, `lib/sutra-copy-progress`. Eliminates supp-plane (U+10000+) silent data corruption on WHERE/JOIN params. ESLint rule added to prevent regression.
- **C. 代码质量清理**: ESLint + Prettier flat-config (`next lint` is currently a no-op) + 60+ unused-export removal (6 `lib/api-*.ts` files partially deleted + ~25 scattered symbols) + 3 console.logs cleaned.

**Tech Stack:** Next.js 15.5.19 App Router + React 19 + mysql2/promise + TypeScript 5.x + Vitest. **Adds**: `eslint@9`, `eslint-config-next`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `prettier`. **No other new deps.**

## Context

User request 2026-08-05: "极度优化当前的网站项目." Acknowledged by user via Q&A that the project should be **scanned across all 4 dimensions (后端 + DB / 前端 / SEO / 代码质量)** and **全站统一扫一遍**, executed as **3 progressive waves** (像 admin-analytics Wave 1/2/3).

A pre-implementation audit (4 parallel Explore agents, 2026-08-05) gathered ~40 specific findings. **Highest-impact Wave 1 candidates** selected:

1. **`.execute()` → `.query()` is data-integrity critical** (per `mysql2-supp-plane-bug.md`). The mysql2 binary protocol silently corrupts 4-byte UTF-8 parameters; users with supp-plane chars in usernames/emails/audit metadata are already affected. `lib/sutras.ts` + `lib/rare-chars.ts` already migrated, but ~30 admin/internal call sites remain on `.execute()`.
2. **SEO gaps** are visible to crawlers immediately (`/etymology/[char]` invisible, 4 list pages have no `<title>`, `/init` crawlable).
3. **ESLint is a no-op**: `npm run lint` runs Next's stub without any config — no CI gate, no auto-discovery of the 60+ dead exports or 475 `any` usages.

Wave 1 deliberately does NOT touch:
- Schema changes (Wave 2 may add `audit_log.ip` index + `chars.hsk_level` index)
- Caching strategy (`unstable_cache`, `experimental.staleTimes`) — Wave 2
- Font preload / `next/font` migration / `unicode-range` — Wave 2/3
- Image optimization restore (requires sharp-linux-x64 — operational, not code) — Wave 2
- File splits (`GenerateCharsForm` 562 LoC, `SutraAudioPlayer` 454 LoC) — Wave 3
- `useApiQuery` hook — Wave 3
- `noUncheckedIndexedAccess` — Wave 3 (would explode currently)

## Global Constraints

- **package manager**: `npm` (per `project-uses-npm.md`); install new deps with `--legacy-peer-deps`
- **mysql2**: write `.query()` (text protocol) per `mysql2-supp-plane-bug.md`; `execute()` is now FORBIDDEN (ESLint rule enforces)
- **No new dependencies** beyond ESLint + Prettier stack listed in Tech Stack
- **ESLint baseline strategy**: enable core rules + autofix in Wave 1; do NOT enable `noUncheckedIndexedAccess`, `no-explicit-any` (warn), or other strict-mode-additions in Wave 1 — staged for Wave 3 to avoid one-shot explosion of 475+ violations
- **No CI gate** added in Wave 1 (no `.github/`, no husky) — `npm run lint` is the verification command
- **No schema changes** (no migrations, no init-db.ts edits)
- **No deploy-shape changes** (no new top-level routes that need REDEPLOY bump — sitemap sub-route is internal)
- **Tests**: vitest + mock-pool pattern from `tests/unit/lib/admin-pageviews.test.ts`
- **Commits**: append `[YYYY-MM-DD HH.MM]` per `feedback-commit-timestamps.md`
- **Branch**: local main only (no auto-push per `no-prod-env-2026-06-21.md`)
- **死代码删除前置**: 每个候选符号先 `grep -rn "symbolName" --include="*.ts" --include="*.tsx" app/ components/ tests/ scripts/` 确认 0 hit, 排除 `lib/` 自身 + `Up/`
- **`components/` + `app/` 内容不动** — 死代码清理只删 lib/ 和 tests/ (用户面零变化)
- **JSON-LD helpers 复用**: 用 `lib/seo/jsonld.ts` 已有的 `buildBook()`, `buildBreadcrumbList()`, `buildOrganization()`, `buildWebSite()` — 不写新 schema 生成器
- **Metadata helper 复用**: 用 `lib/seo/metadata.ts::buildMetadata()` — 不写新 helper

## Design

### Sub-feature A: SEO 完整化

#### A.1 `robots.ts` 加 `/init` + auth paths 屏蔽

```ts
// app/robots.ts (modify)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account', '/init',
                                                      '/login', '/register', '/forgot-password',
                                                      '/reset-password', '/activate'] },
    sitemap: `${getRuntimeSiteUrl()}/sitemap.xml`,
  };
}
```

#### A.2 `/sutra/[id]` JSON-LD (Book + BreadcrumbList)

复用 `lib/seo/jsonld.ts::buildBook()` + `buildBreadcrumbList()` (与 `/ancient/[slug]/page.tsx` 同型)。在 `app/sutra/[id]/page.tsx` 的现有 metadata 块后加:

```tsx
const jsonLd = [
  buildBook({ name: data.title, author: data.translator, inLanguage: 'zh-Hans',
              url: `${baseUrl}/sutra/${id}`, datePublished: data.creationDate }),
  buildBreadcrumbList([{ name: '首页', url: baseUrl },
                       { name: '佛经', url: `${baseUrl}/sutra/${id}` }]),
];
return <script type="application/ld+json"
               dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />;
```

#### A.3 `/etymology/[char]` 新 sub-sitemap

新建 `app/sitemap/etymology.xml/route.ts`, 模板复制 `app/sitemap/chars.xml/route.ts` (BMP-only filter 同型):

```ts
// app/sitemap/etymology.xml/route.ts
import { getPool } from '@/lib/db';
const [[{ base_url }]] = await getPool().query<any[]>(`SELECT getRuntimeSiteUrl() AS base_url`);
const [rows] = await getPool().query<any[]>(
  `SELECT c.\`char\` FROM chars c
     INNER JOIN char_etymology e ON c.\`char\` = e.\`char\`
     WHERE c.\`char\` REGEXP '^[一-鿿]$'    -- BMP CJK only
     LIMIT 50000`
);
const urls = rows.map(r => ({
  loc: `${base_url}/etymology/${encodeURIComponent(r.char)}`,
  changefreq: 'monthly', priority: 0.5,
}));
return new Response(generateSitemapXml(urls),
  { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
```

预估 ~8000 URLs × ~150 bytes = ~1.2 MB (远低于 Google 50000 / 50 MB 上限)。

#### A.4 4 个 list 页 metadata

每个 list 页 `export const metadata: Metadata = buildMetadata({ ... })`:

| Path | Title | Description |
|---|---|---|
| `/pinyin` | 汉字拼音互转工具 | 汉字与拼音实时互转, 支持多音字识别、AI 拍照识别、AI 字义解释 |
| `/dictionary` | 汉字字典 | 8105 个汉字查询, 含拼音、笔顺、字源、部首、组词 |
| `/rare-chars` | 罕见字库 | 1412 个罕见汉字, 含读音、释义、字源 |
| `/game` | 汉字小游戏 | 声调匹配、部首匹配、拼音接龙, 在游戏中学习汉字 |

`buildMetadata()` 已有 OG + canonical 支持, 直接调用。Description 控制在 80-140 中文字符。

#### A.5 全站 Organization + WebSite JSON-LD

在 `app/layout.tsx` 的 `<body>` 内、`<PageViewTracker>` 之前加:

```tsx
const siteJsonLd = [
  buildOrganization({ name: '汉字与拼音', url: getRuntimeSiteUrl(),
                     logo: `${getRuntimeSiteUrl()}/logo.png` }),
  buildWebSite({ name: '汉字与拼音', url: getRuntimeSiteUrl(),
                 inLanguage: 'zh-Hans',
                 potentialAction: { '@type': 'SearchAction',
                                    target: `${getRuntimeSiteUrl()}/search?q={search_term_string}`,
                                    'query-input': 'required name=search_term_string' } }),
];
return <script type="application/ld+json"
               dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }} />;
```

注: 如果未来删 `/search` 路由, `potentialAction` 需相应删 (本 plan 不实现搜索)。

### Sub-feature B: `.execute()` → `.query()` 全量替换

**审计发现的 ~30 处** (按风险度排序):

| 模块 | 处数 | 风险度 |
|---|---|---|
| `lib/admin.ts` | 12 | 高 (audit log metadata 含 user-agent, 可能 supp-plane) |
| `lib/playlists.ts` | 6 | 中 |
| `lib/membership.ts` | 5 | 高 (email + username 路径) |
| `lib/email-campaigns.ts` | 5 | 高 (email 正文可能含 supp-plane) |
| `lib/email-verification.ts` | 3 | 中 |
| `lib/audit.ts` | 2 | 高 (metadata 任意 JSON) |
| `lib/password-reset.ts` | 2 | 中 |
| `lib/page-views.ts` | 2 | 中 (path 可能含 supp-plane path segment) |
| `lib/payment-orders.ts` | 2 | 中 |
| `lib/audio-tracks.ts` | 2 | 低 (BMP 字符) |
| `lib/activation.ts` | 1 | 中 |
| `lib/ai-rare-chars.ts` | 1 | 高 (char 字段) |
| `lib/sutra-copy-progress.ts` | 1 | 低 |

**API 差异 (关键陷阱)**:
- `.execute<T>()` 返回 `Promise<[T, FieldPacket[]]>` (tuple)
- `.query<T>()` 返回 `Promise<T[]>` (裸数组)
- 99% 代码用 `[rows]` 解构 → 1:1 替换
- 但 `[[{ count }]]` 这种嵌套 aggregate 解构要核对 (e.g. `const [[{ n }]] = await pool.execute(...)` → `const [[{ n }]] = await pool.query(...)` 一样工作)
- 还有极个别代码用 `rows` 第 2 元素 (FieldPacket) — grep `FieldPacket` 验证 (审计未见)

**TDD-first 迁移**:
1. 新建 `tests/unit/lib/mysql-protocol-migration.test.ts`: 验证 1 个 `.query()`-migrated 查询 (e.g. `getSystemStats()`) 在 BMP + supp-plane (U+2C27C) 输入下行为一致
2. 用 `grep -rn "\.execute(" --include="*.ts" lib/ app/ scripts/ > /tmp/execute-sites.txt` 列表
3. 逐文件 Edit `replace_all`: `.execute(` → `.query(`, 每个文件后跑该文件相关 unit test
4. 全部替换完跑 `npx tsc --noEmit` + `npx vitest run` 全量验证
5. ESLint rule 加 `no-restricted-syntax` 禁止 `pool.execute(` 和 `getPool().execute(`

**行为预期**:
- BMP-only 数据 (99.99% 流量): 完全一致 (binary vs text protocol 在 ASCII / BMP 范围内等价)
- Supp-plane 数据 (U+10000+): 行为从 **silently corrupted** 变为 **正确** — 这是 bug fix

### Sub-feature C: 代码质量清理

#### C.1 ESLint + Prettier flat config

新建 `eslint.config.mjs` (flat config, Next 15 推荐):

```js
import nextPlugin from 'eslint-config-next';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  ...nextPlugin,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tsPlugin, react: reactPlugin,
               'react-hooks': reactHooksPlugin },
    rules: {
      'no-unused-vars': 'off',  // delegated to TS
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',  // Wave 1 只 warn, Wave 3 收紧
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      'no-restricted-syntax': ['error',
        { selector: "MemberExpression[object.property.name='pool'][property.name='execute']",
          message: 'Use pool.query() instead of pool.execute() — see mysql2-supp-plane-bug' },
        { selector: "CallExpression[callee.property.name='execute']",
          message: 'Use .query() instead of .execute() — see mysql2-supp-plane-bug' }],
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'Up/**', 'scripts/build-*/**',
              'tests/fixtures/**', 'public/**', 'data/**'],
  },
];
```

新建 `.prettierrc`:

```json
{ "semi": true, "singleQuote": true, "trailingComma": "all",
  "printWidth": 100, "tabWidth": 2, "arrowParens": "always" }
```

`package.json` scripts 更新:

```json
{ "lint": "eslint .", "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check ." }
```

**第一阶段执行**:
1. 跑 `npx eslint . --fix` 一次性 autofix
2. 跑 `npx eslint .` 看剩余 errors (应为 0, 因为 `no-explicit-any` 是 warn)
3. 跑 `npx prettier --check .` 看格式化问题, 跑 `npx prettier --write .` 修

**不开启的规则** (Wave 3 再加):
- `noUncheckedIndexedAccess`
- `@typescript-eslint/no-explicit-any` (warn → error)
- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/no-floating-promises`

#### C.2 死代码清理 (~60+ 符号)

**整文件删除候选** (先 grep 确认 0 引用):
- `lib/opencc.ts` 整体 (opencc-js 全未用, `grep -rn "opencc" --include="*.ts" --include="*.tsx" app/ components/ lib/` 验证)
- `lib/api-worksheet.ts` (5 fns: `listWorksheets`, `fetchWorksheet`, `saveWorksheetApi`, `printWorksheetRequest`, `appendCharToMyWorksheetApi`)
- `lib/api-rare-chars.ts` (4 fns: `fetchRareChars`, `fetchRareChar`, `fetchDailyChar`, `printRareCharRequest`; 保留 `RareCharClient` type)
- `lib/api-history.ts` (2 fns: `listHistoryRequest`, `statsRequest`)
- `lib/api-poetry.ts` (3 fns: `getPoemRequest`, `getRandomPoemRequest`, `printPoemRequest`)
- `lib/api-sutras.ts` (2 fns: `getSutraRequest`, `printSutraRequest`)
- `lib/api-admin.ts` (3 fns: `adminListUsers`, `adminGetUser`, `listAdminMembershipsRequest`)

**单符号删除候选** (Edit 工具精确删除):
- `lib/activation.ts:setLock`
- `lib/radical.ts:initRadicalMap`, `_resetRadicalMapForTest`, `getRadical`
- `lib/audit-format.ts:AUDIT_EVENTS`, `EVENT_LABEL`
- `lib/design.ts:NAV_LINKS`, `GITHUB_NEW_ISSUE_URL`
- `lib/email-verification.ts:*` (待 grep 确认)
- `lib/init-checklist.ts:parseDbUrl`
- `lib/llm.ts:LLMError`
- `lib/membership.ts:getMyFeatures` (注意: 这个被 audit 列为死, 但 `react.cache` 包装可能保留 — 先 grep 确认)
- `lib/password-reset.ts:hashResetToken`
- `lib/paypal.ts:_resetTokenCacheForTest`
- `lib/poetry-types.ts:POEM_FONT_LABEL`
- `lib/punctuation.ts:SENT_END`
- `lib/scheduler-config.ts:SCHEDULER_KEYS`, `DEFAULT_CONFIG`
- `lib/scheduler-tasks.ts:runContentRefresh`, `runDailyCharRefresh`, `runStatsRefresh`
- `lib/setup.ts:writeEnvVar`, `loadEnvFromFile`
- `lib/story-history.ts:clearReadHistory`
- `lib/sutras-fs.ts:sutraFsStats`
- `lib/sutras.ts:splitIntoChunks`
- `lib/validators.ts:4 schemas`
- `lib/worksheet-page-count.ts:pageCountFor`
- `lib/worksheet-types.ts:BRUSH_PAPER_SIZES`

**验证步骤** (每个删除后):
1. 跑 `npx tsc --noEmit` (类型错误应 0)
2. 跑 `npx vitest run` (相关 test 应 pass)
3. 跑 `npm run lint` (no-unused-vars 应为 warn 而非 error, 但 new code 不能引入新的 unused)

#### C.3 3 处 console.log 清理

| 文件:行 | 当前 | 改为 |
|---|---|---|
| `lib/email.ts:49` | `console.log('[email] sending to', to)` | `console.debug('[email] sending to', to)` (保留 dev 可见) |
| `lib/scheduler.ts:143` | `console.log('[scheduler] started')` | `console.info('[scheduler] started')` (合规, startup 信息) |
| `components/game/ChainGame.tsx:43` | `console.log('chain state:', state)` | 删除 (debug 残留) |

### Architecture (cross-cutting)

```
[.execute()→.query() 迁移 ──────────────────────────────┐
                                                       │
[SEO A.1-A.5 markup 改动]  [C.1 ESLint config]  [C.2 死代码]  [C.3 console.log]
         ↓                       ↓                     ↓              ↓
   app/robots.ts           eslint.config.mjs       lib/api-*.ts  lib/email.ts
   app/sitemap/            .prettierrc             lib/opencc.ts  lib/scheduler.ts
   app/sutra/[id]/         package.json scripts    ~25 single    components/game/
   app/pinyin/                                       symbols       ChainGame.tsx
   app/dictionary/
   app/rare-chars/
   app/game/
   app/layout.tsx
         ↓
   [tests/unit/lib/mysql-protocol-migration.test.ts] ─── ┘
   [tests/integration/seo.test.ts]
         ↓
[npx tsc --noEmit] [npx vitest run] [npm run lint] [npm run build]
         ↓
[commits × N] (一个子功能一个 commit, 或 A+B+C 一起 1 commit)
         ↓
[REDPLOY doc bump Wave 1] [push to origin (用户授权后)]
```

### Files Summary

**新建 (3 files)**:
| File | LoC |
|---|---|
| `eslint.config.mjs` | +50 |
| `.prettierrc` | +5 |
| `app/sitemap/etymology.xml/route.ts` | +30 |
| `tests/unit/lib/mysql-protocol-migration.test.ts` | +80 |
| `tests/integration/seo.test.ts` | +40 |

**修改 (~50 files, 净 -140 LoC)**:
- `app/robots.ts` (+1)
- `app/sutra/[id]/page.tsx` (+20)
- `app/pinyin/page.tsx` (+10)
- `app/dictionary/page.tsx` (+10)
- `app/rare-chars/page.tsx` (+10)
- `app/game/page.tsx` (+10)
- `app/layout.tsx` (+15)
- `package.json` (+4 lines scripts)
- ~30 `lib/*.ts` files (`.execute(` → `.query(` mechanical)
- 6+ `lib/api-*.ts` files (delete unused symbols)
- ~25 individual unused symbols across lib/
- 3 console.log sites

**删除 (1 file)**:
- `lib/opencc.ts` (~30 LoC, opencc-js 全未用)

**Total**: ~10 new files + ~50 modified + ~3 deleted; net LoC ~-140.

### Testing Strategy

| Test | Type | Purpose |
|---|---|---|
| `tests/unit/lib/mysql-protocol-migration.test.ts` | unit | 1 BMP + 1 supp-plane query, validates `.query()` semantics |
| `tests/integration/seo.test.ts` | integration | `curl localhost:3000/sitemap.xml` includes etymology URLs; `curl localhost:3000/sutra/<id>` includes Book JSON-LD |
| `tests/integration/lint.test.ts` | integration | `npm run lint` exit 0 (after autofix) |
| `npx vitest run` (full) | regression | no broken existing tests |
| `npx tsc --noEmit` | typecheck | no new type errors |
| `npm run build` | build | no route table regressions |

### Verification (端到端)

1. `npx tsc --noEmit` → exit 0
2. `npx vitest run` → 433 pass + new tests pass (target: 433 + 5 = 438+)
3. `npm run lint` → exit 0 (after autofix)
4. `npm run build` → `✓ Compiled successfully`, route count +1 (new sitemap sub-route)
5. Manual:
   - Open `localhost:3000/sitemap.xml` → contains `https://.../etymology/<char>` URLs
   - Open `localhost:3000/sutra/<id>` → View Source contains `application/ld+json` with `Book` schema
   - Open `localhost:3000/robots.txt` → contains `Disallow: /init`
   - Open `localhost:3000/pinyin` → View Source contains `<title>汉字拼音互转工具</title>`
   - Open `localhost:3000/` → View Source contains `<script type="application/ld+json">` with `Organization` + `WebSite`
6. DB test (sub-feature B): `mysql piyin_dev -e "INSERT INTO users (email, ...) VALUES (UNHEX('...U+2C27C...'), ...)"` then run `getUserByEmail(...)` → returns the row correctly (supp-plane preserved)

### Out of Scope (deferred to Wave 2/3)

**Wave 2 (medium-effort structural)** — to be specced separately after Wave 1 ships:
- Frontend: `next/font/local` for critical fonts + `<link rel="preload">` for hero fonts + `recharts` dynamic import in `components/admin/charts/*` + `pinyin-pro` lazy import in `TextToPinyin`
- Backend: `unstable_cache()` for `/api/sutras` list + `/api/rare-chars/daily` + `/api/admin/*/stats`; `experimental.staleTimes` config; missing indexes (`audit_log.ip`, `chars.hsk_level`); `Promise.all` rewrites in `lib/admin-downloads.ts` + `lib/admin-ai.ts`; SELECT+COUNT Promise.all pattern fix
- SEO: `hreflang` for zh-CN/zh-TW; `force-dynamic` → ISR review for 13+ pages; sub-sitemap split for sutras
- Operational: sharp-linux-x64 install → revert `images.unoptimized`

**Wave 3 (heavy architectural)** — to be specced separately after Wave 2 ships:
- Code quality: `useApiQuery` / `useApiMutation` hook + 5 oversized file splits (`GenerateCharsForm`, `SutraAudioPlayer`, `PlaylistsPanel`, `admin/ai/page`, `WorksheetGenerator`) + tighten `any` (475 → <100) + `noUncheckedIndexedAccess` enable + test coverage push to 50%
- Frontend: `unicode-range` for 13 `@font-face` blocks + remove `public/fonts/*.ttf` after subsetting + remove `public/ziyun.png` (build artifact)
- Backend: real `sutras` chunks schema split (separate column or table)

### Risks

1. **Sub-feature B API 差异陷阱**: `.execute()` 返回 tuple, `.query()` 返回裸数组。99% 代码不受影响, 但要 grep `FieldPacket` 和 `[[{` 嵌套解构模式逐个核对。**Mitigation**: 逐文件改, 每个改完跑该文件相关 unit test。
2. **ESLint autofix 可能误改**: `eslint --fix` 可能重排 100+ 行。**Mitigation**: autofix 后用 `git diff` 扫一眼明显异常 (整个函数被重排)。如有疑虑, `git checkout -- <file>` 单独 reject。
3. **#4 list 页 metadata description 长度**: >160 字符 Google 截断, <50 浪费。**Mitigation**: 控制 80-140 中文字符。
4. **#3 etymology sub-sitemap 8K URLs**: 单文件 ~1.2 MB, 远低于 50 MB 上限, 但首次加载 Googlebot 抓取慢。**Mitigation**: 设 `Cache-Control: public, max-age=3600` (1h ISR), Googlebot 二次抓取直接命中缓存。
5. **死代码 grep 漏 false negative**: 某个符号确实没人直接调用, 但被某个动态字符串引用 (e.g. `require(name)` 或 `import(sideVar)`)。**Mitigation**: grep 时也查 `import(` 动态导入和 `require(` 模式。
6. **`lib/membership.ts:getMyFeatures` 可能被 `react.cache` 包装保留**: audit 列为 dead, 但实际可能通过 cache 入口间接使用。**Mitigation**: 删前 grep `getMyFeatures` 包括所有动态引用; 如有保留, 不删。

### Tech Decisions

1. **3 子功能合 1 plan, 不拆 3 plan**: 每个子功能都简单, 拆 plan 重复 harness 设置浪费。**Wave 1 = 1 plan**。
2. **ESLint flat config** 而不是 `.eslintrc.json`: Next 15 推荐 flat config, 且 `next lint` 本身已 deprecate (Next 16 将移除)。直接 flat config 避免后续迁移。
3. **`@typescript-eslint/no-explicit-any` 只 warn 不 error**: 475 处 any 一刀切 error 会让 lint 失败, 失去 lint 作为质量门的作用。Wave 1 只 warn + 报告, Wave 3 收紧。
4. **`no-console` 只允许 `warn/error/info/debug`**: 阻止新代码用 `console.log`, 但 `console.debug/info` (startup banner) 合规保留。
5. **JSON-LD `potentialAction` 假设 `/search` 存在**: 当前不存在搜索页, 但 `WebSite` schema 推荐带 `SearchAction` 占位以解锁 sitelinks searchbox。**Plan 文档必须明确**: 如果用户后续删 `/search` 路由, 这块也要对应删。
6. **死代码删除前置 grep 必须排除 `Up/`**: Up/ 是 gitignored deploy bundle, grep 时会触发大量 false positive。
7. **不引入 husky + lint-staged**: YAGNI, CI 上跑 `npm run lint` 就够 (且当前无 CI)。

### Commit Strategy

按 `feedback-commit-timestamps.md` 加 `[YYYY-MM-DD HH.MM]` 后缀。3 子功能可以一起 1 commit (low risk) 或拆 3 commit (易回滚子功能 B)。**建议**:

- Commit 1 (Sub-feature A — SEO): `docs(seo): add /init robots disallow + sutra/etymology schema + 4 list metadata + site-wide Organization [YYYY-MM-DD HH.MM]`
- Commit 2 (Sub-feature B — mysql2 protocol): `fix(mysql2): replace .execute() with .query() across lib/ (supp-plane safety) [YYYY-MM-DD HH.MM]`
- Commit 3 (Sub-feature C — code quality): `chore(quality): add eslint+prettier config + remove 60+ dead exports + clean 3 console.logs [YYYY-MM-DD HH.MM]`

3 commit 各独立可 revert, 不串扰。**NOT to push** per `no-prod-env-2026-06-21.md` until user explicitly authorizes.

### REDEPLOY Doc Update (deferred)

`REDEPLOY-2026-07-09.md` 当前到 v10 (image-to-char)。Wave 1 ship 后加 v11 段 (5 SEO + B protocol + C lint), 但**REDPLOY 文档更新不放在这个 plan** — 等 Wave 1 全部 commit 完成且 human smoke 通过后, 单独一个小 PR 处理 REDEPLOY 版本。

## Open Questions

(无 — 所有 clarifications 在 Section 1-5 中已通过 Q&A 解决)

## Related Plans / Memory

- `mysql2-supp-plane-bug.md` — B 子功能的依据
- `next.config.ts` images.unoptimized — Wave 2 处理
- `no-prod-env-2026-06-21.md` — 不自动 push
- `feedback-commit-timestamps.md` — commit 时间戳后缀
- `feedback-write-in-chinese.md` — 用户回复中文, 代码注释英文
- `dev-port.md` — dev server port 4444
- `plan-admin-analytics-foundation-status.md` — Wave 1/2/3 分波模板

## Reviewer Calibration Notes

- 死代码删除的 review 重点: 确认 grep 0 hit 的验证记录
- ESLint config 的 review 重点: 不该开的规则没开 (noUncheckedIndexedAccess), 已开的规则不超严
- `.execute()` → `.query()` 的 review 重点: 漏掉的地方 + 错改的 API 差异 (tuple vs array)
- JSON-LD 的 review 重点: schema 字段命名符合 schema.org 标准, 不漏 BreadcrumbList