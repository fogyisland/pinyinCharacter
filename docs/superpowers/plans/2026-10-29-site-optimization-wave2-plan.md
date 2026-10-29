# 站点性能优化 Wave 2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把生产环境的字体载荷从 3.7–5.0 MB/页降到 209–408 KB/页（R9 的重定预算：首页 295 / 字典 209 / 诗词 282 / 故事 408 KB），首屏冷加载从 ~21 s 降到 ~5 s，同时保证零缺字、零 FOUT、登录态页面不进入任何缓存。

**Architecture:** 放弃 Google Fonts 的「按码位区间切分」，改为**按站内用字自建子集**：每族（Noto Sans SC / Noto Serif SC / LXGW WenKai TC）切成 **一个热区文件（按用字频率取前 N 字）+ 若干 Ext 文件（其余字按 16 个码位一个窗口切）**。同一族的所有 `@font-face` 共用**一个 font-family 名**，每条 face 带**互不相交的精确 `unicode-range`**（= 该文件实际含有的码位并集），因此浏览器只会下载页面真正命中的那几个文件。字体源字体由 `fonttools varLib.instancer` 把 `wght` 裁到 `[400,700]`，再用仓库已有的 `subset-font` 切分（实测 229 B/字，比 Google 自己的 305–407 B/字省 25–42 %）。非字体侧同步落地：nginx brotli + HTML 微缓存（强制绕过 `auth_token`）、BBR 调优清单、预压缩脚本、可复现的性能基线脚本。

**Tech Stack:** Node 22 · npm · `subset-font@2.4.0`（已有）· `fontkit@2.0.4`（已有）· Python `fonttools 4.61.1`（构建期，已装）· nginx（Ubuntu/Debian 包）· vitest

**Spec:** `docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`（绑定权威；本计划是它的论证）

---

## Global Constraints

以下每一条都适用于**所有**任务：

- **G1 语言**：给用户的说明用中文；代码标识符、commit message、UI 文案用英文。
- **G2 commit 格式**：subject 结尾带 `[YYYY-MM-DD HH.MM]`（例：`feat(fonts): ... [2026-10-29 14.30]`），正文末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **G3 包管理**：项目用 **npm**（不是 pnpm）。装包用 `npm install --legacy-peer-deps`。**不引入任何新的运行时依赖**——字体切分工具一律是构建期脚本。
- **G4 git add**：只允许**显式路径** `git add <path>...`；禁止 `-A`、`.`、以及不带路径的 `-u`。
- **G5 不得提交**：`Up/`（gitignored 快照）、任何 `.env`、`data/sutras/manifest.json`（**并发会话正在改它**，永远不要 stage 它）。
- **G6 不 push**：除非用户明确授权，否则不 `git push`。本轮全部成果留在本地分支。
- **G7 分支**：实现前先切到 `perf/webfont-wave2-2026-10-29`（从 `main` 切出），不要在 `main` 上直接改。
- **G8 build**：`npm run build` 只在 `D:/Temp/pinyin-build-check` 里跑，且先 `rm -rf .next`；**端口 4444 被占用时绝不 build**。
- **G9 字体观感不变**：三款字体、字形、字重**全部保持**。`font-display: swap` 必须保留。禁止换字体、禁止改变字形。
- **G10 零缺字**：站内能渲染的汉字，一个都不能因为字体改造而落到豆腐块。校验脚本必须断言这一点。
- **G11 spec 是权威**：spec 与本计划冲突时以 spec 为准；spec 自身内部矛盾（见下方「裁决记录」）按下方裁决执行，并把裁决写进 ledger。
- **G12 错误处理**：禁止空 `catch`、禁止 `TODO`、禁止省略号。所有脚本失败必须**非零退出**并给出可执行的补救提示。
- **G13 微缓存安全**：登录态请求**既不读缓存也不写缓存**；任何带 `Set-Cookie` 的响应**一律不写缓存**。这两条由 nginx 指令强制，不靠「现在恰好没有 GET 响应种 cookie」这种假设。

### 裁决记录（spec 内部矛盾，按 G11 裁决）

| # | 矛盾 | 裁决 | 理由 |
|---|---|---|---|
| R1 | spec §4 标题把「服务器 TCP 调优」叫 W2-3、「CDN」叫 W2-4；spec §5 任务表把「预压缩脚本」叫 W2-3、「服务器调优」叫 W2-4 | 以 **spec §5 任务表**为准（它是明确的交付物分解）：Task 6=W2-2 nginx、Task 7=W2-3 预压缩、Task 8=W2-4 服务器调优、Task 9=W2-5 性能基线 | §5 是「任务分解」章节，粒度更细且逐条给了交付物 |
| R2 | spec §4.1.4 说 kai 的字符集是「7 + 2 + 3 ≈ 2 000 字」 | **kai 字符集 = 源码字面量 + 古籍/经文标题 + 罕见字本身**（`data/content/<char>.json` 里带 `rare` 字段的那 1 412 个 `char`），**不含故事正文** | 故事正文渲染在 sans/serif 里，把它塞进 kai 会把稠密窗口填满，让**每一个**页面替故事正文付费（实测首页 kai 51 KB vs 35 KB）。但故事详情页的大字（`app/stories/StoryClient.tsx:117` 的 `font-kai font-bold text-9xl`）渲染的是罕见字**本身**，所以罕见字必须进 kai。实测 kai 真实字符集 **2 601 字** → 16 码位窗口 = **1 027 块 × 2 字重 = 2 054 个文件** |
| R3 | spec §3.6 说「楷体可以只发布 Regular 一个字面」 | **kai 同时发布 400 与 700** | 全站有 3 处 `font-kai font-bold`（`app/ancient/page.tsx:50`、`app/ancient/[slug]/page.tsx:101`、`app/stories/StoryClient.tsx:117`），最后一处是 `text-9xl` 的故事大字——合成加粗在 9xl 上非常难看。Bold 只在真正渲染粗体楷体时才下载 |
| R4 | spec §4.1.2 给出 fallback 链但没说 `unicode-range` 怎么用 | **每一条 `@font-face`（热区与 Ext 全部）都带精确 `unicode-range`，且同族内两两不相交** | 浏览器对同一 family 的多个 face 会**逐个下载探测**直到找到含该字的字体。Ext 有几千个 face，没有 `unicode-range` 会把整族全下下来。区间不相交还保证「同一个字只可能落在一个文件里」，不会有歧义 |
| R5 | spec §3.5 说 sans 需要 16 772 字、serif 20 616 字 | **sans 字符集 = 全部语料 + 源码；serif 字符集 = sans 的全部 + 经文 + 古籍**（即 serif ⊇ sans） | 正文（sans）渲染一切内容，serif 只渲染字典/故事/经文/古籍正文。宁可多包含，不可漏字；多出来的成本由 Ext 分块摊薄 |
| R6 | spec §4.2.1 说「有 brotli 就启用」 | **主配置里 brotli 保持注释**，另出一个 `deploy/nginx-brotli.conf` 片段文件，服务器上 `nginx -V \| grep -o brotli` 有输出才 `include` | nginx 没有条件编译。在没装 brotli 模块的机器上直接解注释会让 `nginx -t` 失败、线上 nginx 起不来。片段文件让「探测→启用」成为一个可执行的两步动作 |

### 字体机制裁决（2026-10-29 实测后追加，R8–R15）

这一组裁决来自一轮真实测量（仓库语料 + 生产站点四个页面的服务端 HTML），它们**推翻了 spec §4.1 的分档机制**，理由是 spec 给出的机制**产不出 spec 自己要的字节**。

**测出来的物理约束（后面每条裁决都建立在它上面）：**

- 单页静态子集成本 ≈ `229 B × (命中块数 × 块内字数)`。块越小越省字节，但块数（= 请求数）会涨。
- CSS 成本 ≈ `13 B/块(gzip)`。块数就是 CSS 的字节数。
- 因此 **CSS 预算与字体预算是直接对立的两端**：压 CSS 就是加块数，加块数就是压字节。spec §3.2 的「单页 ≤ 250 KB」与 §3.3 的「CSS ≤ 25 KB」在静态子集下**不可兼得**。
- 实测每字成本（`fontTools varLib.instancer` + `subset-font`，100 字样本）：变量 `wght 100–900` = 246.3 B/字；实例化 `wght 400:700` = **229.4 B/字**；静态 400 单字重 = 136.1 B/字。选 `400:700`（229.4）比全变量省 7 %，比 Google 自己的 305–407 B/字省 25–42 %。

| # | 矛盾 | 裁决 | 理由 |
|---|---|---|---|
| R8 | spec §4.1.1 的「Tier1 前 200 / Tier2 200–800 / Ext 每 256 码位一块」实测产不出 spec §3.2 自己要的字节：首页 984 KB / 诗词 1 446 KB / 故事 1 350 KB（目标 250 / 250 / 400 KB） | **改为「热区 + Ext 按 16 码位窗口切」**：sans/serif 热区 300 字，Ext 窗口 16 码位；楷体无热区 | 实测新机制（字符集 sans 16 968 / serif 19 888 / kai 2 601，块数 2 786 / 3 115 / 1 027，文件共 **7 955** 个）：首页 **295 KB** / 字典 **209 KB** / 诗词 **282 KB** / 故事 **408 KB**，CSS **97 KB**(gzip)。相比现状的 3 813–4 985 KB 是 **12–18 倍**的下降 |
| R9 | spec §3.2 的单页 ≤ 250/350/250 KB 与 §3.3 的 CSS ≤ 25 KB(gzip) | **重定预算**（本计划与 Task 4/9 按此执行）：单页字体 `/` ≤ 350 KB、`/dictionary` ≤ 300 KB、`/poetry` ≤ 350 KB、`/stories` ≤ 500 KB；三份 CSS 合计 ≤ 110 KB(gzip)；单页字体请求数 ≤ 130 个；冷加载 ≤ 5 s（现状 21–28 s） | 这是对 spec 目标的**显式偏离**，登记在案而不是默默吸收。CSS 是一次性可缓存成本，字体是每次访问成本——预算该花在后者身上 |
| R10 | spec §4.1.3 只说「剩余字符按码位递增后每 N 字一块」，没说按**字符个数**切还是按**码位窗口**切 | **Ext 按码位窗口切**：窗口 = 码位落在 `[k×W, (k+1)×W)` 的全部字符，`W = 16` | Task 1 实现者自己的 C1 发现：256 字一块 + 逐字精确区间 → CSS 185 KB(原始)；同一批字按 min–max 区间 → 1.7 KB。按字符个数切还会产生**空的尾块**（C2） |
| R11 | spec §4.1.1 保留 Tier2 这一档 | **删掉 Tier2**（热区之后不再分档） | 语料尾部每个字只出现一次 → 尾部频率信号是均匀的，「按频率分档」在尾部等价于任意分组。实测把热区加大只会把热区文件本身撑大（热区文件每页都要整份下载）：首页 热区 0 → 325 KB，热区 300 → **295 KB**，热区 450 → 325 KB，热区 600 → 366 KB，热区 1000 → 504 KB |
| R12 | Ext 块的 `unicode-range` 用「块内最小–最大码位」的区间，还是「块内码位并集」的精确并集 | **用精确并集**（`unicodeRange()`），不用 min–max 区间 | min–max 区间会覆盖**文件里没有的字**：浏览器按区间选中这个 face → 直接渲染豆腐块，而不是回退系统字体。精确并集多花约 31 KB(gzip) 的 CSS（一次性、可缓存），换掉唯一一条产生豆腐块的路径 |
| R13 | spec §3.2 想要 ≤ 250 KB/页 | **本轮不做**，登记为下一波 | 真要 250 KB/页需要按页/按需动态子集：新增运行时依赖（G3 明令禁止）+ 约 3 万个文件 |
| R14 | spec §3.6 没规定楷体要不要热区 | **楷体不设热区**（`tier1Size = 0`），只用 Ext 窗口 | 楷体全站只渲染约 38 字（首页），但 300 字的热区文件按 400/700 两份算 = 每页白付 137 KB。实测：楷体热区 0 → 首页 295 KB，楷体热区 300 → 335 KB |
| R15 | spec §4.1.2 的 fallback 链暗示「每档一个 font-family 名」（`Noto Sans SC 1` / `2` / `Ext`） | **一族一个 font-family 名**（`Noto Sans SC`），所有 face 靠互不相交的 `unicode-range` 区分 | 区间互不相交时不需要跨族 fallback 链；一族一名去掉了「同族多条 face 谁生效」的歧义，也让 Task 3/5 少一套族名 |

