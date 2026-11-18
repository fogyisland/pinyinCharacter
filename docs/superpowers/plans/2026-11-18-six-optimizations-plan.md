# 六项优化（按顺序）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按实测优先级依次落地六项优化：清构建缓存 → 拆 sans 族 CSS → classics 数据 gzip 入库 → 拆 `lib/webfont/` 大文件 → 删死代码并修 audio 删文件的静默吞错 → 加章节号约定体检。

**Architecture:** 六项**互相独立**，每项自带测试与提交，可单独回滚。Task 1 是纯运维约定（0 代码）；Task 2 改字体流水线的产物布局（hot/ext 两份 CSS + manifest 扩展 + layout 异步加载）；Task 3 改数据的**存储形态**（裸 JSON → `.json.gz` 入库，读取层已经支持）；Task 4 是纯重构（按职责切文件，不改行为）；Task 5 删两个零调用方的导出并给 `unlink` 加日志；Task 6 给 `scripts/audit-gaps.ts` 加第七类体检。

**Tech Stack:** Next.js 15.5.29 / React 19 / TypeScript / MySQL（mysql2）/ vitest 4.1.12 / Node `zlib` / `subset-font`。**零新增依赖。**

**Spec:** 本计划自身即规格 —— 没有独立 spec 文档，理由与实测证据见下方「Assessment Evidence」。

**Branch:** `feature/admin-webfont-pipeline`（当前分支，已有 164 个未推送提交 —— **不要 rebase，不要 force-push**）。

---

## Assessment Evidence（本计划的实测依据）

不是估算，是本次会话跑出来的数：

| 事实 | 实测值 | 出处 |
|---|---|---|
| `.next/cache` 体积 | **718 MB**（`.next` 共 847 MB） | `du -sh .next/cache` |
| `data/classics` 体积 | **251 MB / 196 文件**（最大单文件 8.5 MB） | `du -sh data/classics` |
| 已跟踪资产总量 | **354 MB**（`public/` + `data/`） | `git ls-files` + `os.path.getsize` |
| `.git` 打包体积 | **362 MB** | `git count-objects -vH` |
| `fonts-sans.css` 体积 | **608 KB / 2468 个 `@font-face`** | `os.path.getsize` |
| sans 族 hot 区 | `hot.woff2` **70.6 KB**，覆盖 262 码位 | 解析 `unicode-range` |
| sans 族 ext 区 | 2458 块 × 6 字 = **7.73 MB** | 同上 |
| `public/font` 文件数 | **7988** 个 woff2（sans 2468 / serif 2855 / wenkai 2658） | `find -name '*.woff2'` |
| >500 行的源文件 | **16 个**（`lib/webfont/` 占 4 席：capability 995 / apply 846 / pipeline 518 / releases 517，**共 2876 行**） | `wc -l` |
| `lib/webfont/` 总行数 | **4004 行 / 10 个文件** | `wc -l lib/webfont/*.ts` |
| 零调用方导出 | `lib/audio-tracks.ts:77 getActiveTrack`、`app/api/audio/active/route.ts`、`lib/playlists.ts:113 getActivePlaylist` | `grep -rn` 全仓 |
| 空 `catch`（仅注释） | **35 处**（源目录），其中 1 处是真缺陷 | AST 式扫描 |
| classics 章号 | **196/196 文件** `id == 下标+1`（`baopuzi-1.json` 35 章全对） | Python 遍历 |
| sutras 章号 | **11/11 文件** `id == 下标`（每文件 1 章） | Python 遍历 |
| `.gitignore` 的 `*.gz` 规则 | **第 62 行**，`git check-ignore -v` 确认会拦下 `data/classics/*.json.gz` | `git check-ignore` |
| `npm audit --omit=dev` | **0 漏洞** | `npm audit` |
| `scripts/audit-gaps.ts` | **6 类全绿** | `npx tsx scripts/audit-gaps.ts` |
| 测试 | 2316 用例 / **2297 通过**；2 个失败是并发超时（单独跑 45/45 全绿） | `npx vitest run` |

⚠️ **两处「数据形状」的实测结论**（Task 6 依赖它们）：

| 语料 | 文件形状 | 章节 id 约定 |
|---|---|---|
| `data/classics/*.json` | **对象**，`{ slug, title, ..., chunks: [...] }` | **1-based**（`id == 下标 + 1`） |
| `data/sutras/*.json` | **顶层数组**（无 `chunks` 包装），`manifest.json` 除外 | **0-based**（`id == 下标`） |

⇒ 体检的 Task 6 必须用**两套不同的取法**读这两个语料。

---

## Global Constraints

- **零新增运行时依赖**：不许装任何新 npm 包。Task 2/3 用 Node 内置 `zlib`，Task 3 用已有的 `lib/json-fs.ts`。
- **每个 Task 一个提交**：提交信息尾加时间戳 `[YYYY-MM-DD HH.MM]`（仓库既有约定）。
- **不 push**：按用户 2026-06-21 起的规矩，改动留在本地。**除非用户明确要求，不执行 `git push`。**
- **不回滚既有提交**：本分支有 164 个未推送提交，改历史会让台账里的 SHA 全部失效。
- **代码/提交信息用英文**，对话与计划用中文。
- **不许用 `...` 省略任何实现**：每个代码块都是完整可粘贴的。
- **每个 Task 结束前跑三件套**：`npx vitest run <本 Task 的测试文件>` + `npx tsc --noEmit` + `npx eslint .`（后者允许既有 warning，但**不许新增 error**）。
- **Task 2/3 属于「动 `app/**/page.tsx` / 动 `public/` 产物布局」的等级** ⇒ 按仓库既有规矩（`feedback-per-task-build-check`），**必须跑一次 `npm run build`** 才算完。⚠️ 但 dev server（4444）存活时**绝不能 build**（会踩坏 dev 的构建缓存）—— 先停 dev，再 build，再起 dev。

---

## Review Focus

按「最可能咬到人」排序。以下每一条都要在**拥有该代码的那个 Task** 里补上对应的测试：

1. **`.gz` 文件在 `.gitignore` 的 `*.gz` 规则下会被忽略** —— Task 3 必须显式反忽略 `data/classics/*.json.gz`，否则提交后 `git status` 里空空如也，文件却从未入库（这是「假成功」，最难发现）。
2. **Task 2 拆分后，ext 区的 CSS 是异步加载的** —— 首次命中一个 ext 块时，浏览器必须等 CSS 到达才知道要取哪个 woff2 ⇒ **多一个 RTT**。若用户滚动极快，可能先看到系统字（fallback），再跳成正字。测试要钉住「ext CSS 用 `media="print"` + 提升脚本」这个结构存在。
3. **Task 2 的 manifest version 变了** —— `lib/font-css.ts` 的 `?v=` 令牌、`public/font/fonts-manifest.json`、`scripts/fonts/import-webfont-release.mjs` 的哈希三者必须同步。**任一处漏改 ⇒ 浏览器拿一年的 immutable 旧 CSS ⇒ 永久豆腐块。** 测试必须断言三者一致。
4. **Task 4 拆文件后，公开导出签名一个都不能变** —— `lib/webfont/` 的导出被 `app/api/admin/webfonts/*` 和 8 个测试文件引用。测试必须逐个断言导出仍存在且签名一致。
5. **Task 5 删掉 `/api/audio/active` 后，前端不能引用它** —— 已验证零引用，但测试要钉住这一点，防止将来有人接上后又漏掉鉴权。
6. **Task 6 的章号断言必须能变红** —— 一个「永远绿」的体检比没有体检更坏（假绿）。测试必须构造一个 id 错位的 classics 文件，断言体检**报出来**。

---

---

### Task 1: 清掉构建缓存

**Files:**
- Modify: `package.json`（新增 `build:clean` 脚本）
- Modify: `DEPLOY.md`（**两处** `npm run build` —— 首次部署第 5 步、升级流程第 4 步）

**Interfaces:**
- Consumes: 无
- Produces: `npm run build:clean` —— 先删 `.next/cache` 再 `next build`；DEPLOY.md 的两处服务器构建都改用它

- [ ] **Step 1: 记录清理前的体积（作为收益证据）**

```bash
du -sh .next/cache .next 2>/dev/null
```

期望：`.next/cache` 明显大于 `.next` 的其余部分（本机实测 718 MB / 总 847 MB）。

⚠️ **先确认 dev server 在跑**（`.next/cache` 里是 dev 的缓存）：
`dev-server.log` 显示 dev server 正在 4444 端口跑着。**dev server 存活时删 `.next/cache` 会让 dev 重新编译**（无害，但会慢一下）。

- [ ] **Step 2: 加 `build:clean` 脚本**

在 `package.json` 的 `scripts` 里，**紧挨着现有的 `"build": "next build",` 后面**加一行：

```json
"build": "next build",
"build:clean": "node -e \"require('node:fs').rmSync('.next/cache',{recursive:true,force:true})\" && next build",
```

⚠️ **不要改 `build` 本身** —— `next build` 每次都会自己重建 `.next`，但**不会**清 `.next/cache`（构建器的增量缓存会跨次累积）。新增一个 `build:clean` 脚本，让**部署流程**用它，日常开发用 `build`。
理由：日常 `npm run build` 加一步删缓存会让本地增量构建变慢；服务器上则完全没有缓存价值（服务器不跑第二次构建）。

⚠️ **`rmSync` 的 `force: true`** —— 缓存目录可能不存在（第一次构建），`force` 让它静默跳过而不是抛错。

- [ ] **Step 3: 在 DEPLOY.md 的两处构建步骤改用 `build:clean`**

DEPLOY.md 里有**两处** `npm run build`：

| 位置 | 上下文 | 改法 |
|---|---|---|
| **第 42 行** | 「5. 构建 + 启动」（首次部署） | `npm run build` → `npm run build:clean` |
| **第 315 行** | 「4. 装新依赖 + 重新构建」（升级流程） | `npm run build` → `npm run build:clean` |

在**第二处**（升级流程）后面加一段说明：

```markdown
#    `build:clean` 先删 `.next/cache` 再构建 —— 服务器上不会跑第二次构建,
#    增量缓存没有价值,只会白占磁盘(实测本机 `.next/cache` 达 718 MB,
#    而 `.next` 总共 847 MB)。产物完全一致。
```

⚠️ **第一处（首次部署）也可以改** —— 首次部署时 `.next/cache` 本来就不存在，删了也无妨。**两处都改，保持一致。**

⚠️ **别忘了 `Up/README.md`** —— `scripts/copy-to-up.py` 的 `write_up_readme()` 里也有一句「必须在 `npm run build` 之前 `rm -rf .next`」（第 325 行）。**那句话现在是过时的**（它让人手删整个 `.next`）。改成：

```python
    'DEPLOY.md` 升级流程速查。**必须**在 `npm run build:clean` 之前 `rm -rf .next` ——
```

⚠️ **这一处改的是 `scripts/copy-to-up.py` 里的 Python 字符串**，不是 DEPLOY.md。**两处都要改。**

- [ ] **Step 4: 验证脚本能跑**

**只验证删缓存这一步**（不触发完整构建）：

```bash
node -e "require('node:fs').rmSync('.next/cache',{recursive:true,force:true})" && du -sh .next
```

期望：`.next` 从 847 MB 降到约 130 MB。

**完整构建的验证放到收尾阶段**（收尾本来就要跑一次 `npm run build`）—— Task 1 不需要单独跑一次全量构建。

⚠️ 若要单独验证 `build:clean`，**先停 4444 端口的 dev server**（`netstat -ano | findstr :4444` → `taskkill //PID <pid> //F`）—— dev server 存活时 build 会踩坏 dev 的构建缓存（见 `dev-build-cache-stomp` 记忆）。

- [ ] **Step 5: 提交**

```bash
git add package.json DEPLOY.md
git commit -m "chore(build): add build:clean so a server build carries no incremental cache [YYYY-MM-DD HH.MM]"
```

---

### Task 2: 拆分 sans 族 CSS —— hot 区阻塞、ext 区异步

**Files:**
- Modify: `scripts/fonts/build-webfont-subsets.mjs`（`renderStylesheet` 拆成两份）
- Modify: `scripts/fonts/import-webfont-release.mjs`（哈希纳入新文件）
- Modify: `lib/webfont/apply.ts`（`STYLESHEETS` 改成六份 —— 见 Step 9）
- Modify: `lib/font-css.ts`（返回两份 CSS 的链接）
- Modify: `app/layout.tsx`（ext CSS 走 `media="print"`）
- Modify: `public/font/fonts-manifest.json`（由流水线重新生成，**不要手改**）
- Test: `tests/unit/scripts/webfont-subsets.test.ts`（**已存在**，加用例）
- Test: `tests/unit/lib/font-css.test.ts`（**新建** —— 见 Step 14）

**Interfaces:**
- Consumes: 现有 `renderStylesheet(family, plan, version)`、`manifestVersion(cssByFile)`、`getFontCssLinks()`
- Produces:
  - `renderStylesheets(family, plan, version): { hot: string; ext: string }` —— 新的导出；`renderStylesheet` 保留为兼容包装
  - `getFontCssLinks(): FontCssLinks` 扩展为 `{ sans: string; sansExt: string; wenkai: string; serif: string }`

**背景与约束（执行者必读）:**

现在三族各有一份 CSS，`sans` 是**唯一阻塞渲染**的那份（`app/layout.tsx:30` 的 `<link rel="stylesheet" href={fontCss.sans} />`）。`wenkai`/`serif` 已经用 `media="print"` + 内联脚本提升做到了不阻塞 —— **同样的手法可以用在 sans 的 ext 区**。

