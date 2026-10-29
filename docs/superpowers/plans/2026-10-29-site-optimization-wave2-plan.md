# 站点性能优化 Wave 2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把生产环境的字体载荷从**实测的 2.9–4.2 MB/页**（今天的真实基线，F27-j 用修正后的页面取字 fixture 重测；更早的 3.7–5.0 MB 是模型值、2.0–3.7 MB 是归因错误时的值）降到 **221–308 KB/页**（F27-j 的重定预算：首页 308 / 字典 308 / 诗词 221 / 故事 308 KB，**9.3–18.9 倍**），每页字体请求数从 43–75 个降到 **3–4 个**，首屏冷加载从 ~21 s 降到 ~5 s，同时保证零缺字、零 FOUT、登录态页面不进入任何缓存。

**Architecture:** 放弃 Google Fonts 的「按码位区间切分」，改为**按站内用字自建子集**：每族（Noto Sans SC / Noto Serif SC / LXGW WenKai TC）切成 **一个热区文件（300 字）+ 若干 Ext 文件（其余字按**频率序**每 6 个字符切一块，F25）**。**热区里装什么字是免费的**（热区大小固定），所以热区先装「四个测量页面真正画出来的字」（页面画像并集，F27-j-c），再用语料频率头补齐；楷体同样有热区（F27-j-d）。同一族的所有 `@font-face` 共用**一个 font-family 名**，每条 face 带**互不相交的精确 `unicode-range`**（= 该文件实际含有的码位并集），因此浏览器只会下载页面真正命中的那几个文件。字体源字体由 `fonttools varLib.instancer` 把 `wght` 裁到 `[400,700]`（实测省 10–11 % 的子集字节，不是 F25 写的 44 %），再用仓库已有的 `subset-font` 切分。**真实成本不是线性模型**：子集字节由每个字形的轮廓复杂度决定，分布重尾——同一个 6 字块实测从 852 B 到 6 600 B（F27 的实测分布，见「第三轮实测修正的字节数（F27）」一节）。非字体侧同步落地：nginx brotli + HTML 微缓存（强制绕过 `auth_token`）、BBR 调优清单、预压缩脚本、可复现的性能基线脚本。

**Tech Stack:** Node 22 · npm · `subset-font`（`package.json` 声明 `^2.4.0`，已安装 **2.5.0**，devDependency）· `fontkit`（`^2.0.4`，已安装 2.0.4，运行时依赖）· Python `fonttools 4.61.1` + `brotli 1.2.0`（构建期，已装）· nginx（Ubuntu/Debian 包）· vitest

**Spec:** `docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`（绑定权威；本计划是它的论证）

---

## Global Constraints

以下每一条都适用于**所有**任务：

- **G1 语言**：给用户的说明用中文；代码标识符、commit message、UI 文案用英文。
- **G2 commit 格式**：subject 结尾带 `[YYYY-MM-DD HH.MM]`（例：`feat(fonts): ... [2026-10-29 14.30]`），正文末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。⚠️ 下面各任务里 `[2026-10-29 HH.MM]` 是**占位符**：提交时必须换成 `date "+%Y-%m-%d %H.%M"` 的**真实本地时间**，不许把 `HH.MM` 原样提交上去。
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
| R2 | spec §4.1.4 说 kai 的字符集是「7 + 2 + 3 ≈ 2 000 字」 | **kai 字符集 = 源码字面量 + 古籍/经文标题 + 罕见字本身**（`data/content/<char>.json` 里带 `rare` 字段的那 1 412 个 `char`），**不含故事正文** | 故事正文渲染在 sans/serif 里，把它塞进 kai 会把稠密窗口填满，让**每一个**页面替故事正文付费（实测首页 kai 51 KB vs 35 KB）。但故事详情页的大字（`app/stories/StoryClient.tsx:117` 的 `font-kai font-bold text-9xl`）渲染的是罕见字**本身**，所以罕见字必须进 kai。实测 kai 真实字符集 **2 601 字** → 16 码位窗口 = **1 027 块 × 2 字重 = 2 054 个文件**（**R16 在此之上追加了 8 105 个库字符 → 8 197 字 / 1 348 块 / 2 696 个文件**） |
| R3 | spec §3.6 说「楷体可以只发布 Regular 一个字面」 | **kai 同时发布 400 与 700** | 全站有 3 处 `font-kai font-bold`（`app/ancient/page.tsx:50`、`app/ancient/[slug]/page.tsx:101`、`app/stories/StoryClient.tsx:117`），最后一处是 `text-9xl` 的故事大字——合成加粗在 9xl 上非常难看。Bold 只在真正渲染粗体楷体时才下载 |
| R4 | spec §4.1.2 给出 fallback 链但没说 `unicode-range` 怎么用 | **每一条 `@font-face`（热区与 Ext 全部）都带精确 `unicode-range`，且同族内两两不相交** | 浏览器对同一 family 的多个 face 会**逐个下载探测**直到找到含该字的字体。Ext 有几千个 face，没有 `unicode-range` 会把整族全下下来。区间不相交还保证「同一个字只可能落在一个文件里」，不会有歧义 |
| R5 | spec §3.5 说 sans 需要 16 772 字、serif 20 616 字 | **sans 字符集 = 全部语料 + 源码；serif 字符集 = sans 的全部 + 经文 + 古籍**（即 serif ⊇ sans） | 正文（sans）渲染一切内容，serif 只渲染字典/故事/经文/古籍正文。宁可多包含，不可漏字；多出来的成本由 Ext 分块摊薄 |
| R6 | spec §4.2.1 说「有 brotli 就启用」 | **主配置里 brotli 保持注释**，另出一个 `deploy/nginx-brotli.conf` 片段文件，服务器上 `nginx -V \| grep -o brotli` 有输出才 `include` | nginx 没有条件编译。在没装 brotli 模块的机器上直接解注释会让 `nginx -t` 失败、线上 nginx 起不来。片段文件让「探测→启用」成为一个可执行的两步动作 |

### 字体机制裁决（2026-10-29 实测后追加，R8–R15）

这一组裁决来自一轮真实测量（仓库语料 + 生产站点四个页面的服务端 HTML），它们**推翻了 spec §4.1 的分档机制**，理由是 spec 给出的机制**产不出 spec 自己要的字节**。

**测出来的物理约束（后面每条裁决都建立在它上面）：**

> ⚠️ **这一组约束已被 F25 推翻**（见下文「第二轮实测推翻的机制」）：真实的子集成本是 `fixed(≈1 000 B) + perChar × 字数`，不是 `229 B/字`；真实的 CSS 成本是 `2.8 B/字 + 5 B/face`，不是 `13 B/块`。下面三条保留在这里作为**第二轮的原始测量记录**，R8–R17 的机制与数字以 F25 为准。

- 单页静态子集成本 ≈ `229 B × (命中块数 × 块内字数)`。块越小越省字节，但块数（= 请求数）会涨。
- CSS 成本 ≈ `13 B/块(gzip)`。块数就是 CSS 的字节数。
- 因此 **CSS 预算与字体预算是直接对立的两端**：压 CSS 就是加块数，加块数就是压字节。spec §3.2 的「单页 ≤ 250 KB」与 §3.3 的「CSS ≤ 25 KB」在静态子集下**不可兼得**。
- 实测每字成本（`fontTools varLib.instancer` + `subset-font`，100 字样本）：变量 `wght 100–900` = 246.3 B/字；实例化 `wght 400:700` = **229.4 B/字**；静态 400 单字重 = 136.1 B/字。选 `400:700`（229.4）比全变量省 7 %，比 Google 自己的 305–407 B/字省 25–42 %。

| # | 矛盾 | 裁决 | 理由 |
|---|---|---|---|
| R8 | spec §4.1.1 的「Tier1 前 200 / Tier2 200–800 / Ext 每 256 码位一块」实测产不出 spec §3.2 自己要的字节：首页 984 KB / 诗词 1 446 KB / 故事 1 350 KB（目标 250 / 250 / 400 KB） | **改为「热区 + Ext 按 16 码位窗口切」**：sans/serif 热区 300 字，Ext 窗口 16 码位；楷体无热区 ⚠️ **机制部分已被 F25 取代**（Ext 改为频率序、每块 6 个字符） | 实测新机制（字符集 sans 16 968 / serif 19 888 / kai **8 197**，块数 2 786 / 3 115 / 1 348，文件共 **8 597** 个）：首页 **307 KB** / 字典 **212 KB** / 诗词 **284 KB** / 故事 **419 KB**，CSS **119.1 KB**(gzip)。相比现状的 3 813–4 985 KB 是 **10–13 倍**的下降。⚠️ 这组数字出自**错误的成本模型**（229.4 B/字、无每文件固定开销），F25 用真实字节重测后机制与数字一并作废 |
| R9 | spec §3.2 的单页 ≤ 250/350/250 KB 与 §3.3 的 CSS ≤ 25 KB(gzip) | **重定预算**（本计划与 Task 4/9 按此执行）：单页字体 `/` ≤ 350 KB、`/dictionary` ≤ 300 KB、`/poetry` ≤ 350 KB、`/stories` ≤ 500 KB；三份 CSS 合计 ≤ **125 KB**(gzip，见 R17)；单页字体请求数 ≤ 130 个；冷加载 ≤ 5 s（现状 21–28 s） ⚠️ **数字已被 F25-c / F25-d 取代** | 这是对 spec 目标的**显式偏离**，登记在案而不是默默吸收。CSS 是一次性可缓存成本，字体是每次访问成本——预算该花在后者身上 |
| R10 | spec §4.1.3 只说「剩余字符按码位递增后每 N 字一块」，没说按**字符个数**切还是按**码位窗口**切 | **Ext 按码位窗口切**：窗口 = 码位落在 `[k×W, (k+1)×W)` 的全部字符，`W = 16` ⚠️ **已被 F25-a 取代** | Task 1 实现者自己的 C1 发现：256 字一块 + 逐字精确区间 → CSS 185 KB(原始)；同一批字按 min–max 区间 → 1.7 KB。按字符个数切还会产生**空的尾块**（C2）。⚠️ F25 用同一成本模型实测：码位窗口机制在同文件数下比频率序多付 **32 % 的页面字节** |
| R11 | spec §4.1.1 保留 Tier2 这一档 | **删掉 Tier2**（热区之后不再分档） | 语料尾部每个字只出现一次 → 尾部频率信号是均匀的，「按频率分档」在尾部等价于任意分组。实测把热区加大只会把热区文件本身撑大（热区文件每页都要整份下载）：首页 热区 0 → 325 KB，热区 300 → **295 KB**，热区 450 → 325 KB，热区 600 → 366 KB，热区 1000 → 504 KB |
| R12 | Ext 块的 `unicode-range` 用「块内最小–最大码位」的区间，还是「块内码位并集」的精确并集 | **用精确并集**（`unicodeRange()`），不用 min–max 区间 | min–max 区间会覆盖**文件里没有的字**：浏览器按区间选中这个 face → 直接渲染豆腐块，而不是回退系统字体。精确并集多花约 31 KB(gzip) 的 CSS（一次性、可缓存），换掉唯一一条产生豆腐块的路径 |
| R13 | spec §3.2 想要 ≤ 250 KB/页 | **本轮不做**，登记为下一波 | 真要 250 KB/页需要按页/按需动态子集：新增运行时依赖（G3 明令禁止）+ 约 3 万个文件 |
| R14 | spec §3.6 没规定楷体要不要热区 | **楷体不设热区**（`tier1Size = 0`），只用 Ext 窗口 | 楷体全站只渲染约 38 字（首页），但 300 字的热区文件按 400/700 两份算 = 每页白付 137 KB。实测：楷体热区 0 → 首页 295 KB，楷体热区 300 → 335 KB（R16 落地后这套数字整体上移，首页 307 KB） |
| R15 | spec §4.1.2 的 fallback 链暗示「每档一个 font-family 名」（`Noto Sans SC 1` / `2` / `Ext`） | **一族一个 font-family 名**（`Noto Sans SC`），所有 face 靠互不相交的 `unicode-range` 区分 | 区间互不相交时不需要跨族 fallback 链；一族一名去掉了「同族多条 face 谁生效」的歧义，也让 Task 3/5 少一套族名 |
| R16 | G10（零缺字）要求「站内能渲染的汉字一个都不能落到豆腐块」，但**楷体的字面量语料（2 601 字）盖不住接龙游戏会渲染的库字符** | **楷体字符集 = 原来的 2 601 字 + `data/general-standard-chinese-characters.json` 的 8 105 个通用规范汉字 = 8 197 字**；三族窗口宽度统一为 **16 码位** ⚠️ **块宽部分已被 F25-a 取代（频率序、每块 6 个字符）** | `components/game/ChainScroll.tsx:63`、`components/game/ChainPickerModal.tsx:24`、`components/game/quest/WrongBook.tsx:118`、`components/game/quest/QuestCharCard.tsx:52` 都用 `font-kai` 渲染库字符，而选字面板（`ChainPickerModal`）按拼音把整池候选字铺出来——`chars-all` 难度 + HSK 4 级以上时池子就是全部 8 105 字。盖不住 → 这些字落到 `--font-kai` 兜底链的 `Kaiti SC`/`STKaiti`/`serif`，游戏页出现两种字体混排（G10 的实质）。`data/hsk-vocab.json` 的 2 632 个 HSK 字被这 8 105 字完全覆盖（实测差集 0），不必单收。**代价**：楷体 1 030 块 → 1 348 块、2 054 → 2 696 个文件，首页楷体 21 KB → 47 KB，CSS +13 KB。实测见下表 |
| R17 | R9 原定的「三份 CSS 合计 ≤ 110 KB(gzip)」在 R16 落地后**不可达** | **CSS 预算 110 KB → 125 KB(gzip)** ⚠️ **已被 F25-d 取代（125 → 175 KB）** | (1) CSS 字节数 ≈ `13–20 B/块(gzip)`，块数由字符集规模 × 窗口宽度决定；(2) R16 要求楷体带上 8 105 库字 → 总块数 6 928 → 7 249；(3) 实测把窗口宽度从 16 放宽到 32 才能把 CSS 压回 110 KB 附近，但那时首页 341 KB / 故事 439 KB，窗口内的「填充字」要每个页面买单；(4) 现网三份 CSS 合计 **132.7 KB**(gzip)（Google 的逐码位逗号列表格式），新机制 119.1 KB 仍是**净下降**；(5) CSS 是首次访问的一次性可缓存成本，而字体是每次访问成本——把预算挪给字体是划算的。⚠️ F25 实测真实 CSS 成本模型为 `2.8 B/字 + 5 B/条 face`（不是 13–20 B/块），并给出**无衬线那份是渲染阻塞的**这一事实，预算必须分族设 |

**R16/R17 的实测前沿**（`scripts/fonts/staging/sweep.mjs`，`W` = sans/serif 窗口宽度，`hot` = sans/serif 热区字数，`kaiW` = 楷体窗口宽度；字节为四个测量页里的最差值）：

> ⚠️ 这张表是**码位窗口机制**下的前沿，已被 F25 的实测前沿取代（频率序 6 字/块 → 最差页 441 KB / CSS 168 KB / 8 779 文件）。这张表保留是为了记录「同一个字符集在不同窗口宽度下会怎样」，R11 的热区曲线结论仍然成立。

| 楷体语料 | 配置 | 最差页 | CSS(gzip) | 字体文件数 | 结论 |
|---|---|---|---|---|---|
| 2 601 字（不含库字） | W=16 hot=300 kaiW=16 | 411 KB | 106.7 KB | 7 961 | 满足原预算，但库字掉到系统字体 |
| 8 197 字（含库字） | W=16 hot=300 kaiW=16 | **419 KB** | **119.1 KB** | **8 597** | **采用**：页面/请求数全达标，CSS 预算放宽到 125 KB |
| 8 197 字（含库字） | W=16 hot=300 kaiW=32 | 439 KB | 113.0 KB | 7 427 | 窗口越宽填充字越多，页面更贵 |
| 8 197 字（含库字） | W=8 hot=300 kaiW=16 | 289 KB | 126.5 KB | 11 828 | 页面最省，但 CSS 与文件数超预算 |
| 8 197 字（含库字） | W=12 hot=300 kaiW=8 | 346 KB | 140.5 KB | 12 121 | CSS 超预算 |
| 8 197 字（含库字） | W=24 hot=300 kaiW=16 | 542 KB | 113.4 KB | 7 148 | 故事页超预算（>500 KB） |

热区字数的实测曲线（R16 语料、W=16、kaiW=16）：hot 0 → 589 KB（216 个请求/页）、hot 150 → 472 KB（157 个请求/页）、**hot 300 → 419 KB（114 个请求/页）**；hot 450 以上在 R11 的旧语料曲线上同样是更差（首页 450 → 325 KB vs 300 → 295 KB）。热区 300 是唯一同时压住字节与请求数的取值——热区文件是**整份下载**的，字数越多每个页面白付的越多，而窗口块才是「按需」的。

**已知未覆盖面**：`/game` 接龙页的选字面板（`ChainPickerModal`）把**候选字**——与当前字同音的全部库字——铺在 `font-kai` 里，候选集合随拼音变化，**无法用静态 HTML fixture 抓取**，因此不在四个测量页的预算内。它不会造成缺字（R16 已把 8 105 个库字全部纳入楷体），但最坏情况（某个常用音的候选字最多）它会拉下几十个楷体块。这一页的真实字节数留到 Task 9 的性能基线脚本在真实站点上量。 |

### 第二轮实测推翻的机制（F25，2026-10-29）

R8–R17 那一轮建立在一个**错误的成本模型**上：单页静态子集成本 ≈ `229.4 B × 命中字数`，**没有每文件固定开销**。真实子集不是这样的。F25 用真实产出的 woff2 字节重测了成本模型与切分机制，**推翻 R8 的「按 16 码位窗口切」**（R10 一并作废），并把 R9 的页面预算与 R17 的 CSS 预算重定到**真实可达**的数字。

**真实成本模型**（实测：`fonttools varLib.instancer` + 仓库已有的 `subset-font`，每族用 4/8/16/32/64 字四档样本做最小二乘拟合）

> ⚠️ **这张成本模型表已被 F27 推翻，下面的 fixed / perChar 数字不要再引用。** 它假设「字节 = fixed + perChar × 字数」线性成立；F27 用真实子集证明**字节由字形的轮廓复杂度决定、分布重尾**：同一个 6 字块实测从 852 B 到 6 600 B（差 7.7 倍），罕见尾部的字比热区的常用字贵 2–3 倍。线性拟合出的 perChar 只是一个平均数，用它外推页面字节必然错。

每个子集文件 ≈ `fixed + perChar × 字数`：

| 族 | fixed | perChar | 权重份数 | 说明 |
|---|---|---|---|---|
| `sans` | ≈1 000 B | 276 B | 1 | 源字体已实例化到 `wght 400–700`，单文件覆盖两个字重 |
| `serif` | ≈1 000 B | **280 B** | 1 | 实例化之后；**未实例化是 499 B/字**——裁轴省 44 % ⚠️ **实测只省 10–11 %**（F27-b） |
| `wenkai` | ≈900 B | 255 B | **2** | 静态 Regular / Bold 各一份 |

- `fixed` **不可压缩**：`dropTables` / `nameIDs` / `noLayoutClosure` / `notdefGlyph:false` / `desubroutinize` 全部试过，输出**逐字节相同**。它不是表头开销，是第一个字形本身。
- 因此 **窄块比宽块更贵**（不是更便宜）：每文件都要付一次 fixed。频率阶梯（热区 | 32 | 8 | 2）实测 834 KB，比统一宽度 8 的 532 KB 更差。
- CSS 成本 ≈ `2.8 B/字`（`unicode-range` 的十六进制，gzip 后）+ `5 B/条 face`（样板）。**码位连续的块 hex 便宜（≈0.5 B/字），频率序的散点块 hex 贵（≈2.8 B/字）**——这是频率序要付的代价。
- 合成探针给出的「19 B/face」是错的（样板重复得太整齐，gzip 奖励了它）。**真实 CSS 成本必须生成真实样式表再 gzip 量。**
- 现网三份 CSS 合计 132.7 KB(gzip)——**几乎全部是字体 CSS**（sans 31 / serif 31 / wenkai 71）。所以 CSS 这一侧没有「顺带省下来」的余地，预算必须按真实模型给。

**机制对决**（同一成本模型、同一批页面；机制 A = 计划的码位窗口，机制 B = 频率序按字符个数切块）

> ⚠️ **下表的字节列已被 F27 用真实子集重测过（见「第三轮实测修正的字节数（F27）」一节），以 F27 的表为准；而 F27 的页面预算与实测前沿又已被 F27-j 取代（见「第四轮实测推翻的归因与热区（F27-j）」）。** 本表保留下来只为记录「为什么机制 B 赢」这个结论——结论不变（频率序赢），但**幅度从模型的 32 % 变成实测的 36 %**。

| 机制 | 最差页字体 | CSS(gzip) | 文件数 | 请求/页 |
|---|---|---|---|---|
| A 码位窗口 8 | 643 KB | 195 KB | 14 551 | 236 |
| A 码位窗口 16（R8 的取值） | 645 KB | 166 KB | 8 597 | 118 |
| A 码位窗口 32 | 1 487 KB | 149 KB | 5 053 | 196 |
| B 频率序 4 字/块 | **391 KB** | 188 KB | 13 166 | 113 |
| **B 频率序 6 字/块（本轮采用）** | **441 KB** | 168 KB | 8 779 | 109 |
| B 频率序 8 字/块 | 495 KB | 156 KB | 6 585 | 113 |
| B 频率序 16 字/块 | 629 KB | 140 KB | 3 295 | 94 |
| B 频率阶梯 12/32/8 | 834 KB | — | — | — |