---

## Review Focus

spec 是愿景文档：它说了系统**必须**做到什么，但没穷举每一种输入。下面 5 条是 spec 隐含、却没有被任何任务的测试覆盖、且最可能咬到真实用户的地方。每条后面标注了把它钉死的测试归属。

1. **字符集漏了一个站内会渲染的字** → 该字走完整条 fallback 链落到系统字体，整页出现两种字体混排；没装 CJK 字体的机器上直接是豆腐块。
   → 归属 Task 1（`webfont-charset.test.ts`：集合并集断言）+ Task 4（`verify-webfont-subsets.mjs`：逐档 cmap 覆盖断言）。

2. **登录态页面被 nginx 微缓存喂给了匿名用户** → 把 A 用户的账号页返回给了 B 用户。这是本轮唯一的高危安全项。
   → 归属 Task 6（`nginx-config.test.ts`：断言 `proxy_cache_bypass $cookie_auth_token $http_rsc;`、`proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;`、`proxy_cache_valid 200 10s;` 三行同时存在，且 TTL ≤ 10 s）。

2b. **同一 URL 的「文档请求」和「RSC 飞行请求」返回两种完全不同的 body**（`text/html` vs `text/x-component`），实测只有 `RSC: 1` 请求头能区分二者（`?_rsc=` 查询参数不行）。微缓存若把 HTML 喂给了飞行请求，Next 的客户端导航会拿到 HTML 而不是 flight 数据 → 页面卡死或白屏。
   → 归属 Task 6（`nginx-config.test.ts`：断言 `$http_rsc` 同时出现在 `proxy_cache_bypass` 与 `proxy_no_cache` 里）。

3. **浏览器还拿着旧的 `/font/fonts-*.css`**（nginx 对 `/font/` 发 `immutable` + 1 年）→ 站点继续按旧的 432 条 `@font-face` 下载 3.8 MB 字体，优化完全没生效，而且没有任何报错。
   → 归属 Task 5（`fonts-css.test.ts`：断言 manifest 的 `version` 是 12 位 hex、且与三份样式表内容的哈希一致；`lib/font-css.ts` 的 `?v=` 必须带上它）。

4. **同一 family 内两条 `@font-face` 的 `unicode-range` 重叠** → 浏览器挑中错误的文件，字形缺失或渲染成豆腐块，而且只在特定页面复现。
   → 归属 Task 4（断言每族所有块两两不相交、并集等于该族字符集）。

5. **静态子集把字节换成了请求数** → 热区盖不住的字会落到几十个 Ext 文件上，一页可能发出上百个字体请求；在 237–291 ms 的 RTT 下，请求数（不是字节数）可能先变成瓶颈，而这类问题不会出现在任何字节预算里。
   → 归属 Task 4（按实测页面表逐页算「命中的文件数」并断言 ≤ 130 个/页）。

---

## 依赖图

```
Task 1 (charset)  ──►  Task 3 (subset)  ──►  Task 4 (verify)  ──►  Task 5 (接入应用)
        ▲                  ▲
        │                  │
Task 2 (下载+裁轴)  ───────┘

Task 6 (nginx)   独立
Task 7 (预压缩)   独立（Task 2 之后跑效果最好）
Task 8 (服务器调优) 独立
Task 9 (性能基线) 独立（Task 5 之后测才有意义）
```

---

### Task 1: 字体字符集构建器（W2-1a）

**Files:**
- Create: `scripts/fonts/webfont-charset.mjs`
- Create: `scripts/fonts/webfont-charset.d.mts`
- Test: `tests/unit/scripts/webfont-charset.test.ts`

**Interfaces:**
- Consumes: 无（纯计算 + 读仓库语料）
- Produces:
  ```js
  // scripts/fonts/webfont-charset.mjs
  export const CJK_RANGES;                    // Array<[number, number]>
  export function isCjkChar(ch: string): boolean
  export function scoreCharacters(sources: CharSource[]): ScoredCharset
  export function planTiers(scored: ScoredCharset, options?: TierOptions): TierPlan
  export function unicodeRange(chars: string[]): string
  export function loadFamilyCharsets(options?: CharsetOptions): Record<FamilyName, TierPlan>
  ```
  ```ts
  // scripts/fonts/webfont-charset.d.mts
  export type FamilyName = 'sans' | 'serif' | 'wenkai';
  export interface CharSource { id: string; weight: number; chars: Iterable<string>; }
  export interface ScoredCharset { ordered: string[]; score: Map<string, number>; }
  export interface ExtBlock { index: number; chars: string[]; lo: number; hi: number; }
  export interface TierPlan { hot: string[]; extBlocks: ExtBlock[]; }
  export interface TierOptions { tier1Size?: number; extBlockSize?: number; }
  export interface CharsetOptions { root?: string; families?: Partial<Record<FamilyName, TierOptions>>; }
  ```
  默认值（见 R8/R14）：

  | 族 | `tier1Size`（热区字数） | `extBlockSize`（码位窗口宽度） |
  |---|---|---|
  | `sans` | 300 | 16 |
  | `serif` | 300 | 16 |
  | `wenkai` | 0 | 16 |

  `ExtBlock.lo` / `ExtBlock.hi` 是块内最小/最大码位。`ExtBlock.index` 从 1 开始，连续。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/webfont-charset.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  isCjkChar,
  scoreCharacters,
  planTiers,
  unicodeRange,
  loadFamilyCharsets,
} from '../../../scripts/fonts/webfont-charset.mjs';

describe('isCjkChar', () => {
  it('accepts CJK ideographs and CJK punctuation', () => {
    expect(isCjkChar('一')).toBe(true);   // U+4E00
    expect(isCjkChar('、')).toBe(true);   // U+3001
    expect(isCjkChar('！')).toBe(true);   // U+FF01
    expect(isCjkChar('永')).toBe(true);   // U+6C38
  });

  it('rejects latin, digits, punctuation and accented letters', () => {
    for (const ch of ['a', '1', ' ', '·', 'é', '—', '“']) {
      expect(isCjkChar(ch)).toBe(false);
    }
  });
});

describe('scoreCharacters', () => {
  it('adds the weighted occurrences of every source', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '永', '永'] },
      { id: 'src', weight: 1000, chars: ['永'] },
    ]);
    expect(scored.score.get('永')).toBe(1003);
  });

  it('orders by descending score, then by ascending code point', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '一'] },
      { id: 'src', weight: 1000, chars: ['丁'] },
    ]);
    expect(scored.ordered[0]).toBe('丁');
    expect(scored.ordered.slice(1).sort()).toEqual(['一', '永']);
  });

  it('keeps only CJK characters', () => {
    const scored = scoreCharacters([{ id: 'x', weight: 1, chars: ['a', '永'] }]);
    expect(scored.ordered).toEqual(['永']);
  });
});

describe('planTiers', () => {
  const chars = ['一', '丁', '丂', '七', '万', '丈']; // U+4E00..U+4E05
  const scored = scoreCharacters([
    { id: 'x', weight: 1, chars: chars.slice().reverse() },
  ]);

  it('puts the hottest characters in the hot tier', () => {
    const plan = planTiers(scored, { tier1Size: 2 });
    expect(plan.hot).toHaveLength(2);
  });

  it('cuts the tail into code point windows, not character slices', () => {
    // tail after a 2 character hot tier: 丂(U+4E02) 七(U+4E03) 万(U+4E04) 丈(U+4E05)
    // windows of 2 code points: [U+4E02,U+4E04) and [U+4E04,U+4E06)
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    expect(plan.extBlocks).toHaveLength(2);
    expect(plan.extBlocks[0].chars).toEqual(['丂', '七']);
    expect(plan.extBlocks[1].chars).toEqual(['万', '丈']);
    expect(plan.extBlocks[0].lo).toBe(0x4e02);
    expect(plan.extBlocks[0].hi).toBe(0x4e03);
    expect(plan.extBlocks[1].lo).toBe(0x4e04);
    expect(plan.extBlocks[1].hi).toBe(0x4e05);
  });

  it('puts every character in exactly one tier', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    const all = [...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...chars].sort());
  });

  it('gives every ext block a disjoint code point span', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    const spans = plan.extBlocks.map((b) => [b.lo, b.hi]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
  });

  it('defaults to a 300 character hot tier and 16 code point windows', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big);
    expect(plan.hot).toHaveLength(300);
    expect(plan.extBlocks.length).toBeGreaterThan(0);
    expect(plan.extBlocks.every((b) => b.hi - b.lo < 16)).toBe(true);
  });

  it('never produces an empty ext block', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big, { tier1Size: 300, extBlockSize: 16 });
    expect(plan.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('never repeats a character between the hot tier and an ext block', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big, { tier1Size: 300, extBlockSize: 16 });
    const hot = new Set(plan.hot);
    expect(plan.extBlocks.some((b) => b.chars.some((c) => hot.has(c)))).toBe(false);
  });

  it('rejects a non positive window width', () => {
    expect(() => planTiers(scored, { extBlockSize: 0 })).toThrow();
  });
});

describe('unicodeRange', () => {
  it('merges consecutive code points into one range', () => {
    expect(unicodeRange(['一', '丁'])).toBe('U+4E00-4E01');
  });

  it('keeps a gap as two ranges', () => {
    expect(unicodeRange(['一', '七'])).toBe('U+4E00, U+4E03');
  });

  it('emits a bare code point for a single character', () => {
    expect(unicodeRange(['一'])).toBe('U+4E00');
  });

  it('returns an empty string for no characters', () => {
    expect(unicodeRange([])).toBe('');
  });
});