⚠️ **`app/layout.tsx` 里已有的 `media="print"` 写法有一个完整的注释块**（第 32-47 行），解释了 `suppressHydrationWarning` 为什么必需。**新加的 ext 链接沿用同样的处理**，注释可以简短引用（不要复制整段）。

⚠️ **提升脚本 `ASYNC_STYLESHEET_FLIP` 在第 59 行**，它是**一份**内联脚本，提升**所有** `media="print"` 的样式表 —— 所以新加的 ext 链接**不需要**新的脚本。

关键点：**hot 区必须保持阻塞**。body 字体每页都要用，异步化会导致首屏闪一下系统字。

为什么这能省：`fonts-sans.css` 的 608 KB 里，hot 区只有 10 个 `@font-face`（`hot.woff2` + `hot-700.woff2` + latin），ext 区有 2458 个。浏览器必须**完整解析整份 CSS** 才知道哪些块会命中 ⇒ 608 KB 的解析成本每次首屏都要付。拆开后，阻塞的只有 ~5 KB。

⚠️ **代价**：ext 区 CSS 到达前，浏览器不知道要去取哪个 ext woff2 ⇒ 首次命中多一个 RTT，滚动快时可能看到 fallback 字。这是**明确的取舍**，必须在代码注释里写清楚。

- [ ] **Step 1: 写失败的测试 —— 渲染出两份 CSS**

在 `tests/unit/scripts/webfont-subsets.test.ts` 里加：

```ts
import { describe, it, expect } from 'vitest';
import { renderStylesheets } from '@/scripts/fonts/build-webfont-subsets.mjs';
```

⚠️ **注意**：该 `.mjs` 是 ESM，`vitest.config.ts` 里可能没有 alias 到 `@/scripts/...`。先看现有测试怎么 import 它：

```bash
grep -n "build-webfont-subsets" tests/unit/scripts/webfont-subsets.test.ts | head -5
```

测试体（**沿用文件顶部已有的 `plan` 常量和 `VERSION`** —— 该文件已有 `const plan = { hot: ['一','丁'], extBlocks: [{ index: 1, chars: ['万','丈'] }] }` 和 `const VERSION = 'abc123def456'`）：

```ts
describe('renderStylesheets — the ext tier is a stylesheet of its own', () => {
  it('puts the hot tier in the hot stylesheet and the ext tier in the ext one', () => {
    const family = {
      key: 'sans',
      label: 'Noto Sans SC',
      css: 'fonts-sans.css',
      dir: 'sans',
      purpose: 'body typeface',
      sources: ['NotoSansSC-wght-400-700.ttf'],
      weights: ['400'],
      variable: true,
      hotSize: 300,
      extBlockChars: 6,
      latinExtBlockChars: 12,
      license: 'NotoSansSC-OFL.txt',
    };

    const { hot, ext } = renderStylesheets(family, plan, VERSION);

    // The hot stylesheet carries the hot tier ...
    expect(hot).toContain('hot.woff2');
    expect(hot).not.toContain('ext-001');
    // ... and the ext stylesheet carries the ext tier.
    expect(ext).toContain('ext-001');
    expect(ext).not.toContain('hot.woff2');
    // Both carry the version token on every URL.
    expect(hot).toContain(`?v=${VERSION}`);
    expect(ext).toContain(`?v=${VERSION}`);
    // And the two together are exactly what the old single stylesheet was.
    expect(countFaceRules(hot) + countFaceRules(ext)).toBe(
      countFaceRules(renderStylesheet(family, plan, VERSION)),
    );
  });

  it('keeps both faces of a weight pair in the same stylesheet', () => {
    // The 400 and the 700 face of one block share a unicode-range, so they
    // must not be split across two stylesheets — a split would make the
    // browser pick the wrong weight for the characters in the other file.
    const family = {
      key: 'sans',
      label: 'Noto Sans SC',
      css: 'fonts-sans.css',
      dir: 'sans',
      purpose: 'body typeface',
      sources: ['NotoSansSC-wght-400-700.ttf'],
      weights: ['400', '700'],
      variable: true,
      hotSize: 300,
      extBlockChars: 6,
      latinExtBlockChars: 12,
      license: 'NotoSansSC-OFL.txt',
    };

    const { hot, ext } = renderStylesheets(family, plan, VERSION);

    // The hot block has one file per weight, and both land in the hot sheet.
    expect(hot).toContain('font-weight: 400');
    expect(hot).toContain('font-weight: 700');
    expect(ext).not.toContain('font-weight: 400');
  });
});
```

⚠️ **`countFaceRules` 不在 `build-webfont-subsets.mjs` 里** —— 它在 `lib/webfont/apply.ts`（`export function countFaceRules(css: string): number`）。**不要**在 `.mjs` 测试里 import 它（那会把 `lib/webfont/apply.ts` 拖进脚本的依赖图）。

改用本文件里已有的等价写法 —— 正则数 `@font-face`：

```ts
/** How many @font-face rules a stylesheet declares. */
function faceCount(css: string): number {
  return (css.match(/@font-face\s*\{/g) ?? []).length;
}
```

把上面测试里的 `countFaceRules(...)` 全部换成 `faceCount(...)`，并在测试文件顶部加这个函数。**这个等价关系已经被现有测试钉住**（`lib/webfont/apply.ts` 的 `countFaceRules` 与 wave-2 的 `parseFaces()` 有一个专门的测试比对），所以这里用本地的 `faceCount` 是安全的。

- [ ] **Step 2: 跑测试，确认它红**

```bash
npx vitest run tests/unit/scripts/webfont-subsets.test.ts
```

期望：FAIL，报 `renderStylesheets is not a function`（导出不存在的典型表现）。

- [ ] **Step 3: 实现 `renderStylesheets`**

在 `scripts/fonts/build-webfont-subsets.mjs` 里，把现有的 `renderStylesheet` 改成：

```js
/**
 * Render the two stylesheets of one family.
 *
 * The hot tier and the ext tier are TWO stylesheets, not one:
 *
 *   fonts-<family>-hot.css   the hot tier — the characters every page
 *                             paints. It is RENDER-BLOCKING, because the
 *                             body typeface draws every character of every
 *                             page: making it asynchronous would show a
 *                             flash of the system font on every page.
 *   fonts-<family>-ext.css   the ext tier — one `@font-face` per six
 *                             characters. It is loaded with
 *                             `media="print"` and promoted by the inline
 *                             script in app/layout.tsx, so it never
 *                             blocks the first paint.
 *
 * WHY THIS IS A WIN: the browser has to parse a stylesheet before it can
 * know which subset file a character needs — the `unicode-range` of every
 * face is what tells it. A single stylesheet with 2458 ext faces cost
 * 608 KB of parsing on every first paint, to learn about faces the page
 * almost never paints. Splitting the two tiers means the blocking part
 * is ~5 KB.
 *
 * ⚠️ THE COST, STATED PLAINLY: until the ext stylesheet arrives, the
 * browser does not know that a character lives in an ext block, so the
 * first paint of such a character waits for the stylesheet and then for
 * the woff2. That is one extra round trip for the characters outside the
 * hot tier. The alternative — one 608 KB blocking stylesheet — costs the
 * same round trip on EVERY page load instead, for the characters the page
 * actually paints. This trade is deliberate.
 *
 * A weight pair (400 and 700) of ONE block shares a unicode-range, so the
 * two faces are never split across the two stylesheets — a split would let
 * the browser pick the wrong weight for the characters in the other file.
 */
export function renderStylesheets(family, plan, version) {
  if (typeof version !== 'string' || !VERSION_TOKEN_PATTERN.test(version)) {
    throw new Error(
      `[webfont] the stylesheet of ${family.label} has no usable version token — ` +
        `it got ${JSON.stringify(version)}, but the URL of every subset file needs ` +
        'twelve lowercase hex characters, or the browser keeps the old file for a year',
    );
  }

  const hotFaces = [];
  const extFaces = [];
  for (const block of blocksOf(plan)) {
    const files = blockFileNames(family, block);
    if (files.length !== family.weights.length) {
      throw new Error(
        `family ${family.key}: ${files.length} file(s) per block but ` +
          `${family.weights.length} weight(s) — the weights and the sources disagree`,
      );
    }
    for (let index = 0; index < files.length; index += 1) {
      const face = renderFace({
        family,
        weight: family.weights[index],
        file: files[index],
        chars: block.chars,
        version,
      });
      // `blocksOf()` yields four kinds: 'hot', 'ext', 'latin', 'latin-ext'.
      //
      // The hot sheet takes the hot Chinese tier AND the latin hot tier:
      // the latin hot block is the handful of latin faces every page
      // paints, and it is small. Everything else — the Chinese ext blocks
      // and the latin ext blocks alike — is the ext tier.
      const isHot = block.kind === 'hot' || block.kind === 'latin';
      (isHot ? hotFaces : extFaces).push(face);
    }
  }

  const header = (which) =>
    `/* ${family.css} (${which} tier) — ${family.purpose}\n` +
    ' * Generated by scripts/fonts/build-webfont-subsets.mjs. Do not edit by hand. */\n';

  return {
    hot: header('hot') + hotFaces.join('\n') + '\n',
    ext: header('ext') + extFaces.join('\n') + '\n',
  };
}
```

⚠️ **保留 `renderStylesheet` 的向后兼容导出**（若 `scripts/fonts/import-webfont-release.mjs` 或测试还在用）。做法：

```js
/**
 * The one-stylesheet form. Kept for the release importer, which needs a
 * single string per family to hash. Prefer renderStylesheets() in the
 * builder.
 */
export function renderStylesheet(family, plan, version) {
  const { hot, ext } = renderStylesheets(family, plan, version);
  return hot + ext;
}
```

- [ ] **Step 4: 改写入逻辑 —— 两份文件**

找到 `scripts/fonts/build-webfont-subsets.mjs` 里写样式表的那一段（`await writeFile(join(FONT_DIR, family.css), css, 'utf8');` 附近，约 780 行），改成：

```js
    const sheets = renderStylesheets(family, plan, version);
    await writeFile(join(FONT_DIR, `fonts-${family.key}-hot.css`), sheets.hot, 'utf8');
    await writeFile(join(FONT_DIR, `fonts-${family.key}-ext.css`), sheets.ext, 'utf8');
```

同时把 `cssByFile` 的收集改成同时收两份（manifest 哈希要覆盖全部六份）。

- [ ] **Step 5: 改 manifest**

`scripts/fonts/build-webfont-subsets.mjs` 里写 manifest 的地方（**第 895-901 行**，现在是 `files: { wenkai, sans, serif }` 三个字段），改成六份：

```js
    files: {
      wenkai: '/font/fonts-wenkai-hot.css',
      wenkaiExt: '/font/fonts-wenkai-ext.css',
      sans: '/font/fonts-sans-hot.css',
      sansExt: '/font/fonts-sans-ext.css',
      serif: '/font/fonts-serif-hot.css',
      serifExt: '/font/fonts-serif-ext.css',
    },
```

⚠️ **`cssByFile` 的键也要一起改**（同一个 `manifestVersion(cssByFile)` 的输入）。Step 4 里 `buildFamily` 现在返回 `stats.css`（一整份 CSS 字符串）。**要改成返回两份**：

```js
    const sheets = renderStylesheets(family, plan, version);
    await writeFile(join(FONT_DIR, `fonts-${family.key}-hot.css`), sheets.hot, 'utf8');
    await writeFile(join(FONT_DIR, `fonts-${family.key}-ext.css`), sheets.ext, 'utf8');
```

而 `buildFamily` 的返回值 `stats.css` 要变成 `stats.cssHot` / `stats.cssExt`，调用处（第 888 行）改成：

```js
    cssByFile[`fonts-${item.family.key}-hot.css`] = stats.cssHot;
    cssByFile[`fonts-${item.family.key}-ext.css`] = stats.cssExt;
```

⚠️ **`family.key` 的值**：读 `FAMILIES`（第 199 行）确认 —— 每个 family 的 `key` 是 `'sans'` / `'serif'` / `'wenkai'`，而 `css` 是 `'fonts-sans.css'` 这样的文件名。**新文件名用 `family.key` 拼**（`fonts-${family.key}-hot.css`），不要用 `family.css` 拼（那是旧文件名，会得到 `fonts-sans.css-hot.css`）。

⚠️ **旧的三份 CSS 文件要删掉**：构建产物里 `public/font/fonts-sans.css` 等三份旧文件如果留着，`/font/:path*` 的 30 天缓存规则会让浏览器可能命中旧文件。Step 4 之后手动删：

```bash
rm -f public/font/fonts-sans.css public/font/fonts-serif.css public/font/fonts-wenkai.css
```

（或者更稳：给构建脚本加一步 `sweepStaleFiles` 风格的清理，把 `public/font/fonts-*.css` 里不在新清单中的删掉。**但 `sweepStaleFiles` 是按 family 目录清理 woff2 的，不是清理根目录的 CSS** —— 所以这一步只能手动删，或者在写完新文件后显式 `unlink` 那三份旧名。推荐**在 `buildFamily` 里显式删**：

```js
  // The one-stylesheet layout is gone: the old file has to go, or the
  // 30-day cache rule on /font/:path* can still serve it.
  await rm(join(FONT_DIR, family.css), { force: true });