**为什么频率序赢**：一个页面命中一个块，就要把**整块**下载下来。频率序把常用字排在前面，一个页面的字因此聚在少数几块里，每块都用得满；码位窗口按码位区间切，页面的散字会散落在几十个窗口里，每个窗口都整份下载。**同一文件数下频率序省 32 % 的页面字节。**

**F25 裁决**

| # | 裁决 |
|---|---|
| **F25-a** | **Ext 块改为「频率序、每块 6 个字符」**，不再是码位窗口。R8 的机制部分与 R10 一起作废；R12（精确并集、不用 min–max 区间）**继续有效且更重要**——频率序的块在码位上是散的，min–max 区间会直接制造豆腐块（G10）。✅ **F27-a 复核：机制成立**，用真实字节重测后频率序仍胜 36 %。 |
| **F25-b** | **热区保留**：sans/serif 热区 300 字，wenkai 无热区（R14 不变）。理由变了：无热区时请求数 148–176/页，超 R9 的 130 上限；有热区时 109/页。✅ **F27-h 复核：成立**，实测无热区是 125–177 请求/页。 ❌ **F27-j-d 推翻**：楷体现在**必须有 300 字热区**（否则诗词页要开 120 个楷体文件），R14「楷体无热区」作废。 |
| **F25-c** | **重定 R9 的页面预算**（字体字节，不含 CSS）：`/` ≤ 460 KB、`/dictionary` ≤ 420 KB、`/poetry` ≤ 320 KB、`/stories` ≤ 480 KB。实测 **431 / 387 / 287 / 441 KB**。请求数 ≤ 110/页（预算仍是 130）。 ⚠️ **数字已被 F27-c 取代**（真实实测 443 / 430 / 323 / 485 KB，预算上调为 500 / 480 / 360 / 540 KB）。 ⚠️ **F27-j-g 再取代**：预算 **330 / 330 / 240 / 330 KB**，实测 **308 / 308 / 221 / 308 KB**。 |
| **F25-d** | **重定 R17 的 CSS 预算**：三份合计 ≤ **175 KB**(gzip)，实测 168 KB（sans 61 / serif 71 / wenkai 37）。**无衬线那份单独设限 ≤ 65 KB**——`app/layout.tsx` 用普通 `<link rel="stylesheet">` 引入它，是**渲染阻塞**的；另两份走 `media="print"` + `ASYNC_STYLESHEET_FLIP`（`lib/font-css.ts`、`lib/font-css-flip.ts`），不阻塞。 ✅ **F27-d 复核：预算不变**，实测 sans 60 / serif 71 / wenkai 37 = 168 KB。 |
| **F25-e** | **`subset-font` 的文本参数必须是字符串**：`subsetFont(buffer, chars.join(''), { targetFormat: 'woff2' })`。传数组会抛 `The subset text must be given as a string`。 |
| **F25-f** | **产物规模**：8 779 个 woff2 文件（sans 2 779 / serif 3 266 / wenkai 2 734），约 22 MB。旧的 Google 子集目录与 `fonts.css` 由 Task 5 删除。 ⚠️ **体积数字已被 F27-f 取代**：实测 27.5 MB，不是 22 MB。 ⚠️ **文件数已被 F27-j-h 再取代**：8 **683** 个文件，不是 8 779 个。 |

**F25 的实测前沿**（`scripts/fonts/staging/probe-mechanism-race.mjs`、`probe-css-real.mjs`、`probe-final-objective.mjs`、`probe-page-totals.mjs`；字节为四个测量页里的最差值）：

> ⚠️ **整张表已被 F27 取代**（那批脚本用的是 F25 的线性成本模型，模型值与真实字节差 3–13 %）。真实数字见下面 F27 的表。

| 配置 | `/` | `/dictionary` | `/poetry` | `/stories` | CSS | 文件 | 请求 |
|---|---|---|---|---|---|---|---|
| 频率序 6 字/块 + 热区 300/300/0 | 431 KB | 387 KB | 287 KB | 441 KB | 168 KB | 8 779 | ≤110 |
| 频率序 4 字/块 + 热区 300/300/0 | 391 KB | 354 KB | 251 KB | 391 KB | 188 KB | 13 166 | ≤113 |
| 频率序 8 字/块 + 热区 300/300/0 | 495 KB | 439 KB | 302 KB | 477 KB | 156 KB | 6 585 | ≤113 |
| 码位窗口 16 + 热区 300/300/0 | 618 KB | 333 KB | 442 KB | 645 KB | 166 KB | 8 597 | ≤118 |

取 6 字/块的理由：它与计划原本的文件预算（8 597）几乎一样，页面字节却比机制 A 省 32 %；再往下（4 字/块）只省 11 % 的字节，却要多 4 387 个文件、多 21 KB 的 CSS（其中 11 KB 在渲染阻塞的那份里）。再往上（8 字/块）要多付 12 % 的页面字节。 ⚠️ **F27-g 复核：结论不变**（真实字节下 4 字/块仍更小但更贵，见下）。

---

### 第三轮实测修正的字节数（F27，2026-10-29）