describe('loadFamilyCharsets', () => {
  it(
    'builds nested charsets: wenkai ⊂ sans ⊂ serif',
    () => {
      const plans = loadFamilyCharsets();
      const size = (p: { hot: string[]; extBlocks: { chars: string[] }[] }) =>
        p.hot.length + p.extBlocks.flatMap((b) => b.chars).length;
      expect(size(plans.wenkai)).toBeGreaterThan(0);
      expect(size(plans.wenkai)).toBeLessThan(size(plans.sans));
      expect(size(plans.sans)).toBeLessThanOrEqual(size(plans.serif));
    },
    180_000,
  );

  it('uses the per family hot tier sizes from the rulings', () => {
    const plans = loadFamilyCharsets();
    expect(plans.sans.hot).toHaveLength(300);
    expect(plans.serif.hot).toHaveLength(300);
    expect(plans.wenkai.hot).toHaveLength(0);
  }, 180_000);

  it('covers the UI literals and the corpus characters', () => {
    const plans = loadFamilyCharsets();
    const sans = new Set(
      [...plans.sans.hot, ...plans.sans.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['字', '韵', '一', '永', '故', '唐']) {
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/webfont-charset.test.ts`
Expected: FAIL —— `Failed to resolve import "../../../scripts/fonts/webfont-charset.mjs"`。

- [ ] **Step 3: 实现 `scripts/fonts/webfont-charset.mjs`**

要求：

1. `CJK_RANGES` 覆盖：U+2E80–U+2EFF（康熙部首）、U+3000–U+303F（中日韩符号和标点）、U+3400–U+4DBF（扩展 A）、U+4E00–U+9FFF（基本区）、U+F900–U+FAFF（兼容汉字）、U+FE30–U+FE4F（兼容形式）、U+FF00–U+FFEF（半角及全角）、U+20000–U+2FA1F 与 U+30000–U+3134F（扩展 B 及以后）。`isCjkChar` 用这些区间的并集判定，单个 code point 判断，不能用 `codePointAt(0) > 0x2000` 这种粗略规则（会把日文假名、希腊字母等也算进来）。

2. `scoreCharacters(sources)`：对每个 source 的每个字符，若 `isCjkChar` 则 `score += source.weight`。返回 `ordered`（先按分数降序，同分按 code point 升序）与 `score`（Map）。

3. `planTiers(scored, options)`：
   - `hot = ordered.slice(0, tier1Size)`（`tier1Size = 0` 时热区为空数组）。
   - 剩余字符按 code point 升序排列后，**按码位窗口切块**：窗口 = 码位落在 `[k×extBlockSize, (k+1)×extBlockSize)` 的全部字符。`extBlockSize` 是**码位**宽度，不是字符个数。窗口按码位升序排列，`ExtBlock.index` 从 1 开始连续编号。
   - `ExtBlock.chars` = 窗口内的字符（码位升序）；`ExtBlock.lo` / `ExtBlock.hi` = 窗口内**实际存在**的最小/最大码位（不是窗口边界——边界要用 `Math.floor(cp / extBlockSize) * extBlockSize` 算，而块里只装真实存在的字）。
   - **不允许出现空块**：窗口里没有字符就不产生这个块。
   - `extBlockSize <= 0` 时抛 `TypeError`，不静默返回空计划。
   - **没有 tier2 这一档**（见 R11）。

4. `unicodeRange(chars)`：把 chars 的 code point 升序排序，合并连续区间，输出 `U+XXXX` 或 `U+XXXX-YYYY`（大写 hex，不足 4 位补 0），多项用 `, ` 连接。

5. `loadFamilyCharsets(options)` 读磁盘构建三族字符集，**读源按下面这张表**（`options.root` 默认仓库根）：

   | 族 | 语料来源 | 权重 |
   |---|---|---|
   | `wenkai` | 源码字面量（`app/` `components/` `lib/` 的 `.ts`/`.tsx`/`.mjs`/`.js`）× 1000、`data/classics/*.json` 的 `title` 字段、`data/sutras/*.json` 的 `title` 字段、`data/content/*.json` 中**带 `rare` 字段的那些文件的 `char` 字段** | 见左 |
   | `sans` | `wenkai` 的全部 + `data/content/*.json` 全部字符串 + `data/poems/*.json` 全部字符串 + `scripts/fonts/gb2312-7000.txt` + `data/general-standard-chinese-characters.json` + `data/unihan/CJKRadicals.txt` | 语料 × 1，源码 × 1000 |
   | `serif` | `sans` 的全部 + `data/sutras/*.json` 全部字符串 + `data/classics/*.json` 全部字符串 | 同上 |

   - **`data/stories/` 不存在**：故事正文在 `data/content/<char>.json` 的 `rare.story` 里，正文由 sans/serif 渲染。楷体只在故事详情页渲染那个**生僻字本身**（`app/stories/StoryClient.tsx:117` 的 `font-kai font-bold text-9xl`），所以楷体字符集收 `rare` 文件的 `char`，**不收故事正文**——收了会把密集区的窗口填满，每个页面都替它们买单（实测首页楷体 35 KB vs 收正文时的 51 KB）。
   - `gb2312-7000.txt` 每行一个字，按行读；`data/general-standard-chinese-characters.json` 是一个 JSON 数组/对象，**遍历它的全部字符串值**取字（先 `JSON.stringify` 再逐字符也可以，只要不漏）；`data/unihan/CJKRadicals.txt` 是纯文本，逐字符取 CJK。
   - 源码字面量扫描：递归遍历 `app/`、`components/`、`lib/`，跳过 `node_modules`，只读 `.ts`/`.tsx`/`.mjs`/`.js`，逐字符取 CJK。
   - 语料目录不存在时**跳过并打印一行说明**，不要抛错。
   - 单个语料文件 JSON 解析失败时跳过该文件并计数，不要让整个构建炸掉；最后打印一行 `skipped N malformed file(s)`。
   - 每族的 `tier1Size` / `extBlockSize` 取上面那张默认表；`options.families` 可以按族覆盖。
   - 函数末尾 `console.log` 每族的字符总数与分档大小，格式：
     `charset sans: 16968 chars (hot 300 / ext 2785 blocks)`。

6. `scripts/fonts/webfont-charset.d.mts` 按上面的 Interfaces 段逐字写声明（参考已有的 `scripts/fonts/build-fonts-css.d.mts` 风格）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/webfont-charset.test.ts`
Expected: PASS，全部 12 个用例绿。

- [ ] **Step 5: 提交**

```bash
git add scripts/fonts/webfont-charset.mjs scripts/fonts/webfont-charset.d.mts tests/unit/scripts/webfont-charset.test.ts
git commit -m "feat(fonts): add the webfont charset and tier planner [2026-10-29 HH.MM]"
```

---

### Task 2: 源字体下载 + 可变轴裁剪（W2-1b）

**Files:**
- Create: `scripts/fonts/download-webfont-sources.ts`
- Create: `scripts/fonts/instance-webfont-axis.mjs`
- Test: `tests/unit/scripts/instance-webfont-axis.test.ts`
- Modify: `package.json`（加两个 script）

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  // scripts/fonts/download-webfont-sources.ts
  export interface FontEntry { filename: string; urls: string[]; label: string; }
  export const SOURCES: FontEntry[];
  export const STAGING_DIR: string;                     // <repo>/scripts/fonts/staging/web
  export async function downloadOnce(url: string, dest: string, timeoutMs?: number): Promise<boolean>;
  export async function downloadFont(entry: FontEntry): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number }>;
  ```
  ```js
  // scripts/fonts/instance-webfont-axis.mjs
  export const INSTANCER_TARGETS: Array<{ src: string; out: string }>;
  export function instancerArgs(src: string, out: string): string[];
  export async function instanceOne(target): Promise<{ status: 'ok' | 'skip' | 'fail'; out?: string }>;
  ```
  下载器落到 `scripts/fonts/staging/web/`（已 gitignored）的文件名固定为：
  `NotoSansSC-wght.ttf`、`NotoSerifSC-wght.ttf`、`LXGWWenKaiTC-Regular.ttf`、`LXGWWenKaiTC-Bold.ttf`，
  另外三份许可证：`NotoSansSC-OFL.txt`、`NotoSerifSC-OFL.txt`、`LXGWWenKaiTC-OFL.txt`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/instance-webfont-axis.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { INSTANCER_TARGETS, instancerArgs } from '../../../scripts/fonts/instance-webfont-axis.mjs';
import { SOURCES } from '../../../scripts/fonts/download-webfont-sources.ts';

describe('download-webfont-sources', () => {
  it('downloads the four source fonts plus their licences', () => {
    expect(SOURCES.map((s) => s.filename).sort()).toEqual(
      [
        'LXGWWenKaiTC-Bold.ttf',
        'LXGWWenKaiTC-OFL.txt',
        'LXGWWenKaiTC-Regular.ttf',
        'NotoSansSC-OFL.txt',
        'NotoSansSC-wght.ttf',
        'NotoSerifSC-OFL.txt',
        'NotoSerifSC-wght.ttf',
      ].sort(),
    );
  });

  it('points every source at an https github raw url', () => {
    for (const source of SOURCES) {
      expect(source.urls.length).toBeGreaterThan(0);
      for (const url of source.urls) {
        expect(url.startsWith('https://raw.githubusercontent.com/')).toBe(true);
      }
    }
  });
});

describe('instance-webfont-axis', () => {
  it('pins the wght axis to the four weights the site uses', () => {
    expect(instancerArgs('src.ttf', 'out.ttf')).toEqual([
      'varLib.instancer',
      'src.ttf',
      'wght=400:700',
      '--output',
      'out.ttf',
      '--no-overlap-flag',
    ]);
  });

  it('instances only the two variable fonts', () => {
    expect(INSTANCER_TARGETS.map((t) => t.src).sort()).toEqual([
      'NotoSansSC-wght.ttf',
      'NotoSerifSC-wght.ttf',
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/instance-webfont-axis.test.ts`
Expected: FAIL —— 找不到 `scripts/fonts/instance-webfont-axis.mjs`。

- [ ] **Step 3: 实现下载器 `scripts/fonts/download-webfont-sources.ts`**

照抄 `scripts/fonts/download-hard-pen-fonts.ts` 的骨架（AbortController + 超时 + UA header + 跳过已存在且非空的文件 + 逐条打印 OK/SKIP/FAIL + `process.exit(0)`）。

`SOURCES` 的具体取值（已实测四个 URL 全部返回 206，即可达）：

```ts
export const SOURCES: FontEntry[] = [
  {
    filename: 'NotoSansSC-wght.ttf',
    label: 'Noto Sans SC variable (wght 100..900)',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'],
  },
  {
    filename: 'NotoSerifSC-wght.ttf',
    label: 'Noto Serif SC variable (wght 200..900)',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'],
  },
  {
    filename: 'LXGWWenKaiTC-Regular.ttf',
    label: 'LXGW WenKai TC Regular',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf'],
  },
  {
    filename: 'LXGWWenKaiTC-Bold.ttf',
    label: 'LXGW WenKai TC Bold',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf'],
  },
  {
    filename: 'NotoSansSC-OFL.txt',
    label: 'Noto Sans SC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt'],
  },
  {
    filename: 'NotoSerifSC-OFL.txt',
    label: 'Noto Serif SC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt'],
  },
  {
    filename: 'LXGWWenKaiTC-OFL.txt',
    label: 'LXGW WenKai TC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/OFL.txt'],
  },
];
```

- [ ] **Step 4: 实现裁轴器 `scripts/fonts/instance-webfont-axis.mjs`**

```js
export const INSTANCER_TARGETS = [
  { src: 'NotoSansSC-wght.ttf', out: 'NotoSansSC-wght-400-700.ttf' },
  { src: 'NotoSerifSC-wght.ttf', out: 'NotoSerifSC-wght-400-700.ttf' },
];

export function instancerArgs(src, out) {
  return ['varLib.instancer', src, 'wght=400:700', '--output', out, '--no-overlap-flag'];
}
```

用 `execFileSync('fonttools', instancerArgs(src, out), { encoding: 'utf8' })` 执行，工作目录设为 staging 目录。

**`fonttools` 缺失时**必须打印可执行的补救提示并以非零码退出：

```
[instance] fonttools not found — install it with:
    python -m pip install --upgrade fonttools brotli
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/instance-webfont-axis.test.ts`
Expected: PASS，2 个 describe / 5 个用例全绿。

- [ ] **Step 6: 加 npm scripts 并实跑一次**

在 `package.json` 的 `"scripts"` 里加（放在现有 `fonts:*` 之后）：

```json
"fonts:download-web": "tsx scripts/fonts/download-webfont-sources.ts",
"fonts:instance-web": "node scripts/fonts/instance-webfont-axis.mjs",
```

Run: `npm run fonts:download-web && npm run fonts:instance-web`
Expected:
- 4 个字体 + 3 个许可证打印 `OK` 或 `SKIP`（已存在则 SKIP）；
- 裁轴打印 `NotoSansSC-wght-400-700.ttf` 与 `NotoSerifSC-wght-400-700.ttf` 的成功行；
- `ls -la scripts/fonts/staging/web/` 里 4 个 ttf 都非空。

> `scripts/fonts/staging/` 是 gitignored，**不要** `git add` 它。

- [ ] **Step 7: 提交**

```bash
git add scripts/fonts/download-webfont-sources.ts scripts/fonts/instance-webfont-axis.mjs tests/unit/scripts/instance-webfont-axis.test.ts package.json
git commit -m "feat(fonts): add the webfont source downloader and axis instancer [2026-10-29 HH.MM]"
```

---

### Task 3: 字体子集切分器（W2-1c）

**Files:**
- Create: `scripts/fonts/build-webfont-subsets.mjs`
- Test: `tests/unit/scripts/webfont-subsets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 `loadFamilyCharsets()`（返回 `{ hot, extBlocks }` 形态的 `TierPlan`）与 `unicodeRange()`；Task 2 落在 `scripts/fonts/staging/web/` 的源字体
- Produces:
  ```js
  export const FAMILIES;                 // 见下表
  export const OUT_ROOT;                 // <repo>/public/font/web
  export function blockFileNames(family, block): string[];
  export function renderFace(spec): string;
  export function renderStylesheet(family, plan): string;
  export function manifestVersion(cssByFile): string;
  export function buildAll(): Promise<BuildReport>;
  ```

  **一族一个 font-family 名（R15）**：不再是 `Noto Sans SC 1` / `2` / `Ext` 三条链，而是同族所有 face 共用 `Noto Sans SC`，靠**互不相交的精确 `unicode-range`** 区分命中。

  | key | font-family 名 | css | 目录 | 源字体 | 字重 | 热区 |
  |---|---|---|---|---|---|---|
  | `sans` | `Noto Sans SC` | `fonts-sans.css` | `sans` | `NotoSansSC-wght-400-700.ttf` | 变量，单文件 `font-weight: 400 700` | 300 字 |
  | `serif` | `Noto Serif SC` | `fonts-serif.css` | `serif` | `NotoSerifSC-wght-400-700.ttf` | 变量，单文件 `font-weight: 400 700` | 300 字 |
  | `wenkai` | `LXGW WenKai TC` | `fonts-wenkai.css` | `wenkai` | `LXGWWenKaiTC-Regular.ttf` + `LXGWWenKaiTC-Bold.ttf` | 静态，`400` 与 `700` 各一份 | **无热区**（R14） |

  文件命名：`hot.woff2` / `ext-001.woff2` / `ext-002.woff2` …（静态族再加 `-<weight>` 后缀：`ext-001-400.woff2`、`ext-001-700.woff2`）。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/webfont-subsets.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  renderStylesheet,
  blockFileNames,
  manifestVersion,
} from '../../../scripts/fonts/build-webfont-subsets.mjs';
import { loadFamilyCharsets } from '../../../scripts/fonts/webfont-charset.mjs';

const plan = {
  hot: ['一', '丁'],
  extBlocks: [{ index: 1, chars: ['万', '丈'], lo: 0x4e07, hi: 0x4e08 }],
};

describe('blockFileNames', () => {
  it('uses one file per block for the variable families', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(blockFileNames(sans, { kind: 'hot' })).toEqual(['hot.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 3 })).toEqual(['ext-003.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 123 })).toEqual(['ext-123.woff2']);
  });

  it('uses one file per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    expect(blockFileNames(kai, { kind: 'ext', index: 3 })).toEqual([
      'ext-003-400.woff2',
      'ext-003-700.woff2',
    ]);
  });
});

describe('renderStylesheet', () => {
  it('declares one face per block for a variable family', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("font-family: 'Noto Sans SC'");
    expect(css).not.toContain('Noto Sans SC 1');
    expect(css).toContain('font-weight: 400 700');
  });

  it('declares one face per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    const css = renderStylesheet(kai, plan);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
  });

  it('gives every face a unicode-range and font-display swap', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    const faces = css.split('@font-face').slice(1);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range: U\+/);
    }
  });

  it('points every face at /font/web/<family>/<file>', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    expect(css).toContain('src: url(/font/web/sans/hot.woff2) format(\'woff2\')');
    expect(css).toContain('src: url(/font/web/sans/ext-001.woff2) format(\'woff2\')');
  });
});

describe('manifestVersion', () => {
  it('is twelve lowercase hex characters', () => {
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when the stylesheet changes and is stable otherwise', () => {
    const a = manifestVersion({ 'fonts-sans.css': 'a' });
    const b = manifestVersion({ 'fonts-sans.css': 'b' });
    expect(a).not.toBe(b);
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toBe(a);
  });
});

describe('the planned charsets fit the design budget', () => {
  it('produces a hot tier and ext blocks for every family', () => {
    const plans = loadFamilyCharsets();
    for (const family of FAMILIES) {
      const p = plans[family.key];
      expect(p.extBlocks.length).toBeGreaterThan(0);
      expect(p.hot.length).toBe(family.key === 'wenkai' ? 0 : 300);
    }
  }, 180_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/webfont-subsets.test.ts`
Expected: FAIL —— 找不到 `scripts/fonts/build-webfont-subsets.mjs`。

- [ ] **Step 3: 实现 `scripts/fonts/build-webfont-subsets.mjs`**

1. `FAMILIES` 常量按上表写死，含 `key`、`label`（= font-family 名）、`css`、`dir`、`sources`（变量族一个文件、静态族两个文件）、`weights`（变量族 `['400 700']`，静态族 `['400','700']`）、`variable`（boolean）、`hotSize`（sans/serif = 300，wenkai = 0）。

2. `blockFileNames(family, block)`：
   - `block` = `{ kind: 'hot' }` → 基名 `hot`；`{ kind: 'ext', index }` → 基名 `ext-` + index 补 3 位零（`ext-003`、`ext-123`）。
   - 变量族：文件名 = `<基名>.woff2`（一个文件承载 400–700 变量轴）。
   - 静态族：文件名 = `<基名>-<weight>.woff2`，权重顺序 400、700。

3. `renderFace(spec)` 输出一个 `@font-face` 块，字段顺序固定：
   ```
   @font-face {
     font-family: '<familyName>';
     font-style: normal;
     font-weight: <weight>;
     font-display: swap;
     src: url(/font/web/<dir>/<file>) format('woff2');
     unicode-range: <ranges>;
   }
   ```
   `familyName` **恒为 `family.label`**（R15：一族一名，不再有 `1` / `2` / `Ext` 后缀）。`unicode-range` 由 Task 1 的 `unicodeRange(chars)` 生成——精确并集，不是 min–max 区间（R12）。

4. `renderStylesheet(family, plan)`：按 热区 → Ext 块（按 `index` 升序）顺序拼所有 face，前面加一段注释头：
   ```
   /* fonts-sans.css — body typeface — --font-han-sans
    * Generated by scripts/fonts/build-webfont-subsets.mjs. Do not edit by hand. */
   ```
   静态族每个块输出两条 face（400 与 700），变量族每个块输出一条（`font-weight: 400 700`）。

5. `buildAll()`：
   - 读 `loadFamilyCharsets()` 得到三族的 `{ hot, extBlocks }`。
   - 读源字体（从 `scripts/fonts/staging/web/`）；**源文件缺失必须报错退出**并提示 `npm run fonts:download-web && npm run fonts:instance-web`。
   - 用 `subsetFont(buffer, chars, { targetFormat: 'woff2' })` 逐块切分，写到 `public/font/web/<dir>/<file>`（目录先 `mkdir -p`）。
   - 变量族用同一个源文件切每一块；静态族 400/700 各切一次。
   - 写 `public/font/fonts-<family>.css`。
   - 写 `public/font/fonts-manifest.json`：
     ```json
     { "version": "<12 hex>", "files": { "wenkai": "/font/fonts-wenkai.css", "sans": "/font/fonts-sans.css", "serif": "/font/fonts-serif.css" } }
     ```
     `version` = `manifestVersion(cssByFile)`，其中 `cssByFile` 是三份样式表内容的 map（键用文件名）。**必须保持 `files` 的三个键名不变**——`lib/font-css.ts` 依赖它。
   - 把三份 OFL 许可证复制到 `public/font/web/OFL-<family>.txt`。
   - 打印每族的块数、文件数、字符数与产物字节数，最后一行打印总量（块数 / 文件数 / 字节 / CSS gzip 字节）。
   - **不删除**旧的 Google 子集目录（删除是 Task 5 的事，避免一步做两件事）。

6. `manifestVersion(cssByFile)`：把 map 的内容按键排序后依次喂进 `createHash('sha256')`，取 hex 前 12 位。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/webfont-subsets.test.ts`
Expected: PASS。

- [ ] **Step 5: 加 npm script 并实跑一次构建**

在 `package.json` 加：
```json
"fonts:subset-web": "node scripts/fonts/build-webfont-subsets.mjs",
```

Run: `npm run fonts:subset-web`
Expected（按 2026-10-29 的语料实测，数字允许 ±5 % 浮动，但**必须打印出来**核对）：

| 族 | 字符数 | 块数 | woff2 文件数 | 备注 |
|---|---|---|---|---|
| `wenkai` | 2 601 | 1 027 | **2 054** | 无热区；每块 400 + 700 两份 |
| `sans` | 16 968 | 2 786 | **2 786** | 热区 300 + 2 785 个 Ext 块 |
| `serif` | 19 888 | 3 115 | **3 115** | 热区 300 + 2 814 个 Ext 块 |
| 合计 | — | 6 928 | **7 955** | 三份 CSS gzip 合计 ≈ 97 KB |

单文件大小：`sans/hot.woff2` ≈ 69 KB（300 字 × 229 B），每个 `ext-*.woff2` ≤ 4 KB（一个 16 码位窗口最多 16 字）。
`public/font/fonts-manifest.json` 的 `version` 是 12 位 hex。

> 这一步会跑十几分钟（切 7 955 次；实测 `subset-font` 94 ms/16 字、210 ms/64 字）。**不要**在 4444 被占用时跑 `npm run build`（G8）——本步骤不涉及 `next build`，不受限。

- [ ] **Step 6: 提交**

```bash
git add scripts/fonts/build-webfont-subsets.mjs tests/unit/scripts/webfont-subsets.test.ts package.json
git commit -m "feat(fonts): add the hot-tier and windowed webfont subsetter [2026-10-29 HH.MM]"
```

> 产物 `public/font/web/**` 与三份样式表由 **Task 5** 一起提交（那时才做替换与删除，避免中间态破坏线上构建）。

---

### Task 4: 子集校验器（W2-1d）

**Files:**
- Create: `scripts/fonts/verify-webfont-subsets.mjs`
- Create: `scripts/fonts/capture-page-font-profiles.mjs`（页面取字 fixture 的再生成器）
- Consume: `data/font-page-profiles.json`（页面取字 fixture，已随本计划提交）
- Test: `tests/unit/scripts/verify-webfont-subsets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 `loadFamilyCharsets()`；Task 3 产出的 `public/font/web/**`、`public/font/fonts-*.css`、`public/font/fonts-manifest.json`；`data/font-page-profiles.json`
- Produces:
  ```js
  export const LIMITS = {
    hotBytes: 90 * 1024,
    extBlockBytes: 12 * 1024,
    cssBytes: 110 * 1024,       // 三份样式表 gzip 后合计
    maxFacesPerCss: 3300,
    maxFontFilesPerPage: 130,
    pageFontBytes: {
      '/': 350 * 1024,
      '/dictionary': 300 * 1024,
      '/poetry': 350 * 1024,
      '/stories': 500 * 1024,
    },
  };
  export async function verifyFamily(family): Promise<{ ok: boolean; errors: string[]; stats: FamilyStats }>;
  export async function verifyAll(): Promise<{ ok: boolean; errors: string[]; stats: FamilyStats[] }>;
  ```
  CLI：`node scripts/fonts/verify-webfont-subsets.mjs` → 全部通过 `exit 0`，任一失败 `exit 1`。

  **限额来自 R9 的重定预算**，不是 spec §3.2/§3.3 的旧数字——旧数字在静态子集下不可兼得（见「字体机制裁决」的物理约束一节）。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/verify-webfont-subsets.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { verifyAll, LIMITS } from '../../../scripts/fonts/verify-webfont-subsets.mjs';

describe('verify-webfont-subsets', () => {
  it(
    'passes on the committed font artifacts',
    async () => {
      const result = await verifyAll();
      if (!result.ok) {
        console.error(result.errors.join('\n'));
      }
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    },
    300_000,
  );

  it('publishes the size limits from the design', () => {
    expect(LIMITS.hotBytes).toBe(90 * 1024);
    expect(LIMITS.extBlockBytes).toBe(12 * 1024);
    expect(LIMITS.cssBytes).toBe(110 * 1024);
    expect(LIMITS.maxFontFilesPerPage).toBe(130);
    expect(LIMITS.pageFontBytes['/dictionary']).toBe(300 * 1024);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现 `scripts/fonts/verify-webfont-subsets.mjs`**

校验项（**每一项失败都要收集进 `errors`，最后统一退出 1**，不要遇到第一个错就抛）：

1. **覆盖完整**：对每一族，用 Task 1 的字符集与样式表里的 `unicode-range` 求并集，断言并集 == 该族字符集（不多不少）。
2. **块不相交**：同一族的**所有**块（热区 + 每个 Ext 块）的 `unicode-range` 两两不相交。
3. **cmap 正确**：用 `fontkit.create(buffer)` + `font.hasGlyphForCodePoint(cp)` 打开每个产物，断言该块声明的每个字符都能渲染；并断言产物**不包含**该块之外的字符。
4. **文件大小**：热区文件 ≤ `LIMITS.hotBytes`，每个 Ext 块文件 ≤ `LIMITS.extBlockBytes`（16 码位窗口 ≤ 16 字 × 229 B ≈ 3.7 KB，留出 woff2 头部余量）。
5. **样式表**：三份 `fonts-<family>.css` **gzip 后合计** ≤ `LIMITS.cssBytes`，单份的 `@font-face` 条数 ≤ `LIMITS.maxFacesPerCss`。
6. **每条 face 的 `font-display` 必须是 `swap`**，`src` 指向的文件必须存在。
7. **manifest**：`version` 是 12 位 hex，且等于三份样式表内容按文件名排序后的 sha256 前 12 位；`files` 的键恰为 `{sans, serif, wenkai}`。
8. **页面预算**（对应 Review Focus 第 5 条）：读 `data/font-page-profiles.json`，对 `/`、`/dictionary`、`/poetry`、`/stories` 四个页面，用各族的热区/Ext 规则算出「浏览器会下载哪些文件」，累加**字节**与**文件数**，断言字节 ≤ `LIMITS.pageFontBytes[path]` 且文件数 ≤ `LIMITS.maxFontFilesPerPage`。
   计算规则：一个字符落在热区就下载热区文件；落在 Ext 就下载它所在的那一个 Ext 块文件（静态族该块是 2 个文件）。同一块只算一次。
   **fixture 怎么来的**：`data/font-page-profiles.json` 记录了 2026-10-29 从 `https://ziyun.pudafo.com` 抓到的四个页面服务端 HTML 里、**按 `font-kai` / `font-serif` class 归属**的 CJK 字符集（未命中这两个 class 的归 sans）。`scripts/fonts/capture-page-font-profiles.mjs` 是它的再生成器：默认从 `--base`（默认 `https://ziyun.pudafo.com`）抓四个页面；也接受 `--html-dir <dir>` 从本地 HTML 目录读（文件名 `<page>.html`，`page` ∈ `home`/`dictionary`/`poetry`/`stories`）。**校验器本身不联网**，只用仓库里的 fixture。

CLI 输出格式：

```
[verify] sans   : 16968 chars, 2786 files, 6082 KB   OK
[verify] serif  : 19888 chars, 3115 files, 7244 KB   OK
[verify] wenkai :  2601 chars, 1027 blocks, 2054 files, 1204 KB   OK
[verify] css    : 97 KB gzip (sans 36 / serif 40 / wenkai 21)   OK
[verify] pages  : / 295 KB / 120 files   /dictionary 209 KB / 41 files   /poetry 282 KB / 94 files   /stories 408 KB / 114 files   OK
[verify] 0 error(s)
```

字体文件用 `fontkit` 打开；`fontkit.create` 对 woff2 的支持在本仓库已被 `scripts/fonts/verify-brush-subsets.mjs` 验证过。

> 上表是 2026-10-29 实测值。校验器的**断言阈值**是 `LIMITS`，不是这张表；实测值落在阈值内即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
Expected: PASS。若页面预算超标，按 R11 的实测曲线调**热区字数**（300 → 150 会更省字节、450 会更省请求数）或**窗口宽度**（16 → 32 会让 CSS 变小、请求数变少），改完重跑 Task 3 的构建再回来跑本测试；**不要**去改 `LIMITS` 的预算数字（R9 已把预算重定过一次）。

- [ ] **Step 5: 加 npm script**

```json
"fonts:verify-webfont": "node scripts/fonts/verify-webfont-subsets.mjs",
"fonts:capture-page-profiles": "node scripts/fonts/capture-page-font-profiles.mjs",
```

Run: `npm run fonts:verify-webfont`
Expected: `0 error(s)`，退出码 0。

- [ ] **Step 6: 提交**

```bash
git add scripts/fonts/verify-webfont-subsets.mjs scripts/fonts/capture-page-font-profiles.mjs tests/unit/scripts/verify-webfont-subsets.test.ts package.json
git commit -m "feat(fonts): add the webfont subset verifier [2026-10-29 HH.MM]"
```

---

### Task 5: 接入应用（W2-1e）

**Files:**
- Modify: `app/globals.css`（`:root` 块，第 465–470 行）
- Modify: `lib/font-css.ts`（只改注释，不改行为）
- Modify: `tests/unit/lib/fonts-css.test.ts`（整体重写）
- Modify: `tests/unit/lib/middleware-redirect.test.ts`（第 65 行的示例路径）
- Delete: `public/font/noto-sans-sc/`、`public/font/noto-serif-sc/`、`public/font/lxgw-wenkai-tc/`、`public/font/fonts.css`
- Delete: `scripts/fonts/build-fonts-css.mjs`、`scripts/fonts/build-fonts-css.d.mts`
- Add: `public/font/web/**`、`public/font/fonts-sans.css`、`public/font/fonts-serif.css`、`public/font/fonts-wenkai.css`、`public/font/fonts-manifest.json`

**Interfaces:**
- Consumes: Task 3 的产物（`public/font/web/**` + 三份样式表 + manifest）
- Produces:
  - `app/globals.css` 里三个 CSS 变量改为**单族 + 系统兜底**（R15：一族一名，不再有跨档 fallback 链）：
    ```css
    --font-han-sans:
      'Noto Sans SC',
      system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    --font-han-serif:
      'Noto Serif SC',
      Georgia, 'Songti SC', 'SimSun', serif;
    --font-wenkai:
      'LXGW WenKai TC',
      'Kaiti SC', 'KaiTi', 'STKaiti', serif;
    ```
    同族的所有 face 共用这个名字，靠互不相交的精确 `unicode-range` 决定命中哪一个文件；浏览器找不到命中的 face 时（字不在字库里）自动落到系统字体。
  - `lib/font-css.ts` 的**导出签名与行为完全不变**（`FontCssLinks` + `getFontCssLinks()`）；manifest 的 `files` 键名不变，因此 `app/layout.tsx` **不需要改**。
  - `app/globals.css` 第 29–31 行的 `--font-sans` / `--font-serif` / `--font-kai` **不动**。

- [ ] **Step 1: 改 `app/globals.css` 的三个变量**

把 `:root` 里第 466–469 行的三行替换成上面那三段（每段一个变量，值按上面的换行写）。**只改这三个变量**，不要顺手改 `@theme` 里的 `--font-sans/--font-serif/--font-kai`，也不要动 `--font-kai` 之外的其他排版变量。

- [ ] **Step 2: 改 `lib/font-css.ts` 的注释**

文件头注释里「public/font/fonts.css used to be linked ...」那段过时了。改成描述新模型：三份分族样式表（sans 阻塞首屏，另两份 `media="print"` 异步）、每份内部按「热区 + 16 码位 Ext 窗口」分块、**一族一个 font-family 名**、每条 face 带**精确且互不相交**的 `unicode-range`。**函数体一字不改**。

- [ ] **Step 3: 重写 `tests/unit/lib/fonts-css.test.ts`**

新文件的用例（保留 `describe` 命名风格）：

1. `public/font/fonts-<family>.css` 三份都存在。
2. 每份样式表里的 `@font-face` 条数 = 该族的块数（wenkai 是块数 × 2，因为 400/700 各一条 face）。
3. 每条 face 的 `font-family` 只能是这 **3** 个名字之一：`Noto Sans SC`、`Noto Serif SC`、`LXGW WenKai TC`。
4. 每条 face 的 `src` 文件在 `public/` 下真实存在。
5. 每条 face 的 `font-display` 都是 `swap`。
6. 每条 face 都有非空的 `unicode-range`。
7. `fonts-sans.css`（唯一阻塞首屏的那份）**原始** ≤ 400 KB。
8. 三份样式表合起来 gzip 后 ≤ 110 KB —— 用 `node:zlib` 的 `gzipSync` 算。**（这是 R9 重定后的预算；spec §3.3 的 25 KB 在静态子集下不可达，原因见「字体机制裁决」）**
9. manifest 的 `version` 是 12 位 hex；`files` 的值恰为 `/font/fonts-{wenkai,sans,serif}.css`；`version` 等于三份样式表内容按文件名排序后的 sha256 前 12 位（**直接实现这段哈希，不要 import 构建脚本**）。
10. `app/layout.tsx` 仍然包含 `getFontCssLinks()`、`href={fontCss.sans}`、`media="print"` 的两处 —— 与旧测试同义，保留。
11. `app/globals.css` 包含 `'Noto Sans SC'`、`'Noto Serif SC'`、`'LXGW WenKai TC'` 这 3 个族名，并且**不含** `'Noto Sans SC 1'` / `'Noto Sans SC Ext'` / `'LXGW WenKai TC Ext'` 这类旧的分档族名（防止有人把链改回去）。
12. 旧的 Google 子集目录**不存在**：`public/font/noto-sans-sc`、`public/font/noto-serif-sc`、`public/font/lxgw-wenkai-tc`、`public/font/fonts.css` 都不在磁盘上。

- [ ] **Step 4: 改 `tests/unit/lib/middleware-redirect.test.ts`**

第 65 行的示例路径 `'/font/noto-sans-sc/example.woff2'` 换成 `'/font/web/sans/hot.woff2'`（该目录已不存在，留着会误导）。第 64 行的 `'/font/fonts.css'` 也换成 `'/font/fonts-sans.css'`。**只改这两行**，不改测试逻辑。

- [ ] **Step 5: 删除旧产物并暂存新产物**

```bash
git rm -r public/font/noto-sans-sc public/font/noto-serif-sc public/font/lxgw-wenkai-tc
git rm public/font/fonts.css scripts/fonts/build-fonts-css.mjs scripts/fonts/build-fonts-css.d.mts
git add public/font/web public/font/fonts-sans.css public/font/fonts-serif.css public/font/fonts-wenkai.css public/font/fonts-manifest.json
```

> `git add` 只用显式路径（G4）。`data/sutras/manifest.json` **不要**出现在任何 `git add` 里（G5）。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿。若有旧的测试还在断言 `fonts.css` 存在或断言 Google 子集目录存在，把它们改到新模型上（**只改与字体产物相关的断言**）。

- [ ] **Step 7: 检查改动面**

```bash
git status --short
```

Expected: 只出现本任务列出的路径。**特别确认 `data/sutras/manifest.json` 仍是未暂存的修改状态**（G5）。

- [ ] **Step 8: 提交**

```bash
git commit -m "feat(fonts): ship frequency-tiered webfont subsets [2026-10-29 HH.MM]"
```

> 提交信息里不要写「done」之类的结论；用祈使句描述改动。

---

### Task 6: nginx —— brotli 与 HTML 微缓存（W2-2）

**Files:**
- Modify: `deploy/nginx.ziyun.pudafo.com.conf`
- Create: `deploy/nginx-brotli.conf`
- Create: `deploy/OPTIMIZATION.md`
- Test: `tests/unit/deploy/nginx-config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 一份可直接 `cp` 到 `/etc/nginx/conf.d/` 的 nginx 配置，以及一份部署/回滚手册。

**安全约束（Review Focus 第 2 条与第 2b 条，全部必须满足，缺一条本任务不做）**：

> 本段每一条都来自对线上 `https://ziyun.pudafo.com` 的实测（2026-10-29），不是推测。

1. `proxy_cache_bypass $cookie_auth_token $http_rsc;` —— `auth_token` 是 `lib/auth.ts:18` 的会话 cookie 名。
   **`proxy_cache_bypass` 只管「读」，不管「写」** —— 它阻止命中缓存，但**照样会把带登录态的响应写进缓存**。所以必须同时有第 2 条。
2. `proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;` —— 登录态请求、带 `Set-Cookie` 的响应、RSC 飞行请求**一律不写缓存**。
   `$upstream_http_set_cookie` 是 nginx 自带变量（1.7.5+），有值即表示上游这个响应种了 cookie。
   实测依据：`setSessionCookie()` 只在三个 POST 路由里被调用（`app/api/auth/{login,register,reset}/route.ts`），`setup_completed` 由 Server Action（POST）种下，**当前没有任何 GET 响应会种 cookie** —— 这条指令是把「现在恰好没有」变成「将来也一定没有」。
3. `proxy_ignore_headers Cache-Control;` —— Next 的 `Cache-Control: private, no-cache, no-store` 必须被忽略才能缓存。
   **只忽略 `Cache-Control`，不忽略 `Set-Cookie`** —— 忽略 `Set-Cookie` 等于允许把带 cookie 的响应写进缓存，与第 2 条自相矛盾。
4. `proxy_cache_valid 200 10s;` —— TTL 只有 10 秒；只有 200 会被缓存（307 → `/init`、4xx、5xx 都不入缓存）。
5. `location /api/ { proxy_cache off; }` —— **`location /` 下还挂着 68 个 GET API 路由**（实测清单见 `app/api/**/route.ts`），其中 `/api/chars/random`、`/api/poetry/random`、`/api/game/round`、`/api/stats`、`/api/audio/active` 的语义是「每次给新内容」，缓存 10 秒会让它们对所有用户返回同一个值；`/api/history`、`/api/notes`、`/api/membership/me`、`/api/worksheets/*` 是用户态数据。新增的 `location /api/` 比 `/api/auth/`、`/api/init/` 短，nginx 取最长前缀匹配，**那两个限流块不受影响**。
6. `$http_rsc` 必须同时进 `proxy_cache_bypass` 与 `proxy_no_cache` —— 线上实测：`RSC: 1` 请求头返回 `Content-Type: text/x-component` 的 flight 数据（22 843 B），同一个 URL 不带该头返回 `text/html` 的完整页面（45 929 B）。两者**只有这一个请求头不同**，缓存键（`$request_uri`）完全相同 → 不隔离就是白屏。
7. 上线后用 `curl -I` 验证 `X-Ziyun-Cache` 出现 `MISS` → `HIT`，且带 `auth_token` 的请求恒为 `BYPASS`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/deploy/nginx-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const conf = readFileSync(resolve(ROOT, 'deploy', 'nginx.ziyun.pudafo.com.conf'), 'utf8');
const brotli = readFileSync(resolve(ROOT, 'deploy', 'nginx-brotli.conf'), 'utf8');

describe('the nginx config caches HTML but never for a logged-in user', () => {
  it('declares the cache zone', () => {
    expect(conf).toMatch(/proxy_cache_path\s+\S+\s+levels=1:2\s+keys_zone=ziyun_html:10m/);
  });

  it('bypasses the cache for the session cookie and for RSC flight requests', () => {
    expect(conf).toContain('proxy_cache_bypass $cookie_auth_token $http_rsc;');
  });

  it('never writes the cache for a logged-in user, a cookie-setting response or a flight request', () => {
    expect(conf).toContain('proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;');
  });

  it('never caches for longer than ten seconds', () => {
    expect(conf).toContain('proxy_cache_valid 200 10s;');
  });

  it("ignores Next's private no-store header but keeps Set-Cookie protection", () => {
    expect(conf).toContain('proxy_ignore_headers Cache-Control;');
    expect(conf).not.toContain('proxy_ignore_headers Cache-Control Set-Cookie;');
  });

  it('reports the cache status', () => {
    expect(conf).toContain('add_header X-Ziyun-Cache $upstream_cache_status always;');
  });

  it('only caches GET and HEAD', () => {
    expect(conf).toContain('proxy_cache_methods GET HEAD;');
  });

  it('turns the cache off for every API route', () => {
    const apiBlock = conf.slice(conf.indexOf('location /api/ {'), conf.indexOf('location / {'));
    expect(apiBlock).toContain('proxy_cache off;');
  });

  it('turns the cache off for the MCP stream endpoint', () => {
    const mcpBlock = conf.slice(conf.indexOf('location /mcp'), conf.indexOf('location / {'));
    expect(mcpBlock).toContain('proxy_cache off;');
  });
});

describe('the brotli snippet is opt-in', () => {
  it('turns brotli on with a static precompressed lookup', () => {
    expect(brotli).toContain('brotli on;');
    expect(brotli).toContain('brotli_comp_level 6;');
    expect(brotli).toContain('brotli_static on;');
  });

  it('is not included by the main config', () => {
    expect(conf).not.toContain('include /etc/nginx/conf.d/nginx-brotli.conf;');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/deploy/nginx-config.test.ts`
Expected: FAIL —— `deploy/nginx-brotli.conf` 不存在。

- [ ] **Step 3: 改 `deploy/nginx.ziyun.pudafo.com.conf`**

在 `limit_req_zone` 定义之后、`upstream ziyun_app` 之前插入缓存区定义：

```nginx
# ---------------------- HTML 微缓存 ----------------------
# Next 对每个 HTML 都发 private,no-store,不忽略它就永远缓存不了。
# 只缓存匿名访问的「文档请求」;带 auth_token 的登录态请求、RSC 飞行请求、
# 以及所有 API 响应都既不读也不写缓存。
# TTL 10 秒 —— 目的是省掉往返与传输,不是做内容分发。
proxy_cache_path /var/cache/nginx/ziyun
    levels=1:2
    keys_zone=ziyun_html:10m
    max_size=64m
    inactive=10m
    use_temp_path=off;
```

在 `location / {` 块内（`proxy_pass` 之后）插入：

```nginx
        # HTML 微缓存(仅匿名、仅文档请求)
        proxy_cache ziyun_html;
        proxy_cache_key "$scheme$request_method$host$request_uri";
        proxy_cache_valid 200 10s;
        proxy_cache_methods GET HEAD;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        # 读:登录态与 RSC 飞行请求都不读缓存
        proxy_cache_bypass $cookie_auth_token $http_rsc;
        # 写:登录态、带 Set-Cookie 的响应、RSC 飞行请求都不写缓存
        # (proxy_cache_bypass 只管读不管写,这一行是必需的第二道闸)
        proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;
        proxy_cache_lock on;
        proxy_ignore_headers Cache-Control;
        add_header X-Ziyun-Cache $upstream_cache_status always;
```

在 `location /mcp` 块之后、`location / {` 之前插入 API 兜底块（比 `/api/auth/`、`/api/init/` 短，最长前缀匹配不受影响）：

```nginx
    # ---- API 一律不缓存 ----
    # location / 下还挂着 68 个 GET API 路由,其中 /api/chars/random、/api/game/round、
    # /api/stats 的语义是「每次给新内容」,缓存会让所有用户拿到同一个值;
    # /api/history、/api/notes、/api/membership/me 是用户态数据。
    # 本块比 location /api/auth/ 与 location /api/init/ 短,nginx 取最长前缀匹配,
    # 那两个限流块不受影响。
    location /api/ {
        proxy_pass http://ziyun_app;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_cache off;
    }
```

并把文件里注释掉的 brotli 三行换成一行指向片段文件的说明：

```nginx
# brotli 需要 nginx-module-brotli;探测到再 include:
#   nginx -V 2>&1 | grep -o brotli
#   cp deploy/nginx-brotli.conf /etc/nginx/conf.d/ && sudo nginx -t && sudo systemctl reload nginx
```

- [ ] **Step 4: 创建 `deploy/nginx-brotli.conf`**

```nginx
# brotli —— 仅在服务器编译了 nginx-module-brotli 时 include
#
# 启用步骤:
#   1. nginx -V 2>&1 | grep -o brotli        # 必须有输出
#   2. cp deploy/nginx-brotli.conf /etc/nginx/conf.d/nginx-brotli.conf
#   3. sudo nginx -t && sudo systemctl reload nginx
#   4. curl -I -H 'Accept-Encoding: br' https://ziyun.pudafo.com/ | grep -i content-encoding
#
# 没有 brotli 模块就不要放这个文件 —— nginx 会因未知指令启动失败。
brotli on;
brotli_comp_level 6;
brotli_static on;
brotli_types
    text/plain
    text/css
    text/xml
    application/json
    application/javascript
    application/xml
    image/svg+xml;
```

- [ ] **Step 5: 创建 `deploy/OPTIMIZATION.md`**

内容必须包含：

- **部署顺序**：先 `nginx -t`，再 `systemctl reload nginx`；给出完整的 `cp`/`ln -s`/`nginx -t`/`reload` 命令串。
- **回滚**：`cp deploy/nginx.ziyun.pudafo.com.conf.bak /etc/nginx/sites-available/ziyun.pudafo.com.conf && sudo nginx -t && sudo systemctl reload nginx`；以及 `sudo rm -f /etc/nginx/conf.d/nginx-brotli.conf` 撤销 brotli。
- **上线后验证**（五条命令 + 期望输出）：
  ```bash
  curl -I https://ziyun.pudafo.com/ | grep -i x-ziyun-cache      # 第一次 MISS
  curl -I https://ziyun.pudafo.com/ | grep -i x-ziyun-cache      # 第二次 HIT
  curl -I -H 'Cookie: auth_token=dummy' https://ziyun.pudafo.com/ | grep -i x-ziyun-cache   # BYPASS
  curl -I -H 'RSC: 1' https://ziyun.pudafo.com/ | grep -i x-ziyun-cache   # BYPASS（飞行请求不碰缓存）
  curl -I https://ziyun.pudafo.com/api/stats | grep -i x-ziyun-cache      # 无该头（API 不缓存）
  ```
  再手工确认一次「客户端导航没被缓存污染」：浏览器打开首页 → 点进任意内链 → DevTools Network 里该导航请求的响应 `Content-Type` 必须是 `text/x-component`，且页面白屏/卡死都没有。
- **风险提示（微缓存的三条硬约束）**：
  1. **新增任何「按用户区分」的 cookie 或请求头时，必须同时扩展 `proxy_cache_bypass` 与 `proxy_no_cache`** —— 只改前者会让登录态响应被写进缓存（`proxy_cache_bypass` 只管读不管写）。
  2. **不要给 `location /` 之外的路径加缓存**，尤其不要把 `location /api/` 的 `proxy_cache off;` 删掉 —— 68 个 GET API 路由里混着「每次给新内容」的（`/api/chars/random`、`/api/game/round`、`/api/stats`）和用户态数据（`/api/history`、`/api/notes`、`/api/membership/me`）。
  3. **`$http_rsc` 不能从两条指令里去掉** —— 同一个 URL 带 `RSC: 1` 返回的是 Next 的 flight 数据（`text/x-component`），不带则返回整页 HTML（`text/html`），二者只有这一个请求头不同。缓存键是 `$request_uri`，不隔离就等于把 HTML 喂给客户端路由 → 白屏。
- **线上配置对账待办**（来自 spec §4.2.3）：线上响应带 `Alt-Svc: quic=":443"; h3=":443"`，而仓库配置只有 `listen 443 ssl http2` —— 上线前必须在服务器上核对 `nginx -V` 与 `/etc/nginx/conf.d/` 的实际配置，决定是给仓库补 QUIC 还是把线上改回与仓库一致；同时确认 brotli 模块是否存在。
- **已实测的线上事实**（2026-10-29，改配置前请复核）：`RSC: 1` 是区分 flight 数据与 HTML 的唯一手段（`?_rsc=` 查询参数**不**产生 flight 数据，实测返回 200 `text/html`）；`Next-Router-Prefetch: 1` 单独发会得到 **500**（上游 Next 的行为，不是本项目引入的）；无 `RSC` 头的普通文档请求响应头是 `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` + `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/deploy/nginx-config.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add deploy/nginx.ziyun.pudafo.com.conf deploy/nginx-brotli.conf deploy/OPTIMIZATION.md tests/unit/deploy/nginx-config.test.ts
git commit -m "feat(deploy): add nginx brotli snippet and anonymous HTML microcache [2026-10-29 HH.MM]"
```

---

### Task 7: 预压缩脚本（W2-3）

**Files:**
- Create: `scripts/precompress-assets.mjs`
- Test: `tests/unit/scripts/precompress-assets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 无
- Produces:
  ```js
  export const COMPRESSIBLE_EXTENSIONS;                       // Set<string>
  export const SKIPPED_EXTENSIONS;                           // Set<string>（已是压缩格式）
  export function isCompressible(filePath): boolean;
  export async function precompressFile(filePath, options?): Promise<{ file: string; bytesIn: number; bytesOut: number; status: 'written' | 'skipped' | 'failed' }>;
  export async function precompressTree(dir, options?): Promise<{ written: number; skipped: number; failed: number; savedBytes: number }>;
  ```

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/precompress-assets.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isCompressible,
  precompressFile,
  precompressTree,
} from '../../../scripts/precompress-assets.mjs';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('isCompressible', () => {
  it('accepts text payloads', () => {
    for (const file of ['a.js', 'a.css', 'a.json', 'a.svg', 'a.html', 'a.txt']) {
      expect(isCompressible(file)).toBe(true);
    }
  });

  it('rejects already-compressed payloads', () => {
    for (const file of ['a.woff2', 'a.png', 'a.jpg', 'a.webp', 'a.mp3', 'a.gz', 'a.br']) {
      expect(isCompressible(file)).toBe(false);
    }
  });
});

describe('precompressFile', () => {
  it('writes a .br next to the source and shrinks it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("x");'.repeat(500));
    const result = await precompressFile(file);
    expect(result.status).toBe('written');
    expect(result.bytesOut).toBeLessThan(result.bytesIn);
    const br = await readFile(`${file}.br`);
    expect(br.length).toBe(result.bytesOut);
  });

  it('skips a file whose .br is newer than the source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("x");'.repeat(500));
    await precompressFile(file);
    const second = await precompressFile(file);
    expect(second.status).toBe('skipped');
  });

  it('refuses to touch an already-compressed file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'font.woff2');
    await writeFile(file, 'not really a font');
    const result = await precompressFile(file);
    expect(result.status).toBe('skipped');
    await expect(stat(`${file}.br`)).rejects.toThrow();
  });
});

describe('precompressTree', () => {
  it('walks a directory tree and reports the totals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    await writeFile(join(dir, 'a.css'), 'body{color:red}'.repeat(200));
    await writeFile(join(dir, 'b.woff2'), 'binary');
    const result = await precompressTree(dir);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.savedBytes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/precompress-assets.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现 `scripts/precompress-assets.mjs`**

- 用 `node:zlib` 的 `brotliCompress`（`params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }`）与 `gzip`（`level 9`）各生成一份 `.br` 与 `.gz`。
- `isCompressible`：扩展名在 `COMPRESSIBLE_EXTENSIONS` 里且**不在** `SKIPPED_EXTENSIONS` 里。`COMPRESSIBLE_EXTENSIONS` = `.js .mjs .css .json .svg .html .txt .xml .map`；`SKIPPED_EXTENSIONS` = `.woff .woff2 .png .jpg .jpeg .gif .webp .avif .ico .mp3 .mp4 .zip .gz .br .ttf .otf .pdf`。
- `precompressFile(filePath, { force = false })`：
  - 不可压缩 → `{ status: 'skipped' }`；
  - `.br` 已存在且 mtime ≥ 源文件 mtime 且 `force` 为 false → `{ status: 'skipped' }`；
  - 否则写 `.br`（以及 `.gz`），返回 `{ status: 'written', bytesIn, bytesOut }`；写失败 → `{ status: 'failed' }`（**记录错误，不吞掉**）。
- `precompressTree(dir, options)`：递归遍历，累加 `written/skipped/failed/savedBytes`（savedBytes = 源文件字节 − `.br` 字节之和）。
- CLI 默认扫描 `.next/static` 与 `public/font`（后者只有 CSS/JSON 有意义，`.woff2` 会被跳过），也接受命令行目录参数。**脚本本身不删任何文件**，只新增 `.br` / `.gz`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/precompress-assets.test.ts`
Expected: PASS。

- [ ] **Step 5: 加 npm script 并实跑**

```json
"assets:precompress": "node scripts/precompress-assets.mjs",
```

Run: `npm run assets:precompress`
Expected: 打印每个目录的 `written/skipped/failed` 与节省字节数。

> `.next/` 与生成的 `.br`/`.gz` 都是构建产物，**不入库**。确认 `.gitignore` 已覆盖 `*.br` / `*.gz`；没覆盖就补两行（属于本任务）。

- [ ] **Step 6: 提交**

```bash
git add scripts/precompress-assets.mjs tests/unit/scripts/precompress-assets.test.ts package.json .gitignore
git commit -m "feat(deploy): add the brotli and gzip asset precompressor [2026-10-29 HH.MM]"
```

---

### Task 8: 服务器调优清单（W2-4）

**Files:**
- Create: `deploy/tuning/ipv4-bbr.conf`
- Create: `deploy/tuning/README.md`

**Interfaces:**
- Consumes: 无
- Produces: 一份 sysctl 配置文件 + 一份「怎么查、怎么上、怎么确认、怎么退」的操作手册。

- [ ] **Step 1: 创建 `deploy/tuning/ipv4-bbr.conf`**

```
# TCP 调优 —— 跨境链路 (中国联通 → 新加坡) 的吞吐
#
# 实测基线: RTT 250 ms,单连接持续吞吐 177 KB/s。
# BBR 把拥塞控制从「缓冲区填满才丢包」换成「按带宽时延积发包」,
# 在这种高时延链路上通常能翻数倍。
#
# 应用:  sudo cp deploy/tuning/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
#        sudo sysctl --system
# 回滚:  sudo rm /etc/sysctl.d/99-ziyun-bbr.conf && sudo sysctl --system
#
# 注意: BBR 只对**新建**的连接生效,已在跑的连接仍用旧算法。
# 验证:  ss -tin | grep -i bbr

net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
```

- [ ] **Step 2: 创建 `deploy/tuning/README.md`**

必须包含：

- **改前先看现状**：
  ```bash
  sysctl net.ipv4.tcp_congestion_control
  sysctl net.core.default_qdisc
  ```
- **应用**：
  ```bash
  sudo cp deploy/tuning/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
  sudo sysctl --system
  ```
- **确认生效**：
  ```bash
  sysctl net.ipv4.tcp_congestion_control     # 期望 bbr
  ss -tin | grep -i bbr                       # 新连接应显示 bbr
  ```
  `bbr` 不在 `tcp_congestion_control` 的可选值里时，先 `sudo modprobe tcp_bbr && sudo sysctl -w net.ipv4.tcp_congestion_control=bbr`；仍不可用说明内核太老（需 ≥ 4.9），此时**只应用 qdisc 与缓冲区那几行**。
- **回滚**：删文件 → `sudo sysctl --system`。
- **风险**：调大 `rmem_max/wmem_max` 会增加单连接内存占用；机器内存紧张时把 `16777216` 调成 `4194304`。
- **它解决的是什么**：这条链路 250 ms 的 RTT 下,Linux 默认拥塞控制的有效窗口约 44 KB,正好对应实测的 177 KB/s。这是**带宽**问题,和字体瘦身(载荷问题)是两条独立的线。

- [ ] **Step 3: 提交**

```bash
git add deploy/tuning/ipv4-bbr.conf deploy/tuning/README.md
git commit -m "docs(deploy): add the BBR and TCP buffer tuning checklist [2026-10-29 HH.MM]"
```

> 本任务**不改服务器**，只提供文件与说明。是否执行由用户决定。

---

### Task 9: 性能基线进仓库（W2-5）

**Files:**
- Create: `scripts/perf/class-attribution.mjs`
- Create: `scripts/perf/paired-ttfb.mjs`
- Create: `scripts/perf/font-load.mjs`
- Create: `scripts/perf/full-load.mjs`
- Test: `tests/unit/scripts/perf-class-attribution.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 无（三个测量脚本走网络）
- Produces:
  ```js
  // scripts/perf/class-attribution.mjs
  export function splitHtmlChunks(html: string): Array<{ tag: string; attrs: string; text: string }>;
  export function attributeForClass(chunks, className: string): string[];
  export function classOfChunk(attrs: string, classNames: string[]): string;
  ```

  **下标必须正确**：`re.split(r"<(\w+)([^>]*)>", html)` 的结果是
  `[text0, tag0, attrs0, text1, tag1, attrs1, text2, …]`，
  所以第 i 个标签的**属性在 `3i+2`**、**正文在 `3i+3`**。
  第一版诊断脚本按 2 步长取值，把标签名当成了属性，导致「多数文本块归入 sans」的假象，把首页字体载荷低估成 2.83 MB（实为 3.81 MB）。**本模块的单元测试必须锁死这个下标。**

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/perf-class-attribution.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  splitHtmlChunks,
  attributeForClass,
  classOfChunk,
} from '../../../scripts/perf/class-attribution.mjs';

describe('splitHtmlChunks', () => {
  it('splits a tag into its name, its attributes and its text', () => {
    const chunks = splitHtmlChunks('<p class="font-kai">字</p>');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tag).toBe('p');
    expect(chunks[0].attrs).toBe('class="font-kai"');
    expect(chunks[0].text).toBe('字');
  });

  it('keeps the tag name out of the attributes', () => {
    const chunks = splitHtmlChunks('<div id="a"><span>x</span></div>');
    expect(chunks[0].attrs).not.toContain('div');
    expect(chunks[0].attrs).toBe('id="a"');
  });

  it('yields one chunk per tag', () => {
    const html = '<h1>一</h1><p class="font-serif">二</p><span>三</span>';
    expect(splitHtmlChunks(html)).toHaveLength(3);
  });
});

describe('attributeForClass', () => {
  it('returns the text of the chunks carrying the class', () => {
    const chunks = splitHtmlChunks(
      '<h1 class="font-kai">字</h1><p class="font-sans">韵</p>',
    );
    expect(attributeForClass(chunks, 'font-kai')).toEqual(['字']);
    expect(attributeForClass(chunks, 'font-sans')).toEqual(['韵']);
  });

  it('does not confuse the tag name with the attributes', () => {
    // A <font-kai> tag name must never be read as the class attribute.
    const chunks = splitHtmlChunks('<font-kai>字</font-kai>');
    expect(attributeForClass(chunks, 'font-kai')).toEqual([]);
  });
});

describe('classOfChunk', () => {
  it('prefers the first matching class in the given order', () => {
    const order = ['font-kai', 'font-serif', 'font-sans'];
    expect(classOfChunk('class="font-serif font-sans"', order)).toBe('font-serif');
    expect(classOfChunk('class="font-sans"', order)).toBe('font-sans');
    expect(classOfChunk('class="other"', order)).toBe('font-sans');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/perf-class-attribution.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现 `scripts/perf/class-attribution.mjs`**

```js
export function splitHtmlChunks(html) {
  const parts = html.split(/<(\w+)([^>]*)>/);
  // parts = [text0, tag0, attrs0, text1, tag1, attrs1, text2, ...]
  const chunks = [];
  for (let i = 1; i + 2 < parts.length; i += 3) {
    chunks.push({ tag: parts[i], attrs: parts[i + 1], text: parts[i + 2] });
  }
  return chunks;
}
```

`attributeForClass(chunks, className)`：返回所有 `attrs` 里出现 `class="..."` 且其中含该 class 名的 chunk 的 `text`。
`classOfChunk(attrs, classNames)`：按 `classNames` 的顺序返回第一个命中的；都没命中时返回 `classNames[classNames.length - 1]`（默认 sans）。

**必须再剥掉 `<script>` / `<style>` 的内容**（脚本里的中文不是页面文字）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/perf-class-attribution.test.ts`
Expected: PASS。

- [ ] **Step 5: 实现 `scripts/perf/paired-ttfb.mjs`**

- 用 `node:https` 的 `Agent({ keepAlive: true })` 走**同一条 keep-alive 连接**。
- 每个页面采样 N（默认 15）次：先取静态基线 `GET /manifest.json` 的 TTFB，再取 `GET <page>` 的 TTFB，记录差值。
- 输出每个页面的**中位数**差值与 min/max；页面上限硬编码为 `+24 ms`（spec §2.2），超了退出码 1。
- 基址来自 `--base` 参数，默认 `https://ziyun.pudafo.com`。

- [ ] **Step 6: 实现 `scripts/perf/font-load.mjs`**

- 取页面 HTML → `splitHtmlChunks` → `classOfChunk` → 每族收集字符集（归属规则与 `data/font-page-profiles.json` 一致：`font-kai` → kai，`font-serif` → serif，其余 → sans）。
- 用 Task 1 的 `loadFamilyCharsets()`（热区 + 16 码位 Ext 窗口）与 `public/font/fonts-manifest.json`，算出「每族要下载哪些文件」，累加文件**字节**与**文件数**。
- 打印表格：`page | sans KB | serif KB | kai KB | total KB | font files`，并对照预算 `/ ≤ 350 KB`、`/dictionary ≤ 300 KB`、`/poetry ≤ 350 KB`、`/stories ≤ 500 KB`、文件数 ≤ 130（R9）；超标退出码 1。

- [ ] **Step 7: 实现 `scripts/perf/full-load.mjs`**

- **冷连接**取页面 HTML，解析出所有 stylesheet / script / font `url()`，逐个下载（同样走 keep-alive）。
- 打印：HTML 字节、JS+CSS 字节、字体字节、总字节、总耗时（秒）、并与 R9 的「首页冷加载 ≤ 5 s」对照（spec §2.2 原写的 2.5 s 是在旧字体模型下估的，见「字体机制裁决」）。

- [ ] **Step 8: 加 npm script**

```json
"perf:ttfb": "node scripts/perf/paired-ttfb.mjs",
"perf:fonts": "node scripts/perf/font-load.mjs",
"perf:load": "node scripts/perf/full-load.mjs",
```

- [ ] **Step 9: 提交**

```bash
git add scripts/perf/class-attribution.mjs scripts/perf/paired-ttfb.mjs scripts/perf/font-load.mjs scripts/perf/full-load.mjs tests/unit/scripts/perf-class-attribution.test.ts package.json
git commit -m "feat(perf): add the paired ttfb and font payload probes [2026-10-29 HH.MM]"
```

---

## 收尾（全部任务完成后）

- [ ] 跑一次完整验证：
  ```bash
  npm test
  npm run fonts:verify-webfont
  ```
  两者都必须绿。
- [ ] 在 `D:/Temp/pinyin-build-check` 里（先 `rm -rf .next`，且确认 4444 端口未被占用）跑一次 `npm run build`，确认字体改造没有破坏构建（G8）。
- [ ] 跑一次 `npm run perf:fonts -- --base http://127.0.0.1:4444`，用本地 dev server 验证四个页面的字体载荷落在预算内。
- [ ] 把本轮结果写进 `docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md` 的「验收」小节，或另起一份实施记录。
- [ ] **不 push**（G6）。把分支名、提交数、待用户执行的动作（服务器 nginx 部署、BBR、CDN 决策、浏览器 smoke）汇总给用户。

## 仍需用户执行 / 决策的事项（本计划不代劳）

1. **服务器 nginx 部署与回滚**——`deploy/OPTIMIZATION.md` 里有完整命令串，但服务器上的操作由用户执行（需要 sudo）。
2. **BBR 是否应用**——`deploy/tuning/` 只提供文件与说明。
3. **CDN 接入**——需要用户的 Cloudflare 账号；代码侧只预留了 nginx 注释。
4. **线上 nginx 配置对账**——线上带 `Alt-Svc: quic` 而仓库配置没有，需要在服务器上核对后决定往哪边对齐。
5. **浏览器 smoke**——字体改造后需要人工过一遍 `/`、`/dictionary`、`/poetry`、`/stories`、`/ancient`、`/stories`（故事大字）、`/not-found`（160px 的「无」）、`/error`（120px 的「误」），确认没有豆腐块、没有明显字体闪烁、粗体楷体正常。

---

## 本轮由我（Claude）代做的三个默认选择（用户未逐项回答）

用户中断了确认问卷后指示「继续」，因此以下三项是**我按推荐项代做的决定**，不是用户的答复。执行前请用户确认；任何一项要改，改的是本计划对应小节，不是代码。

| # | 议题 | 我的默认选择 | 依据 | 推翻它要改什么 |
|---|---|---|---|---|
| D1 | 字体 | **保留三款 webfont 及其全部字形/字重**，按站内真实用字重新子集化（不做换字体、不做可变字体以外的形变） | 用户要求「保持外观」，spec G9 也这么写 | Task 1/3 的字符集来源表与 `FAMILIES` 表 |
| D2 | 基础设施 | **我直接改 `deploy/nginx.ziyun.pudafo.com.conf` 并给出 deploy/rollback 命令串**；CDN 保持可选、代码侧只留注释 | 微缓存与 brotli 片段是本轮收益最大的一档 | Task 6 |
| D3 | 机房 | **不迁移**（保留现机房与 `139.5.108.245`） | 迁移会把本轮变成多项目工程，且用户未提出 | 不涉及代码；只影响 Task 8 的服务器调优清单适用范围 |