```

（`rm` 从 `node:fs/promises` 导入 —— 检查该文件顶部的 import 列表，**如果没有 `rm` 就要加**。）

- [ ] **Step 6: 改 `lib/font-css.ts`**

```ts
export interface FontCssLinks {
  /** Body typeface (--font-han-sans) — every character of every page. */
  sans: string;
  /** The ext tier of the body typeface — loaded without blocking. */
  sansExt: string;
  /** Brand typeface (--font-kai) — the header mark, the section titles. */
  wenkai: string;
  /** Serif accent typeface (--font-han-serif) — dictionary, story, admin. */
  serif: string;
}

export function getFontCssLinks(): FontCssLinks {
  const version = manifest.version;
  return {
    sans: `${manifest.files.sans}?v=${version}`,
    sansExt: `${manifest.files.sansExt}?v=${version}`,
    wenkai: `${manifest.files.wenkai}?v=${version}`,
    serif: `${manifest.files.serif}?v=${version}`,
  };
}
```

⚠️ **`manifest.files.sansExt` 的类型**：`public/font/fonts-manifest.json` 是 `import` 进来的 JSON，TS 会推断出它的字面量结构。**Step 10 跑完字体流水线后**，`public/font/fonts-manifest.json` 才会有 `sansExt` 字段 —— 在此之前 `tsc` 会报 `Property 'sansExt' does not exist`。

⇒ **顺序很重要**：Step 6 改完代码后，**必须先跑 Step 10 生成新 manifest**，再跑 `tsc --noEmit`。若 Step 10 跑不了（没有 staging 字体、需要网络），就**手工把 `public/font/fonts-manifest.json` 的 `files` 字段补上这六个键**（`sansExt` 指向一个还不存在的文件 —— 但那样字体就加载不到 ext 了）。

⚠️ **更稳的做法**：先跑 Step 10（生成产物），再改 Step 6/7（改代码）。**调整步骤顺序：Step 4 → Step 5 → Step 9 → Step 10 → Step 6 → Step 7 → Step 8。**

- [ ] **Step 7: 改 `app/layout.tsx`**

把现在的：

```tsx
        <link rel="stylesheet" href={fontCss.sans} />
```

改成：

```tsx
        {/* Body typeface — render-blocking, every glyph of every page uses it. */}
        <link rel="stylesheet" href={fontCss.sans} />
        {/*
          The ext tier of the body typeface — one face per six characters,
          2458 of them for the sans family. It is loaded without blocking:
          `media="print"` keeps it off the critical path and the inline
          script below promotes it once it arrives.

          ⚠️ THE TRADE: until this stylesheet arrives, the browser does not
          know that a character lives in an ext block, so the first paint of
          such a character waits for it. That is ONE extra round trip for
          the characters outside the hot tier — paid once per cold load.
          The alternative, one 608 KB blocking stylesheet, cost the SAME
          parse on EVERY page load for characters the page almost never
          paints. This trade is deliberate.
        */}
        <link
          rel="stylesheet"
          href={fontCss.sansExt}
          media="print"
          suppressHydrationWarning
        />
```

⚠️ **`suppressHydrationWarning` 是必需的**：提升脚本会在 hydration 之前改 `media` 属性，React 会发现 DOM 里是 `media="all"` 而自己的树里是 `media="print"`。既有代码（`app/layout.tsx:47-55`）已经对 wenkai/serif 这么做并写了注释 —— 新加的这份沿用同样的处理。

- [ ] **Step 8: 确认提升脚本能提升多张表**（**已核实，无需改动**）

`lib/font-css-flip.ts` 的现有实现：

```ts
export const ASYNC_STYLESHEET_FLIP = `(function(){var l=document.querySelectorAll('link[rel="stylesheet"][media="print"]');for(var i=0;i<l.length;i++){(function(el){if(el.sheet){el.media="all";}else{el.addEventListener("load",function(){el.media="all";});}})(l[i]);}})();`;
```

✅ **它用的是 `querySelectorAll`，能提升所有 `media="print"` 的样式表** —— 新加的 ext 表会自动被提升，**不需要改这个文件**。

⚠️ 但要**确认 `app/layout.tsx` 里引用的就是这个常量**（而不是另抄了一份内联脚本）：

```bash
grep -n "ASYNC_STYLESHEET_FLIP" app/layout.tsx
```

- [ ] **Step 9: 改 `scripts/fonts/import-webfont-release.mjs` 的哈希**

```bash
grep -n "STYLESHEETS" scripts/fonts/import-webfont-release.mjs
```

现有（**第 110 行**）：

```js
const STYLESHEETS = FAMILIES.map((family) => `fonts-${family}.css`);
```

⚠️ **这里的 `FAMILIES` 是字符串数组**（`'sans'` / `'serif'` / `'wenkai'`），**不是** `build-webfont-subsets.mjs` 里的对象数组 —— 所以是 `family` 直接拼，不是 `family.key`。

改成：

```js
const STYLESHEETS = FAMILIES.flatMap((family) => [
  `fonts-${family}-hot.css`,
  `fonts-${family}-ext.css`,
]);
```

⚠️ **这个 importer 里还有三处依赖旧文件名**，全部要改：

| 位置 | 现在 | 改成 |
|---|---|---|
| 第 110 行 | `const STYLESHEETS = FAMILIES.map(...)` | 上面的 `flatMap` |
| 第 336 行 | `readStylesheet(join(fontDir, `fonts-${family}.css`))` | 读两份：`fonts-${family}-hot.css` 和 `fonts-${family}-ext.css` |
| 第 508 行 | `...STYLESHEETS.map((file) => `public/font/${file}`)` | **不用改** —— 它用的是 `STYLESHEETS` 数组，自动跟着变 |

第 336 行是**最容易漏的**：它读单个样式表算 face 数。改成：

```js
  const css = STYLESHEETS
    .filter((file) => file.startsWith(`fonts-${family}-`))
    .map((file) => readStylesheet(join(fontDir, file)))
    .join('\n');
```

⚠️ **这一步是 Task 2 里最关键的一步。** 哈希覆盖的文件集合变了 ⇒ `manifest.version` 变了 ⇒ `?v=` 令牌变了。而 `/font/web/:path*` 是**一年 immutable**、`/font/:path*` 是 **30 天**：
- 若哈希漏改 ⇒ 浏览器在 30 天内拿旧的 CSS ⇒ 新旧样式表与 woff2 字节不匹配 ⇒ **豆腐块**。
- 哈希改对 ⇒ 新 CSS 的 URL 带新 `?v=` ⇒ 立即生效。

⚠️ **还有一处**：`lib/webfont/apply.ts` 的第 84 行也有一个 `const STYLESHEETS = ['fonts-sans.css', 'fonts-serif.css', 'fonts-wenkai.css'] as const;` —— **这是服务端在发布时重写样式表用的**。它也要改成六份：

```ts
const STYLESHEETS = [
  'fonts-sans-hot.css',
  'fonts-sans-ext.css',
  'fonts-serif-hot.css',
  'fonts-serif-ext.css',
  'fonts-wenkai-hot.css',
  'fonts-wenkai-ext.css',
] as const;
```

⚠️ **`lib/webfont/apply.ts` 属于 Task 4 的范围，但这个改动属于 Task 2**（它是哈希/发布契约的一部分）。Task 2 必须改它，否则发布流程会用旧文件名去找样式表 ⇒ 找不到 ⇒ 发布失败。**Task 4 之后不要重复改。**

- [ ] **Step 10: 跑字体流水线重新生成产物**

```bash
npm run fonts:subset-web
```

⚠️ 这需要 staging 里的源字体（`scripts/fonts/staging/web/`）。若 staging 不存在（`.gitignore` 排除了它），先跑：

```bash
npm run fonts:download-web && npm run fonts:instance-web
```

（这两个需要网络。）

跑完检查产物：

```bash
ls -la public/font/fonts-*.css
```

期望：**六份**文件（`-hot` / `-ext` × 三族），**没有**旧的三份 `fonts-<family>.css`。

`fonts-sans-hot.css` 应该在几 KB 量级，`fonts-sans-ext.css` 在 600 KB 量级。

⚠️ **如果 staging 里的源字体不存在、且不能联网下载** ⇒ Task 2 **做不了**（无法重新生成样式表和 manifest）。此时的退路是**只做代码侧**：改 `build-webfont-subsets.mjs` / `import-webfont-release.mjs` / `lib/font-css.ts` / `app/layout.tsx`，**但不生成新产物** —— 那样 `manifest.files.sansExt` 不存在，**应用会 404**。

⇒ **这种情况下 Task 2 必须整体推迟**，不能只交一半。理由：一份指向不存在文件的 manifest 比不改更糟。

- [ ] **Step 11: 跑校验**

```bash
npm run fonts:verify-webfont
npx vitest run tests/unit/scripts/webfont-subsets.test.ts tests/unit/scripts/verify-webfont-subsets.test.ts
```

⚠️ `verify-webfont-subsets.test.ts` 这个文件名**要确认存在**：

```bash
ls tests/unit/scripts/ | grep -i webfont
```

若不存在，跑实际存在的那个。**不要凭空写一个不存在的路径。**

- [ ] **Step 12: 建 production build 验证**

⚠️ **先停 4444 端口的 dev server**（否则会踩坏 dev 的构建缓存 —— 见 `dev-build-cache-stomp` 记忆）：

```bash
netstat -ano | findstr :4444
```

记下 PID，`taskkill //PID <pid> //F`。

然后：

```bash
npm run build
```

期望：构建成功，且**没有** hydration 警告（`suppressHydrationWarning` 生效了）。

⚠️ **构建时 dev server 必须已停**（上面那条 `taskkill` 就是为此）。构建完起回 dev：

```bash
npm run dev
```

⚠️ **dev server 的日志要重定向到文件**（`dev-turbopack-and-watcher` 记忆）：dev server 的 stdout 会占满管道导致挂起。用后台方式启动，日志写进 `dev-server.log`。

- [ ] **Step 13: 写 `tests/unit/lib/font-css.test.ts` —— 钉住「manifest 与链接一致」**

这是 **Review Focus 第 3 条**（manifest version 与 `?v=` 令牌必须同步）的护栏。**这一步在 Step 12 之后做** —— 因为它要读**新生成的** `public/font/fonts-manifest.json`。

新建 `tests/unit/lib/font-css.test.ts`：

```ts
/**
 * lib/font-css.ts — the stylesheet links the layout renders.
 *
 * The manifest carries the file names and the version; the module turns
 * them into URLs. A mismatch between the two is what serves a stale
 * stylesheet, so it is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import manifest from '@/public/font/fonts-manifest.json';
import { getFontCssLinks } from '@/lib/font-css';

describe('getFontCssLinks', () => {
  it('gives every family a stylesheet that exists on disk', () => {
    const links = getFontCssLinks();
    for (const [name, url] of Object.entries(links)) {
      const path = join(process.cwd(), 'public', url.split('?')[0]);
      expect(existsSync(path), `${name} points at ${url}, which does not exist`).toBe(true);
    }
  });

  it('carries the manifest version on every URL', () => {
    const links = getFontCssLinks();
    for (const url of Object.values(links)) {
      expect(url).toContain(`?v=${manifest.version}`);
    }
  });

  it('gives the sans family a hot tier and an ext tier', () => {
    const links = getFontCssLinks();
    // The hot tier blocks the first paint; the ext tier does not. They
    // are two files, not one — a single stylesheet would put 2458 ext
    // faces in front of every first paint.
    expect(links.sans).toContain('-hot.css');
    expect(links.sansExt).toContain('-ext.css');
    expect(links.sans).not.toBe(links.sansExt);
  });

  it('keeps the manifest and the module in step', () => {
    // The manifest is the single source of truth. If the module hardcodes
    // a file name, the two drift and the browser gets a 404 for a
    // stylesheet the layout waits for.
    const raw = readFileSync(
      join(process.cwd(), 'public', 'font', 'fonts-manifest.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { files: Record<string, string> };
    const links = getFontCssLinks();
    for (const [key, url] of Object.entries(parsed.files)) {
      expect(url).toBe(links[key as keyof typeof links]);
    }
  });
});
```

⚠️ **`lib/font-css.ts` 带 `server-only` 标记** —— 但 `vitest.config.ts` 已经把它 alias 成空模块（第 13 行 `'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js')`），**所以在测试里 import 它没问题**。

⚠️ **这个测试在 Task 2 之前会红**（manifest 里还没有 `sansExt`）—— 它是**本 Task 的验收标准**，不是先于本 Task 就该绿的。

- [ ] **Step 14: 钉住 layout 的结构 —— ext 必须是非阻塞的**

这是 **Review Focus 第 2 条**（ext 区异步 ⇒ 多一个 RTT，滚动快时可能闪系统字）。**这个取舍是刻意的，但它必须被「锁」在代码里** —— 有人哪天把 `media="print"` 去掉，ext 区就会变成阻塞的，608 KB 又回到首屏关键路径上，而没有任何测试会喊。

在 `tests/unit/lib/font-css.test.ts` 里加一个用例（**读 `app/layout.tsx` 的源码**）：

```ts
  it('loads the ext tier without blocking the first paint', () => {
    // The layout is the only place that decides which stylesheet blocks
    // the first paint. Read it as text: rendering the root layout needs
    // a database and a request context, and what matters here is the
    // markup, not the render.
    const layout = readFileSync(
      join(process.cwd(), 'app', 'layout.tsx'),
      'utf8',
    );

    // The hot tier blocks — it draws every glyph of every page.
    expect(layout).toMatch(/<link\s+rel="stylesheet"\s+href=\{fontCss\.sans\}\s*\/>/);

    // The ext tier does not: it carries media="print", and the inline
    // script promotes it once it arrives.
    expect(layout).toContain('href={fontCss.sansExt}');
    expect(layout).toMatch(/href=\{fontCss\.sansExt\}[\s\S]{0,120}media="print"/);
    expect(layout).toContain('ASYNC_STYLESHEET_FLIP');
  });
```