> ⚠️ **本节的「页面预算 / 请求数上限 / 实测前沿 / 热区配置 / 产物文件数」已被下一节 F27-j 取代**，因为它建立在一个**错误的页面取字 fixture** 上（楷体字被算成了正文字）。**本节仍然有效的**是：机制结论（频率序 6 字/块胜出码位窗口）、**单文件字节的真实分布**（Ext 块 852 B–6 600 B，重尾）、以及「裁轴只省 10–11 %」这个更正。**已取代的具体项**：
>
> | 本节的数字 | F27-j 的权威值 | 谁取代了它 |
> |---|---|---|
> | 热区 300/300/**0** | 热区 **300/300/300**，且**并集优先** | F27-j-c / F27-j-d / F27-j-h |
> | 页面预算 500 / 480 / 360 / 540 KB | **330 / 330 / 240 / 330 KB** | F27-j-g |
> | 请求数 ≤ 130/页（实测 ≤111） | **≤ 12 个文件/页**（实测 3–4） | F27-j-g |
> | CSS gzip 168 KB | **158 KB**（sans 60 / serif 71 / wenkai 27） | F27-j-g（⚠️ 已被 **F31-a** 再取代：过滤后 ≈ **154–156 KB**） |
> | 8 779 个文件 / 净 +8 347 个 | **8 683 个文件 / 净 +8 246 个**、27.45 MB | F27-j-h（⚠️ 已被 **F31-a** 再取代：**7 936 个文件 / 净 +7 499 个**、≈ 27.3 MB） |
> | 实测页面 443 / 430 / 323 / 485 KB | **308 / 308 / 221 / 308 KB** | F27-j |
> | 「Task 1 已提交的实现不动」 | **Task 1 必须改**（这就是第 4 轮） | F27-j-c / F27-j-d / F27-j-e / F27-j-f |
>
> **不要照着本节的表格实现**；照下一节。

F25 的**机制**是对的，但它的**成本模型是错的**。Task 3 要生成 8 779 个字体文件，在这之前必须用真实字节把预算钉死——否则整个 Task 4 的 verify 会照着一组不存在的数字去判定。

F27 做了三件事：

1. **推翻 F25 的成本模型**——字节不是 `fixed + perChar × 字数`。
2. **用真实字节重测机制对决**——验证 F25-a 的结论站不站得住。
3. **重定所有预算**——页面字节、CSS 字节、单文件字节、产物规模。

脚本（都在 `scripts/fonts/staging/`，gitignored）：

| 脚本 | 干什么 |
|---|---|
| `probe-baseline.mjs` | 解析现网三份样式表，按 `unicode-range` 匹配页面 fixture ⇒ **今天真实的首屏基线** |
| `probe-page-bytes.mjs` | 只切页面真正命中的块 ⇒ 真实每页字节与请求数 |
| `probe-width-race.mjs` | 块宽 4/6/8/12/16 的真实竞赛（字节 + CSS + 请求数） |
| `probe-hot-race.mjs` | 热区大小 × 块宽的真实矩阵 |
| `probe-full-build.mjs` | **把全部 8 779 个块都切出来** ⇒ 权威的单文件字节分布 |
| `probe-mechanism-real.mjs` | 机制 A vs B 的真实字节对决 |

#### F27 的第一条结论：F25 的成本模型不成立

F25 假设「子集字节 = fixed(≈1 000 B) + perChar(255–280 B) × 字数」。F27 把**全部 8 779 个块**真实切出来后发现：

```
sans    ext min 852B  p50 3160B  p90 3936B  p99 4544B  max 5368B
serif   ext min 872B  p50 4072B  p90 4992B  p99 5880B  max 6600B
wenkai  ext min 1264B p50 2828B  p90 3556B  p99 4132B  max 4600B
```

**同一个 6 字块，852 B 到 6 600 B，差 7.7 倍。** 字节由**每个字形的轮廓复杂度**决定，分布重尾：罕见尾部的字比热区的常用字贵 2–3 倍。线性拟合出的 perChar 只是一个平均数，用它外推页面字节必然错——这就是 F25 那张表的每个数字都对不上的原因。

**推论 1：F25 的「裁轴省 44 %」也是错的。** 真实只省 **10–11 %**：

| 族 | 未裁轴 B/字 | 裁轴后 B/字 | 实测省 |
|---|---|---|---|
| serif | 266 | 238 | 10.5 % |
| sans | 206 | 185 | 10.2 % |

原因在 `gvar` 表：`NotoSansSC-wght.ttf` → `NotoSansSC-wght-400-700.ttf`，`gvar` 只从 7 081 744 B 缩到 6 985 240 B（**−1.4 %**），整文件 17 772 300 → 17 645 708 B。变字重的插值数据几乎没被裁掉。

**推论 2：F25-e 之外再补一条**——裁轴**仍然要做**（它把字重范围钉死在 400–700，符合 G9 的重量审计；也让源文件小一点），但**不许把它的节省计入字节预算**。

#### F27 的第二条结论：机制对决，真实字节仍然频率序赢

同一批字符、同一批页面，真实子集字节：

| 机制 | 文件数 | CSS(gzip) | 最差页 | `/` | `/dictionary` | `/poetry` | `/stories` |
|---|---|---|---|---|---|---|---|
| A 码位窗口 16（R8 的取值） | 8 597 | 117 KB | **757 KB** | 610 KB | 328 KB | 466 KB | 757 KB |
| A 码位窗口 8 | 14 552 | 145 KB | 535 KB | 445 KB | 282 KB | 323 KB | 535 KB |
| A 码位窗口 32 | 5 055 | 100 KB | 1 201 KB | 896 KB | 401 KB | 704 KB | 1 201 KB |
| **B 频率序 6 字/块（F25-a，采用；字节列已被 F27-j 重测）** | 8 779 | 168 KB | **485 KB** | 443 KB | 430 KB | 323 KB | 485 KB |
| B 频率序 4 字/块 | 13 166 | 189 KB | 428 KB | 396 KB | 369 KB | 275 KB | 428 KB |
| B 频率序 8 字/块 | 6 585 | 158 KB | 536 KB | 490 KB | 485 KB | 360 KB | 536 KB |

**同文件数下（8 6xx ↔ 8 8xx）频率序比码位窗口省 36 %**（485 KB vs 757 KB），F25 用模型估的是 32 %。**F25-a 的机制成立，不需要改 Task 1 的实现。**

注意机制 A 的 CSS 反而更小（117 KB vs 168 KB）——码位连续的块 `unicode-range` 的 hex 便宜。但省下的 51 KB CSS 抵不上多出的 272 KB 字体字节，而且 A 的请求数与 B 相当（120 vs 111）。

#### F27 的第三条结论：今天的真实基线与改造后的真实收益

**今天的基线**（`probe-baseline.mjs` 解析现网三份样式表 + 页面 fixture）：

| 页面 | 字体字节 | 文件数 | CSS(gzip) | 合计 |
|---|---|---|---|---|
| `/` | 3 560 KB | 57 | 132 KB | **3 693 KB** |
| `/dictionary` | 2 815 KB | 42 | 132 KB | **2 947 KB** |
| `/poetry` | 1 877 KB | 34 | 132 KB | **2 010 KB** |
| `/stories` | 2 884 KB | 46 | 132 KB | **3 017 KB** |

**改造后**（字体 + CSS）：

| 页面 | 改造前 | 改造后（字体 + CSS） | 倍数 |
|---|---|---|---|
| `/` | 3 693 KB | 443 + 168 = **611 KB** | **6.0×** |
| `/dictionary` | 2 947 KB | 430 + 168 = **598 KB** | **4.9×** |
| `/poetry` | 2 010 KB | 323 + 168 = **491 KB** | **4.1×** |
| `/stories` | 3 017 KB | 485 + 168 = **653 KB** | **4.6×** |

F25 写的「3.7–5.0 MB → 431–441 KB，6.8×」是模型值。真实是 **2.0–3.7 MB → 491–653 KB，4.1–6.0×**——依然是一个数量级的改善，但别在报告里写 6.8×。

#### F27 的第四条结论：块宽与热区的取舍

**块宽**（热区 300/300/0，真实字节）：

| 块宽 | 文件数 | CSS(gzip) | sans CSS | 最差页 | 结论 |
|---|---|---|---|---|---|
| 4 字 | 13 166 | 189 KB | **66 KB** | 428 KB | 字节最小，但文件 +50 %，且 sans 那份 **超了 65 KB 的渲染阻塞上限**（F27-d） |
| **6 字（采用，机制不变）** | 8 779 | 168 KB | 60 KB | 485 KB | 文件数与计划预算一致，CSS 三份都在限内 ⚠️ 块宽本身仍有效，但本行的文件数与字节是 F27-j 之前的值 |
| 8 字 | 6 585 | 158 KB | 55 KB | 536 KB | 省 23 个文件，多付 51 KB 页面字节 |
| 12 字 | 4 392 | 145 KB | — | 633 KB | |
| 16 字 | 3 295 | 139 KB | — | 716 KB | |

**热区**（块宽 6，真实字节）：

| 热区（sans/serif/wenkai） | 文件数 | CSS | 最差页 | 请求/页 |
|---|---|---|---|---|
| **300/300/0（当时采用，已被 F27-j 取代）** | 8 779 | 168 KB | 485 KB | **≤111** |
| 无热区 | 8 877 | 169 KB | 535 KB | **125–177** ❌ 超 130 上限 |
| 100/100/0 | 8 846 | 169 KB | 520 KB | 140–153 ❌ |
| 300/300/300 | 8 681 | 168 KB | 606 KB | ≤111 |

#### F27 裁决

| # | 裁决 |
|---|---|
| **F27-a** | **F25 的机制全部成立**：频率序 6 字/块、热区 300/300/0、精确并集 `unicode-range`、一个 family 名。真实字节把「省 32 %」修正为 **省 36 %**。 ⚠️ **F27-j-c/d/e/f 推翻了其中的热区与「Task 1 不动」**：热区改成**并集优先 300/300/300**、楷体必须有热区、诗题进楷体语料、源码扫描要剥注释 ⇒ **Task 1 必须改**（这就是第 4 轮）。频率序 6 字/块与精确并集 `unicode-range` 仍然成立。 |
| **F27-b** | **F25 的成本模型作废**（`fixed + perChar × 字数` 不成立，分布重尾 852 B–6 600 B）。**「裁轴省 44 %」作废**，实测 10–11 %（`gvar` 只缩了 1.4 %）。裁轴照做（G9 的重量审计通过：站内只用到 400/500/600/700），但**不计入字节预算**。 |
| **F27-c** | **重定页面预算**（字体字节，不含 CSS）：`/` ≤ **500 KB**、`/dictionary` ≤ **480 KB**、`/poetry` ≤ **360 KB**、`/stories` ≤ **540 KB**。实测 443 / 430 / 323 / 485 KB（F25 的 431/387/287/441 低估了 3–13 %）。请求数 ≤ 130/页不变（实测最多 111）。 |
| **F27-d** | **CSS 预算不变**：三份合计 ≤ **175 KB**(gzip)，实测 168 KB（sans 60 / serif 71 / wenkai 37）；sans 单独 ≤ **65 KB**（实测 60 KB）。⚠️ 4 字/块时 sans 会到 **66 KB**，破限。 ⚠️ **F27-j-g**：预算不变（≤ 175 KB），但**实测值改为 158 KB**（sans 60 / serif 71 / **wenkai 27**）。 |
| **F27-e** | **重定单文件上限**：热区文件 ≤ **96 KB**（实测 sans 72 KB / serif 89 KB）；Ext 块 ≤ **7 KB**（实测 p99 5 880 B、max **6 600 B**）。⚠️ F25 的 4 KB 上限会**在 8 779 个块里的 1 779 个（20 %）上失败**。 |
| **F27-f** | **产物规模**：8 779 个 woff2 文件，**27.5 MB**（F25 说 22 MB）。对比旧的 432 个文件 / 20.2 MB ⇒ **净 +7.3 MB、+8 347 个文件**。旧的 Google 子集目录与 `fonts.css` 由 Task 5 删除。 ⚠️ **F27-j-h 取代**：8 **683** 个文件（不是 8 779）、**27.45 MB**；对比旧的 437 个文件 / 21 MB ⇒ 净 **+6.5 MB、+8 246 个文件**。 |
| **F27-g** | **块宽保持 6 字/块**。4 字/块能再省 12 % 的页面字节（最差 428 vs 485 KB），但要 +4 387 个文件（+50 %）、+21 KB CSS（其中 +6 KB 在渲染阻塞的那份里，破 F27-d），构建时间多约 8 分钟。收益不值这个代价。 |
| **F27-h** | **热区保持 300/300/0**。无热区 ⇒ 125–177 请求/页（破 130 上限）且字节更差（最差 535 KB）；热区 100 ⇒ 520 KB + 140–153 请求；给楷体也加 300 字热区 ⇒ 最差 606 KB。 ❌ **F27-j-d 推翻**：楷体**也**给 300 字热区（不是 0），且热区改并集优先 ⇒ **300/300/300**。 |

#### F27 的可复核性

- **字体覆盖**：四个源字体（sans 30 890 字形 / serif 30 928 / wenkai Regular 22 401 / wenkai Bold）都覆盖全部 8 105 个标准字，**0 缺失** ⇒ 子集化不会造成豆腐块（G10）。
- **字重审计**：站内三款字体只用 400/500/600/700（Tailwind `font-normal` 2 处、`font-medium` 68、`font-semibold` 32、`font-bold` 18；无内联 `fontWeight`；`app/globals.css:217` 的 `font-weight:600` 是打印规则，`:650` 的 `font-weight:100` 属于 Zen Kaku Gothic New）⇒ 裁到 `wght=400:700` 安全（G9）。
- **楷体来源**：CSS 用的是 `LXGW WenKai TC`（`app/globals.css:469`），与 `scripts/fonts/build-fonts-css.mjs:53` 一致 ⇒ 用 TC 不用 GB。
- **裁轴工具**：`python -I -m fontTools.varLib.instancer <src> wght=400:700 --output <out> --no-overlap-flag`（fontTools 4.61.1 + brotli 1.2.0）。serif 25 125 512 → 25 116 124 B，sans 17 772 300 → 17 645 708 B。
- **子集耗时**：约 31–35 ms/块（`subset-font` 内部用 `p-limit(1)` 串行化），8 779 个文件约 **5 分钟**。
- **不新增运行时依赖**（G3）：`subset-font` 仓库里已有；fontTools 只是构建期工具。

---

### 第四轮实测推翻的归因与热区（F27-j，2026-10-29）

F27 把**字节**钉死了，但它给出的页面预算、请求数上限、实测前沿，建立在一个**错误的页面取字 fixture** 上：`data/font-page-profiles.json` 的归因规则把**楷体字算成了正文字**。F27-j 修好归因规则、重测基线、**重定热区机制**。

#### F27-j 的第一条结论：已提交的 fixture 是错的

fixture 由一段正则切 HTML 产生：它把标签的**直属文本**取成 `([^<]*)`。Next.js 的 SSR 会在相邻文本节点之间插注释分隔符：

```html
<h3 class="font-kai text-lg">《<!-- -->在岳咏蝉<!-- -->》</h3>
```

于是这一行只取到 `《`，`在岳咏蝉` 一个字都没取到。fixture 随后用「sans = 全部 − kai − serif」补齐差集 ⇒ **每一个楷体字都被算进了 sans，楷体集合被清空**。

实测差（已提交的 fixture → 修正后）：

| 页面 | sans | serif | 楷体 |
|---|---|---|---|
| `/` | 107 → **112** | 12 → **32** | 38 → **52** |
| `/dictionary` | 53 → **65** | 80 → **80** | 7 → **7** |
| `/poetry` | 145 → **89** | 0 → **0** | 6 → **75** |
| `/stories` | 65 → **90** | 171 → **171** | 8 → **8** |

诗词页的楷体从 6 个变成 75 个——**正是 `components/poetry/PoemCard.tsx:32` 用 `font-kai` 渲染的诗题**。旧 fixture 把它们全算给了 sans。

第二个缺陷更隐蔽：**`font-family` 是继承属性**，但旧规则只看「直属父元素的 class」。`<h3 class="font-kai"><span>字</span></h3>` 里的字其实用楷体渲染，旧规则会算成 sans。归因必须**沿元素栈向下走**。

#### F27-j 的第二条结论：语料频率预测不了页面画什么

把源码字面量的权重从 1000 降到 1 / 10 / 100，让「语料频率」而不是「源码字面量」主导热区，实测四个页面仍然是 **520–670 KB / 80–142 个文件**（设计 E1 那一行）——比 F27 承诺的 443–485 KB / ≤111 个文件**更差**。

原因有两条：

1. 源码扫描贡献 **1 103** 个不重复的汉字（剥掉注释后 1 034 个，**69 个只存在于注释里**，从不渲染）。300 字的热区会被它们占满，真正的常用字进不去。
2. 品牌字体的语料里**一个楷体渲染的诗题都没有**——`data/poems` 不在楷体的来源表里。诗词页那 75 个楷体字因此散落在几百个 Ext 块里。

#### F27-j 的第三条结论：热区装什么字是免费的

热区的大小是**固定的**（`tier1Size`），所以热区里放哪些字**不花钱**——它的大小不取决于放什么。于是可以把「四个页面真正画出来的字」放进热区：并集 **sans 184 / serif 257 / 楷体 122**，都 < 300，装得下。

**设计矩阵**（真实子集字节；`E0` = 已提交的机制，`E2` = 采用）：

| 设计 | 热区 | 文件数 | CSS(gzip) | `/` | `/dictionary` | `/poetry` | `/stories` |
|---|---|---|---|---|---|---|---|
| `E0` 频率序 300/300/0（F27 的机制，含注释、楷体无热区） | 频率 | 8 779 | 157 KB | 496 KB/130f | 432/88 | 522/174 | 491/108 |
| `E1` 频率序 300/300/300（去注释 + 诗题进楷体语料） | 频率 | 8 683 | 157 KB | 520/78 | 560/81 | 532/120 | 599/95 |
| **`E2` 并集优先 300/300/300（采用）** | 并集 + 频率 | 8 683 | 158 KB | **308/4** | **308/4** | **221/3** | **308/4** |
| `E3` 并集优先，热区 = 并集大小（184/257/122） | 并集 | 8 768 | 157 KB | 187/4 | 187/4 | 111/3 | 187/4 |
| `E4` 并集优先 600/600/300 | 并集 + 频率 | 8 583 | 156 KB | 470/4 | 470/4 | 294/3 | 470/4 |

（这张矩阵由 `scripts/fonts/staging/probe-final-design.mjs` 一次跑出；`E2` 那一行的 158 KB 另由**全量构建** `probe-full-new-design.mjs` 复核过（8 683 个文件全部切出来）。两者差 1 KB 是 CSS 文本细节的舍入差，不影响任何预算判定。）

`E0`（已提交的机制）有一个**新的回归**：诗词页要开 **174** 个字体文件，而今天的现网只要 75 个。F27 的预算「≤130 个/页」本来会把它判成失败——它确实该失败，只是 F27 归因错了，没看出这个回归。

`E3` 比 `E2` 每页少 121 KB，但它把热区**缩到只剩四个测量页画过的字**：四个页面之外的页面（/game、/sutra、/ancient…）吃不到任何热区好处，全部落到 Ext 块。`E2` 的热区在并集之外还留了 116（sans）/ 43（serif）/ 178（楷体）个**语料频率头**，那是对未测量页面的安全网。**选 `E2`**：它在四个测量页面上比 `E1` 少 40–56 % 的字节和 4–29 倍的文件数，同时对未测量页面**不劣于 `E1`**。

#### F27-j 的第四条结论：今天的真实基线（用修正后的 fixture 重测）

| 页面 | 字体字节 | 文件数 | CSS(gzip) | 合计 | 新机制 | 倍数 |
|---|---|---|---|---|---|---|
| `/` | 4 131 KB | 64 | 132 KB | 4 263 KB | 308 KB / 4f | **13.4×** |
| `/dictionary` | 2 878 KB | 43 | 132 KB | 3 010 KB | 308 KB / 4f | **9.3×** |
| `/poetry` | 4 182 KB | 75 | 132 KB | 4 314 KB | 221 KB / 3f | **18.9×** |
| `/stories` | 2 947 KB | 47 | 132 KB | 3 079 KB | 308 KB / 4f | **9.6×** |

（CSS 从 132 KB 涨到 158 KB：Ext 块从 432 条变成 8 683 条 face。CSS 是一次性可缓存成本，字体是每次访问成本——这笔交换划算，但**要在最终报告里点名**。）

#### F27-j 裁决

| # | 裁决 |
|---|---|
| **F27-j-a** | **归因规则改成栈式继承**：`font-family` 会继承，所以元素的有效字族 = 它自己的 `font-kai`/`font-serif`/`font-sans` class，没有就沿用父元素的有效字族，`body` 默认 sans。旧的「扁平分块 + 就近父类」规则**作废**。归因只有**一份实现**（Task 4 的 `scripts/perf/class-attribution.mjs`），采集器与 Task 9 的载荷核算共用它。 |
| **F27-j-b** | **`data/font-page-profiles.json` 用新规则重新生成并提交**（上表四个页面）。采集器与 fixture 必须能对得上：Task 4 的采集器重跑一遍，产物必须与仓库里这份**逐字节相同**，否则归因规则又漂了。 |
| **F27-j-c** | **热区改成「页面画像并集优先」**：每族的热区 = 「四个页面在该族渲染的字的并集（按被几个页面渲染降序）」+ 「语料频率序兜底」，截到 `tier1Size`。**取代** F25-a / R14 的「纯频率序热区」。热区大小固定 ⇒ 装什么字不花钱。 |
| **F27-j-d** | **楷体必须有热区**（`tier1Size` 0 → **300**，取代 R14）。否则诗词页要开 120 个楷体文件。楷体的并集只有 122 字，热区里另外 178 个位置留给语料频率头。 |
| **F27-j-e** | **`data/poems/*.json` 的 `title` 进楷体语料**（`PoemCard.tsx:32` 用 `font-kai` 渲染诗题）。1 237 个不重复的字，其中 **7 个（鵩 飚 巂 岧 鴈 劒 濬）在别的任何来源里都没有**。⚠️ 这 7 个字**现在不在楷体字符集里** → 诗题里出现它们就是豆腐块（G10）。**这是一个已存在的缺陷，本轮修掉。** |
| **F27-j-f** | **源码扫描跳过注释**（`app/` `components/` `lib/` 里的 `.ts`/`.tsx`/`.mjs`/`.js`）。1 103 → 1 034 个字，其中 69 个只存在于注释里。注释里的字从不渲染，不该占热区的位置。 |
| **F27-j-g** | **重定页面预算与请求数上限**（实测值 + 约 7 % 余量）：字体字节 `/` ≤ **330 KB**、`/dictionary` ≤ **330 KB**、`/poetry` ≤ **240 KB**、`/stories` ≤ **330 KB**（实测 308 / 308 / 221 / 308）；**每页字体文件数 ≤ 12**（实测最多 4）。CSS 合计 ≤ **175 KB**(gzip)（实测 158 KB）。**取代 F27-c / F27-d 的 500 / 480 / 360 / 540 KB 与 130 个文件。** |
| **F27-j-h** | **块宽仍为 6 字/块，热区 300/300/300**。文件数 8 683、CSS **158 KB**(gzip)、产物 27.45 MB（见 Task 3 的期望表）。 |
| **F27-j-i** | **已知未覆盖面**：四个测量页面之外的页面（`/game` 接龙选字面板、`/sutra`、`/ancient`、`/worksheet`…）只吃得到**语料频率头**那部分热区，其余落到 Ext 块。**现网已初始化并锁定**（2026-10-29 起 `/game` 等路由返回「系统已初始化完成」页），无法采集它们的真实字符集 ⇒ 采集器必须支持 `--base` 重新采集，**并把「未测量页面的请求数」列为浏览器 smoke 的必查项**。 |

#### F27-j 的可复核性

- 探针（都在 `scripts/fonts/staging/`，gitignored）：`make-page-profiles.mjs`（栈式归因 + 重新生成 fixture）、`probe-legacy-baseline2.mjs`（用修正后的 fixture 重测现网基线）、`probe-final-design.mjs`（E0–E4 设计矩阵）、`probe-full-new-design.mjs`（**把 8 683 个文件全切出来** ⇒ 权威的单文件字节分布）。
- 归因规则的正确性有**独立证据**：`/` 的楷体字从 38 涨到 52、诗词页从 6 涨到 75，且涨上去的字正是 `font-kai` 元素里的字（`《在岳咏蝉》`、`《诗三百首》`）。
- 字体覆盖：四个源字体都覆盖全部 8 105 个标准字，**0 缺失** ⇒ 子集化不会造成豆腐块（G10）。诗题的 7 个独有字（鵩 飚 巂 岧 鴈 劒 濬）在 `LXGWWenKaiTC` 与 `NotoSansSC` 里都有字形。

#### F31 裁决（Task 3 任务评审后追加，2026-10-29）

> ⚠️ **本节取代上面 F27 各项里「产物文件数 / CSS gzip / 字符数」的最终值**——那些是**过滤前**的探针数字。F31-a 把字符集按源字体的真实覆盖裁掉之后，产出的文件数从 8 683 降到 **7 936**，字符数从 45 060 降到 **40 584**，Ext 块从 7 361 降到 **6 615**。**机制结论（F27-j-a/b/c/d/e/f）不受影响**，被取代的只有规模数字。

| # | 裁决 |
|---|---|
| **F31-a** | **字体是权威，字符集必须按源字体的真实覆盖过滤**。Task 1 的 `CJK_RANGES` 覆盖 Plane 3/4（`0x20000–0x2FA1F` / `0x30000–0x3134F`），但三款源字体**没有**这些区的字形 ⇒ 计划里有 4 476 个字画不出来，652 个 Ext 块**一个字都画不出**（空壳文件：sans 282 / serif 370），CSS 却声明它们 ⇒ **Task 4 的 cmap 门禁永远过不了**。修法：在**切分之前**用 fontkit 读源字体的 `characterSet` 过滤计划，尾部**重新切块**；一个族的覆盖取该族**各个源文件的交集**（楷体 400 与 700 共用一条 `unicode-range`，取并集会让 700 那条 face 声称只有 400 画得出的字 ⇒ 粗体豆腐块）。**过滤不改变任何渲染**：新字体缺的那些 BMP 字在旧的 432 个 Google 子集里同样没有（G10 不受影响）。 |
| **F31-b** | **Task 4 的 cmap 门禁改写**：①（硬）一个块声明的每个字都必须在**它自己那个文件**里有字形；②（硬）同一族各块的 `unicode-range` 两两不相交；③（信息）文件里超出本块范围的码位**不算失败**，但要排除 `U+FFFF`（每个文件都有 `.notdef` 映射）；④「并集 == Task 1 的字符集」改成「并集 ⊆ 字符集」（过滤后不可能再相等）。 |
| **F31-c** | **接受评审的 Minor #1 / #2 / #4 / #5**（TOTAL 累加器把 Ext 块数塞进叫 `blocks` 的字段、源字体缺失不预检、`renderFace` 不挡空字符集、`buildAll` 不可测）；**驳回 Minor #3**（`manifestVersion` 没有把文件名也喂进哈希）——R18 的版本令牌已经让「任一 woff2 变了 ⇒ CSS 内容变 ⇒ URL 变」，字节相同的两份样式表不可能出现，把文件名喂进哈希是多余的。 |

> 完整推导、实测数据与「为什么不能用另外两种修法」见账本 `.superpowers/sdd/2026-10-29-site-optimization-wave2-plan/progress.md`。

---

## Review Focus

spec 是愿景文档：它说了系统**必须**做到什么，但没穷举每一种输入。下面 5 条是 spec 隐含、却没有被任何任务的测试覆盖、且最可能咬到真实用户的地方。每条后面标注了把它钉死的测试归属。

1. **字符集漏了一个站内会渲染的字** → 该字走完整条 fallback 链落到系统字体，整页出现两种字体混排；没装 CJK 字体的机器上直接是豆腐块。
   → 归属 Task 1（`webfont-charset.test.ts`：集合并集断言）+ Task 4（`verify-webfont-subsets.mjs`：逐档 cmap 覆盖断言）。

1b. **某个字只在一处被渲染，而那一处的来源是「抄来的字面量」而不是权威数据源** → 抄漏一个就永久豆腐块。本轮已实证一例：`components/game/RadicalToken.tsx:31` 用 `font-kai` 渲染 `chars.radical`，其数据来自 `data/radicals.json` 的 214 个 values；而 `components/dictionary/RadicalSidebar.tsx` 那份 213 项的 `RADICALS` 字面量把 `戶` 写成简体的 `户`、且漏了 `韭` —— 只抄源码字面量会漏掉这两个。权威源是 `data/radicals.json` 的 values。
   → 归属 Task 1（`webfont-charset.test.ts`：断言 `戶` 与 `韭` 都在楷体字符集里，且楷体 ⊂ sans ⊂ serif）。

2. **登录态页面被 nginx 微缓存喂给了匿名用户** → 把 A 用户的账号页返回给了 B 用户。这是本轮唯一的高危安全项。
   → 归属 Task 6（`nginx-config.test.ts`：断言 `proxy_cache_bypass $cookie_auth_token $http_rsc;`、`proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;`、`proxy_cache_valid 200 10s;` 三行同时存在，且 TTL ≤ 10 s）。

2b. **同一 URL 的「文档请求」和「RSC 飞行请求」返回两种完全不同的 body**（`text/html` vs `text/x-component`），实测只有 `RSC: 1` 请求头能区分二者（`?_rsc=` 查询参数不行）。微缓存若把 HTML 喂给了飞行请求，Next 的客户端导航会拿到 HTML 而不是 flight 数据 → 页面卡死或白屏。
   → 归属 Task 6（`nginx-config.test.ts`：断言 `$http_rsc` 同时出现在 `proxy_cache_bypass` 与 `proxy_no_cache` 里）。

3. **浏览器还拿着旧的 `/font/fonts-*.css`**（nginx 对 `/font/` 发 `immutable` + 1 年）→ 站点继续按旧的 432 条 `@font-face` 下载 3.8 MB 字体，优化完全没生效，而且没有任何报错。
   → 归属 Task 5（`fonts-css.test.ts`：断言 manifest 的 `version` 是 12 位 hex、且与三份样式表内容的哈希一致；`lib/font-css.ts` 的 `?v=` 必须带上它）。

4. **同一 family 内两条 `@font-face` 的 `unicode-range` 重叠** → 浏览器挑中错误的文件，字形缺失或渲染成豆腐块，而且只在特定页面复现。
   → 归属 Task 4（断言每族所有块两两不相交、并集等于该族字符集）。

5. **静态子集把字节换成了请求数** → 热区盖不住的字会落到几十个 Ext 文件上，一页可能发出上百个字体请求；在 237–291 ms 的 RTT 下，请求数（不是字节数）可能先变成瓶颈，而这类问题不会出现在任何字节预算里。
   → 归属 Task 4（按实测页面表逐页算「命中的文件数」并断言 ≤ **12** 个/页，F27-j-g；实测 3–4 个）。

6. **归因规则漂移** → fixture 说「这个字是楷体」、预算核算说「这个字是正文字」，两边说的不是一回事，测出来的载荷就是假的，而**没有任何一个字节预算会发现它**。这正是本轮实测踩到的坑：已提交的 fixture 把 `/poetry` 上 **69 个**该用楷体渲染的字全算给了 sans（该页楷体 6 → 75，正文 145 → 89），F27 的三个数字因此全部偏了。
   → 归属 Task 4（`scripts/perf/class-attribution.mjs` 只有**一份**实现；采集器与 Task 9 的载荷核算都调它；采集器重跑一遍的产物必须与仓库里已提交的 `data/font-page-profiles.json` **逐字节相同**）。

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
  export interface ExtBlock { index: number; chars: string[]; }
  export interface TierPlan { hot: string[]; extBlocks: ExtBlock[]; }
  export interface TierOptions { tier1Size?: number; extBlockChars?: number; hotChars?: string[]; }
  export interface CharsetOptions { root?: string; pageProfiles?: string; families?: Partial<Record<FamilyName, TierOptions>>; }
  ```
  默认值（见 R14 / F25-a / **F27-j-d**）：

  | 族 | `tier1Size`（热区字数） | `extBlockChars`（每块字符个数） |
  |---|---|---|
  | `sans` | 300 | 6 |
  | `serif` | 300 | 6 |
  | `wenkai` | **300** | 6 |

  **`tier1Size` 是热区的**下限**，不是上限**（F27-j-c）：`options.hotChars` 里点名的字**必须**全部进热区，一个都不能被截断——被截断就意味着那些字没有字形 ⇒ 豆腐块（G10）。所以热区的实际大小 = `max(tier1Size, hotChars.length)`。正常情况下（并集 184 / 257 / 122）热区就是 300。

  **`hotChars` 是「页面画像并集」**（F27-j-c）：`loadFamilyCharsets()` 读 `data/font-page-profiles.json`，对每一族取「四个页面在该族渲染的字」的并集，按**被几个页面渲染**降序、同频按码位升序排列，作为该族热区的**前排**；热区剩下的位置用语料频率序补齐。`planTiers()` 本身保持纯函数——它只负责把 `hotChars` 放到最前面。

  `ExtBlock.index` 从 1 开始，连续。**Ext 块不是码位连续的区间**：它是频率序上的连续切片，块里的字在码位上是散的。块的 `unicode-range` 必须由 `unicodeRange(block.chars)` 生成（R12 的精确并集），**不要**用 min–max 区间——那会让浏览器给一个块画不出的字挑中这个 face，直接出豆腐块（G10）。

  **选项名是 `extBlockChars`（每块多少个字符），不是 `extBlockSize`（码位窗口宽度）。** F25-a 之前的旧名已作废：沿用 `extBlockSize` 会让人以为切的是码位窗口，而那正是被实测推翻的机制。

  **`ExtBlock` 不再带 `lo` / `hi`。** 那两个字段只对码位连续的窗口有意义，频率序的块没有「跨度」可言；留着它们就是留一个会被误当成 `unicode-range` 的字段。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/webfont-charset.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCjkChar,
  stripSourceComments,
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

describe('stripSourceComments', () => {
  it('drops a line comment but keeps the string next to it', () => {
    expect(stripSourceComments('const a = "字"; // 注释里的字\n')).toContain('字');
    expect(stripSourceComments('const a = "字"; // 注释里的字\n')).not.toContain('注');
  });

  it('drops a block comment but keeps the code around it', () => {
    expect(stripSourceComments('/* 块注释 */const b = 1;')).toBe('const b = 1;');
  });

  it('keeps a comment marker inside a string', () => {
    expect(stripSourceComments('const url = "https://example.com";')).toContain('https://example.com');
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
  const big = scoreCharacters([
    { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
  ]);

  it('puts the hottest characters in the hot tier', () => {
    const plan = planTiers(scored, { tier1Size: 2 });
    expect(plan.hot).toHaveLength(2);
  });

  it('cuts the tail into blocks of a fixed CHARACTER count', () => {
    // The tail after a 2 character hot tier is 丂, 七, 万, 丈. The blocks
    // hold two characters each, so the tail falls into two blocks — not
    // into the three blocks a 2 code point window would produce (the old
    // mechanism split it as 丂七 / 万 / 丈).
    const plan = planTiers(scored, { tier1Size: 2, extBlockChars: 2 });
    expect(plan.extBlocks).toHaveLength(2);
    expect(plan.extBlocks[0].chars).toEqual(['丂', '七']);
    expect(plan.extBlocks[1].chars).toEqual(['万', '丈']);
  });

  it('keeps the ext blocks in score order, not code point order', () => {
    // 七 scores a thousand times more than 一 and 丈, so the frequency
    // order is 七 / 一 / 丈 even though 一 has the lower code point.
    // A code point ordered mechanism would have produced 一 / 七 / 丈.
    const mixed = scoreCharacters([
      { id: 'x', weight: 1, chars: ['一', '丈'] },
      { id: 'src', weight: 1000, chars: ['七'] },
    ]);
    const plan = planTiers(mixed, { tier1Size: 0, extBlockChars: 3 });
    expect(plan.extBlocks).toHaveLength(1);
    expect(plan.extBlocks[0].chars).toEqual(['七', '一', '丈']);
  });

  it('puts every character in exactly one tier', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockChars: 2 });
    const all = [...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...chars].sort());
  });

  it('fills every block but the last with exactly the block size', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    expect(plan.extBlocks).toHaveLength(Math.ceil((2000 - 300) / 6));
    expect(plan.extBlocks.slice(0, -1).every((b) => b.chars.length === 6)).toBe(true);
  });

  it('defaults to a 300 character hot tier and 6 characters per ext block', () => {
    const plan = planTiers(big);
    expect(plan.hot).toHaveLength(300);
    expect(plan.extBlocks).toHaveLength(Math.ceil((2000 - 300) / 6));
  });

  it('never produces an empty ext block', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    expect(plan.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('never repeats a character between the hot tier and an ext block', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    const hot = new Set(plan.hot);
    expect(plan.extBlocks.some((b) => b.chars.some((c) => hot.has(c)))).toBe(false);
  });

  it('rejects a non positive block size', () => {
    expect(() => planTiers(scored, { extBlockChars: 0 })).toThrow();
  });

  it('never truncates the seeded characters, even when they exceed the tier size', () => {
    // A painted character that falls out of the hot tier is a tofu box
    // (G10), so the tier grows instead of dropping names.
    const seeded = ['永', '和', '谐'];
    const plan = planTiers(scored, { tier1Size: 2, hotChars: seeded });
    expect(plan.hot.slice(0, 3)).toEqual(seeded);
    expect(plan.hot).toHaveLength(3);
  });

  it('keeps the seeded characters first and fills the rest by frequency', () => {
    const plan = planTiers(scored, { tier1Size: 3, hotChars: ['丁'] });
    expect(plan.hot[0]).toBe('丁');
    expect(plan.hot).toHaveLength(3);
    expect(new Set(plan.hot).size).toBe(3);
  });

  it('places a seeded character that the corpus does not contain in the hot tier', () => {
    // The page profile may name a character the corpus missed (F27-j-e
    // found seven of them in the poem titles). It still has to get a glyph.
    const plan = planTiers(scored, { tier1Size: 1, hotChars: ['鵩'] });
    expect(plan.hot[0]).toBe('鵩');
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
    // R14 said "no hot tier for the brand face"; F27-j-d reversed that —
    // without a brand face hot tier /poetry opens 120 files.
    expect(plans.wenkai.hot).toHaveLength(300);
  }, 180_000);

  it('seeds the hot tier with the characters the measured pages paint', () => {
    // F27-j-c: the hot tier holds a FIXED number of characters, so WHICH
    // characters it holds is free. The page profile fixture is the only
    // evidence of what the pages actually paint.
    const plans = loadFamilyCharsets();
    const fixture = JSON.parse(
      readFileSync(
        resolve(fileURLToPath(new URL('../../../data/font-page-profiles.json', import.meta.url))),
        'utf8',
      ),
    ) as { pages: Record<string, Record<string, string>> };
    for (const family of ['sans', 'serif', 'wenkai'] as const) {
      const painted = new Set<string>();
      for (const page of Object.values(fixture.pages)) {
        for (const ch of page[family] ?? '') painted.add(ch);
      }
      expect(painted.size).toBeGreaterThan(0);
      const hot = new Set(plans[family].hot);
      const missing = [...painted].filter((ch) => !hot.has(ch));
      expect(missing).toEqual([]);
    }
  }, 180_000);

  it('covers every poem title character in wenkai, because the poem card paints them in the brand face', () => {
    // F27-j-e: components/poetry/PoemCard.tsx renders 《诗题》 in
    // font-kai. Seven of the title characters existed in NO other corpus
    // source, so they were falling back to the system font today.
    const plans = loadFamilyCharsets();
    const wenkai = new Set(
      [...plans.wenkai.hot, ...plans.wenkai.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['鵩', '飚', '巂', '岧', '鴈', '劒', '濬']) {
      expect(wenkai.has(ch)).toBe(true);
    }
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

  it('covers every standard character in wenkai, because the chain game paints them in the brand face', () => {
    const plans = loadFamilyCharsets();
    const wenkai = new Set(
      [...plans.wenkai.hot, ...plans.wenkai.extBlocks.flatMap((b) => b.chars)],
    );
    const standard = JSON.parse(
      readFileSync(
        resolve(fileURLToPath(new URL('../../../data/general-standard-chinese-characters.json', import.meta.url))),
        'utf8',
      ),
    ) as string[];
    expect(standard.length).toBeGreaterThan(0);
    expect(standard.filter((ch) => !wenkai.has(ch))).toEqual([]);
  }, 180_000);

  it('keeps the wenkai charset inside the measured bounds', () => {
    const plans = loadFamilyCharsets();
    const size = plans.wenkai.hot.length + plans.wenkai.extBlocks.flatMap((b) => b.chars).length;
    // The lower bound is the 8 105 standard characters of R16; the upper
    // bound catches an accidental scan of the 70 234 KEYS of
    // data/radicals.json, which are a lookup table that is never rendered.
    expect(size).toBeGreaterThanOrEqual(8105);
    expect(size).toBeLessThan(9000);
  }, 180_000);

  it('honours a per family override even after the default plans were cached', () => {
    loadFamilyCharsets();
    const plans = loadFamilyCharsets({ families: { sans: { tier1Size: 10 } } });
    // `tier1Size` is a FLOOR: the seeded union of the measured pages is
    // longer than 10, so the hot tier holds the union and stops there. The
    // default's 300 characters are gone — a cache that ignored the
    // override would hand back the 300 character default plan.
    expect(plans.sans.hot.length).toBeLessThan(300);
    expect(plans.sans.hot.length).toBeGreaterThanOrEqual(10);
  }, 180_000);

  it('treats an explicitly undefined override as no override', () => {
    // A spread of the override object over the defaults lets an explicit
    // `undefined` win the spread and wipe the default out. The observable
    // invariant is the one that matters: such a call has to produce exactly
    // the default plan, hot tier and Ext blocks alike.
    const defaults = loadFamilyCharsets();
    const plans = loadFamilyCharsets({ families: { wenkai: { tier1Size: undefined } } });
    expect(plans.wenkai.hot).toEqual(defaults.wenkai.hot);
    expect(plans.wenkai.extBlocks).toHaveLength(defaults.wenkai.extBlocks.length);
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
   - **种子先行**（F27-j-c）：`options.hotChars` 是页面画像并集的点名序列，**排在热区最前面**，一个都不能少；**语料里没有的种子字也照样进热区**（它必须有字形，G10）。种子按原顺序去重。
   - **热区大小 = `max(tier1Size, 种子长度)`**：`tier1Size` 是**下限**不是上限。种子比 `tier1Size` 长时**不许截断**——截掉的那个字要么落到别的块（页面多下一个文件），要么整个语料里都没有（豆腐块）。
   - 种子占位之后，热区剩下的位置按频率序（`scored.ordered`）补齐；`tier1Size = 0` 且没有种子时热区为空数组。
   - **剩余字符保持频率序，按 `extBlockChars` 个一组切块**（F25-a）：`tail = ordered.filter((ch) => !hotSet.has(ch))`（**热区里的字要从尾巴里剔掉**，否则同一个字会同时出现在热区和 Ext 块里），然后 `for (let i = 0; i < tail.length; i += extBlockChars) blocks.push(tail.slice(i, i + extBlockChars))`。**不要**按码位重新排序——频率序正是这一版机制的全部意义：页面命中的字因此聚在少数几块里，每块都用得满。
   - `extBlockChars` 是**字符个数**，不是码位宽度。最后一块可以是**不满**的（尾巴），这是正常的。
   - `ExtBlock.chars` = 块内的字符（保持频率序）；`ExtBlock.index` 从 1 开始连续编号。
   - **不允许出现空块**：切片长度永远 > 0。
   - `extBlockChars <= 0` 或不是整数时抛 `TypeError`，不静默返回空计划。
   - **没有 tier2 这一档**（见 R11）。
   - **块不是码位连续的**：块的 `unicode-range` 由 `unicodeRange(block.chars)` 生成（精确并集，R12）。**不要**输出 min–max 区间——那会让浏览器给块里没有的字挑中这个 face，直接出豆腐块（G10）。

4. `unicodeRange(chars)`：把 chars 的 code point 升序排序，合并连续区间，输出 `U+XXXX` 或 `U+XXXX-YYYY`（大写 hex，不足 4 位补 0），多项用 `, ` 连接。

5. `loadFamilyCharsets(options)` 读磁盘构建三族字符集，**读源按下面这张表**（`options.root` 默认仓库根）：

   | 族 | 语料来源 | 权重 |
   |---|---|---|
   | `wenkai` | 源码字面量（`app/` `components/` `lib/` 的 `.ts`/`.tsx`/`.mjs`/`.js`，**去掉注释**，见下）× 1000、`data/classics/*.json` 的 `title` 字段、`data/sutras/*.json` 的 `title` 字段、**`data/poems/*.json` 的 `title` 字段**（F27-j-e）、`data/content/*.json` 中**带 `rare` 字段的那些文件的 `char` 字段**、**`data/radicals.json` 的 214 个部首值**、**`data/general-standard-chinese-characters.json` 的 8 105 个库字符**（见 R16） | 见左 |
   | `sans` | `wenkai` 的全部 + `data/content/*.json` 全部字符串 + `data/poems/*.json` 全部字符串 + `scripts/fonts/gb2312-7000.txt` + `data/general-standard-chinese-characters.json` | 语料 × 1，源码 × 1000 |
   | `serif` | `sans` 的全部 + `data/sutras/*.json` 全部字符串 + `data/classics/*.json` 全部字符串 | 同上 |

   - **`data/stories/` 不存在**：故事正文在 `data/content/<char>.json` 的 `rare.story` 里，正文由 sans/serif 渲染。楷体只在故事详情页渲染那个**生僻字本身**（`app/stories/StoryClient.tsx:117` 的 `font-kai font-bold text-9xl`），所以楷体字符集收 `rare` 文件的 `char`，**不收故事正文**——收了会把密集区的窗口填满，每个页面都替它们买单（实测首页楷体 35 KB vs 收正文时的 51 KB）。
   - **`data/poems/*.json` 的 `title` 字段进 `wenkai`**（F27-j-e）：`components/poetry/PoemCard.tsx:32` 把诗题渲染成 `《{poem.title}》` 并套 `font-kai`。1 165 个诗文件、1 237 个不同的诗题字，其中**恰好 7 个（鵩 飚 巂 岧 鴈 劒 濬）在别的任何语料来源里一个字都没有**——今天它们落到系统字体，站点上是混排（一个已经存在的 G10 缺陷）。诗题**只取顶层 `title` 字段**（复用现成的 `collectEntryTitles`），不要把整首诗收进来：正文是正文，诗题才是品牌 face 要画的东西。
     ⚠️ **扫描顺序**：`data/poems` 必须在 `sans` 复制 `wenkai` 分数**之前**扫一次——`scanJsonDirectory(dir, state, { strings: true, titles: true, rares: false })` 一次读出 `counts` 与 `titles`，把 `titles` 折进 `wenkaiScore`，再把 `counts` 折进 `sansScore`。
   - `gb2312-7000.txt` 每行一个字，按行读；`data/general-standard-chinese-characters.json` 是一个 JSON 数组/对象，**遍历它的全部字符串值**取字（先 `JSON.stringify` 再逐字符也可以，只要不漏）。
   - **`data/radicals.json` 只取 values，不取 keys。** 它是 `Record<char, radical>`，70 234 个 key 是查表用的、页面从不渲染（`scripts/import-chars-data.ts:23` 用它填 `chars.radical` 列），214 个 value 才是页面上的部首字。整份扫描会把字符集从 1.7 万撑到 7 万，机制直接崩。收 values 的理由：`components/game/RadicalToken.tsx:31` 用 `font-kai` 渲染部首，所以部首必须在**楷体**子集里；而 `components/dictionary/RadicalSidebar.tsx` 那份 213 项的 `RADICALS` 字面量把 `戶` 写成简体的 `户`、且根本没有 `韭`——照抄源码字面量会漏掉这两个，游戏里渲染成豆腐块。
   - **`data/unihan/` 两个文件不进语料**：`CJKRadicals.txt` 是 `number; hex; hex` 的码位映射（246 行、0 个汉字），`Unihan_RadicalStrokeCounts.txt` 是 `U+XXXX\tkRSUnicode\t1.4` 行，两者都只被一次性生成脚本 `scripts/build-radicals.ts` 消费，运行时页面不读它们。逐字符扫描对它们是 0 收益。
   - **`data/general-standard-chinese-characters.json` 同时进 sans 和 wenkai（见 R16）**：这 8 105 个字就是 `chars` 表的种子（`scripts/import-chars-data.ts`），也是游戏渲染的全部库字符。进 sans 是因为字典/详情页用 sans 渲染它们；进 **wenkai** 是因为 `components/game/ChainScroll.tsx:63`、`components/game/ChainPickerModal.tsx:24`、`components/game/quest/WrongBook.tsx:118`、`components/game/quest/QuestCharCard.tsx:52` 都用 `font-kai` 渲染库字符（选字面板一次铺满整池）。不进 wenkai 的话这些字会掉到系统字体（`Kaiti SC`/`STKaiti`/`serif`），游戏页出现混排。`data/hsk-vocab.json` 的 2 632 个 HSK 字**已被这 8 105 个字完全覆盖**（实测差集为 0），不必单独收。
   - 源码字面量扫描：递归遍历 `app/`、`components/`、`lib/`，跳过 `node_modules`，只读 `.ts`/`.tsx`/`.mjs`/`.js`，**先 `stripSourceComments(text)` 去掉注释**，再逐字符取 CJK。
   - **源码扫描必须跳过注释**（F27-j-f）：今天的扫描把整个文件逐字符读进去，注释里的汉字因此拿到了 ×1000 的源码权重。实测有 **69 个字只存在于注释里**（区减泄露吞永远防举拉映射笼让堡桌侧栏屏屉边朱淡观滚既缘颜浅压轻篇乾教育强零嗯训李若亦乎赖微软终焉舍伪集六特殊齐叉判纪偏纳浮乘丢倍戳告诉光像）——它们把 300 字的热区挤掉了真正会被画到的字，热区的命中率因此下降。
     `stripSourceComments` 是一个**词法级**的剥离器，必须识别三种形态：`//` 行注释、`/* … */` 块注释、以及**字符串字面量**（`"`、`'`、`` ` ``）里的内容。字符串里的 `//`（例如 `'https://example.com'`）不是注释；字符串里的 `\` 转义要正确跳过；模板字符串按同一条规则处理。
   - 语料目录不存在时**跳过并打印一行说明**，不要抛错。
   - 单个语料文件 JSON 解析失败时跳过该文件并计数，不要让整个构建炸掉；最后打印一行 `skipped N malformed file(s)`。
   - 每族的 `tier1Size` / `extBlockChars` 取上面那张默认表；`options.families` 可以按族覆盖。
   - **热区的种子来自页面画像**（F27-j-c，取代 F25-a / R14 的「纯频率序热区」）：`loadFamilyCharsets()` 读 `data/font-page-profiles.json`（路径用 `options.pageProfiles` 覆盖，默认 `<root>/data/font-page-profiles.json`），对每一族取**所有页面**在该族渲染的字的并集，按「被几个页面渲染」降序、同频按码位升序排列，作为该族 `planTiers` 的 `hotChars`。
     - 这份 fixture 是「页面真正画了什么字」的**唯一证据**——它是从生产环境抓下来的 HTML。
     - 热区**装什么字是免费的**：热区的大小由 `tier1Size` 定死，换成并集里的字不花一分钱，却把命中率从「语料频率猜的」变成「页面实测的」。
     - `options.families[family].hotChars` 可以按族覆盖种子（给别的调用方一个口子）。
     - fixture 读不到时**报错退出**（它是一份入库文件，读不到就是仓库坏了，静默退回频率序会悄悄回到今天的命中率）。
   - **覆盖项里值为 `undefined`（或 `null`）的键视为「没有覆盖」**：必须逐键取值（`override.tier1Size ?? defaults.tier1Size`），**不能**把覆盖对象整个展开到默认值上（`{ ...defaults, ...override }`）——展开会让显式的 `undefined` 赢，于是 `tier1Size` 变成 `undefined`（热区大小算不出来）、`hotChars` 变成 `undefined`（页面画像的种子被抹掉）。⚠️ **注意 F27-j-d 之后楷体本来就有 300 字热区**，这条规则防的不是「楷体多出热区」，而是「默认值被显式的 `undefined` 抹掉」。缓存键也一样忽略值为 `undefined` 的键，让 `{}` 和 `{ tier1Size: undefined }` 共用同一个缓存条目。
   - **缓存键必须包含 `options.families` 与 `options.pageProfiles`**：扫描代价高，同一进程内缓存一次即可，但只按 `root` 缓存会让第二次带 `families` 覆盖的调用拿到第一次的结果（静默忽略调用方的覆盖），也会让换了 fixture 路径的调用拿到旧 fixture 的结果。
   - 函数末尾 `console.log` 每族的字符总数与分档大小，格式：
     `charset sans: 16968 chars (hot 300 / ext 2778 blocks)`。
     按 F27-j 的语料（源码去注释 + 诗题进楷体）、每块 6 字，三行分别是：
     `charset wenkai: 8204 chars (hot 300 / ext 1318 blocks)`、
     `charset sans: 16968 chars (hot 300 / ext 2778 blocks)`、
     `charset serif: 19888 chars (hot 300 / ext 3265 blocks)`。

6. `scripts/fonts/webfont-charset.d.mts` 按上面的 Interfaces 段逐字写声明（参考已有的 `scripts/fonts/build-fonts-css.d.mts` 风格）。

7. **模块头注释必须与实现一致**（第一轮评审的两条事实性错误）：
   - 头部描述楷体的字符集来源时，**必须列出 `data/general-standard-chinese-characters.json` 的 8 105 个库字符**（R16）——漏掉它会让人以为楷体只覆盖稀有字。
   - 头部里「扫描读取约 235 MB」的体积数字要改成实测值（约 270 MB）；宁可写「约 270 MB」也不要写一个偏小的数字。
   - 头部描述 Ext 机制时改成「**频率序、每块 6 个字符**」，不要再说「16 码位窗口」——那是已被 F25-a 作废的旧机制。
   - 「二次折入会改变热区组成」这个说法**没有实测依据**，删掉它；只写可验证的事实：「这 8 105 个字在楷体里折入一次；正文字族直接复制楷体的分数，所以不会重复计数。」
   - **头部必须写清热区的真实规则**（F27-j-c）：不是「界面最常用的 300 个字」，而是「**实测页面画像的并集优先**」——读 `data/font-page-profiles.json`，四个页面画过的字排在最前，剩余名额按语料频率补齐。
   - **头部必须写清楷体现在有热区**（300 字）：F27-j-d 用实测推翻了 R14 的「楷体无热区」。R14 的理由（「楷体字都稀有，一份 300 字的文件就是浪费」）是错的：/poetry 的诗题全在楷体里，没有热区时那一页要开 120 个文件。
   - **头部必须提到两处新语料**（F27-j-e / F27-j-f）：诗题的 `title` 字段进楷体；源码扫描跳过注释。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/webfont-charset.test.ts`
Expected: PASS，全部用例绿（用例数以测试文件为准）。

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
  export const DOWNLOAD_TIMEOUT_MS: number;             // 600_000
  export const MAX_ATTEMPTS_PER_URL: number;            // 3
  export async function remoteSize(url: string): Promise<number | null>;
  export async function downloadOnce(url: string, dest: string, timeoutMs?: number): Promise<boolean>;
  export async function downloadFont(entry: FontEntry): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number; expected?: number }>;
  ```
  ```js
  // scripts/fonts/instance-webfont-axis.mjs
  export const INSTANCER_TARGETS: Array<{ src: string; out: string }>;
  export const PYTHON_BIN: string;                      // process.env.PYTHON ?? 'python'
  export function instancerArgs(src: string, out: string): string[];
  export function readWeightAxis(buffer: Buffer): { min: number; default: number; max: number } | null;
  export async function instanceOne(target): Promise<{ status: 'ok' | 'skip' | 'fail'; out?: string; axis?: { min: number; default: number; max: number } }>;
  ```
  下载器落到 `scripts/fonts/staging/web/`（已 gitignored）的文件名固定为：
  `NotoSansSC-wght.ttf`、`NotoSerifSC-wght.ttf`、`LXGWWenKaiTC-Regular.ttf`、`LXGWWenKaiTC-Bold.ttf`，
  另外三份许可证：`NotoSansSC-OFL.txt`、`NotoSerifSC-OFL.txt`、`LXGWWenKaiTC-OFL.txt`。

  **为什么接口长这样（F27 后的加固）**：`scripts/fonts/download-hard-pen-fonts.ts` 的骨架有四个坑，本任务照抄它的外形但**不能照抄它的行为**——
  (a) 它的 `downloadFont` **只判断「本地文件存在且非空」就 SKIP**，不核对大小，于是曾经留下一个 420 KB 的 `.part` 当成下载好的文件，后面所有步骤都基于一个坏文件继续；
  (b) 它的超时是 60 s，对 13–25 MB 的字体远远不够（本机实测 25 MB 需要几百秒）；
  (c) 它的 `main()` 无论成败都 `process.exit(0)`，**违反 G12**（失败必须非零退出）；
  (d) 它把整个响应读进内存（`res.arrayBuffer()`），25 MB 的字体 × 7 个文件会让峰值内存不可控。
  所以本任务要求：**按远端 `Content-Length` 核对大小**、**超时 ≥ 600 000 ms**、**逐 URL 重试**、**失败非零退出**、**流式落盘**。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/instance-webfont-axis.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { INSTANCER_TARGETS, instancerArgs } from '../../../scripts/fonts/instance-webfont-axis.mjs';
import {
  SOURCES,
  DOWNLOAD_TIMEOUT_MS,
  MAX_ATTEMPTS_PER_URL,
} from '../../../scripts/fonts/download-webfont-sources.ts';

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

  it('waits long enough for a 25 MB font and retries every url', () => {
    // The 60 s default of the hard-pen downloader is far too short here:
    // the serif source is 25 125 512 bytes.
    expect(DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
    expect(MAX_ATTEMPTS_PER_URL).toBeGreaterThanOrEqual(2);
  });
});

describe('instance-webfont-axis', () => {
  it('pins the wght axis to the four weights the site uses', () => {
    expect(instancerArgs('src.ttf', 'out.ttf')).toEqual([
      '-I',
      '-m',
      'fontTools.varLib.instancer',
      'src.ttf',
      'wght=400:700',
      '--output',
      'out.ttf',
      '--no-overlap-flag',
    ]);
  });

  it('runs the interpreter in isolated mode', () => {
    // -I keeps the interpreter from putting the script directory and the
    // working directory on sys.path, so a stray json.py cannot shadow the
    // standard library.
    expect(instancerArgs('src.ttf', 'out.ttf')[0]).toBe('-I');
    expect(instancerArgs('src.ttf', 'out.ttf')[1]).toBe('-m');
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

参考 `scripts/fonts/download-hard-pen-fonts.ts` 的**外形**（UA header + 逐条打印 + 落到 staging 目录），但**行为按下面这份清单**（理由见 Interfaces 段末尾的 (a)–(d)）：

1. **UA header**：`User-Agent: pinyin-character-webfont-fetch/1.0`。
2. **超时**：`DOWNLOAD_TIMEOUT_MS = 600_000`（10 分钟）。源文件最大 25 125 512 B（serif），60 s 不够。
3. **流式落盘**：`fetch` 拿到 `response.body` 后逐块 `write` 到 `dest + '.part'`，**不要**用 `res.arrayBuffer()`（25 MB × 4 会把峰值内存顶到 100 MB+）。写完 `close()` 后再 `rename` 成正式文件名——**正式文件名存在的时刻，文件一定是完整的**。
4. **按远端 `Content-Length` 核对大小**：
   - 下载前先发一次 **HEAD** 请求读 `content-length`（本机实测 `raw.githubusercontent.com` 的 HEAD 返回 200 且带正确的 `Content-Length`，例如 sans 17 772 300）。
   - 拿到 `expected` 后落盘；写完比对**实际字节数**与 `expected`。
   - **不一致 ⇒ 删掉 `.part`，算这次失败，换下一个 attempt / URL 重下。**
   - ⚠️ **大小契约必须来自「真正承载字节的那个响应」**（F28-d，2026-10-29 任务评审后修订）：`fetchToPart` 要捕获 **GET 响应自己的 `content-length`** 并带回，`promote()` 拿**它**比对。HEAD 探测**降级为只服务 SKIP 决策**（本地已有且与远端声明一致 ⇒ 不发 GET）。原因见规则 5 第三条——HEAD 探不通时「服务器没给 Content-Length」和「服务器根本没应答」是两回事，混为一谈就会把唯一的大小防线关掉。
   - HEAD 探测的 `reachable` 标志必须在决策点被采信：**任何 HTTP 响应**（哪怕 404 / 405 / 500）都表示「服务器有应答」；只有请求本身失败（DNS / TLS / 超时 / reset）才是「不可达」。
5. **绝不因为「本地已有非空文件」就 SKIP**（这是硬要求）：
   - 本地文件存在 **且** `expected !== null` **且** 本地大小 === `expected` ⇒ `SKIP`（真的完整）。
   - 本地文件存在 **但** 大小 ≠ `expected` ⇒ **当作截断，重下**（打印一行 `REDO`，说明本地多大、应为多少）。
   - **服务器应答了但没给 `content-length`**（`reachable === true` 且 `size === null`）且本地非空 ⇒ `SKIP` 并打印一行**警告**说明大小无法核对。
   - ⚠️ **服务器根本没应答**（所有 URL 的探测都 `reachable === false`）⇒ **不得 SKIP**，也**不得**打印「服务器没给 Content-Length」——那不是事实，服务器从来没被访问到。此时按「服务器不可达」处理：继续走下载尝试（GET 可能通，HEAD 失败常常只是连接 reset），下载也全败 ⇒ 该 entry 判 `FAIL`，原因写明「不可达」。
   - **不变式**：本地非空文件只有在「远端声明的大小 === 本地大小」时才允许被 SKIP。
6. **重试**：每个 URL 最多 `MAX_ATTEMPTS_PER_URL = 3` 次；一个 entry 的所有 URL 都试完仍失败 ⇒ 该 entry 判 `FAIL`。每次 attempt 之间固定等 2 s。
7. **打印**：每个 entry 一行，格式 `OK  <size> bytes <filename>` / `SKIP <size> bytes <filename>` / `FAIL <filename>`，并附一行失败原因（HTTP 状态码或异常消息）。
8. **退出码（G12）**：只要有任何一个 entry 是 `FAIL`，打印补救提示并**非零退出**。
   ⚠️ **不要用 `process.exit(1)`**（F28-d）：Node 在 Windows 上对管道写入 stderr/stdout 是异步的，紧跟其后的 `process.exit()` 可能把补救文案截断一半。用 `process.exitCode = 1` 后 `return`（成功路径同样直接走到函数末尾，让进程自然退出 0）。
   补救提示固定文案（失败计数用**真实数量**，不要写死 1）：
   ```
   [download] <N> file(s) failed — retry with:
       npm run fonts:download-web
   If a download keeps stalling, fetch it by hand (the URLs are printed above)
   and drop it into scripts/fonts/staging/web/ with the exact file name.
   ```

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

export const PYTHON_BIN = process.env.PYTHON ?? 'python';

export function instancerArgs(src, out) {
  return [
    '-I',
    '-m',
    'fontTools.varLib.instancer',
    src,
    'wght=400:700',
    '--output',
    out,
    '--no-overlap-flag',
  ];
}
```

用 `execFileSync(PYTHON_BIN, instancerArgs(src, out), { encoding: 'utf8', cwd: STAGING_DIR })` 执行，工作目录设为 staging 目录。

**为什么不用裸 `fonttools` 控制台脚本**：`-I`（isolated mode）让解释器**不把脚本所在目录与当前工作目录放进 `sys.path`**，这样旁边放一个 `json.py` 之类的文件就遮蔽不掉标准库（本次会话的安全约束：下载到的文件是不可信数据，读它们的 Python 一律用 `-I`）。`-m fontTools.varLib.instancer` 走的是模块入口，等价于控制台脚本但不依赖 `Scripts/` 目录是否在 `PATH` 上。控制台脚本等价写法保留在注释里：`fonttools varLib.instancer <src> wght=400:700 --output <out> --no-overlap-flag`。

**裁轴后必须核对 `fvar`（G9 的证据）**：用仓库已有的 `fontkit` 读产物的轴：

```js
export function readWeightAxis(buffer) {
  const font = fontkit.create(buffer);
  const axis = font.variationAxes?.wght;
  if (!axis) return null;
  return { min: axis.min, default: axis.default, max: axis.max };
}
```

`instanceOne()` 在写完产物后调它，**并断言 `min === 400 && default === 400 && max === 700`**；不满足就判 `FAIL` 并把实测值打印出来。
理由（G9 的字重审计结论）：站内三族只用到 400/500/600/700，裁到 400–700 安全；但**裁轴后默认实例必须是 400**——Noto Sans SC 的默认实例原本是 100、Noto Serif SC 是 200，裁轴把它们变成 400，正是我们要的（不指定字重时按 400 渲染，与今天的 CSS 一致）。
**裁轴前也要打印一遍原始轴的 min/default/max**，让「裁轴改变了默认实例」这件事在报告里看得见。

**`fonttools` 缺失时**必须打印可执行的补救提示并以非零码退出：

```
[instance] fonttools not found — install it with:
    python -m pip install --upgrade fonttools brotli
```

（探测方式：跑一次 `python -I -m fontTools.varLib.instancer --help`；探测不到就打印上面这段并**非零退出**（用 `process.exitCode = 1` 后 return，不要用 `process.exit(1)`——理由同规则 8）。**不要**用 `fonttools` 在 `PATH` 上与否来判断，因为 `Scripts/` 常常不在 `PATH` 上。⚠️ 探测失败要**区分「模块不存在」与「模块跑了但失败」**：前者给安装命令，后者把真实错误摘要带进文案，别让运维去装一个已经装好的包。探测成功时也打一行 `[instance] fonttools: ok`。）

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
- 4 个字体 + 3 个许可证各打印一行 `OK` 或 `SKIP`；**SKIP 只允许出现在大小核对通过的情况下**；
- 裁轴打印 `NotoSansSC-wght-400-700.ttf` 与 `NotoSerifSC-wght-400-700.ttf` 的成功行，**并且每一行都带裁轴后的轴信息 `wght 400..700 default 400`**；
- `ls -la scripts/fonts/staging/web/` 里 4 个 ttf 都非空，且大小与下表一致（本地实测值）：

  | 文件 | 字节数 |
  |---|---|
  | `NotoSansSC-wght.ttf` | 17 772 300 |
  | `NotoSerifSC-wght.ttf` | 25 125 512 |
  | `LXGWWenKaiTC-Regular.ttf` | 13 110 528 |
  | `LXGWWenKaiTC-Bold.ttf` | 12 881 104 |
  | `NotoSansSC-wght-400-700.ttf`（裁轴后） | 17 645 708 |
  | `NotoSerifSC-wght-400-700.ttf`（裁轴后） | 25 116 124 |

> `scripts/fonts/staging/` 是 gitignored，**不要** `git add` 它。
>
> 裁轴这一步会打印 fontTools 的修复告警（`Attempting to fix OTLOffsetOverflowError ('GPOS', ...)`）——这是 fontTools 在裁剪可变字体时的正常修复流程，**不是错误**，不要因此判失败；以产物存在且轴核对通过为准。

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
  export const STAGING_DIR;              // <repo>/scripts/fonts/staging/web（可被 buildAll 的 options 覆盖）
  export function blockFileNames(family, block): string[];
  export function renderFace(spec): string;               // spec 带 version（见 R18）
  export function renderStylesheet(family, plan, version): string;
  export function manifestVersion(cssByFile): string;
  export function createVersionHasher(): { update(name, bytes): void; digest(): string };  // R18
  export function filterPlanByCoverage(plan, covered, extBlockChars): TierPlan;           // F31-a
  export function buildAll(options = {}): Promise<BuildReport>;   // options.stagingDir
  ```

  **一族一个 font-family 名（R15）**：不再是 `Noto Sans SC 1` / `2` / `Ext` 三条链，而是同族所有 face 共用 `Noto Sans SC`，靠**互不相交的精确 `unicode-range`** 区分命中。

  | key | font-family 名 | css | 目录 | 源字体 | 字重 | 热区 |
  |---|---|---|---|---|---|---|
  | `sans` | `Noto Sans SC` | `fonts-sans.css` | `sans` | `NotoSansSC-wght-400-700.ttf` | 变量，单文件 `font-weight: 400 700` | 300 字 |
  | `serif` | `Noto Serif SC` | `fonts-serif.css` | `serif` | `NotoSerifSC-wght-400-700.ttf` | 变量，单文件 `font-weight: 400 700` | 300 字 |
  | `wenkai` | `LXGW WenKai TC` | `fonts-wenkai.css` | `wenkai` | `LXGWWenKaiTC-Regular.ttf` + `LXGWWenKaiTC-Bold.ttf` | 静态，`400` 与 `700` 各一份 | 300 字（F27-j-d 推翻了 R14 的「无热区」） |

  文件命名：`hot.woff2` / `ext-001.woff2` / `ext-002.woff2` …（静态族再加 `-<weight>` 后缀：`ext-001-400.woff2`、`ext-001-700.woff2`）。

  **`FAMILIES` 里还有一项 `extBlockChars`（F31-a）**：三族都是 **6**，与 `scripts/fonts/webfont-charset.mjs` 的每族默认值（`DEFAULT_EXT_BLOCK_CHARS = 6`、`FAMILY_DEFAULTS` 的 `{ tier1Size: 300, extBlockChars: 6 }`）**必须一致**——过滤后要**重新切块**，切块宽度就得由 Task 3 自己说了算而不是继承别人的。测试里有一条漂移守卫钉住它。

  **⚠️ woff2 的 URL 必须带版本令牌（R18）**：生成的样式表里每一个 woff2 的 `src` 都是 `url(/font/web/<dir>/<file>?v=<12 hex>) format('woff2')`，**不是**裸 URL。令牌**按族**计算 = 该族写出的每个 woff2 的「文件名 + 字节」按写入顺序（hot → ext-001 → … → ext-N，静态族再加 `-400` / `-700`）喂进 `sha256`，取 hex 前 12 位。

  为什么：**`/font/:path*` 是 `Cache-Control: public, max-age=31536000, immutable`**（`next.config.ts:45`；生产实测逐字吻合）⇒ 回访的浏览器在最长一年内**不会发条件请求**。而这些文件名是**稳定的**（`hot.woff2` / `ext-001.woff2`），**不含内容哈希**（7 936 个文件里含 8 位以上 hex 的文件名 **0** 个）⇒ 语料一变、频率序一变、块成员就整体移位 ⇒ 同一 URL 下的文件内容变了 ⇒ 浏览器继续用旧文件 ⇒ 旧文件里没有新 `unicode-range` 声称的那些字 ⇒ **豆腐块（G10）**。旧机制没有这个问题是因为 Google 的文件名带内容哈希（`k3kXo84MPvpLmixcA63oeALRIIKIyQ4.woff2`），内容变 ⇒ 文件名变 ⇒ URL 变 ⇒ 缓存自然失效——**新设计把文件名改成稳定名时把这个隐式机制弄丢了**。

  代价（**在真实的三份样式表上实测**，不是估算）：统一令牌 `?v=<12 hex>` ⇒ gzip **+310 / +377 / −468 B**，合计 **174 948 → 175 167 B（+219 B）**，仍在 `175 * 1024` = 179 200 之内（余量 4 033 B）；「每个文件各带自己的哈希」⇒ **+83 007 B** ⇒ 直接破预算 ⇒ **否决**。

  令牌取**产物字节**的哈希是安全的，因为切分是确定性的：实测同进程连续切两次字节完全相同；**跨进程**新切出的 `sans/ext-001.woff2` 与几小时前落在磁盘上的那份**逐字节相同**。⇒ 语料没变令牌就不变（不会把 27 MB 的缓存白废掉），语料变了令牌就变。

**⚠️ 字符集必须按源字体的真实覆盖过滤（F31-a；测试写进 Step 1，实现写进 Step 3）**

  **一个 face 只能声称它画得出的字。** 三份源字体本来就没有 CJK 扩展 B/G 区（Plane 3/4）的字形，而 Task 1 的 `CJK_RANGES` 有意覆盖那些区 ⇒ 语料里的生僻字进了计划，却切不出字形 ⇒ 产物里有 **652 个「空壳文件」**（CSS 声明 6 个字符、文件里一个字形都没有：`sans/ext-1364.woff2` 的表目录是 `cmap:4 glyf:0 loca:4`，`fontkit` 取 `characterSet` 直接抛 `Could not find a supported cmap table`）⇒ **Task 4 的 cmap 闸门按现状必然失败**。

  实测的分布（量的是磁盘上的真实产物）：

  | 族 | 计划字符 | 无字形的字符 | 全空块 | 部分空块 | 过滤后 Ext 块 | 过滤后文件 |
  |---|---|---|---|---|---|---|
  | sans | 16 968 | **1 925**（Plane 3 = 1 902，Plane 4 = 19，BMP 4） | **282** | 71 | 2 458 | 2 459 |
  | serif | 19 888 | **2 548**（Plane 3 = 2 511，Plane 4 = 35，BMP 2） | **370** | 107 | 2 840 | 2 841 |
  | wenkai | 8 204 | **3**（U+3400/U+FF00/U+FFEF） | 0 | 2 | 1 317 | 2 636 |
  | 合计 | 45 060 | 4 476 | 652 | 180 | 6 615 | **7 936**（原 8 683） |

  **过滤不改变任何一个字的渲染结果**（控制器逐个打开旧的 432 个 Google 子集文件查过：**凡是新字体缺的字，旧子集也缺**——sans 缺的 U+9FFF/U+4DBF 旧 sans 也没有；U+FF00/U+FFEF 是 Unicode 未分配码位，谁都没有；wenkai 缺的 U+3400 旧 wenkai 也没有）⇒ 今天它们就靠系统字体兜底，过滤后仍然靠系统字体兜底。**G10 不受影响。**

  做法：
  1. 用 `fontkit`（**已经是 devDependency，G3 满足**）打开该族的**每一个源字体**取 `characterSet`（码位集合）。
  2. **该族的覆盖 = 各个源字体的覆盖的交集**（不是并集）——楷体是静态族，400 与 700 两个文件声明**同一条 `unicode-range`**（R3），取并集会让 700 那条 face 声称只有 400 画得出的字 ⇒ **粗体渲染时那个字变豆腐块**。
  3. **过滤发生在切分之前**：`hot` = 滤完的热区（保持原顺序，不补不截）；尾块 = 把原 `extBlocks` 摊平 → 滤掉没覆盖的 → **按 `extBlockChars` 重新切成连续编号的块**（不重新切的话，一块 6 字里若 5 字画不出，这块只剩 1 字，白占一个文件）。
  4. `extBlockChars` 从 `FAMILIES` 表取（**6**，与 `webfont-charset.mjs` 的每族默认值一致）；**测试里要有一条漂移守卫**，不许在两处各写一个魔数。
  5. 过滤后**不会有空块**，也不会有「0 字符的 face」。`renderFace` 仍要加一道**空字符 ⇒ 抛错**的守卫（`unicode-range: ;` 会让整条 face 被浏览器静默丢弃）。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scripts/webfont-subsets.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  renderStylesheet,
  blockFileNames,
  manifestVersion,
  filterPlanByCoverage,
} from '../../../scripts/fonts/build-webfont-subsets.mjs';
import { loadFamilyCharsets, planTiers } from '../../../scripts/fonts/webfont-charset.mjs';

const plan = {
  hot: ['一', '丁'],
  extBlocks: [{ index: 1, chars: ['万', '丈'] }],
};

// R18: 每个 woff2 的 URL 都带这个版本令牌。
const VERSION = 'abc123def456';

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
    const css = renderStylesheet(sans, plan, VERSION);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("font-family: 'Noto Sans SC'");
    expect(css).not.toContain('Noto Sans SC 1');
    expect(css).toContain('font-weight: 400 700');
  });

  it('declares one face per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    const css = renderStylesheet(kai, plan, VERSION);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
  });

  it('gives every face a unicode-range and font-display swap', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan, VERSION);
    const faces = css.split('@font-face').slice(1);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range: U\+/);
    }
  });

  it('points every face at /font/web/<family>/<file> with the version token', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan, VERSION);
    expect(css).toContain("src: url(/font/web/sans/hot.woff2?v=abc123def456) format('woff2')");
    expect(css).toContain("src: url(/font/web/sans/ext-001.woff2?v=abc123def456) format('woff2')");
  });

  it('stamps every face with the version token (R18)', () => {
    for (const family of FAMILIES) {
      const css = renderStylesheet(family, plan, VERSION);
      const urls = [...css.matchAll(/url\(\/font\/web\/[^)]+\)/g)].map((m) => m[0]);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain(`?v=${VERSION}`);
      }
    }
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