⚠️ **这个用例读源码而不是渲染组件** —— 渲染 `RootLayout` 需要数据库（它调 `getRuntimeSiteUrl()`）和请求上下文（`searchParams`/`params`），**不适合做单测**。读源码是这个取舍的**精确**护栏。

⚠️ **正则里的空白很敏感** —— `href={fontCss.sansExt}` 和 `media="print"` 之间的空白不能超过 120 个字符（JSX 的属性换行）。**先看一眼 layout 里实际的写法再调整这个正则**。若太脆，改成两个独立的断言：

```ts
    const extIndex = layout.indexOf('href={fontCss.sansExt}');
    expect(extIndex).toBeGreaterThan(-1);
    expect(layout.slice(extIndex, extIndex + 200)).toContain('media="print"');
```

**这个版本更稳**，用它。

- [ ] **Step 15: 跑新测试，确认它绿**

```bash
npx vitest run tests/unit/lib/font-css.test.ts
```

期望：PASS，五个用例全绿。

⚠️ **第一个用例是本 Task 最重要的护栏** —— 它验证 manifest 里的每一个文件名**在磁盘上真实存在**。如果 Step 5 忘了加 `sansExt`，或者 Step 10 的流水线没跑，这个用例会**立刻红**。

- [ ] **Step 16: 提交**

```bash
git add -A scripts/fonts public/font lib/font-css.ts app/layout.tsx lib/webfont/apply.ts tests/unit/scripts/webfont-subsets.test.ts tests/unit/lib/font-css.test.ts
git commit -m "perf(fonts): split the sans ext tier out of the render-blocking stylesheet [YYYY-MM-DD HH.MM]"
```

⚠️ **`lib/font-css-flip.ts` 不在提交列表里** —— Step 8 核实过它**不需要改**。
⚠️ **`lib/webfont/apply.ts` 在提交列表里** —— Step 9 的 `STYLESHEETS` 六份改动属于本 Task。
⚠️ **`public/font/fonts-manifest.json` 要进提交** —— 它是生成物，但**必须跟着代码走**，否则新克隆的仓库 `manifest.files.sansExt` 不存在，`getFontCssLinks()` 拿到 `undefined`。

---

### Task 3: `data/classics` 改 gzip 入库

**Files:**
- Create: `scripts/gzip-classics.ts`
- Modify: `.gitignore`（反忽略 `data/classics/*.json.gz`）
- Modify: `DEPLOY.md`
- Test: `tests/unit/scripts/gzip-classics.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `lib/json-fs.ts` 的 `readJsonAuto`（**已经**支持 `.json.gz` 回落，无需改）
- Produces: `npm run classics:gzip` —— 把 `data/classics/*.json` 压成 `*.json.gz` 并删掉裸文件

**背景与约束（执行者必读）:**

仓库里 `data/classics` 占 251 MB，是 `.git` 打包体积（362 MB）的主要来源。发布包**已经**用 `.json.gz`（`scripts/copy-to-up.py` 的 `GZIP_DIRS`），但仓库里是裸 JSON。

读取层**已经准备好了**：
- `lib/json-fs.ts` 的 `readJsonAuto(path)` 先试 `.json`，没有再试 `.json.gz`。
- `lib/classics/loader.ts` 的 `classicFileBytes()` 专门处理 `.gz`-only 部署。

所以**代码零改动**，只改存储形态。

⚠️ **最大的坑**：`.gitignore` 第 62 行有 `*.gz`（给 precompress-assets 的 sidecar 用的）。不反忽略的话，`git add` 会**静默跳过**所有 `.gz` 文件 ⇒ 提交看起来成功，文件却从未入库 ⇒ 下次 clone 又是裸 JSON 缺失 ⇒ **运行时报 404**。这是典型的假成功。

- [ ] **Step 1: 写失败的测试**

新建 `tests/unit/scripts/gzip-classics.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipClassics, decompressClassics } from '@/scripts/gzip-classics';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gzip-classics-'));
  mkdirSync(join(root, 'classics'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('gzipClassics', () => {
  it('writes a .json.gz beside every .json and removes the plain file', () => {
    writeFileSync(join(root, 'classics', 'a.json'), '{"chunks":[{"id":1}]}', 'utf8');
    writeFileSync(join(root, 'classics', 'b.json'), '{"chunks":[{"id":2}]}', 'utf8');

    const result = gzipClassics(root);

    expect(result.compressed).toBe(2);
    expect(existsSync(join(root, 'classics', 'a.json'))).toBe(false);
    expect(existsSync(join(root, 'classics', 'a.json.gz'))).toBe(true);
    expect(existsSync(join(root, 'classics', 'b.json.gz'))).toBe(true);
  });

  it('round-trips the bytes exactly', () => {
    const payload = JSON.stringify({ chunks: [{ id: 1, label: '第一' }] });
    writeFileSync(join(root, 'classics', 'a.json'), payload, 'utf8');

    gzipClassics(root);
    decompressClassics(root);

    expect(readFileSync(join(root, 'classics', 'a.json'), 'utf8')).toBe(payload);
  });

  it('leaves a file that already has a .gz alone', () => {
    writeFileSync(join(root, 'classics', 'a.json'), '{}', 'utf8');
    writeFileSync(join(root, 'classics', 'b.json.gz'), 'not gzip', 'utf8');

    const result = gzipClassics(root);

    // b.json.gz was never a .json, so it is not a candidate at all.
    expect(result.compressed).toBe(1);
    expect(readFileSync(join(root, 'classics', 'b.json.gz'), 'utf8')).toBe('not gzip');
  });
});
```

⚠️ **import 路径**：`@/scripts/gzip-classics` 需要 `scripts/` 在 `@/` 的别名下。`tsconfig.json` 的 `paths` 若只映射 `@/*` → `./*`，则 `@/scripts/gzip-classics` 可用。**先确认**：

```bash
grep -n '"@/\*"' tsconfig.json
```

若是 `"@/*": ["./*"]`，上面的 import 可用。

- [ ] **Step 2: 跑测试，确认它红**

```bash
npx vitest run tests/unit/scripts/gzip-classics.test.ts
```

期望：FAIL，报找不到模块 `scripts/gzip-classics`。

- [ ] **Step 3: 实现 `scripts/gzip-classics.ts`**

```ts
/**
 * gzip-classics — compress data/classics/*.json in place.
 *
 * WHY: the classics corpus is 251 MB of JSON across 196 files, and it is
 * the largest thing in the git repository (the packed repo is 362 MB).
 * The deploy bundle ALREADY ships these files gzipped (see
 * scripts/copy-to-up.py's GZIP_DIRS), and the read path ALREADY falls
 * back to `.json.gz` (see lib/json-fs.ts's readJsonAuto and
 * lib/classics/loader.ts's classicFileBytes) — so the repository is the
 * ONLY place still carrying the uncompressed form.
 *
 * Compressing them in the repository costs nothing at runtime: the reader
 * does the same gunzip it already does for a .gz-only deployment.
 *
 * WHAT IT DOES:
 *   - for every data/classics/*.json, write <name>.json.gz and delete the
 *     plain file
 *   - a file that already has a .json.gz is left untouched
 *   - `decompressClassics` is the inverse, for a machine that wants the
 *     plain files back (a local checkout that diffs the corpus)
 *
 * ⚠️ THE GITIGNORE TRAP: the repository's .gitignore carries a blanket
 * `*.gz` rule (it keeps the precompress-assets sidecars out of git).
 * Without an explicit un-ignore rule, `git add data/classics` silently
 * skips every .json.gz — the commit looks successful and the files are
 * NOT in it. The next clone has no classics at all and the reader falls
 * back to the database, which is empty on a fresh install. .gitignore
 * therefore carries a `!data/classics/*.json.gz` exception, and
 * tests/unit/scripts/gzip-classics.test.ts asserts the rule exists.
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GzipClassicsResult {
  /** How many files were compressed in this run. */
  compressed: number;
  /** The bytes of plain JSON that were replaced. */
  bytesIn: number;
  /** The bytes of gzip that replaced them. */
  bytesOut: number;
}

/** The classics directory of a repository root. */
export function classicsDir(repoRoot: string): string {
  return join(repoRoot, 'data', 'classics');
}

/**
 * Compress every plain .json of the classics directory.
 *
 * @param repoRoot the repository root — the directory that HOLDS data/classics
 * @returns how much was compressed
 */
export function gzipClassics(repoRoot: string): GzipClassicsResult {
  const dir = classicsDir(repoRoot);
  const result: GzipClassicsResult = { compressed: 0, bytesIn: 0, bytesOut: 0 };
  if (!existsSync(dir)) return result;

  const entries = readdirSync(dir).filter((name) => name.endsWith('.json'));
  for (const name of entries) {
    const plainPath = join(dir, name);
    const gzPath = `${plainPath}.gz`;
    // A file that already has its compressed twin is left alone: the
    // compressed twin is the current form, and re-compressing it would
    // need the plain file, which is gone.
    if (existsSync(gzPath)) continue;

    const plain = readFileSync(plainPath);
    const gz = gzipSync(plain, { level: 9 });
    writeFileSync(gzPath, gz);
    rmSync(plainPath);

    result.compressed += 1;
    result.bytesIn += plain.byteLength;
    result.bytesOut += gz.byteLength;
  }
  return result;
}

/**
 * The inverse: expand every .json.gz back into a plain .json.
 *
 * @param repoRoot the repository root — the directory that HOLDS data/classics
 * @returns how many files were expanded
 */
export function decompressClassics(repoRoot: string): number {
  const dir = classicsDir(repoRoot);
  let count = 0;
  if (!existsSync(dir)) return count;

  const entries = readdirSync(dir).filter((name) => name.endsWith('.json.gz'));
  for (const name of entries) {
    const gzPath = join(dir, name);
    const plainPath = gzPath.slice(0, -3);
    if (existsSync(plainPath)) continue;

    const plain = gunzipSync(readFileSync(gzPath));
    writeFileSync(plainPath, plain);
    rmSync(gzPath);
    count += 1;
  }
  return count;
}

/** True when the command was asked to expand rather than compress. */
function wantsDecompress(argv: readonly string[]): boolean {
  return argv.includes('--decompress');
}

function main(): void {
  const repoRoot = process.cwd();
  if (wantsDecompress(process.argv.slice(2))) {
    const count = decompressClassics(repoRoot);
    console.log(`[gzip-classics] expanded ${count} file(s)`);
    return;
  }
  const result = gzipClassics(repoRoot);
  const savedMb = (result.bytesIn - result.bytesOut) / 1024 / 1024;
  console.log(
    `[gzip-classics] compressed ${result.compressed} file(s): ` +
      `${(result.bytesIn / 1024 / 1024).toFixed(1)} MB → ` +
      `${(result.bytesOut / 1024 / 1024).toFixed(1)} MB (saved ${savedMb.toFixed(1)} MB)`,
  );
}

// Only run when invoked directly, so the test can import the functions.
if (require.main === module) {
  main();
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
npx vitest run tests/unit/scripts/gzip-classics.test.ts
```

期望：PASS，3 个用例全绿。

- [ ] **Step 5: 加 `.gitignore` 反忽略规则**（**最容易漏的一步**）

在 `.gitignore` 末尾（`*.gz` 那行下面）加：

```gitignore
# ⚠️ The blanket `*.gz` above keeps the precompress-assets sidecars out of
# git. The classics corpus is the EXCEPTION: it is stored gzipped in the
# repository (251 MB of JSON would otherwise be the largest thing in the
# packed repo). The read path falls back to `.json.gz` — see
# lib/json-fs.ts's readJsonAuto.
# ⚠️ Without this rule `git add data/classics` silently skips every file
# and the commit looks successful while shipping nothing.
!data/classics/*.json.gz
```

⚠️ **gitignore 的规则顺序**：`!` 反忽略必须在 `*.gz` **之后**才生效（同文件内后面的规则优先）。上面就放在末尾，符合。

**验证规则真的生效**：

```bash
git check-ignore -v data/classics/baopuzi-1.json.gz; echo "exit=$?"
```

期望：**没有输出**，且 `exit=1`（1 = 没有被忽略）。如果还有输出，说明规则没生效。

- [ ] **Step 6: 加一条测试，钉住反忽略规则存在**

在 `tests/unit/scripts/gzip-classics.test.ts` 里加：

```ts
it('un-ignores the compressed classics in .gitignore', () => {
  // Without the `!data/classics/*.json.gz` rule the commit looks
  // successful and ships nothing — the hardest failure to notice.
  const ignore = readFileSync(join(root, '..', '..', '..', '.gitignore'), 'utf8');
  expect(ignore).toContain('!data/classics/*.json.gz');
});
```

⚠️ 这个路径依赖仓库布局。更稳的写法是用 `process.cwd()`：

```ts
it('un-ignores the compressed classics in .gitignore', () => {
  const ignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
  expect(ignore).toContain('!data/classics/*.json.gz');
});
```

**先跑一次，确认它红**（因为 `.gitignore` 还没改）：

```bash
npx vitest run tests/unit/scripts/gzip-classics.test.ts
```

期望：FAIL，报 `.gitignore` 里没有那条规则。

然后改 `.gitignore`，再跑，确认它绿。

- [ ] **Step 7: 加 npm script**

`package.json` 的 `scripts` 里加：

```json
"classics:gzip": "tsx scripts/gzip-classics.ts",
```

⚠️ `tsx` **读不到 `.env`**（见 `npm-does-not-read-env-file` 记忆）—— 但这个脚本**不需要环境变量**，所以不用 `--env-file-if-exists=.env`。

- [ ] **Step 8: 真正执行压缩**

```bash
npm run classics:gzip
```

期望输出类似：`[gzip-classics] compressed 196 file(s): 251.0 MB → 38.7 MB (saved 212.3 MB)`

⚠️ **这 38.7 MB 是实测值**（用 Python 的 `gzip.compress(b, 9)` 在全部 196 个文件上跑出来的，不是估算）。Node 的 `gzipSync` 用的是 zlib，压缩率与 Python 的 gzip 基本一致（同一个 DEFLATE 算法），所以实际值会非常接近。

⚠️ **gzip 往返是字节级无损的**（已实测：`gzip.decompress(gzip.compress(b, 9)) == b` 为 True）。所以语料内容**不会**因为压缩而改变。

**验证读取层仍然工作**（这才是关键）：

```bash
ls data/classics/*.json 2>/dev/null | wc -l   # 期望 0
ls data/classics/*.json.gz | wc -l            # 期望 196
npx tsx -e "const { readJsonAuto } = require('./lib/json-fs.ts'); const d = readJsonAuto('data/classics/baopuzi-1.json') as { chunks: Array<{id:number}> }; console.log('chunks:', d.chunks.length, 'first id:', d.chunks[0].id);"
```

期望：`chunks: 35 first id: 1`

⚠️ **这个命令已经实测过**（在压缩之前跑过，输出正是 `chunks: 35 first id: 1`）—— 压缩之后**必须得到同样的输出**，否则说明压缩破坏了数据。

⚠️ **`tsx -e` 里的 `require('./lib/json-fs.ts')` 用的是相对路径** —— 它相对于**当前工作目录**解析（不是相对于 `lib/json-fs.ts` 自己）。所以**必须在仓库根目录跑**。

⚠️ **还要验证一个「看起来不一样但应该一样」的路径**：直接读 `.json.gz` 文件（证明压缩本身无损）：

```bash
npx tsx -e "const { gunzipSync } = require('node:zlib'); const { readFileSync } = require('node:fs'); const d = JSON.parse(gunzipSync(readFileSync('data/classics/baopuzi-1.json.gz')).toString('utf8')); console.log('chunks:', d.chunks.length, 'first id:', d.chunks[0].id, 'title:', d.title);"
```

期望：`chunks: 35 first id: 1 title: 抱朴子·上册`

⚠️ **这个命令现在跑会失败**（`ENOENT`）—— 因为压缩还没做，`data/classics/baopuzi-1.json.gz` **还不存在**。**压缩之后**它才应该成功。

- [ ] **Step 9: 检查 git 是否真的会收这些文件**

```bash
git status --short data/classics | head -5
git add -A data/classics
git status --short data/classics | head -5
```

期望：**第二行有 196 个 `D`（删除裸文件）+ 196 个 `A`（新增 .gz）**。如果 `A` 一行都没有 ⇒ 反忽略规则没生效，**停下**，回到 Step 5。

- [ ] **Step 10: 确认发布包逻辑仍然对**（**已核实，三处都对**）

**① `scripts/copy-to-up.py` 的 `should_gzip()`**（第 167-174 行）：它判断的是**路径**且要求 `endswith('.json')`。源文件现在是 `.json.gz` ⇒ 返回 False ⇒ **不二次压缩，原样复制**。

**这正是想要的** —— 压缩过的数据再压一遍没有意义。

**② `EXCLUDE_FILES`**（第 76-91 行）里**没有 `*.gz`** ⇒ `.gz` 文件**不被排除**。✅

**③ `lib/json-fs.ts` 的 `readJsonAuto`**：Up/ 包里 `readJsonAuto('data/classics/x.json')` → `.json` 不存在 → 试 `.json.gz` → **存在** ⇒ 读到。✅ dev 仓库里同样是 `.json.gz` ⇒ 同样读到。✅

**④ `scripts/audit-gaps.ts` 的 `findMissingRuntimeData`**（第 365-371 行）**已经同时认两种形态**：

```ts
    // A file reference: it may ship plain or gzipped.
    const candidates = [rooted('data', dataPath), rooted('data', `${dataPath}.gz`)];
```

⇒ **Task 3 不会让体检的「runtime data missing from the bundle」这一类变红。** ✅

**跑一次打包验证**：

```bash
python scripts/copy-to-up.py
ls Up/data/classics/ | head -5
```

期望：`Up/data/classics/` 里是 `.json.gz` 文件，**没有** `.json`。

⚠️ 打包后**删掉 `Up/`**（它在 `.gitignore` 里，但会占磁盘）：

```bash
rm -rf Up
```

- [ ] **Step 11: 跑全量测试 + 体检**

```bash
npx vitest run tests/unit/scripts/ tests/unit/lib/
npx tsx scripts/audit-gaps.ts
```

期望：全绿。体检的「runtime data missing from the bundle」这一类**必须仍然是 `(none)`** —— 它检查的就是「运行时需要的数据有没有进发布包」。

⚠️ 如果体检报 `data/classics/*.json` 缺失，说明打包脚本的规则要调（`.gz` 的路径形态变了）。修法：让 `should_gzip()` 认得 `.json.gz` 已经是压缩态（不改行为，只是不再要求源文件是 `.json`）。

- [ ] **Step 12: 提交**

```bash
git add -A .gitignore package.json scripts/gzip-classics.ts tests/unit/scripts/gzip-classics.test.ts data/classics
git commit -m "perf(data): store the classics corpus gzipped so the repository loses 212 MB [YYYY-MM-DD HH.MM]"
```

---

### Task 4: 拆 `lib/webfont/` 的两个超大文件

**Files:**
- Create: `lib/webfont/module-resolution.ts`（从 `capability.ts` 切出）
- Create: `lib/webfont/probes.ts`（从 `capability.ts` 切出）
- Create: `lib/webfont/release-publish.ts`（从 `apply.ts` 切出）
- Modify: `lib/webfont/capability.ts`（995 → 约 400 行）
- Modify: `lib/webfont/apply.ts`（846 → 约 500 行）
- Test: 现有的 8 个 webfont 测试文件（**不得改动任何断言**）

**Interfaces:**
- Consumes: 现有 `lib/webfont/capability.ts` 与 `lib/webfont/apply.ts` 的**全部导出**
- Produces: **所有现有导出保持不变**（`probeCapability`、`resolveFontDir`、`resolveModuleEntry`、`resolveArgv`、`applyStagedBuild`、`countFaceRules`、`rewriteStylesheetUrls`、`manifestVersionOf`、`parsePageCost`、`describeGateFailure`、以及 `CapabilityReport` / `ApplyResult` 等类型）

**背景与约束（执行者必读）:**

`lib/webfont/` 有 10 个文件，其中两个过大：

```
lib/webfont/capability.ts   995 行
lib/webfont/apply.ts        846 行
```

CLAUDE.md 规范是单文件 300-500 行。这两个文件各自聚了多份职责：

`capability.ts` 混了三件事：
1. **模块解析**（`resolveModuleEntry`、`resolveArgv`、`resolveFontDir`、`parsePackageRequest`、`exportCandidates`、`patternCandidates`、`firstExistingFile`、`nodeModulesDirs`、`readPackageManifest`）—— 约 300 行，纯粹是「在 node_modules 里找一个入口文件」的算法
2. **各项探针**（`probePython`、`probeFontTools`、`probeNetwork`、`probeStagingDir`、`checkFontDir`、`probeToolchain`、`probeSources`）—— 约 280 行
3. **编排**（`probeCapability`）—— 约 130 行

`apply.ts` 混了两件事：
1. **纯文本工具**（`countFaceRules`、`rewriteStylesheetUrls`、`manifestVersionOf`、`parsePageCost`、`describeGateFailure`）—— 约 200 行，全是无 I/O 的纯函数
2. **发布动作**（`publishRelease`、`buildCandidate`、`removeCandidate`、`currentLiveReleaseDir`、`registerRelease`、`rollbackRelease`、`supersededReleaseOf`、`applyStagedBuild`）—— 约 600 行

**拆分原则：纯函数留下，副作用留下，编排层留下。**

⚠️ **绝对不能改任何公开导出的签名** —— `app/api/admin/webfonts/*` 和 8 个测试文件都在用。

- [ ] **Step 1: 记录基线 —— 导出清单与测试状态**

```bash
grep -n "^export " lib/webfont/capability.ts lib/webfont/apply.ts
npx vitest run tests/unit/lib/webfont-*.test.ts
```

把导出清单抄下来（这是拆分后的验收基准）。期望：测试全绿。

- [ ] **Step 2: 切 `capability.ts` 的模块解析部分**

新建 `lib/webfont/module-resolution.ts`，把 `capability.ts` 里这些函数**整体搬过去**（连同它们用到的类型定义与 import）：

```
resolveFontDir            (line 217)
readPackageManifest       (line 252)
nodeModulesDirs           (line 265)
parsePackageRequest       (line 289)
exportCandidates          (line 315)
patternCandidates         (line 356)
firstExistingFile         (line 382)
resolveFromManifest       (line 399)
resolveModuleEntry        (line 441)
resolveBinEntry           (line 473)
resolveExecutable         (line 504)
resolveArgv               (line 536)
```

以及它们依赖的辅助：

```
appRoot                   (line 189)
findAppRoot               (line 193)
```

`capability.ts` 改为从新文件 import 并 re-export：

```ts
export {
  resolveFontDir,
  resolveModuleEntry,
  resolveArgv,
} from './module-resolution';
```

⚠️ **re-export 而非改调用方**：这样 `import { resolveModuleEntry } from '@/lib/webfont/capability'` 的现有代码（含测试）**一行都不用改**。

⚠️ `resolveFontDir` 有个同名函数在 `lib/webfont/paths.ts` 里（`LIVE_FONT_DIR`）—— **不要混淆**，本任务搬的是 `capability.ts` 里那个（它读 `WEBFONT_FONT_DIR` 环境变量）。搬之前先确认两者的区别：

```bash
grep -n "resolveFontDir" lib/webfont/paths.ts lib/webfont/capability.ts lib/webfont/*.ts
```

⚠️ `capability.ts` 里 `resolveFontDir` 的默认参数是 `root: string = appRoot()` —— `appRoot` 也必须一起搬。

- [ ] **Step 3: 跑测试，确认没坏**

```bash
npx vitest run tests/unit/lib/webfont-capability.test.ts
npx tsc --noEmit
```

期望：全绿。

- [ ] **Step 4: 切 `capability.ts` 的探针部分**

新建 `lib/webfont/probes.ts`，把这些搬过去：

```
pythonBin                  (line 170)
defaultRunCommand          (line 549)
firstLine                  (line 578)
describeFailure            (line 586)
parsePythonVersion         (line 594)
probePython                (line 610)
probeFontTools             (line 643)
readFontToolsVersion       (line 674)
probeNetwork               (line 690)
probeFileName              (line 724)
probeStagingDir            (line 751)
checkFontDir               (line 795)
probeToolchain             (line 805)
resolveSafely              (line 824)
probeSources               (line 841)
hostOf                     (line 855)
```

以及类型 `CommandResult`、`RunCommand`、`PythonOutcome`、`FontToolsOutcome`。

`capability.ts` 只留编排：

```ts
import { probePython, probeFontTools, probeNetwork, probeToolchain, probeSources } from './probes';

export async function probeCapability(opts: ProbeOptions = {}): Promise<CapabilityReport> {
  const fontDir = resolveFontDir(opts.fontDir);
  const python = await probePython(opts);
  const fontTools = python.ok
    ? await probeFontTools(python.bin, opts)
    : { ok: false as const, version: null, detail: 'python unavailable' };
  const network = await probeNetwork(opts);
  const toolchain = await probeToolchain(python, fontTools, opts);
  const sources = await probeSources(opts);
  const fontDirCheck = checkFontDir(fontDir);
  return {
    fontDir,
    fontDirOk: fontDirCheck.ok,
    fontDirDetail: fontDirCheck.detail,
    python,
    fontTools,
    network,
    toolchain,
    sources,
    ok: python.ok && fontTools.ok && network.ok && toolchain.ok && sources.ok && fontDirCheck.ok,
  };
}
```

⚠️ **字段名必须和现有的 `CapabilityReport` 完全一致** —— 先把 `lib/webfont/capability.ts` 第 59-89 行的接口定义抄下来，逐字段对上。上面的形状是**示意**，以真实接口为准。

⚠️ **不要让 `probes.ts` 从 `capability.ts` import 任何东西** —— 那会形成 `capability.ts → probes.ts → capability.ts` 的循环 import。**TypeScript 的类型级循环 import 是允许的**（编译期会被擦除），但**运行时的循环 import 可能拿到 `undefined`**。

⚠️ **`resolveFontDir` 与 `checkFontDir` 留在 `capability.ts`**（它们是路径解析，不是探针）。`probes.ts` 需要 `fontDir` 时，**由 `capability.ts` 解析后作为参数传进去** —— 探针函数的签名里带 `fontDir: string`，探针自己不去解析路径。

⚠️ **类型也要挪出去** —— `CapabilityReport` 是 `probes.ts` 的返回类型，如果它留在 `capability.ts`，`probes.ts` 就得 import `capability.ts` ⇒ 又回到循环。新建 `lib/webfont/types.ts`，两个文件都从那里 import：

```ts
// lib/webfont/types.ts
export interface CapabilityReport {
  // ← 从 lib/webfont/capability.ts 第 59-89 行**逐字段原样搬过来**，
  //   不要改字段名、不要改可选性、不要加新字段。
  [把真实字段列在这里]
}

export interface CommandResult {
  // ← 从 lib/webfont/capability.ts 第 90-96 行原样搬过来。
  [把真实字段列在这里]
}

export type RunCommand = (bin: string, args: string[]) => Promise<CommandResult>;
```

⚠️ **这一段不要凭记忆写** —— 执行者打开 `lib/webfont/capability.ts` 看第 59-96 行，把真实定义**剪切**过来。计划只保证「搬过去、名字不变」，不保证「内容是这几行」。

⚠️ **搬完之后**，`capability.ts` 里原来的接口定义要**删掉**（不能两处都有），改成：

```ts
export type { CapabilityReport, CommandResult, RunCommand } from './types';
```

⇒ 公开导出路径不变（`import { CapabilityReport } from '@/lib/webfont/capability'` 仍然可用），但 `tsc` 用的是 `export type`，运行时不存在这个导出 —— 所以类型只能被**类型位置**使用。如果有代码在运行时读 `CapabilityReport`（不可能，但要用 grep 确认），那就改成 `export { }` 的值导出。

⚠️ **先确认 `CapabilityReport` 的定义边界**（line 59-89），把 `CommandResult`（line 90-96）和 `RunCommand`（line 97）一起搬 —— `RunCommand` 也是 `CommandResult` 的依赖，不能漏。

- [ ] **Step 5: 跑测试**

```bash
npx vitest run tests/unit/lib/webfont-capability.test.ts tests/unit/lib/webfont-schema-errors.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: 切 `apply.ts` 的纯文本工具**

新建 `lib/webfont/release-text.ts`，把这些搬过去：

```
countFaceRules             (line 230)
rewriteStylesheetUrls      (line 253)
manifestVersionOf          (line 282)
parsePageCost              (line 300)
toNumberRecord             (line 325)
findPageCostLine           (line 336)
extractFindings            (line 350)
describeGateFailure        (line 369)
```

⚠️ **`parsePageCost` 有同名函数在 `lib/webfont/pipeline.ts:362`** —— 两处都存在。搬的时候**只搬 `apply.ts` 里那份**，并且 `apply.ts` 改成 import 它：

```ts
import { parsePageCost } from './release-text';
```

⚠️ 但 `apply.ts` 现在**导出** `parsePageCost` ⇒ 公开导出不能少。改法：

```ts
export { parsePageCost } from './release-text';
```

⚠️ **`parsePageCost` 有 TWO implementations —— 不要合并它们**：

| 位置 | 签名 | 归谁管 |
|---|---|---|
| `lib/webfont/apply.ts:300` | `parsePageCost(stdout: string): PageCostReport \| null` | 搬去 `release-text.ts` |
| `lib/webfont/pipeline.ts:362` | `parsePageCost(stdout: string): PageCostReport \| null` | **不动**，留在 `pipeline.ts` |

两者签名相同但**实现不同**（`pipeline.ts` 那份有自己的 `toPageCostReport` 转换函数，在第 382 行）。它们服务于流水线的不同阶段。**保守做法：保持两份各自独立，本 Task 只搬 `apply.ts` 那份。** `PageCostReport` 类型来自 `@/scripts/fonts/verify-webfont-subsets.d.mts` —— 新文件照抄这个 import。

⚠️ **Task 2 已经改过 `apply.ts` 的 `STYLESHEETS`**（第 84 行，六份样式表）。拆分时**那处改动要跟着走到新文件**，别漏。

- [ ] **Step 7: 跑测试**

```bash
npx vitest run tests/unit/lib/webfont-apply.test.ts tests/unit/lib/webfont-pipeline.test.ts
npx tsc --noEmit
```

- [ ] **Step 8: 切 `apply.ts` 的发布动作**

新建 `lib/webfont/release-publish.ts`，把这些搬过去：

```
publishRelease             (line 436)
buildCandidate             (line 494)
removeCandidate            (line 541)
currentLiveReleaseDir      (line 551)
supersededReleaseOf        (line 796)
registerRelease            (line 811)
rollbackRelease            (line 843)
```

⚠️ `applyStagedBuild`（line 572）是**编排层**，留在 `apply.ts`。它调用上面这些函数 ⇒ 从新文件 import。

⚠️ `registerRelease` / `rollbackRelease` 与 `lib/webfont/releases.ts` 有关联 —— 检查它们是否重复定义了 `releases.ts` 里的东西：

```bash
grep -n "^export " lib/webfont/releases.ts
```

`releases.ts` 已经有 `readReleases`、`writeReleases`、`markSuperseded`、`planCleanup`、`canCleanReleases`、`releaseBytesOnDisk`、`removeReleaseDirs`。**`apply.ts` 的 `registerRelease`/`rollbackRelease` 是 apply 专用的编排**，不重复，搬过去即可。

- [ ] **Step 9: 跑测试**

```bash
npx vitest run tests/unit/lib/webfont-apply.test.ts tests/unit/lib/webfont-releases.test.ts
npx tsc --noEmit
```

- [ ] **Step 10: 确认行数达标**

```bash
wc -l lib/webfont/*.ts
```

期望：
- `capability.ts` ≤ 450 行
- `apply.ts` ≤ 450 行
- 新文件每个 ≤ 450 行

- [ ] **Step 11: 确认公开导出一个都没少**（**用测试钉住，不靠肉眼**）

肉眼比对清单会漏。**写一个测试**，它把拆分前的导出清单**当作快照**记下来：

新建 `tests/unit/lib/webfont-exports.test.ts`：

```ts
/**
 * lib/webfont — the public surface.
 *
 * The webfont cluster was split by responsibility (capability probing,
 * module resolution, release publishing). The split must NOT change what
 * the module exports: `app/api/admin/webfonts/*` and the other test files
 * import these names, and a renamed export breaks them at runtime, not
 * at compile time, when the import is a type-only one.
 */
import { describe, it, expect } from 'vitest';

import * as capability from '@/lib/webfont/capability';
import * as apply from '@/lib/webfont/apply';

describe('lib/webfont — the public exports', () => {
  it('exports the capability surface', () => {
    for (const name of [
      'resolveFontDir',
      'resolveModuleEntry',
      'resolveArgv',
      'probeCapability',
    ]) {
      expect(typeof (capability as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });

  it('exports the apply surface', () => {
    for (const name of [
      'countFaceRules',
      'rewriteStylesheetUrls',
      'manifestVersionOf',
      'parsePageCost',
      'describeGateFailure',
      'applyStagedBuild',
    ]) {
      expect(typeof (apply as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });
});
```

⚠️ **类型导出（`CapabilityReport` / `ApplyResult` 等）在运行时不存在** —— 所以这个测试只查**值导出**（函数）。类型的一致性由 `tsc --noEmit` 保证。

⚠️ **这个测试在拆分之前就该是绿的** —— 它是**护栏**，不是新行为的测试。**拆分之后必须仍然是绿的**；如果某个导出在拆分中丢了，这个测试立刻红。

**同时做一次人工比对**（测试覆盖不到「导出被改名」的情况，只覆盖「导出消失」）：

```bash
grep -n "^export " lib/webfont/capability.ts lib/webfont/apply.ts
```

与 Step 1 抄下的清单**逐条比对**。少一个就是回归。

- [ ] **Step 12: 跑全量 webfont 测试 + 体检**

```bash
npx vitest run tests/unit/lib/ tests/unit/scripts/
npx tsx scripts/audit-gaps.ts
npx eslint .
```

⚠️ eslint 可能报「`capability.ts` 里 import 了但没用」—— 那说明有函数搬错了地方。**不许用 eslint-disable 掩盖**，改代码。

- [ ] **Step 13: 提交**

```bash
git add -A lib/webfont tests/unit/lib/
git commit -m "refactor(webfont): split the capability probe and the release publisher by responsibility [YYYY-MM-DD HH.MM]"
```

---

### Task 5: 删死代码 + 修 audio 删文件的静默吞错

**Files:**
- Modify: `lib/audio-tracks.ts`（删 `getActiveTrack`）
- Delete: `app/api/audio/active/route.ts`
- Modify: `app/api/admin/audio/[id]/route.ts`（`unlink` 加日志）
- Modify: `lib/audio-tracks.ts`（`deleteTrack` 前检查文件名合法性）
- Test: `tests/unit/app/api/admin/audio-delete.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `deleteTrack(id): Promise<{ filename: string } | null>`
- Produces: `deleteTrack` 的语义收紧 —— 拒绝删除文件名不是 `<数字>.mp3` 的行

**背景与约束（执行者必读）:**

两件事：

**(a) 死代码。** `lib/audio-tracks.ts:77` 的 `getActiveTrack()` 和 `app/api/audio/active/route.ts` **零调用方**（`grep -rn` 全仓确认）。后者还是**公开无鉴权**的接口（返回默认播放列表）。留着的代价是一个无鉴权的信息面 + 死代码。

⚠️ **但 `getActivePlaylist()`（`lib/playlists.ts:113`）是 `getActiveTrack` 的兄弟**，只有 `/api/audio/active` 调它。删掉路由后 `getActivePlaylist` 也变成零调用方 —— **一并删掉**，否则只是把死代码挪了个地方。

⚠️ **前端播放器与后台曲目系统是脱节的**（已确认）：`components/sutra/SutraAudioPlayer.tsx` 走 `/api/tts`，`app/api/audio/active` 无人调用。所以删掉不会破坏任何功能。

**(b) 真缺陷。** `app/api/admin/audio/[id]/route.ts:69` 的 `unlink` 把**所有** fs 错误吞掉：

```ts
    try {
      await unlink(filePath);
    } catch {
      // swallow ENOENT and other fs errors
    }
```

ENOENT（文件已不在）是正常的，但 `EACCES`/`EPERM`/`EISDIR` 不是 —— 它们意味着**磁盘上的文件留下了**，而 DB 里的行已经删了 ⇒ 孤儿文件永久堆积，且没有任何日志。

⚠️ **顺带一个路径安全点**：`join(AUDIO_DIR, removed.filename)` —— `removed.filename` 来自数据库。如果 DB 里有一行 `filename = '../../.env'`，这个 `unlink` 会删到 `public/audio/` 外面去。文件名是上传时写的（`<id>.mp3`），但 `deleteTrack` 不做任何校验就把它交给 `unlink`。**加一道白名单校验。**

- [ ] **Step 1: 写失败的测试**

新建 `tests/unit/app/api/admin/audio-delete.test.ts`（**放在 `admin/` 目录下，与 `font-config.test.ts` / `webfonts.test.ts` 同级**）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const unlinkMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/audio-tracks', () => ({
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
  deleteTrack: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
}));

import { DELETE } from '@/app/api/admin/audio/[id]/route';
import { requireAdmin } from '@/lib/auth';
import { deleteTrack } from '@/lib/audio-tracks';
import { writeAudit } from '@/lib/audit';

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedDeleteTrack = vi.mocked(deleteTrack);
const mockedWriteAudit = vi.mocked(writeAudit);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
  mockedWriteAudit.mockResolvedValue(undefined);
});

function del(id: number): NextRequest {
  return new NextRequest(`http://localhost/api/admin/audio/${id}`, { method: 'DELETE' });
}

describe('DELETE /api/admin/audio/[id]', () => {
  it('removes the file of a deleted track', async () => {
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    unlinkMock.mockResolvedValue(undefined);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(String(unlinkMock.mock.calls[0][0])).toContain('7.mp3');
  });

  it('does not fail the request when the file is already gone', async () => {
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    unlinkMock.mockRejectedValue(enoent);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(200);
  });

  it('logs a failure that is not ENOENT', async () => {
    // The row is gone but the file is still on disk: an orphan that will
    // never be cleaned up. That has to leave a trace.
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    unlinkMock.mockRejectedValue(eacces);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

      // The request still succeeds — the row IS gone.
      expect(res.status).toBe(200);
      // But the failure was reported.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('EACCES');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not touch the disk when the row was not deleted', async () => {
    // `deleteTrack` returns null for a row it refused to delete — a row
    // whose filename is not the `<id>.mp3` this module writes. Nothing may
    // be unlinked in that case: the name might point outside public/audio.
    mockedDeleteTrack.mockResolvedValue(null);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(404);
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
```

⚠️ **第三个用例（`logs a failure that is not ENOENT`）是本 Task 的核心新行为** —— 现在的代码全吞，所以它**会红**。

⚠️ **第四个用例是安全护栏** —— 它验证「`deleteTrack` 返回 null 时绝不 unlink」。这依赖 Task 5 Step 3 里的白名单校验（在 `deleteTrack` 内部拒绝，而不是在路由里判断）。

⚠️ **第三个用例的 `console.error` 必须 spy 掉**，否则测试输出会有噪音。

⚠️ **ENOENT 用例（第二个）现在就能通过** —— 现在的代码就是全吞。它是**回归护栏**，不是新行为。

- [ ] **Step 2: 跑测试，确认它红**

```bash
npx vitest run tests/unit/app/api/admin/audio-delete.test.ts
```

期望：至少第三个用例 FAIL（现在的代码会调 `unlink('../../.env')`）。

- [ ] **Step 3: 改 `lib/audio-tracks.ts` 的 `deleteTrack`**

现在的（第 161-170 行）：

```ts
export async function deleteTrack(id: number): Promise<{ filename: string } | null> {
  const [rows] = await getPool().query<AudioTrackNameRow[]>(
    `SELECT filename FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  await getPool().query(`DELETE FROM audio_tracks WHERE id = ?`, [id]);
  return { filename: rows[0].filename };
}
```

改成：

```ts
/**
 * The file name of a track, in the one shape the upload route writes:
 * `<id>.mp3`.
 *
 * It is a WHITELIST, not a sanitiser. The caller hands the name to
 * `unlink(join(AUDIO_DIR, name))`, and a name like `../../.env` would
 * resolve outside the audio directory — so the check is "does it look
 * exactly like what we write", not "does it look safe enough".
 */
const TRACK_FILENAME_PATTERN = /^\d+\.mp3$/;

/** True when a stored filename is one this module wrote. */
export function isTrackFilename(filename: string): boolean {
  return TRACK_FILENAME_PATTERN.test(filename);
}

export async function deleteTrack(id: number): Promise<{ filename: string } | null> {
  const [rows] = await getPool().query<AudioTrackNameRow[]>(
    `SELECT filename FROM audio_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;

  const filename = rows[0].filename;
  // A row whose filename is not one we wrote is bad data. Deleting it
  // would either leave an orphan file (the name does not point at one)
  // or — worse — let a hand-edited row make the server unlink a file
  // outside public/audio. Refuse, and let the caller report it.
  if (!isTrackFilename(filename)) return null;

  await getPool().query(`DELETE FROM audio_tracks WHERE id = ?`, [id]);
  return { filename };
}
```

⚠️ **`isTrackFilename` 也要有直接的单元测试** —— 路由测试只验证「`deleteTrack` 返回 null 时不 unlink」，**验证不了白名单本身**。新建 `tests/unit/lib/audio-tracks-filename.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isTrackFilename } from '@/lib/audio-tracks';

describe('isTrackFilename', () => {
  it('accepts the one shape the upload route writes', () => {
    expect(isTrackFilename('7.mp3')).toBe(true);
    expect(isTrackFilename('0.mp3')).toBe(true);
    expect(isTrackFilename('123.mp3')).toBe(true);
  });

  it('rejects a name that would resolve outside the audio directory', () => {
    expect(isTrackFilename('../../.env')).toBe(false);
    expect(isTrackFilename('../secrets.txt')).toBe(false);
    expect(isTrackFilename('/etc/passwd')).toBe(false);
    expect(isTrackFilename('sub/dir/7.mp3')).toBe(false);
  });

  it('rejects a name that is not an mp3 this module wrote', () => {
    expect(isTrackFilename('7.wav')).toBe(false);
    expect(isTrackFilename('7')).toBe(false);
    expect(isTrackFilename('seven.mp3')).toBe(false);
    expect(isTrackFilename('7.mp3.gz')).toBe(false);
    expect(isTrackFilename('')).toBe(false);
  });
});
```

⚠️ **`@/lib/audio-tracks` 的 import 会拉进 `lib/db.ts`**（它 `import { getPool } from '@/lib/db'`）—— **已核实**：

- `lib/db.ts` 的 `getPool()` 是**惰性**的（`if (pool) return pool;` → 不调用就不建池），而且**没有** `server-only` 标记 ⇒ import 时**不碰数据库**。
- `lib/audio-tracks.ts` 也**没有** `server-only` 标记 ⇒ 在普通 vitest 环境里 import 它**不会抛**。

⇒ 测试可以**直接 import**，不需要 mock db。但为了不让这个测试在将来某个版本里意外连上真实数据库，**仍然加上这个 mock**（它不依赖 `lib/db.ts` 的实现细节）：

```ts
import { describe, it, expect, vi } from 'vitest';

// The module under test imports the db module; the pool is lazy, but
// mocking it keeps this test from ever touching a database.
vi.mock('@/lib/db', () => ({ getPool: vi.fn() }));

import { isTrackFilename } from '@/lib/audio-tracks';
```

- [ ] **Step 4: 改 `app/api/admin/audio/[id]/route.ts` 的 `unlink`**

现在的：

```ts
    // Best-effort unlink — don't fail the request if file is already gone.
    const filePath = join(AUDIO_DIR, removed.filename);
    try {
      await unlink(filePath);
    } catch {
      // swallow ENOENT and other fs errors
    }
```

改成：

```ts
    // The file is removed on a best-effort basis: the row is gone either
    // way, and a failure here must not fail the request.
    //
    // But the failure is NOT silent. ENOENT means the file was already
    // gone — fine, nothing to do. Any other error (EACCES, EPERM, EISDIR)
    // means the file is still on disk while its row is gone: an orphan
    // that will never be cleaned up. That is worth a line in the log.
    const filePath = join(AUDIO_DIR, removed.filename);
    try {
      await unlink(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error(
          `[admin.audio.delete] could not remove ${filePath}: ${code ?? 'unknown error'} — ` +
            'the row is gone but the file is still on disk',
        );
      }
    }
```

⚠️ `console.error` 是 eslint 允许的（`no-console` 只禁 `log`）。

- [ ] **Step 5: 删死代码**

**(a) 删 `lib/audio-tracks.ts` 的 `getActiveTrack`**

先看它长什么样，以及 `ActiveAudioTrack` 类型是否只服务于它：

```bash
grep -n "getActiveTrack\|ActiveAudioTrack" lib/audio-tracks.ts
```

把 `getActiveTrack` 函数和只服务于它的类型一起删掉。

**(b) 删 `app/api/audio/active/route.ts`**

```bash
rm app/api/audio/active/route.ts
rmdir app/api/audio 2>/dev/null || true
```

⚠️ `app/api/audio/` 目录下只有这一个文件 ⇒ 删掉后目录空了就一并删。

**(c) 删 `lib/playlists.ts` 的 `getActivePlaylist`**

```bash
grep -rn "getActivePlaylist" app lib components --include=*.ts --include=*.tsx
```

确认只剩 `lib/playlists.ts` 里的定义本身（`/api/audio/active` 已被删）⇒ 删掉它和只服务于它的类型。

⚠️ `PlaylistWithTracks` 类型可能还被别处用：

```bash
grep -rn "PlaylistWithTracks" app lib components --include=*.ts --include=*.tsx
```

只在 `lib/playlists.ts` 里用才删。

- [ ] **Step 6: 跑测试，确认全绿**

```bash
npx vitest run tests/unit/app/api/admin/audio-delete.test.ts tests/unit/lib/
npx tsc --noEmit
```

- [ ] **Step 7: 确认没有残留引用**（**用测试钉住，不靠 grep**）

**这是 Review Focus 第 5 条**：`/api/audio/active` 是个**公开无鉴权**的端点。删掉它之后，必须保证**没有人再接上它** —— 接上就等于重新开一个无鉴权面。

新建 `tests/unit/lib/audio-active-removed.test.ts`：

```ts
/**
 * The public audio route is gone.
 *
 * `/api/audio/active` answered, without authentication, "what is the
 * default playlist" — a public information surface nobody called. It was
 * removed because the sutra player uses `/api/tts`, not this route.
 *
 * The route must STAY removed. If somebody wires a client back to it,
 * they get an unauthenticated endpoint again — so the reference is
 * pinned here rather than left to a grep someone remembers to run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every source file of the app, as absolute paths. */
function sourceFiles(): string[] {
  const found: string[] = [];
  for (const dir of ['app', 'lib', 'components', 'scripts']) {
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
      }
    };
    const absolute = join(ROOT, dir);
    if (existsSync(absolute)) walk(absolute);
  }
  return found;
}

describe('the public audio route stays removed', () => {
  it('has no route file', () => {
    expect(existsSync(join(ROOT, 'app', 'api', 'audio'))).toBe(false);
  });

  it('is not referenced by any source file', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8');
      if (text.includes('api/audio/active') || text.includes('getActiveTrack')) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

⚠️ **`statSync` 没有用到** —— 去掉那个 import。

⚠️ **这个测试会扫整个 `app`/`lib`/`components`/`scripts`** —— 在大仓库上跑要一点时间（几百个文件），但仍在秒级。

⚠️ **`getActiveTrack` 也在检查名单里** —— 因为 `lib/audio-tracks.ts` 里那个函数本身也要删。**如果只删函数不删路由，或反过来，都会被这个测试抓住。**

**同时做一次人工确认**（测试扫的是 `.ts`/`.tsx`，不扫 `.md` 文档）：

```bash
grep -rn "getActiveTrack\|getActivePlaylist\|api/audio/active" app lib components scripts --include=*.ts --include=*.tsx
```

期望：**空**。

⚠️ 用 **Python** 确认（Windows 下 `grep -P` 对多字节可能假阴性，见 `windows-multibyte-grep-false-negative` 记忆）：

```bash
python -c "
import os,re
pat = re.compile(r'getActiveTrack|getActivePlaylist|api/audio/active')
hits=[]
for root in ('app','lib','components','scripts'):
    for dp,_,fs in os.walk(root):
        for f in fs:
            if f.endswith(('.ts','.tsx')):
                p=os.path.join(dp,f)
                s=open(p,encoding='utf-8').read()
                if pat.search(s): hits.append(p)
print(hits or 'NO RESIDUAL REFERENCES')
"
```

- [ ] **Step 8: 提交**

```bash
git add -A app lib tests/
git commit -m "fix(audio): refuse an unsafe track filename and stop swallowing the unlink error [YYYY-MM-DD HH.MM]"
```

---

### Task 6: 章节号约定的体检断言

**Files:**
- Modify: `scripts/audit-gaps.ts`（新增第七类 `chapterIdDrift`）
- Test: `tests/unit/scripts/audit-gaps.test.ts`（新增用例）

**Interfaces:**
- Consumes: 现有 `auditGaps(): GapReport` 与 `GapReport` 接口
- Produces: `GapReport.chapterIdDrift: ChapterIdDrift[]`，其中 `ChapterIdDrift = { file: string; kind: 'classics' | 'sutras'; index: number; expected: number; actual: number }`

**背景与约束（执行者必读）:**

两套章号约定并存：

| 数据 | 约定 | 验证 |
|---|---|---|
| `data/classics/*.json` | **1-based**（`id == 下标 + 1`） | 196/196 文件符合 |
| `data/sutras/*.json` | **0-based**（`id == 下标`） | 11/11 文件符合 |

对齐靠**三处手工换算**：
- `components/classics/ClassicChunkPicker.tsx:22` —— `?chunk=${c.id - 1}`
- `components/classics/ClassicChunkPicker.tsx:42` —— `?chunk=${Number(e.target.value) - 1}`
- `app/ancient/[slug]/page.tsx:61` —— `audioChunks = chunkMeta.map((c, i) => ({ id: i, ... }))`

我用 `baopuzi-1.json`（35 章）逐个验过，**两条链路当前全部命中正确**。但这是**巧合性正确** —— 换一批数据或新增一个入口忘了减 1，就会静默错位一章（不是报错，是跳到错误的章节）。

体检要做的：**把约定钉在数据里**，让任何偏离立刻在 `audit-gaps.ts` 里报出来。

⚠️ **这个体检必须能变红**（`Review Focus` 第 6 条）—— 一个永远绿的体检比没有体检更坏。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/scripts/audit-gaps.test.ts` 里加。**该文件已有现成的脚手架**，直接用：

- `write(relativePath, content)` —— 往临时仓库里写一个文件（会自动建父目录）
- `setAuditRoot(workDir)` —— 已经在 `beforeEach` 里调过了，**测试体里不用再调**
- `restoreRoot()` —— 已经在 `afterEach` 里调过了，**测试体里不用再调**

⇒ **不要自己造 `makeRoot` / 手动 `try...finally`** —— 现有约定就是用 `write()` + `beforeEach` 已设好的 root。

先在文件顶部的 import 列表里加上要测的函数：

```ts
import {
  scriptNeedsDatabase,
  findScriptEnvGaps,
  findBrokenScriptReferences,
  findMissingNpmScriptTargets,
  findUnrunnableDocCommands,
  findMissingRuntimeData,
  findDocDrift,
  findChapterIdDrift,
  setAuditRoot,
} from '@/scripts/audit-gaps';
```

然后在文件末尾加：

```ts
describe('audit-gaps — the chapter id convention', () => {
  it('reports a classics file whose chunk id is not the index plus one', () => {
    // The classics corpus is ONE-based: the first chapter is 1.
    write(
      'data/classics/broken.json',
      JSON.stringify({
        slug: 'broken',
        title: '断',
        chunks: [
          { id: 1, label: '一' },
          { id: 2, label: '二' },
          { id: 5, label: '五' }, // should be 3
        ],
      }),
    );

    const drift = findChapterIdDrift();

    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe('classics');
    expect(drift[0].index).toBe(2);
    expect(drift[0].expected).toBe(3);
    expect(drift[0].actual).toBe(5);
    expect(drift[0].file).toContain('broken.json');
  });

  it('reports a sutras file whose chunk id is not the index', () => {
    // The sutras corpus is ZERO-based, and its files are a TOP-LEVEL ARRAY
    // — not an object with a `chunks` key.
    write(
      'data/sutras/broken.json',
      JSON.stringify([
        { id: 0, label: '甲' },
        { id: 7, label: '乙' }, // should be 1
      ]),
    );

    const drift = findChapterIdDrift();

    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe('sutras');
    expect(drift[0].index).toBe(1);
    expect(drift[0].expected).toBe(1);
    expect(drift[0].actual).toBe(7);
  });

  it('reports nothing for a corpus that follows the convention', () => {
    write(
      'data/classics/good.json',
      JSON.stringify({
        slug: 'good',
        title: '好',
        chunks: [
          { id: 1, label: '一' },
          { id: 2, label: '二' },
        ],
      }),
    );
    write(
      'data/sutras/good.json',
      JSON.stringify([
        { id: 0, label: '甲' },
        { id: 1, label: '乙' },
      ]),
    );

    expect(findChapterIdDrift()).toEqual([]);
  });

  it('ignores the sutras manifest, which is an index and not a chapter file', () => {
    write(
      'data/sutras/manifest.json',
      JSON.stringify({ version: 1, generatedAt: '2026-01-01', items: [{ id: 99 }] }),
    );

    expect(findChapterIdDrift()).toEqual([]);
  });
});
```

⚠️ **第四个用例是必要的**：`data/sutras/manifest.json` 是**对象**（不是数组），而且它的 `items` 里带着自己的 id 字段。**若不显式跳过它**，一个「顶层数组才检查」的规则会自然跳过它（对象不是数组）—— 但**万一将来 manifest 改成数组**，它就会误报。这个用例把「跳过 manifest」钉成显式行为。

- [ ] **Step 2: 跑测试，确认它红**

```bash
npx vitest run tests/unit/scripts/audit-gaps.test.ts
```

期望：FAIL，报 `findChapterIdDrift is not a function`（或 import 失败）。

- [ ] **Step 3: 实现 `findChapterIdDrift`**

在 `scripts/audit-gaps.ts` 里加：

```ts
/**
 * A chapter whose id does not match the convention its corpus follows.
 *
 * The two corpora use DIFFERENT conventions, on purpose:
 *
 *   data/classics/*.json   one-based   — the id equals the array index
 *                                           plus one, so the first chapter
 *                                           is 1.
 *   data/sutras/*.json     zero-based  — the id equals the array index.
 *
 * The read paths line up with those conventions:
 *   - lib/classics/queries.ts's parseChunks uses `c.id ?? i + 1`
 *   - lib/sutras.ts's normalizeChunks uses `id: i`
 *
 * And the URLs that address a chapter use the ARRAY INDEX:
 *   - app/ancient/[slug]/page.tsx reads `?chunk=N` and indexes with N
 *   - components/classics/ClassicChunkPicker.tsx converts a chunk id
 *     into that index with `c.id - 1` (twice)
 *
 * So the convention is only correct as long as every one of those
 * conversions stays in step. A regenerated corpus that changed its
 * convention, or a new entry point that forgot the `-1`, would shift every
 * chapter by one — SILENTLY, because a chapter id that is off by one is
 * still a valid id.
 *
 * This rule pins the convention to the data, so a drift is reported
 * instead of shipped.
 */
export interface ChapterIdDrift {
  /** The file, relative to the audit root. */
  file: string;
  /** Which corpus the file belongs to. */
  kind: 'classics' | 'sutras';
  /** The array index of the offending chunk. */
  index: number;
  /** The id the convention requires at that index. */
  expected: number;
  /** The id the file actually carries. */
  actual: number;
}

/**
 * The id the convention of a corpus requires at an array index.
 *
 * classics is one-based, sutras is zero-based.
 */
function expectedChapterId(kind: 'classics' | 'sutras', index: number): number {
  return kind === 'classics' ? index + 1 : index;
}

export function findChapterIdDrift(): ChapterIdDrift[] {
  const drift: ChapterIdDrift[] = [];

  const check = (kind: 'classics' | 'sutras', relPath: string, chunks: unknown[]) => {
    chunks.forEach((chunk, index) => {
      if (!chunk || typeof chunk !== 'object') return;
      const id = (chunk as { id?: unknown }).id;
      // A chunk without an id is fine: the reader falls back to the
      // index (`c.id ?? i + 1` / `id: i`).
      if (typeof id !== 'number') return;
      const expected = expectedChapterId(kind, index);
      if (id !== expected) {
        drift.push({
          file: relPath,
          kind,
          index,
          expected,
          actual: id,
        });
      }
    });
  };

  // classics 的形状是对象 { chunks: [...] }；sutras 的形状是顶层数组
  const classicsDir = rooted('data', 'classics');
  if (existsSync(classicsDir)) {
    for (const name of readdirSync(classicsDir)) {
      if (!name.endsWith('.json')) continue;
      let parsed: unknown;
      try {
        // readJsonAuto falls back to <name>.json.gz — the shape the corpus
        // takes after Task 3 compresses it in the repository.
        parsed = readJsonAuto(join(classicsDir, name));
      } catch {
        continue; // a file that is not JSON is another rule's business
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const chunks = (parsed as { chunks?: unknown }).chunks;
      if (!Array.isArray(chunks)) continue;
      check('classics', `data/classics/${name}`, chunks);
    }
  }

  // sutras: a top-level ARRAY
  const sutrasDir = rooted('data', 'sutras');
  if (existsSync(sutrasDir)) {
    for (const name of readdirSync(sutrasDir)) {
      if (!name.endsWith('.json')) continue;
      // manifest.json is the index of the corpus, not a chapter file.
      if (name === 'manifest.json') continue;
      let parsed: unknown;
      try {
        parsed = readJsonAuto(join(sutrasDir, name));
      } catch {
        continue; // a file that is not JSON is another rule's business
      }
      if (!Array.isArray(parsed)) continue;
      check('sutras', `data/sutras/${name}`, parsed);
    }
  }

  return drift;
}
```

⚠️ **import 要加一个**：`import { readJsonAuto } from '@/lib/json-fs';`（`scripts/audit-gaps.ts` 顶部，第 28 行之后）。

⚠️ **`readdirSync` / `existsSync` / `join` 已经在 import 列表里**（第 27-28 行）—— **不用重复加**。

⚠️ **`rooted(...)` 是现成的辅助**（第 84 行 `function rooted(...segments: string[]): string { return join(auditRoot, ...segments); }`）—— 本实现用它，**这样测试的 `setAuditRoot` 才能生效**。**不要**直接用 `join('data', 'classics')`，那样就绕过了 audit root，测试会读到真实仓库而不是临时仓库。

⚠️ **`file` 字段的格式**：用 `data/classics/${name}` 这种**相对于 audit root 的路径**（带正斜杠），与 `findMissingRuntimeData` 里的 `relativeToAuditRoot`（第 291 行）保持一致。测试断言用 `toContain('broken.json')`，不依赖具体前缀。

⚠️ **`catch` 里必须有说明**（CLAUDE.md 硬规则：不许有空 catch）。上面两处 `catch { continue; }` 都带了行内注释说明「这不是本规则该管的事」—— **保留这些注释**。

⚠️ **`data/classics/` 里的 `.json.gz`**（Task 3 之后）：本实现只读 `.json`（`name.endsWith('.json')`）。Task 3 把语料压成 `.json.gz` 之后，**这个体检会一个文件都读不到 ⇒ 永远空数组 ⇒ 假绿**。

⇒ **Task 6 必须处理 `.gz`**，否则 Task 3 之后它就废了。

**已核实：`lib/json-fs.ts` 没有 `server-only` 标记**，可以直接 import。而且它的 `readJsonAuto(path)` 正是为这件事写的：

```ts
export function readJsonAuto(path: string): unknown | null {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const gzPath = `${path}.gz`;
  if (existsSync(gzPath)) {
    const buf = readFileSync(gzPath);
    const text = gunzipSync(buf).toString('utf8');
    return JSON.parse(text);
  }
  return null;
}
```

⚠️ **`readJsonAuto` 的回落是「`.json` 不存在才试 `.json.gz`」** —— 所以遍历条件只放行 `.json` 结尾的文件名就够了，`.json.gz` 通过回落被读到。**这样写，Task 6 在 Task 3 之前跑也能工作**（读 `.json`），Task 3 之后也能工作（读 `.json.gz`）。

⚠️ **`readJsonAuto` 在文件不存在时返回 `null`，在 JSON 解析失败时抛 `SyntaxError`** —— 所以外面要包 try/catch（实现里那两处 `catch { continue; }` 带了行内注释说明「这不是本规则该管的事」，**保留这些注释** —— CLAUDE.md 不许空 catch）。

⚠️ **`readJsonAuto` 的返回类型是 `unknown | null`** —— 取 `chunks` 前必须先判类型（实现里那行 `typeof parsed !== 'object'`）。

⚠️ **`file` 字段带不带 `.gz` 无所谓** —— 用 `data/classics/${name}`（`name` 是遍历到的逻辑文件名）。Task 3 之后遍历放行的是 `x.json`（内容来自 `x.json.gz`）—— 报告显示 `.json` 是可接受的，它指向的是逻辑文件名。**不值得**为显示准确再加一次 `existsSync` 判断。

- [ ] **Step 4: 接到 `GapReport` 和 `auditGaps()`**

在 `GapReport` 接口里加：

```ts
  chapterIdDrift: ChapterIdDrift[];
```

在 `auditGaps()` 的返回里加：

```ts
    chapterIdDrift: findChapterIdDrift(),
```

- [ ] **Step 5: 接到 `main()` 的输出**

先看 `main()`（第 686 行）现有六类是怎么打印的，**照同样的格式**加第七类（放在最后，即「numbers in the docs that contradict the code」之后）：

```ts
  console.log('\n=== chapter ids that break their corpus convention ===');
  if (report.chapterIdDrift.length === 0) {
    console.log('  (none)');
  }
  for (const drift of report.chapterIdDrift) {
    console.log(`  ${drift.file}: chunk #${drift.index} has id ${drift.actual}, expected ${drift.expected}`);
  }
```

- [ ] **Step 6: 把新类别加进退出码的计算**（**最容易漏的一步**）

`main()` 末尾有一个 `problems` 计数，它决定 `process.exitCode`（第 745-756 行）：

```ts
  const problems =
    report.scriptEnvGaps.length +
    report.missingFromBundle.length +
    report.brokenScriptReferences.length +
    report.unrunnableDocCommands.length +
    report.docDrift.length +
    missingTargets.length;
```

⚠️ **不加这一项，体检会「打印出问题但退出码是 0」** —— CI 会判定通过。这是一个**看起来能用的体检其实是哑的**的经典坑。

改成：

```ts
  const problems =
    report.scriptEnvGaps.length +
    report.missingFromBundle.length +
    report.brokenScriptReferences.length +
    report.unrunnableDocCommands.length +
    report.docDrift.length +
    report.chapterIdDrift.length +
    missingTargets.length;
```

⚠️ **`missingTargets` 不在 `report` 里** —— 它是 `main()` 内部单独调用的 `findMissingNpmScriptTargets()`。**别把它写成 `report.missingTargets`**（`GapReport` 里没有这个字段）。

- [ ] **Step 7: 跑测试，确认它绿**

```bash
npx vitest run tests/unit/scripts/audit-gaps.test.ts
```

期望：PASS。

- [ ] **Step 8: 在真实仓库上跑体检**

```bash
npx tsx scripts/audit-gaps.ts
echo "exit code: $?"
```

期望：**七类全绿**，新的一类是 `(none)`，**退出码是 0**。

⚠️ 若这一类**报出了东西** ⇒ 真实数据里有偏离 ⇒ **停下，先查清楚**，不要直接改数据。

⚠️ **退出码也必须是 0** —— 如果打印全绿但退出码是 1，说明 `problems` 的计算漏了项（或者别的类别有问题）。**两个都看。**

- [ ] **Step 9: 提交**

```bash
git add -A scripts/audit-gaps.ts tests/unit/scripts/audit-gaps.test.ts
git commit -m "feat(audit): report a chapter id that breaks its corpus convention [YYYY-MM-DD HH.MM]"
```

---

## 收尾（全部 Task 完成后）

- [ ] **跑全量测试**

```bash
npx vitest run
```

期望：全绿（并发下偶发超时是已知的资源争用，单独跑该文件即可）。

- [ ] **跑 lint + 类型检查**

```bash
npx tsc --noEmit
npx eslint .
```

期望：0 error。

- [ ] **跑体检**

```bash
npx tsx scripts/audit-gaps.ts
```

期望：七类全绿。

- [ ] **跑 production build**（本计划动了 `app/layout.tsx` ⇒ 必须）

⚠️ **先停 4444 端口的 dev server**。

```bash
npm run build
```

- [ ] **汇总报告**

列出六个提交、改动行数、以及仍未做的项（见下）。

---

## 明确不做的事（YAGNI）

| 不做 | 理由 |
|---|---|
| 不把 `data/classics` 拆成数据库表 | 251 MB 的语料入库要建 196 张表 + 全文索引，代价远大于收益；读取层已经够快（有 LRU）。 |
| 不合并 `pipeline.ts` 与 `apply.ts` 里两份 `parsePageCost` | 它们服务于不同的流水线阶段，合并需要证明等价 —— 不在本次范围。 |
| 不给 `scripts/build-classics-guwendao.ts`（1343 行）拆分 | 它是一次性数据生成脚本，拆分的收益低于风险；本次只拆**运行时**代码。 |
| 不删 `public/fonts`（29 MB 古文字硬笔字体） | 它们在 `app/globals.css` 里被真正使用。 |
| 不改 `public/strokes`（20 MB） | 已在 git 里、30 天缓存、每字一个 JSON，形态合理。 |
| 不把 `lib/webfont/jobs.ts`、`releases.ts` 等已达标的文件动 | 它们都在 300-500 行规范内。 |
| 不 push | 用户 2026-06-21 起的规矩。 |