describe('filterPlanByCoverage', () => {
  it('drops the characters the font cannot draw and re-cuts the tail', () => {
    const covered = new Set(['一', '三', '四', '六'].map((c) => c.codePointAt(0)));
    const filtered = filterPlanByCoverage(
      {
        hot: ['一', '二', '三'],
        extBlocks: [
          { index: 1, chars: ['四', '五'] },
          { index: 2, chars: ['六', '七'] },
        ],
      },
      covered,
      6,
    );
    expect(filtered.hot).toEqual(['一', '三']);
    // '五' 与 '七' 没有覆盖，被滤掉后剩下的 '四' 与 '六' 合到同一块
    expect(filtered.extBlocks).toEqual([{ index: 1, chars: ['四', '六'] }]);
  });

  it('never produces an empty block', () => {
    const covered = new Set(['四'].map((c) => c.codePointAt(0)));
    const filtered = filterPlanByCoverage(
      { hot: ['一'], extBlocks: [{ index: 1, chars: ['四', '五'] }] },
      covered,
      6,
    );
    expect(filtered.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('uses the same block width as the charset planner', () => {
    const chars = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    const planner = planTiers({ ordered: chars, score: new Map() }, {});
    for (const family of FAMILIES) {
      expect(family.extBlockChars).toBe(planner.extBlocks[0].chars.length);
    }
  });
});

describe('the planned charsets fit the design budget', () => {
  it('produces a hot tier and ext blocks for every family', () => {
    const plans = loadFamilyCharsets();
    for (const family of FAMILIES) {
      const p = plans[family.key];
      expect(p.extBlocks.length).toBeGreaterThan(0);
      expect(p.hot.length).toBe(300);
    }
  }, 180_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/webfont-subsets.test.ts`
Expected: FAIL —— 找不到 `scripts/fonts/build-webfont-subsets.mjs`。

- [ ] **Step 3: 实现 `scripts/fonts/build-webfont-subsets.mjs`**

1. `FAMILIES` 常量按上表写死，含 `key`、`label`（= font-family 名）、`css`、`dir`、`sources`（变量族一个文件、静态族两个文件）、`weights`（变量族 `['400 700']`，静态族 `['400','700']`）、`variable`（boolean）、`hotSize`（**三族都是 300**——F27-j-d 给楷体也留了热区）、`extBlockChars`（**三族都是 6**——必须与 `scripts/fonts/webfont-charset.mjs` 的每族默认值一致，测试里有一条漂移守卫钉住它）。

2. `blockFileNames(family, block)`：
   - `block` = `{ kind: 'hot' }` → 基名 `hot`；`{ kind: 'ext', index }` → 基名 `ext-` + index 补 3 位零（`ext-003`、`ext-123`）。
   - 变量族：文件名 = `<基名>.woff2`（一个文件承载 400–700 变量轴）。
   - 静态族：文件名 = `<基名>-<weight>.woff2`，权重顺序 400、700。

3. `filterPlanByCoverage(plan, covered, extBlockChars)`（F31-a）：**一个 face 只能声称它画得出的字**。
   - `covered` = `Set<number>`，码位集合，来源是 `fontkit.create(源字体).characterSet`（`fontkit` 已经是 devDependency，G3 满足）。
   - 该族的 `covered` = **各个源字体覆盖的交集**（不是并集）：静态族（楷体）400 与 700 两个文件声明**同一条 `unicode-range`**（R3），取并集会让 700 那条 face 声称只有 400 画得出的字 ⇒ **粗体渲染时那个字变豆腐块**。
   - 返回：`hot` = 滤完的热区（保持原顺序，不补不截）；`extBlocks` = 原 `extBlocks` 摊平 → 滤掉没覆盖的 → **按 `extBlockChars` 重新切成连续编号的块**（不重切的话，一块 6 字里若 5 字画不出，这块只剩 1 字，白占一个文件）。

4. `renderFace(spec)` 输出一个 `@font-face` 块，字段顺序固定：
   ```
   @font-face {
     font-family: '<familyName>';
     font-style: normal;
     font-weight: <weight>;
     font-display: swap;
     src: url(/font/web/<dir>/<file>?v=<version>) format('woff2');
     unicode-range: <ranges>;
   }
   ```
   `familyName` **恒为 `family.label`**（R15：一族一名，不再有 `1` / `2` / `Ext` 后缀）。`unicode-range` 由 Task 1 的 `unicodeRange(chars)` 生成——精确并集，不是 min–max 区间（R12）。**`version` 是该族的版本令牌（R18），必填**——没有它，浏览器会一直用一年前缓存的旧字体文件，而新的 `unicode-range` 声称里面有那个字 ⇒ 豆腐块。
   **空字符 ⇒ 抛错**：`unicodeRange([])` 返回空串 ⇒ `unicode-range: ;` ⇒ 整条 face 被浏览器**静默丢弃**（不报错、那个字只是悄悄不生效）。守卫要指名是哪个族的哪个文件（G12：文案说真话）。

5. `renderStylesheet(family, plan, version)`：按 热区 → Ext 块（按 `index` 升序）顺序拼所有 face，前面加一段注释头：
   ```
   /* fonts-sans.css — body typeface — --font-han-sans
    * Generated by scripts/fonts/build-webfont-subsets.mjs. Do not edit by hand. */
   ```
   静态族每个块输出两条 face（400 与 700），变量族每个块输出一条（`font-weight: 400 700`）。`version` 原样传给每一条 face 的 `src`。

6. `buildAll(options = {})`：
   - `options.stagingDir` 覆盖暂存目录（默认 `STAGING_DIR` = `scripts/fonts/staging/web`），**为了让「源字体缺失」这条失败路径可测**。
   - 读 `loadFamilyCharsets()` 得到三族的 `{ hot, extBlocks }`。
   - **预检**：先把三族的**全部源字体与许可证**校验一遍（读得到、非空、是 sfnt、许可证在位），**全部通过之后才开始写任何产物**——否则第二/三族失败时会留下「第一族的新 CSS 已落盘而 manifest 还是旧的」这种半成品（`?v=` 与内容脱钩 ⇒ 浏览器可能拿到旧的 immutable 缓存样式表）。
   - 读源字体（从暂存目录）；**源文件缺失必须报错退出**并提示 `npm run fonts:download-web && npm run fonts:instance-web`。
   - 按 `filterPlanByCoverage` 过滤该族的计划（F31-a）。
   - 用 `subsetFont(buffer, chars.join(''), { targetFormat: 'woff2' })` 逐块切分，写到 `public/font/web/<dir>/<file>`（目录先 `mkdir -p`）。**文本参数必须是字符串**：`subset-font` 的第二个参数是「要保留哪些字符」的文本，传数组会抛 `The subset text must be given as a string`（F25-e）。
   - 变量族用同一个源文件切每一块；静态族 400/700 各切一次。
   - **算该族的版本令牌（R18）**：在写文件的循环里，把每个 woff2 的「文件名 + 字节」依次喂进该族的 `sha256`，写完这一族后取 hex 前 12 位。**不额外读盘**。令牌**按族**算（sans 变了不该把 serif 的 URL 也弄脏）。
   - 写 `public/font/fonts-<family>.css`（用刚算出的令牌）。
   - 写 `public/font/fonts-manifest.json`：
     ```json
     { "version": "<12 hex>", "files": { "wenkai": "/font/fonts-wenkai.css", "sans": "/font/fonts-sans.css", "serif": "/font/fonts-serif.css" } }
     ```
     `version` = `manifestVersion(cssByFile)`，其中 `cssByFile` 是三份样式表内容的 map（键用文件名）。**必须保持 `files` 的三个键名不变**——`lib/font-css.ts` 依赖它。
   - 把三份 OFL 许可证复制到 `public/font/web/OFL-<family>.txt`。
   - 打印每族的块数、文件数、字符数与产物字节数，最后一行打印总量（块数 / 文件数 / 字节 / CSS gzip 字节）。**块数要分清「含热区」与「只 Ext」**——现在 TOTAL 把 Ext 块数累加进一个叫 `blocks` 的字段，打印行说「7361 blocks」而实际是 7 364。
   - **不删除**旧的 Google 子集目录（删除是 Task 5 的事，避免一步做两件事）。

7. `manifestVersion(cssByFile)`：把 map 的内容按键排序后依次喂进 `createHash('sha256')`，取 hex 前 12 位。

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

| 族 | 字符数 | Ext 块数 | woff2 文件数 | 产物字节 | 备注 |
|---|---|---|---|---|---|
| `wenkai` | 8 201 | 1 317 | **2 636** | ≈ 7 600 KB | 热区 300 + 1 317 个 Ext 块；每块 400 + 700 两份 |
| `sans` | 15 043 | 2 458 | **2 459** | ≈ 8 200 KB | 热区 300 + 2 458 个 Ext 块（变量族一个文件承载 400–700） |
| `serif` | 17 340 | 2 840 | **2 841** | ≈ 12 150 KB | 热区 300 + 2 840 个 Ext 块（变量族一个文件承载 400–700） |
| 合计 | 40 584 | 6 615 | **7 936** | ≈ 27 100–27 400 KB ≈ 27.3 MB | 三份 CSS gzip 合计 **必须 ≤ 179 200 B（175 KB）**，sans 单独 **必须 ≤ 66 560 B（65 KB）** |

> ⚠️ **这一组数字是 F31-a 过滤之后的**（字符集已按源字体的真实覆盖裁剪）。未过滤的旧数字是 sans 16 968 / 2 778 / 2 779、serif 19 888 / 3 265 / 3 266、wenkai 8 204 / 1 318 / 2 638、合计 7 361 块 / 8 683 个文件 / 27.45 MB / CSS gzip 158 KB——**那 747 个多出来的文件是「声明了 6 个字却一个字都画不出」的空壳**（实测 sans 282 个 / serif 370 个），每个还要占一条 `@font-face`（CSS 变胖）＋ 一次请求（页面变慢）。差额 **4 476 个字**几乎全在 Plane 3/4（生僻字区），源字体里根本没有字形。
>
> **CSS gzip 的精确值以实跑为准**（本表给的是按「每条 face ≈ 22.6 B gzip」推的估值：去掉 746 个 Ext 块 ⇒ 约 −25 KB，再加 R18 令牌 +219 B ⇒ 约 154–156 KB）。**硬阈值是 179 200 B（三份合计）与 66 560 B（sans 单独）**，超了就必须回头砍块宽或热区。

单文件大小（**F27-j 全量实测的真实分布**，不是 F25 的线性模型——F25 的 `fixed + perChar` 已被推翻，分布重尾）：

| 族 | 热区文件 | Ext 最小 | Ext p50 | Ext p90 | Ext p99 | Ext 最大 |
|---|---|---|---|---|---|---|
| `sans` | 72 KB | 852 B | 3 168 B | 3 924 B | 4 544 B | 5 368 B |
| `serif` | 89 KB | 872 B | 4 076 B | 4 992 B | 5 872 B | **6 600 B** |
| `wenkai`（400 + 700 **两份合计**） | 77 KB/份 | 3 124 B | 5 732 B | 7 164 B | 8 208 B | 9 096 B |

⇒ Task 4 的单文件上限按 **热区 ≤ 96 KB、Ext 块 ≤ 7 KB** 判定（F27-e）。注意 **有相当比例的块超过 4 KB**（F27-j 实测 serif 的 Ext 块 p50 就是 4 076 B、楷体的 p50 是 5 732 B）——F25 的 4 KB 上限会把大量正确的块误判为超限。
`public/font/fonts-manifest.json` 的 `version` 是 12 位 hex。

> 这一步会跑约 5 分钟（切 7 936 次；实测 `subset-font` 约 31–35 ms/6 字块）。**不要**在 4444 被占用时跑 `npm run build`（G8）——本步骤不涉及 `next build`，不受限。

- [ ] **Step 6: 提交**

```bash
git add scripts/fonts/build-webfont-subsets.mjs tests/unit/scripts/webfont-subsets.test.ts package.json
git commit -m "feat(fonts): add the hot-tier and frequency-ordered webfont subsetter [2026-10-29 HH.MM]"
```

> 产物 `public/font/web/**` 与三份样式表由 **Task 5** 一起提交（那时才做替换与删除，避免中间态破坏线上构建）。

---

### Task 4: 子集校验器（W2-1d）

**Files:**
- Create: `scripts/fonts/verify-webfont-subsets.mjs`
- Create: `scripts/fonts/capture-page-font-profiles.mjs`（页面取字 fixture 的再生成器）
- Create: `scripts/perf/class-attribution.mjs`（HTML → 字族归因；**Task 4 的采集器与 Task 9 的 font-load 共用同一个模块**）
- Consume: `data/font-page-profiles.json`（页面取字 fixture，已随本计划提交）
- Test: `tests/unit/scripts/verify-webfont-subsets.test.ts`
- Test: `tests/unit/scripts/perf-class-attribution.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 `loadFamilyCharsets()`；Task 3 产出的 `public/font/web/**`、`public/font/fonts-*.css`、`public/font/fonts-manifest.json`；`data/font-page-profiles.json`
- Produces:
  ```js
  export const LIMITS = {
    hotBytes: 96 * 1024,
    extBlockBytes: 7 * 1024,
    cssBytes: 175 * 1024,       // 三份样式表 gzip 后合计（F25-d / F27-d）
    sansCssBytes: 65 * 1024,    // 无衬线那份单独设限：它渲染阻塞（F25-d / F27-d）
    maxFacesPerCss: 3400,
    maxFontFilesPerPage: 12,    // F27-j-g：实测最多 4 个
    pageFontBytes: {
      '/': 330 * 1024,
      '/dictionary': 330 * 1024,
      '/poetry': 240 * 1024,
      '/stories': 330 * 1024,
    },
  };
  export async function verifyFamily(family): Promise<{ ok: boolean; errors: string[]; stats: FamilyStats }>;
  export async function verifyAll(): Promise<{ ok: boolean; errors: string[]; stats: FamilyStats[] }>;
  ```
  以及 `scripts/perf/class-attribution.mjs` 的导出（**Task 4 与 Task 9 共用**，避免两处各写一份归因规则）：
  ```js
  export function classTokens(attrs: string): string[];
  export function stripScriptsAndStyles(html: string): string;
  export function stripComments(html: string): string;
  export function collectFamilyCharsets(html: string): { sans: Set<string>; serif: Set<string>; wenkai: Set<string> };
  ```
  CLI：`node scripts/fonts/verify-webfont-subsets.mjs` → 全部通过 `exit 0`，任一失败 `exit 1`。

  **限额来自 R9、F25-c/d 与 F27-c/d/e 的重定预算**，不是 spec §3.2/§3.3 的旧数字——旧数字建立在「229.4 B/字、无每文件固定开销」这个错的成本模型上（F25 的模型本身也已被 F27 推翻，见「第三轮实测修正的字节数（F27）」一节）。

  **本组数字是 F27-j 全量实测的**（`scripts/fonts/staging/probe-full-new-design.mjs` 全量构建 8 683 个文件）：热区 sans 72 KB / serif 89 KB / wenkai 77 KB；Ext 块单文件 p99 4 544 B、max 6 600 B；**每页 221–308 KB、最多 4 个文件**；三份 CSS gzip 合计 **158 KB**（sans 60 / serif 71 / wenkai 27）。
  `maxFontFilesPerPage` 与 `pageFontBytes` 在 F27-j-g 被重定：旧值 130 个文件 / 500–540 KB 是「热区按语料频率」那套设计的产物；新设计的热区装的是**页面实测画过的字**，于是每页只要 3–4 个文件、221–308 KB。限额留了约 7 % 的余量（330 / 330 / 240 / 330 KB），文件数上限 12 是实测值 4 的三倍。

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
    expect(LIMITS.hotBytes).toBe(96 * 1024);
    expect(LIMITS.extBlockBytes).toBe(7 * 1024);
    expect(LIMITS.cssBytes).toBe(175 * 1024);
    expect(LIMITS.sansCssBytes).toBe(65 * 1024);
    expect(LIMITS.maxFontFilesPerPage).toBe(12);
    expect(LIMITS.pageFontBytes['/dictionary']).toBe(330 * 1024);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
Expected: FAIL —— 找不到模块。

> **Step 4 的前提**：Task 3 的 `npm run fonts:subset-web` 已经跑过，`public/font/web/**`（**7 936 个文件**，F31-a 过滤后的数量）与三份样式表**在磁盘上**。测试读的是工作树，不是 git —— 所以 Task 4 跑测试时产物是未提交状态，这是**预期的**：产物由 **Task 5** 一起提交（见 Task 3 Step 6 的说明）。若磁盘上没有产物，先跑 `npm run fonts:subset-web`（约 5 分钟），**不要**在本任务里 `git add` 它们。
>
> 打开全部 7 936 个 woff2（`fontkit.create`）实测约 **45 秒**（现有 Google 子集每文件 5.4 ms，本次的 3 KB 小块更快），测试超时给到 300 秒足够。

- [ ] **Step 3: 实现 `scripts/fonts/verify-webfont-subsets.mjs`**

校验项（**每一项失败都要收集进 `errors`，最后统一退出 1**，不要遇到第一个错就抛）：

1. **覆盖完整**：对每一族，断言样式表里所有 `unicode-range` 的并集 **⊆** Task 1 的字符集（不多不少地**不能**声明字库之外的字）。
   ⚠️ **不能**再断言「并集 == 该族字符集」：F31-a 过滤之后，并集**必然小于**字符集——差的就是**源字体画不出的那些字**（sans 1 925 / serif 2 548 / wenkai 3）。等式不成立，⊆ 成立且有意义。
2. **块不相交**：同一族的**所有**块（热区 + 每个 Ext 块）的 `unicode-range` 两两不相交。
   ⚠️ **比的是「块」，不是「face」**：静态族（楷体）每个块有**两条** face（400 与 700），它们**声明同一条 `unicode-range`**（R3），所以「所有 face 两两不相交」是**假的**——朴素实现会把每一对 400/700 face 判成重叠。正确做法：按**文件块**归并（把同一块的 400/700 两条 face 看成一条 range），再比块与块。
3. **cmap 正确（豆腐块闸门，G10）**：用 `fontkit.create(buffer)` 打开每个产物，断言**每条 face 声明的每个字符**，在**这条 face 指向的那个文件**里都有字形（`font.hasGlyphForCodePoint(cp)`）。
   - ⚠️ **按 face 查，不要按块查**：静态族（楷体）一个块有两条 face（400 指向 `ext-NNN-400.woff2`、700 指向 `ext-NNN-700.woff2`），两条声明同一条 range，但**字形必须分别在各自的文件里**——「块里有字形」不等于「这个字重的文件里有字形」。按 face 查就自动覆盖了单文件的变量族与双文件的静态族。
   - **硬失败**：声明了却画不出 ⇒ 豆腐块。
   - **不计失败、只报告**：文件里多出来的码位——**必须排除 `U+FFFF`**（`.notdef` 的 cmap 映射，**每个文件都有**），其余（例如 serif `ext-105` 声明 U+3010 却带 U+3011、`ext-106` 声明 U+3011 却带 U+3010——源字体里这两个码位**共用同一个字形**，harfbuzz 的字形闭包把兄弟码位一起带进来）**记为信息，不判失败**：两个文件都带着它们，浏览器无论选中哪个 face 都画得出 ⇒ 不会出豆腐块。
4. **文件大小**：热区文件 ≤ `LIMITS.hotBytes`（**96 KB**；F27-j 实测 sans 72 KB / serif 89 KB / wenkai 77 KB/份），每个 Ext 块文件 ≤ `LIMITS.extBlockBytes`（**7 KB**；F27-j 实测 sans max 5 368 B、serif max 6 600 B、wenkai 的 400+700 两份合计最大 9 096 B ⇒ 单份约 4.5 KB）。⚠️ **不要**用 F25 的 4 KB 上限——F27 实测有五分之一的块超过 4 KB，用 4 KB 会把正确的产物判成失败。
5. **样式表**：三份 `fonts-<family>.css` **gzip 后合计** ≤ `LIMITS.cssBytes`（175 KB，F25-d），单份的 `@font-face` 条数 ≤ `LIMITS.maxFacesPerCss`（3 400）。**无衬线那一份单独 ≤ `LIMITS.sansCssBytes`（65 KB）**——`app/layout.tsx` 用普通 `<link rel="stylesheet">` 引入它，是**渲染阻塞**的；另两份走 `media="print"` + `ASYNC_STYLESHEET_FLIP`（`lib/font-css.ts`、`lib/font-css-flip.ts`），不阻塞首屏。
6. **每条 face 的 `font-display` 必须是 `swap`**，`src` 指向的文件必须存在。
7. **manifest**：`version` 是 12 位 hex，且等于三份样式表内容按文件名排序后的 sha256 前 12 位；`files` 的键恰为 `{sans, serif, wenkai}`。
8. **页面预算**（对应 Review Focus 第 5 条）：读 `data/font-page-profiles.json`，对 `/`、`/dictionary`、`/poetry`、`/stories` 四个页面，用各族的热区/Ext 规则算出「浏览器会下载哪些文件」，累加**字节**与**文件数**，断言字节 ≤ `LIMITS.pageFontBytes[path]` 且文件数 ≤ `LIMITS.maxFontFilesPerPage`。
   计算规则：一个字符落在热区就下载热区文件；落在 Ext 就下载它所在的那一个 Ext 块文件（静态族该块是 2 个文件）。同一块只算一次。
9. **版本令牌（R18）**：每一族的样式表里**每一个** `url(/font/web/…)` 都必须带 `?v=<12 位 hex>`；且该令牌等于**这一族自己的** woff2 文件的 sha256：「文件名 + 字节」依次喂进 sha256，取 hex 前 12 位。
   **顺序必须是「样式表里 face 的出现顺序」**（热区优先，然后 Ext 块按块号升序；静态族每个块先 400 后 700）——**不是文件名排序**（`ext-001.woff2` 按字母序排在 `hot.woff2` 前面，两者算法会算出两个不同的令牌）。样式表本来就是按写入顺序渲染的，所以校验器**按样式表里 `src` 出现的先后**取文件、重算哈希，就与构建脚本的算法一致了。
   **为什么要有这一项**：`/font/**` 在生产上是 `public, max-age=31536000, immutable`（一年不可变），而新设计的 woff2 文件名是**稳定名**（`hot.woff2` / `ext-001.woff2`，7 936 个文件里 0 个带内容哈希）——语料一变、频率顺序一变、Ext 块的成员就整体换位，于是同一个 URL 换了内容：浏览器手里那份 immutable 的旧文件不会重新下载，而新 CSS 的 `unicode-range` 声称那个文件里有那个字 ⇒ **豆腐块（G10）**。令牌一改 URL 就变，浏览器必然重新取。
   **要断言的是「令牌 = 内容的哈希」，不是「令牌长得像哈希」**：令牌与内容脱钩就等于没令牌。所以校验器要**自己按上文的算法重算一遍**，跟 CSS 里写的比对；重算不出来（少一个文件、顺序变了、字节对不上）就报错。
   **实测代价**：统一令牌对三份样式表的 gzip 增量合计 **+219 B**（sans +310 / serif +377 / wenkai −468），离 175 KB 预算的余量从 4 252 B 降到 4 033 B；「每个文件各带自己的哈希」是 +83 007 B，直接破预算——所以是**按族**一个令牌，不是按文件。
   **fixture 怎么来的**：`data/font-page-profiles.json` 记录了 2026-10-29 从 `https://ziyun.pudafo.com` 抓到的四个页面服务端 HTML 里、**按栈式归属**得到的 CJK 字符集——元素自己的 `font-kai` / `font-serif` / `font-sans` class 决定它渲染成哪款字，没有就继承父元素，再没有就是 `body` 的 sans。`scripts/fonts/capture-page-font-profiles.mjs` 是它的再生成器：默认从 `--base`（默认 `https://ziyun.pudafo.com`）抓四个页面；也接受 `--html-dir <dir>` 从本地 HTML 目录读（文件名 `<page>.html`，`page` ∈ `home`/`dictionary`/`poetry`/`stories`）。**校验器本身不联网**，只用仓库里的 fixture。

CLI 输出格式：

```
[verify] sans   : 15043 chars, 2459 files, ~8 MB   OK
[verify] serif  : 17340 chars, 2841 files, ~11 MB   OK
[verify] wenkai :  8201 chars, 2636 files, ~7 MB   OK
[verify] css    : ~160 KB gzip (待实跑)   OK
[verify] pages  : / 308 KB / 4 files   /dictionary 308 KB / 4 files   /poetry 221 KB / 3 files   /stories 308 KB / 4 files   OK
[verify] 0 error(s)
```

> **字符数与文件数是 F31-a 过滤之后的值**（sans 16 968 → **15 043** / 2 459 个文件；serif 19 888 → **17 340** / 2 841；wenkai 8 204 → **8 201** / 2 636；合计 8 683 → **7 936** 个文件、6 615 个 Ext 块）——差额就是**源字体画不出的那些字**（Plane 3/4 的生僻字 + 3 个 BMP 码位）。
> 每页字节与请求数仍是 **2026-10-29 F27-j 全量实测值**（`scripts/fonts/staging/probe-full-new-design.mjs` 与 `probe-final-design.mjs` 的 `E2 UNION seeded, caps 300/300/300` 一行）——**不是** F25 的模型值，也不是 F27 的旧值（旧的按语料频率排热区，每页要 87–111 个文件）。产物字节与 CSS gzip 字节带 `≈`，实跑后以真实数字为准。

字体文件用 `fontkit` 打开；`fontkit.create` 对 woff2 的支持在本仓库已被 `scripts/fonts/verify-brush-subsets.mjs` 验证过。

> 上表是 2026-10-29 实测值。校验器的**断言阈值**是 `LIMITS`，不是这张表；实测值落在阈值内即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
Expected: PASS。若页面预算超标，按 F27-j 的实测矩阵调**热区字数**（300 → 150 会更省字节、450 会更省请求数）或**块宽**（6 → 8 字会让 CSS 变小、请求数变少但页面字节变多），改完重跑 Task 3 的构建再回来跑本测试；**不要**去改 `LIMITS` 的预算数字（R9、F25-c/d、F27-c/d/e、F27-j-g 已经把预算重定过四次，且每个数字都是实测的）。

- [ ] **Step 5: 写 `scripts/perf/class-attribution.mjs` 的失败测试**

创建 `tests/unit/scripts/perf-class-attribution.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  classTokens,
  stripComments,
  collectFamilyCharsets,
} from '../../../scripts/perf/class-attribution.mjs';

describe('classTokens', () => {
  it('reads the class names out of an attribute string', () => {
    expect(classTokens('class="font-kai text-lg"')).toEqual(['font-kai', 'text-lg']);
  });

  it('returns an empty list when there is no class attribute', () => {
    expect(classTokens('id="a"')).toEqual([]);
  });
});

describe('stripComments', () => {
  it('drops an HTML comment', () => {
    expect(stripComments('<p>字<!-- 注释 -->词</p>')).toBe('<p>字词</p>');
  });
});

describe('collectFamilyCharsets', () => {
  it('puts kai and serif text in their own family and the rest in sans', () => {
    const html =
      '<p class="font-kai">楷</p><p class="font-serif">宋</p><p>黑</p>';
    const sets = collectFamilyCharsets(html);
    expect([...sets.wenkai]).toEqual(['楷']);
    expect([...sets.serif]).toEqual(['宋']);
    expect([...sets.sans]).toEqual(['黑']);
  });

  it('inherits the face of the parent when the element has no font class', () => {
    // `font-family` inherits. A span inside a font-kai heading is still
    // painted in the brand face. The old flat rule ("the class of the
    // immediate parent") put it in sans and emptied the kai set — that is
    // what produced the wrong fixture F27-j found.
    const sets = collectFamilyCharsets('<div class="font-kai"><span>楷</span></div>');
    expect([...sets.wenkai]).toEqual(['楷']);
    expect([...sets.sans]).toEqual([]);
  });

  it('inherits through several levels', () => {
    const sets = collectFamilyCharsets('<section class="font-serif"><p><em>宋</em></p></section>');
    expect([...sets.serif]).toEqual(['宋']);
    expect([...sets.sans]).toEqual([]);
  });

  it('ignores the Chinese inside script and style blocks', () => {
    const html =
      '<style>.x::after{content:"字"}</style><script>const a="文";</script><p>汉</p>';
    const sets = collectFamilyCharsets(html);
    expect([...sets.sans]).toEqual(['汉']);
  });

  it('ignores the Chinese inside comments', () => {
    const sets = collectFamilyCharsets('<p>汉</p><!-- 注释字 -->');
    expect([...sets.sans]).toEqual(['汉']);
  });

  it('does not push a void element onto the stack', () => {
    // A void element has no closing tag; pushing it would swallow the
    // rest of the document into its face.
    const sets = collectFamilyCharsets('<p class="font-kai">楷<br>续</p><p>黑</p>');
    expect([...sets.wenkai].sort()).toEqual(['楷', '续']);
    expect([...sets.sans]).toEqual(['黑']);
  });

  it('reads the text of a heading that Next.js splits with comment markers', () => {
    // Next.js SSR emits `<!-- -->` between adjacent text nodes:
    // <h3 class="font-kai text-lg">《<!-- -->在岳咏蝉<!-- -->》</h3>
    const sets = collectFamilyCharsets('<h3 class="font-kai">《<!-- -->在岳咏蝉<!-- -->》</h3>');
    expect([...sets.wenkai].sort()).toEqual(['在', '岳', '咏', '蝉'].concat(['》', '《']).sort());
  });

  it('reads the head of the document as nothing to paint', () => {
    const sets = collectFamilyCharsets('<head><title>标题</title></head><body><p>汉</p></body>');
    expect([...sets.sans]).toEqual(['汉']);
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run tests/unit/scripts/perf-class-attribution.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 7: 实现 `scripts/perf/class-attribution.mjs`**

```js
/**
 * scripts/perf/class-attribution.mjs — HTML → 字族归因。
 *
 * 页面上的同一个汉字可能用三款字渲染：正文字族（sans）、衬线字族（serif）、
 * 楷体（kai）。这个模块按**栈**遍历服务端 HTML，把每个文本节点归到它真正
 * 渲染时用的那一款字。
 *
 * 归属规则是**栈式**的，因为 `font-family` 会继承：一个元素渲染成哪款字，
 * 取决于它自己的 `font-*` class；自己没有，就继承父元素的那款；再往上没有，
 * 就是 `body` 的默认（sans，`app/globals.css:66`）。
 *
 * ⚠️ 第一版用的是「文本块的直属父元素的 class」，**这条规则是错的**
 * （F27-j-a）：Next.js SSR 会在相邻文本节点之间插 `<!-- -->`，
 * `<h3 class="font-kai">《<!-- -->在岳咏蝉<!-- -->》</h3>` 的直属父元素
 * class 抓对了，但正则 `([^<]*)` 抓到的文本只有 `《`——于是楷体集合被掏空，
 * 剩下的字全被算成 sans。已提交的 fixture 就是这样错的。
 *
 * 为什么要单独成模块：`data/font-page-profiles.json`（页面取字 fixture，Task 4 的
 * 采集器产出）与 `scripts/perf/font-load.mjs`（每页字体载荷测量，Task 9 产出）
 * 必须用**同一条**归因规则。两处各写一份，规则迟早漂移，于是 fixture 说的字符集
 * 和预算算的字符集不是一回事，测出来的载荷就是假的。
 */

import { isCjkChar } from '../fonts/webfont-charset.mjs';

/** class 名 → 字族。 */
const FAMILY_BY_CLASS = {
  'font-kai': 'wenkai',
  'font-serif': 'serif',
  'font-sans': 'sans',
};

/** 没有任何字族 class 时的默认字族：`body` 用的是 sans。 */
const DEFAULT_FAMILY = 'sans';

/** 空元素：没有闭合标签，不能进栈。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 从 `class="..."` 里取 class 名列表。 */
export function classTokens(attrs) {
  const match = /class="([^"]*)"/.exec(attrs);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

/** 去掉 <script> / <style> 的内容——里面的中文不是页面文字。 */
export function stripScriptsAndStyles(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
}

/** 去掉 HTML 注释——注释里的中文不是页面文字。 */
export function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 一个元素渲染成哪款字：自己的 `font-*` class，否则继承父元素的那款。
 */
export function familyOfAttrs(attrs, parentFamily) {
  const tokens = classTokens(attrs);
  for (const className of Object.keys(FAMILY_BY_CLASS)) {
    if (tokens.includes(className)) return FAMILY_BY_CLASS[className];
  }
  return parentFamily;
}

/**
 * 把一段 HTML 的汉字归到三个字族。
 *
 * @returns {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }}
 */
export function collectFamilyCharsets(html) {
  const source = stripComments(stripScriptsAndStyles(html));
  const sets = { sans: new Set(), serif: new Set(), wenkai: new Set() };
  const stack = [{ tag: '#root', family: DEFAULT_FAMILY }];
  let inHead = false;
  let i = 0;
  const n = source.length;

  const addText = (text) => {
    if (inHead) return;
    const family = stack[stack.length - 1].family;
    for (const ch of text) {
      if (isCjkChar(ch)) sets[family].add(ch);
    }
  };

  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { addText(source.slice(i)); break; }
    if (lt > i) addText(source.slice(i, lt));

    // 注释：整段跳过（`stripComments` 已经删了，这里是兜底）。
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // 声明（`<!DOCTYPE html>` 之类）：整段跳过。
    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closing = source[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(source.slice(nameStart));
    if (!nameMatch) { i = lt + 1; continue; }
    const tag = nameMatch[0].toLowerCase();
    const end = source.indexOf('>', lt);
    if (end === -1) { addText(source.slice(lt)); break; }
    const attrs = source.slice(nameStart + tag.length, end).trim();

    if (closing) {
      if (tag === 'head') inHead = false;
      // 弹到最近的一个同名开标签为止。
      for (let s = stack.length - 1; s >= 1; s -= 1) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
    } else {
      const selfClosing = source[end - 1] === '/';
      if (tag === 'head') inHead = true;
      const family = familyOfAttrs(attrs, stack[stack.length - 1].family);
      if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push({ tag, family });
    }
    i = end + 1;
  }
  return sets;
}
```

> `isCjkChar` 来自 Task 1 的 `scripts/fonts/webfont-charset.mjs`——**一个 CJK 判定只有一处**。该模块被 import 时不会触发语料扫描（它的主块有 `invokedDirectly` 守卫）。
>
> **这份实现必须与 `scripts/fonts/staging/make-page-profiles.mjs`（本轮的采集脚本）逐行等价**：那份脚本重新生成的 fixture 必须与仓库里已提交的 `data/font-page-profiles.json` **逐字节相同**。Task 4 的采集器跑一次就能验证这一点（见 Step 9）。
>
> ✅ **已提前验证**：本轮把上面这份实现原样抄成 `scripts/fonts/staging/verify-plan-attribution.mjs`（只把 CJK 判定换成 import 来的 `isCjkChar`、把抓取换成读本地 HTML）跑了一遍，结果是 **IDENTICAL**——逐字节复现已提交的 `data/font-page-profiles.json`（`/` 112/32/52、`/dictionary` 65/80/7、`/poetry` 89/0/75、`/stories` 90/171/8）。⇒ 下面这段实现可以直接照抄，Task 4 的逐字节门禁会通过。

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run tests/unit/scripts/perf-class-attribution.test.ts`
Expected: PASS。

- [ ] **Step 9: 实现 `scripts/fonts/capture-page-font-profiles.mjs`（复用上一步的模块）**

- 默认从 `--base`（默认 `https://ziyun.pudafo.com`）抓 `/`、`/dictionary`、`/poetry`、`/stories` 四个页面的服务端 HTML；也接受 `--html-dir <dir>` 从本地 HTML 目录读（文件名 `<page>.html`，`page` ∈ `home`/`dictionary`/`poetry`/`stories`）。
- **归因一律调用 `scripts/perf/class-attribution.mjs` 的 `collectFamilyCharsets()`**，不要在这里另写一份正则。
- 输出 `data/font-page-profiles.json`，结构与已提交的 fixture 一致：
  ```json
  { "capturedAt": "<YYYY-MM-DD>", "source": "<base>", "pages": { "/": { "sans": "…", "serif": "…", "wenkai": "…" } } }
  ```
  三个字族的字符集按码位升序拼接成字符串。
- **必须能复现已提交的 fixture**：本轮的采集脚本 `scripts/fonts/staging/make-page-profiles.mjs` 用的就是上面这套规则，从 `D:/temp/pg-{home,dictionary,poetry,stories}.html` 重新生成的结果与仓库里的 `data/font-page-profiles.json` **逐字节相同**。采集器写好之后，用同一批本地 HTML 跑一次：
  ```bash
  node scripts/fonts/capture-page-font-profiles.mjs --html-dir D:/temp --out D:/temp/font-page-profiles.check.json
  diff D:/temp/font-page-profiles.check.json data/font-page-profiles.json
  ```
  Expected：**没有差异**。有差异就说明归因规则走样了——这正是 F27-j 找到旧 fixture 错在哪的办法（见 F27-j-b），所以这一步是本任务的**验收条件**，不是可选检查。
- 采集到新数据时**不要**直接覆盖仓库里已提交的 fixture —— 先打印新旧差异，由协调方决定是否更新（G4：本任务只提供再生成器）。
- ⚠️ **覆盖范围有限**（F27-j-i）：生产站点 2026-10-29 起已完成初始化，未登录的请求会返回「系统已初始化完成」页面，所以**线上现在抓不到真实内容**。已提交的 fixture 来自初始化之前的四次抓取，只覆盖 `/`、`/dictionary`、`/poetry`、`/stories` 四个页面；其余页面的字体命中靠热区里的语料频率兜底。**这是已知的覆盖缺口**，不是可以忽略的细节：浏览器走查要额外记下未测量页面的字体请求数（见 Task 9 的走查清单）。

- [ ] **Step 10: 加 npm script**

```json
"fonts:verify-webfont": "node scripts/fonts/verify-webfont-subsets.mjs",
"fonts:capture-page-profiles": "node scripts/fonts/capture-page-font-profiles.mjs",
```

Run: `npm run fonts:verify-webfont`
Expected: `0 error(s)`，退出码 0。

- [ ] **Step 11: 提交**

```bash
git add scripts/fonts/verify-webfont-subsets.mjs scripts/fonts/capture-page-font-profiles.mjs scripts/perf/class-attribution.mjs tests/unit/scripts/verify-webfont-subsets.test.ts tests/unit/scripts/perf-class-attribution.test.ts package.json
git commit -m "feat(fonts): add the webfont subset verifier [2026-10-29 HH.MM]"
```

---

### Task 5: 接入应用（W2-1e）

**Files:**
- Verify only: `app/globals.css`（`:root` 块，第 465–470 行；**实测已是单族写法，预期不改**，见 Step 1）
- Modify: `lib/font-css.ts`（只改注释，不改行为）
- Modify: `next.config.ts`（**只改 `:41-49` 上面那段注释**，第 35–37 行说「`/font/` 的文件名是内容哈希」已经不成立；`headers()` 的三行逻辑**一个字都不许改**，见 Step 2b）
- Modify: `tests/unit/lib/fonts-css.test.ts`（整体重写）
- Modify: `tests/unit/lib/middleware-redirect.test.ts`（第 65 行的示例路径）
- Delete: `public/font/noto-sans-sc/`、`public/font/noto-serif-sc/`、`public/font/lxgw-wenkai-tc/`、`public/font/fonts.css`
- Delete: `scripts/fonts/build-fonts-css.mjs`、`scripts/fonts/build-fonts-css.d.mts`
- Add: `public/font/web/**`、`public/font/fonts-sans.css`、`public/font/fonts-serif.css`、`public/font/fonts-wenkai.css`、`public/font/fonts-manifest.json`

**Interfaces:**
- Consumes: Task 3 的产物（`public/font/web/**` + 三份样式表 + manifest）
- Produces:
  - `app/globals.css` 里三个 CSS 变量必须是**单族 + 系统兜底**（R15：一族一名，不再有跨档 fallback 链）：
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
    ⚠️ **实测：仓库当前的 `app/globals.css:466-469` 已经就是这个值**（只是换行写法不同）——所以这一步是**核对**而不是改写，详见 Step 1。
  - `lib/font-css.ts` 的**导出签名与行为完全不变**（`FontCssLinks` + `getFontCssLinks()`）；manifest 的 `files` 键名不变，因此 `app/layout.tsx` **不需要改**。
  - `app/globals.css` 第 29–31 行的 `--font-sans` / `--font-serif` / `--font-kai` **不动**。

- [ ] **Step 1: 核对 `app/globals.css` 的三个变量（**预期：不需要改**）**

R15 要求「一族一名 + 互不相交的精确 `unicode-range`」。**实测：仓库当前的 `app/globals.css:466-469` 已经是单族写法**，值与 Interfaces 段完全一致，只有换行排版不同：

```css
  --font-han-sans:
    'Noto Sans SC', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-han-serif: 'Noto Serif SC', Georgia, 'Songti SC', 'SimSun', serif;
  --font-wenkai: 'LXGW WenKai TC', 'Kaiti SC', 'KaiTi', 'STKaiti', serif;
```

**所以这一步只是核对，不是改写。** 读一遍 `app/globals.css:464-481`，确认这三个变量各自只点名**一个** webfont 族、后面跟的全是系统字体兜底：

- 值已经正确 ⇒ **不要动这个文件**。只改换行会产生纯空白 diff，违反「保持 Git Diff 干净」。
- 只有当某个变量里混进了第二个 webfont 族名（例如 `'Noto Serif SC'` 出现在 `--font-han-sans` 里）才改成 Interfaces 段那三段。

**不要**顺手改 `@theme` 里的 `--font-sans/--font-serif/--font-kai`（第 29–31 行），也不要动其他排版变量。Step 3 的第 11 条测试会独立复核这一点。

- [ ] **Step 2: 改 `lib/font-css.ts` 的注释**

文件头注释里「public/font/fonts.css used to be linked ...」那段过时了。改成描述新模型：三份分族样式表（sans 阻塞首屏，另两份 `media="print"` 异步）、每份内部按「热区（页面画像并集优先）+ 频率序 6 字 Ext 块」分块、**一族一个 font-family 名**、每条 face 带**精确且互不相交**的 `unicode-range`。**函数体一字不改**。

⚠️ **注释里有一句现在是不成立的，必须一并改掉**：现有注释说 manifest 的 `?v=` 让「整个 `/font/` 目录树都能用 `Cache-Control: immutable` 而永不过期」。这句话**只对样式表成立**，对 woff2 文件**不成立**——`?v=` 只出现在样式表的 URL 上，样式表里的 woff2 URL 另带**每族一个**的版本令牌（R18）。新注释要把两层令牌说清楚：`manifest.version` 版本化的是**样式表**；**woff2 自己的**令牌写在 CSS 里，由 Task 3 生成。

- [ ] **Step 2b: 改 `next.config.ts` 的注释（**只改注释**）**

`next.config.ts:35-37` 那三行现在写的是：

```
  //   /font/    — Google Fonts subsets. The file names are content hashes,
  //               and the generated stylesheets carry a `?v=<hash>` query, so
  //               `immutable` can never serve a stale file.
```

**「文件名是内容哈希」这句话现在不成立了**：旧的 Google 子集是内容哈希文件名（要删掉），新的 `/font/web/**` 是**稳定名**（`hot.woff2` / `ext-001.woff2` / `ext-001-400.woff2` …，7 936 个文件里 0 个带内容哈希）。稳定名 + 一年 `immutable` 正是 R18 要防的：**同一个 URL 换了内容，而浏览器手里那份 immutable 的旧文件不会重新下载** ⇒ 新 CSS 的 `unicode-range` 声称某个文件里有某个字，那个文件其实没有 ⇒ 豆腐块（G10）。

改成说清楚两层令牌：`/font/` 下现在有两类东西——**样式表**（`fonts-{sans,serif,wenkai}.css`）由 `lib/font-css.ts` 追加 manifest 的 `?v=<manifest version>`；**woff2 子集**由 Task 3 在 CSS 里给每族一个 `?v=<族令牌>`（R18，sha256 前 12 位）。两者一变 URL 就变，`immutable` 才安全。

⚠️ **`headers()` 的三行逻辑一个字都不许改**（`/font/:path*` → `year`、`/fonts/:path*` → `month`、`/strokes/:path*` → `month`）。这一步是**纯注释**。改完跑 `npx tsc --noEmit` 确认没碰坏类型。

- [ ] **Step 3: 重写 `tests/unit/lib/fonts-css.test.ts`**

新文件的用例（保留 `describe` 命名风格）：

1. `public/font/fonts-<family>.css` 三份都存在。
2. 每份样式表里的 `@font-face` 条数 = 该族的「热区 + Ext 块」总数（wenkai 是 × 2，因为 400/700 各一条 face）。
3. 每条 face 的 `font-family` 只能是这 **3** 个名字之一：`Noto Sans SC`、`Noto Serif SC`、`LXGW WenKai TC`。
4. 每条 face 的 `src` 文件在 `public/` 下真实存在。
5. 每条 face 的 `font-display` 都是 `swap`。
6. 每条 face 都有非空的 `unicode-range`。
7. `fonts-sans.css`（唯一阻塞首屏的那份）**原始** ≤ 700 KB（700 KB = 700 × 1024 = **716 800 B**）。**Task 3 修复轮（F31-a 过滤 + R18 令牌）的实测值 —— 用这一组，不要用估算**：sans 原始 **620 320 B**（≈ 606 KB）/ **2 459** 条 face；serif 原始 **722 614 B**（≈ 705 KB）/ **2 841** 条 face；wenkai 原始 **666 617 B**（≈ 651 KB）/ **2 636** 条 face；三份合计原始 **2 009 551 B**。⚠️ wenkai 是**静态族，一个块两份文件**（400 + 700 各一份），所以它的原始字节是单份的两倍——计划里早先写的「wenkai 297 KB」是**单份**数字，别拿它当整族数字用；上面 666 617 B 是**整族**。字体字节合计 **28 127 360 B**（28.1 MB）。旧口径留档：未过滤构建是 sans 661 307 / serif 784 049 / wenkai 627 103 B，合计 2 072 459 B、**8 683** 个文件、28 774 592 B 字体字节。
8. 三份样式表合起来 gzip 后 ≤ `LIMITS.cssBytes` = **175 × 1024 = 179 200 字节**（F25-d 定的是 175 **KB** = 175 × 1024，不是 175 000 字节——算余量别算错）——用 `node:zlib` 的 `gzipSync` 算。**Task 3 修复轮（F31-a 过滤 + R18 令牌）的实测值 —— 用这一组**：合计 **157 282 B**（sans **55 437** / serif **63 915** / wenkai **37 930**），余量 **21 918 B**。另两份的 gzip 预算按同样口径换算：`LIMITS.sansCssBytes` = **65 × 1024 = 66 560 字节**，实测 sans **55 437 B**，余量 **11 123 B**。旧口径留档：未过滤构建 174 948 B 合计（sans 62 839 / serif 73 754 / wenkai 38 355），余量 4 252 B；加上 R18 令牌后 175 167 B，余量 **4 033 B**——过滤掉 746 个空壳 Ext 块之后，余量从 4 KB 级回到 **22 KB 级**。**（这是 R9 重定 + R17 放宽 + F25-d 重定后的预算；spec §3.3 的 25 KB 在静态子集下不可达，原因见「字体机制裁决」）**
9. manifest 的 `version` 是 12 位 hex；`files` 的值恰为 `/font/fonts-{wenkai,sans,serif}.css`；`version` 等于三份样式表内容按文件名排序后的 sha256 前 12 位（**直接实现这段哈希，不要 import 构建脚本**）。
10. `app/layout.tsx` 仍然包含 `getFontCssLinks()`、`href={fontCss.sans}`、`media="print"` 的两处 —— 与旧测试同义，保留。
11. `app/globals.css` 包含 `'Noto Sans SC'`、`'Noto Serif SC'`、`'LXGW WenKai TC'` 这 3 个族名，并且**不含** `'Noto Sans SC 1'` / `'Noto Sans SC Ext'` / `'LXGW WenKai TC Ext'` 这类旧的分档族名（防止有人把链改回去）。
12. 旧的 Google 子集目录**不存在**：`public/font/noto-sans-sc`、`public/font/noto-serif-sc`、`public/font/lxgw-wenkai-tc`、`public/font/fonts.css` 都不在磁盘上。
13. **每条 face 的 `src` URL 都带 `?v=<12 位 hex>`**（R18），且三份样式表的令牌**各自不同**（令牌按族算：族内容变了令牌才变）。这一条防的是「有人手改 CSS 把令牌删掉」——那会让 woff2 退回一年 immutable 的旧缓存，重新长出豆腐块（G10）。
14. 旧的 Google 子集目录**不存在**……（并入第 12 条，不重复）。

- [ ] **Step 4: 改 `tests/unit/lib/middleware-redirect.test.ts`**

第 65 行的示例路径 `'/font/noto-sans-sc/example.woff2'` 换成 `'/font/web/sans/hot.woff2'`（该目录已不存在，留着会误导）。第 64 行的 `'/font/fonts.css'` 也换成 `'/font/fonts-sans.css'`。**只改这两行**，不改测试逻辑。

- [ ] **Step 5: 删除旧产物并暂存新产物**

> **⚠️ 暂存之前先核对产物数量——这一步是硬闸门。** Task 3 的构建脚本现在**会清理** `public/font/web/<family>/` 里上一次构建的陈旧文件（修复轮 2 加的 `sweepStaleFiles`，提交 `1ed36c0ce`：写完一族之后，把该族目录里**不在本次写出集合中**的 `.woff2` 删掉；目录不存在返回空数组、`unlink` 失败抛错不吞）。⇒ **正常情况下不该有孤儿**。但**构建失败过、或者中途有人往里塞过文件**的话，目录里仍可能多出 `ext-NNNN.woff2`：它们**没有任何样式表引用**，会被一起提交 ⇒ 撑大仓库（7 936 个文件已经不少了）并且让下面的数字门禁对不上。暂存前必须逐项核对：

```bash
# 恰好 7 936 个 woff2 + 3 份 OFL 许可证，一个不多一个不少
ls public/font/web/*/*.woff2 | wc -l     # 7 936
ls public/font/web/OFL-*.txt | wc -l     # 3
# 三族分别是：
ls public/font/web/sans/*.woff2 | wc -l    # 2 459
ls public/font/web/serif/*.woff2 | wc -l   # 2 841
ls public/font/web/wenkai/*.woff2 | wc -l  # 2 636
```

> 数字对不上 ⇒ **先查清楚多出来/少掉的是什么**（多半是上一次构建的孤儿文件，或上一次构建中途失败留下的半成品），**不要**直接 `git add` 把它们带进去。字体字节合计应约 **28 127 360 B**。

```bash
git rm -r public/font/noto-sans-sc public/font/noto-serif-sc public/font/lxgw-wenkai-tc
git rm public/font/fonts.css scripts/fonts/build-fonts-css.mjs scripts/fonts/build-fonts-css.d.mts
git add public/font/web/sans public/font/web/serif public/font/web/wenkai \
        public/font/web/OFL-sans.txt public/font/web/OFL-serif.txt public/font/web/OFL-wenkai.txt \
        public/font/fonts-sans.css public/font/fonts-serif.css public/font/fonts-wenkai.css \
        public/font/fonts-manifest.json
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
- Produces: 一份 nginx 配置（**含微缓存指令**）+ 一份部署/回滚手册（`deploy/OPTIMIZATION.md`）。
  ⚠️ **不是「可直接 `cp` 覆盖」的配置文件**——仓库这份与线上跑的那份**不一致**（F30-a，见下面的部署前置），手册必须写清「先对账、只搬缓存那几行、备份、冒烟、回滚」。

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

**⚠️⚠️ 部署前置（承重；控制器裁决 F30-a / F30-b，2026-10-29 实测）**

> **仓库里的 nginx 配置不是线上跑的那份。** 这一条不是推测，是拿响应头逐项对出来的：

| 判据 | 仓库配置会产生的 | 线上实测（2026-10-29） | 结论 |
|---|---|---|---|
| `/font/noto-sans-sc/<hash>.woff2` 的 `ETag` | nginx `alias` + `expires` ⇒ `W/"<mtime-hex>-<size-hex>"` | `W/"2034-19ebc889440"`（**size 在前**、mtime 毫秒在后） | **Next.js** 的形状 |
| 同一个响应的 `Expires:` | nginx `expires 1y` **必定**带 `Expires:` | **没有 `Expires:`** | 不是 nginx 的 `expires` |
| `Cache-Control` | nginx 的 `expires` 产出 `max-age=31536000`，再叠 `add_header` 的 `public, immutable` ⇒ **两个** `Cache-Control` 头 | **一个**：`public, max-age=31536000, immutable` —— 与 `next.config.ts:45` 的 `/font/:path*` **逐字相同** | 由 Next.js 发出 |
| 一个不存在的字体 | nginx `try_files $uri =404` ⇒ nginx 的 404 | `X-Powered-By: Next.js` + `link: </_next/static/css/8cff398d26f7fab1.css>` + `Vary: rsc, …` ⇒ **Next.js 的 404 页面** | 请求根本没进 nginx 的静态分支 |

⇒ **线上 `/font/`、`/fonts/`、`/strokes/`、`/_next/static/`、`/audio/`、`= /logo.png` 全部由 Next.js 提供**，而仓库配置里对应的 `alias` 块（`deploy/nginx.ziyun.pudafo.com.conf:123-177`，2026-07-05 由 `da2955439` 加入）**在生产上没有生效**。

**F30-a（本任务的第一承重约束）**：**不许把仓库这份配置整份覆盖到服务器上。** 仓库文件里那些 `alias` 块一旦生效，静态资源就改由 nginx 出；而且 **`alias` + `try_files $uri =404` 是 nginx 的已知坑**（`try_files` 在 `alias` 语境下会用 alias 目录拼**完整请求 URI**，路径多出一层前缀）⇒ 最坏情况是**这一整段静态资源全部 404**——**本波次刚做出来的 7 936 个字体文件会全部消失**。上线必须按这个顺序：

1. **先对账**：在服务器上 `sudo nginx -T` 导出**当前生效**的完整配置，与仓库这份逐段 diff，**搞清楚线上到底有没有那些 `alias` 块**（本任务之前的实测结论是**没有**）。
2. **只搬缓存那几行**：把 `proxy_cache_path` 块与 `location /` 里的缓存指令，按线上现有配置的结构**手工合并**进去，不要整文件覆盖。
3. **先备份**：`sudo cp /etc/nginx/conf.d/<线上那份>.conf{,.bak-$(date +%F-%H%M)}`，并把回滚命令写进 `OPTIMIZATION.md`。
4. **`nginx -t` 通过后 `reload`**（不是 `restart`）。
5. **冒烟**（三条都要过，缺一条就回滚）：
   ```bash
   curl -sI https://ziyun.pudafo.com/font/web/sans/hot.woff2 | head -20   # 必须 200 + Content-Type: font/woff2
   curl -sI https://ziyun.pudafo.com/ | grep -i x-ziyun-cache             # 必须出现 X-Ziyun-Cache
   ```
   ⚠️ 这条冒烟是**本波次的验收项**：字体 404 意味着整个 Wave 2 的产物全废，而页面上**看不出任何错误**（字会悄悄回落到系统字体）。

   **第三条：带 `?v=` 令牌的字体 URL 必须返回正确的字节。** 前两条冒的是「文件在不在」，这一条冒的是 **R18 本身**——令牌的整套设计（`hot.woff2` 这种稳定名 + 一年 immutable 缓存）成立的前提是**带令牌的 URL 取回来的正是本地那个文件**。少验这一条，最坏情况是线上返回的是**另一个文件**（旧缓存里那份），而页面上的字照样是豆腐块。

   ```bash
   # a) 取 manifest 版本号（部署后的那份），再取 sans 样式表；样式表 URL 上的 ?v= 就是 manifest 的 version
   MV=$(grep -o '"version": *"[0-9a-f]\{12\}"' /var/www/ziyun/public/font/fonts-manifest.json | grep -o '[0-9a-f]\{12\}')
   echo "manifest version=$MV"
   # b) 取线上 sans 样式表里 sans 的令牌
   TOKEN=$(curl -s "https://ziyun.pudafo.com/font/fonts-sans.css?v=$MV" \
           | grep -o 'hot\.woff2?v=[0-9a-f]\{12\}' | head -1 | sed 's/.*v=//')
   echo "token=$TOKEN"                                    # 必须是 12 位小写 hex（当前应为 f31ca9b32566）
   # c) 带令牌的 URL 必须 200 + font/woff2 + 一年 immutable
   curl -sI "https://ziyun.pudafo.com/font/web/sans/hot.woff2?v=$TOKEN" | head -20
   #    必须含：200、Content-Type: font/woff2、Cache-Control: public, max-age=31536000, immutable
   # d) 取回来的字节必须与服务器上的文件逐字节相同（比服务器上部署后的那份，别拿构建目录比）
   curl -s "https://ziyun.pudafo.com/font/web/sans/hot.woff2?v=$TOKEN" -o /tmp/sans-hot.woff2
   sha256sum /tmp/sans-hot.woff2                          # 必须等于服务器上 public/font/web/sans/hot.woff2 的 sha256
   ```

   > **文件名注意**：sans/serif 是单字重，热区文件叫 `hot.woff2`；楷体（wenkai）是双字重，叫 `hot-400.woff2` / `hot-700.woff2`。用错文件名会拿到 404，而 404 在页面上又看不出错（字回落系统字体）。冒烟 sans 时用 `hot.woff2`。

   ⚠️ **d) 这一条是承重的**：R18 的令牌是「这一族所有文件的 sha256（文件名 + 字节，按写入顺序）」的前 12 位。如果线上返回的字节与本地不一致，那么**要么部署的不是这次构建的产物，要么代理层缓存了旧文件**——两种情况都会让令牌失去意义（浏览器手里的旧文件配新 CSS ⇒ 豆腐块）。
6. **回滚**：`sudo cp <备份> /etc/nginx/conf.d/<线上那份>.conf && sudo nginx -t && sudo systemctl reload nginx`。

**F30-b**：**本波次不碰那些 `alias` 块**——它们在生产上没生效，改它们既无收益、又把一个「已知的部署漂移」变成「未知的部署漂移」。仓库这份配置里的 `alias` 块**保持原样**，本任务只在 `OPTIMIZATION.md` 里把漂移写清楚，并给出去漂移的路径（要么把线上改成与仓库一致，要么把仓库改成与线上一致——**这是运维的活，不是本任务的活**）。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/deploy/nginx-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const conf = readFileSync(resolve(ROOT, 'deploy', 'nginx.ziyun.pudafo.com.conf'), 'utf8');
const brotli = readFileSync(resolve(ROOT, 'deploy', 'nginx-brotli.conf'), 'utf8');
const manual = readFileSync(resolve(ROOT, 'deploy', 'OPTIMIZATION.md'), 'utf8');

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

describe('the deploy manual refuses to overwrite the live nginx config (F30-a)', () => {
  it('says the repository config is not the one running in production', () => {
    expect(manual).toMatch(/不是线上跑的那份|不是线上生效的那份/);
  });

  it('requires reconciling the effective config before changing anything', () => {
    expect(manual).toContain('nginx -T');
  });

  it('smoke-tests the webfont path, because a 404 there is invisible on the page', () => {
    expect(manual).toContain('/font/web/sans/hot.woff2');
    expect(manual).toContain('font/woff2');
  });

  it('keeps a rollback command', () => {
    expect(manual).toMatch(/回滚/);
    expect(manual).toContain('nginx -t');
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

- **⚠️ 开头第一段必须是「不要整份覆盖」**（F30-a）：说明**仓库这份 nginx 配置不是线上跑的那份**——线上 `/font/`、`/fonts/`、`/strokes/`、`/_next/static/`、`/audio/`、`= /logo.png` 由 **Next.js** 提供（判据：ETag 是 `W/"<size-hex>-<mtime-ms-hex>"`、没有 `Expires:`、`Cache-Control` 与 `next.config.ts:45` 逐字相同、404 页面带 `X-Powered-By: Next.js`），而仓库配置里对应的 `alias` 块（`deploy/nginx.ziyun.pudafo.com.conf:123-177`）**在生产上没有生效**。因此**不许** `cp` 覆盖，**只搬缓存那几行**。
- **部署顺序**（F30-a 的六步，逐条给命令）：
  1. **对账**：`sudo nginx -T > /tmp/nginx-effective.conf`，与仓库这份 diff，确认线上到底有没有那些 `alias` 块；
  2. **备份**：`sudo cp /etc/nginx/conf.d/<线上那份>.conf{,.bak-$(date +%F-%H%M)}`；
  3. **合并**（不是覆盖）缓存指令：`proxy_cache_path` 块 + `location /` 里的 `proxy_cache*` 那几行；
  4. `sudo nginx -t`（**必须通过**）→ `sudo systemctl reload nginx`（**不是 restart**）；
  5. **冒烟**：`curl -sI https://ziyun.pudafo.com/font/web/sans/hot.woff2` 必须 **200 + `Content-Type: font/woff2`**；`curl -sI https://ziyun.pudafo.com/ | grep -i x-ziyun-cache` 必须出现该头；
  6. **回滚**：`sudo cp <备份> /etc/nginx/conf.d/<线上那份>.conf && sudo nginx -t && sudo systemctl reload nginx`。
  ⚠️ **第 5 条是本波次的验收项**：字体 404 意味着整个 Wave 2 的产物全废，而页面上**看不出任何错误**（字会悄悄回落到系统字体）。
- **配置漂移的说明（F30-b）**：写清「仓库配置与线上不一致」这件事，并把两条去漂移的路径列出来（把线上改成与仓库一致 / 把仓库改成与线上一致），注明**这是运维的活，本波次不动那些 `alias` 块**。
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
- Create: `scripts/perf/paired-ttfb.mjs`
- Create: `scripts/perf/font-load.mjs`
- Create: `scripts/perf/full-load.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4 的 `scripts/perf/class-attribution.mjs`（`collectFamilyCharsets()`）；Task 1 的 `loadFamilyCharsets()`；Task 3 产出的 `public/font/fonts-manifest.json` 与 `public/font/web/**`
- Produces: 三个测量脚本（都走网络）+ 对应的 npm script

  **归因规则只有一份**：HTML → 字族的映射一律调用 Task 4 的 `scripts/perf/class-attribution.mjs`，**不要**在这个任务里再写一份正则——`data/font-page-profiles.json`（fixture）和本任务的 `font-load.mjs`（预算核算）必须用同一条规则，否则测出来的载荷是假的。

  **归因规则是栈式的**（F27-j-b）：元素自己的 `font-kai` / `font-serif` / `font-sans` class 决定它渲染成哪款字，没有就继承父元素，再没有就是 `body` 的 sans。**不要**用「文本块的直属父元素的 class」那条旧规则——它把 Next.js SSR 用 `<!-- -->` 拆开的文本截断了（`《<!-- -->在岳咏蝉<!-- -->》` 只抓到 `《`），楷体集合被掏空，剩下的字全被算成 sans。Task 4 的单元测试已经锁死这条规则。

- [ ] **Step 1: 复核 Task 4 的归因模块（**本任务不新建它**）**

`scripts/perf/class-attribution.mjs` 与它的单元测试 `tests/unit/scripts/perf-class-attribution.test.ts` **在 Task 4 里已经写完**（Task 4 的 fixture 采集器要用它）。本任务只**复用**：

```bash
npx vitest run tests/unit/scripts/perf-class-attribution.test.ts
```

Expected: PASS。若不通过，先修 Task 4 留下的那个模块，**不要**在这里另写一份。

- [ ] **Step 2: 实现 `scripts/perf/paired-ttfb.mjs`**

- 用 `node:https` 的 `Agent({ keepAlive: true })` 走**同一条 keep-alive 连接**。
- 每个页面采样 N（默认 15）次：先取静态基线 `GET /manifest.json` 的 TTFB，再取 `GET <page>` 的 TTFB，记录差值。
- 输出每个页面的**中位数**差值与 min/max；页面上限硬编码为 `+24 ms`（spec §2.2），超了退出码 1。
- 基址来自 `--base` 参数，默认 `https://ziyun.pudafo.com`。

- [ ] **Step 3: 实现 `scripts/perf/font-load.mjs`**

- 取页面 HTML → **Task 4 的 `collectFamilyCharsets(html)`** → 每族字符集（归属规则与 `data/font-page-profiles.json` 天然一致，因为两者调用的是同一个模块：栈式继承，`font-kai` → wenkai、`font-serif` → serif、`font-sans` → sans，都没有就是 sans）。
- 用 Task 1 的 `loadFamilyCharsets()`（热区 + 频率序 6 字 Ext 块）与 `public/font/fonts-manifest.json`，算出「每族要下载哪些文件」，累加文件**字节**与**文件数**。
- 打印表格：`page | sans KB | serif KB | kai KB | total KB | font files`，并对照预算 `/ ≤ 330 KB`、`/dictionary ≤ 330 KB`、`/poetry ≤ 240 KB`、`/stories ≤ 330 KB`、文件数 ≤ **12**（F27-j-g；实测 308 / 308 / 221 / 308 KB，最多 **4** 个文件）；超标退出码 1。

- [ ] **Step 4: 实现 `scripts/perf/full-load.mjs`**

- **冷连接**取页面 HTML，解析出所有 stylesheet / script / font `url()`，逐个下载（同样走 keep-alive）。
- 打印：HTML 字节、JS+CSS 字节、字体字节、总字节、总耗时（秒）、并与 R9 的「首页冷加载 ≤ 5 s」对照（spec §2.2 原写的 2.5 s 是在旧字体模型下估的，见「字体机制裁决」）。

- [ ] **Step 5: 加 npm script**

```json
"perf:ttfb": "node scripts/perf/paired-ttfb.mjs",
"perf:fonts": "node scripts/perf/font-load.mjs",
"perf:load": "node scripts/perf/full-load.mjs",
```

- [ ] **Step 6: 提交**

```bash
git add scripts/perf/paired-ttfb.mjs scripts/perf/font-load.mjs scripts/perf/full-load.mjs package.json
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
5. **浏览器 smoke**——字体改造后需要人工过一遍 `/`、`/dictionary`、`/poetry`、`/stories`、`/ancient`、`/stories`（故事大字）、`/not-found`（160px 的「无」）、`/error`（120px 的「误」），确认没有豆腐块、没有明显字体闪烁、粗体楷体正常。⚠️ **另需记录「未测量页面」的字体请求数**（F27-j-i）：`/game`、`/sutra`、`/ancient`、`/worksheet` 等页面的字符集**没有被 fixture 覆盖**（现网已初始化并锁定，抓不到它们的真实内容），它们只吃得到热区里的语料频率头，其余落到 Ext 块 ⇒ 这些页面的字体请求数可能明显高于四个测量页面的 3–4 个。**在 DevTools 的 Network 面板按 `font/woff2` 过滤，逐页记下请求数与字节数**；若某个未测量页面的请求数 > 12（`LIMITS.maxFontFilesPerPage`）或字节数 > 330 KB，记录下来——那说明热区的语料兜底不够，需要回到 F27-j-c 重新评估热区种子。

---

## 本轮由我（Claude）代做的三个默认选择（用户未逐项回答）

用户中断了确认问卷后指示「继续」，因此以下三项是**我按推荐项代做的决定**，不是用户的答复。执行前请用户确认；任何一项要改，改的是本计划对应小节，不是代码。

| # | 议题 | 我的默认选择 | 依据 | 推翻它要改什么 |
|---|---|---|---|---|
| D1 | 字体 | **保留三款 webfont 及其全部字形/字重**，按站内真实用字重新子集化（不做换字体、不做可变字体以外的形变） | 用户要求「保持外观」，spec G9 也这么写 | Task 1/3 的字符集来源表与 `FAMILIES` 表 |
| D2 | 基础设施 | **我直接改 `deploy/nginx.ziyun.pudafo.com.conf` 并给出 deploy/rollback 命令串**；CDN 保持可选、代码侧只留注释 | 微缓存与 brotli 片段是本轮收益最大的一档 | Task 6 |
| D3 | 机房 | **不迁移**（保留现机房与 `139.5.108.245`） | 迁移会把本轮变成多项目工程，且用户未提出 | 不涉及代码；只影响 Task 8 的服务器调优清单适用范围 |

