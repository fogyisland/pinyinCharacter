# 站点性能优化 Wave 2 设计文档

日期：2026-10-29
状态：待实施
前序：[2026-08-05-site-optimization-wave1-design.md](./2026-08-05-site-optimization-wave1-design.md)（Wave 1，已于 2026-08-09 交付）

---

## 1. 背景与为什么是 Wave 2

2026-08-05 的 Wave 1 设计文档是「站点性能优化」三波计划的第一波，明确写明 "Wave 1 of 3"，并把后续两波的范围留在了文档末尾。Wave 1 已交付；Wave 2 从未开工。

Wave 1 遗留的 Wave 2 / Wave 3 清单（`docs/superpowers/specs/2026-08-05-site-optimization-wave1-design.md` 第 446–470 行）是在**没有实测数据**的前提下写的：

- `unstable_cache()` 缓存 `/api/sutras`、`/api/rare-chars/daily`、`/api/admin/*/stats`
- `experimental.staleTimes`
- `next/font/local` + `<link rel=preload>`
- 缺失索引（`audit_log.ip`、`chars.hsk_level`）
- `lib/admin-downloads.ts` / `lib/admin-ai.ts` 的 `Promise.all` 改写
- `force-dynamic` → ISR 审查（13+ 页面）
- 恢复 `images.unoptimized = false`

2026-10-29 的实测**否定了其中大部分**（见 §3）。本设计文档按实测结果重新排序，把 Wave 1 误判为「Wave 3 再做」的那一项——**字体子集化**——提升为 Wave 2 的第一优先级，因为实测证明它就是全站最大的成本项。

---

## 2. 目标与成功标准

### 2.1 目标

把生产环境的**字体载荷**从 3.7–5.0 MB / 页降到 **221–308 KB / 页**（预算 ≤ 330 KB，实测降幅 **−92 % … −95 %**），首屏冷加载从 ~21 秒降到 **≤ 5 s**，同时：

- 首屏渲染的**视觉表现不变**（三款 webfont 仍然在用，字形不换）
- 所有站点自身能渲染的汉字**不缺字**（tofu = 0）
- 服务端渲染耗时**不劣化**
- 登录态页面**不泄露**给匿名缓存

### 2.2 成功标准（可测）

| 指标 | 现状（2026-10-29 实测） | 目标 | 测量方式 |
|---|---|---|---|
| `/` 字体 woff2 | **3 813 KB** | ≤ 330 KB | `scripts/perf/font-load.mjs` |
| `/dictionary` 字体 woff2 | **4 985 KB** | ≤ 330 KB | 同上 |
| `/poetry` 字体 woff2 | **4 638 KB** | ≤ 240 KB | 同上 |
| `/stories` 字体 woff2 | **3 746 KB** | ≤ 330 KB | 同上 |
| 单页字体请求数 | **63 / 86 / 84 / 63 个**（上表四页依次） | ≤ 12 个 | 同上 |
| 字体 CSS（gzip） | 132.7 KB（线上是**单份合并**样式表） | ≤ 175 KB（新模型**三份合计**） | `curl -w %{size_download}` |
| 字体 CSS（gzip，无衬线那份，渲染阻塞） | 30.9 KB | ≤ 65 KB | 同上 |
| 首页冷加载耗时 | ~21 s（字体部分） | ≤ 5 s | `scripts/perf/full-load.mjs` |
| 服务端渲染 delta | +5 … +24 ms | ≤ +24 ms（不得劣化） | `scripts/perf/paired-ttfb.mjs` |
| 站点可渲染汉字缺字数 | 0 | 0 | `scripts/fonts/verify-webfont-subsets.mjs` |

> ⚠️ **「目标」这一列被实测重定过四轮**，当前值是**实际执行的门禁**：R9 → R17 → F25-c/d → F27-c/d/e → F27-j-g（见计划 `docs/superpowers/plans/2026-10-29-site-optimization-wave2-plan.md` 的《裁决记录》）。原始目标（250/350/250 KB、CSS ≤ 25 KB、冷加载 ≤ 2.5 s）建立在「每字 229 B、无每文件固定开销」这个**错误的成本模型**上——按它实现是做不到的。偏离不是静默改写：每个数字都有对应的实测值，依据全部登记在案。
>
> **并且要明说一件不体面的事：这一波让 CSS 变大了。** 线上现状是**单份合并样式表** `public/font/fonts.css`，gzip **132.9 KB**（136 065 B，控制器在 HEAD 上实测；本节原写的 132.7 KB 是 2026-10-29 对线上文件的实测值，差值来自线上文件与仓库 HEAD 不是同一份）。新模型是**三份**，合计 **153.6 KB**（157 282 B：sans 55 437 / serif 63 915 / wenkai 37 930）⇒ **+20.7 KB**。新模型的每条 face 都带一条精确且互不相交的 `unicode-range`，加上每族的 R18 版本令牌，CSS 必然比 Google 的逐码位逗号列表更啰嗦。这是**故意的取舍**：CSS 是首次访问的**一次性可缓存**成本，字体是**每次访问**的成本——预算该花在后者身上（§2.2 的字体行实测降了 **92–95 %**，CSS 行涨了 16 %）。**若将来有人拿「CSS ≤ 25 KB」回来当门禁，那是拿一个做不到的数字当标准。**
>
> 另：旧模型按族拆开是 sans **30.9 KB** / serif **30.9 KB** / wenkai **70.9 KB**（gzip）；新模型无衬线那份涨到 54.1 KB，但它**是唯一渲染阻塞的那一份**，所以单独设了 ≤ 65 KB 的上限。

### 2.3 非目标（明确不做）

- **不做** 缓存 API 层改造（`unstable_cache` / `experimental.staleTimes` / `force-dynamic` → ISR）。理由见 §3.3，实测收益 ≤24 ms。
- **不做** 换字体。三款字体（Noto Sans SC / Noto Serif SC / LXGW WenKai TC）保持不变。
- **不做** 机房迁移。
- **不做** `images.unoptimized = false` 回归。本轮首载里图片字节可忽略，且生产机 `sharp-linux-x64` 的历史坑未解。
- **不做** `public/fonts/`（隶书/篆书/甲骨文等古文字字体）的重新切分。那批字体只在 `/etymology/<char>` 用，且已经切过一轮（157 MB → 29 MB）。

### 2.4 反目标（做成这些算失败）

- 为了减字节而让任何站内可渲染的汉字变成豆腐块。
- 为了减字节而让首屏出现明显的字体闪烁（`font-display` 必须保持 `swap`）。
- 让登录用户看到匿名缓存的页面，或让匿名用户看到登录用户的页面。
- 引入新的**运行时**依赖（字体切分是**构建期**工具，不进 bundle）。

---

## 3. 实测数据（本设计的全部依据）

测量于 2026-10-29，生产环境 `https://ziyun.pudafo.com`，服务器位于**新加坡**（AS142002 Scloud Pte Ltd，45.197.12.253），客户端为**中国联通**（traceroute：192.168.31.1 → 120.80.165.241 → 219.158.x.x → 129.250.x.x（NTT 国际出口）→ 新加坡）。

### 3.1 网络基线

| 项 | 实测值 | 说明 |
|---|---|---|
| RTT（ping） | **282–291 ms** | 跨境链路 |
| 冷连接 → 首字节 | 750–1 050 ms | DNS + TCP(1 RTT) + TLS(1 RTT) + 请求(1 RTT) |
| 热连接 → nginx 静态基线 | 254 ms | 恰好 1 RTT，nginx 自身开销 ≈ 0 |
| **持续带宽（单 keep-alive 连接）** | **177 KB/s** | 12 个字体文件顺序下载 757 KB / 4.267 s |

### 3.2 载荷构成：字体占了首载的 90 % 以上

| 页面 | wenkai | serif | sans | **字体合计** | 页面需要的最少字形数 |
|---|---|---|---|---|---|
| `/` | 2 203 KB（34 个文件 / 37 字） | 583 KB（9 / 21） | 1 027 KB（20 / 169） | **3 813 KB** | 227 |
| `/dictionary` | 736 KB（12 / 7） | 1 571 KB（21 / 80） | 2 678 KB（53 / 736） | **4 985 KB** | 823 |
| `/poetry` | 3 452 KB（62 / 75） | 0 | 1 186 KB（22 / 169） | **4 638 KB** | 244 |
| `/stories` | 651 KB（12 / 8） | 1 755 KB（25 / 210） | 1 341 KB（26 / 280） | **3 746 KB** | 464 |

字体 CSS 另计 132.7 KB（3 个文件，432 条 @font-face）。

**根因**：Google Fonts 把每个 CJK 字体按**码位区间**切成 101 / 101 / 230 个子集。页面上 37 个散落的楷体字因此命中 **34 个**不同的子集文件——下载 2.2 MB 只为渲染 37 个字。

> 校正说明：本设计早期版本引用的「首页 2.83 MB / 字典页 2.48 MB」出自一个**下标错位**的 class 归属探测脚本（`re.split` 双捕获组下标算错，把标签名当成了属性），把多数文本块误判成 sans。修正后首页实为 3.81 MB、字典页 4.99 MB。上表是校正值。

### 3.3 服务端渲染不是瓶颈

用「每请求前先取一个 nginx 直出的静态基线 `/manifest.json`，取两者 TTFB 差值」的方法，配对采样 15 次取中位数：

| 页面 | 基线 TTFB | 页面 TTFB | 差值 |
|---|---|---|---|
| `/` | 254 ms | 259 ms | **+5 ms** |
| `/dictionary` | 254 ms | 272 ms | **+18 ms** |
| `/poetry` | 254 ms | 272 ms | **+18 ms** |
| `/game`、`/pinyin`、`/worksheet` | — | — | +8 … +24 ms |

服务端渲染耗时是 **5–24 ms**。因此 `unstable_cache()` / `experimental.staleTimes` / ISR / 加索引**合计最多省 96 ms**，而字体要 21 秒。**它们不是本轮的目标。**

### 3.4 切分工具链的实测能力（本轮做过的 spike）

| 实验 | 结果 |
|---|---|
| `subset-font`（fontkit 封装，仓库已有）处理**可变字体** | ✅ 保留 `wght` 轴与 9 个命名实例（Thin…Black） |
| 源字体 `NotoSansSC[wght].ttf` | 16.9 MB，31 036 字形 |
| 切出 155 字 | 35.9 KB → **1.24 KB 固定开销 + 229 B/字** |
| `fonttools varLib.instancer` 把 wght 裁到 [400,700] | 16.9 → 16.8 MB；切分后 **225 B/字**（−7 %） |
| `pyftsubset --flavor=woff2` | 240 B/字（比 `subset-font` 差）→ **不采用** |
| 站点实际用到的字重 | 仅 400 / 500 / 600 / 700（`font-bold` 18 处、`font-semibold` 32 处、`font-medium` 68 处；无 100–300、无 800–900） |
| **Google 自己的子集** | sans **305 B/字**、serif **407 B/字**、wenkai **291 B/字**（101/101/230 文件，14 801 / 14 827 / 32 194 字形，sans 与 serif 全部为可变字体） |

**结论：本仓库的切分器（225 B/字）比 Google 自己的子集（305–407 B/字）还省 26–44 %。** 所以问题从来不是每字成本，而是 **Google 下载了页面根本用不到的字形**：字典页只需要 823 个字形，Google 送了约 6 900 个。

### 3.5 真实字符集规模（从语料文件统计，非页面探测）

| 来源 | 文件数 | 去重字符数 |
|---|---|---|
| `data/content/*.json` | 7 905 | 16 502 |
| `data/poems/*.json` | 1 165 | 4 695 |
| `data/classics/*.json` | 196 | 13 015 |
| `data/sutras/*.json` | 12 | 2 531 |
| **源码里的中文字面量**（`app/` `components/` `lib/` 共 576 个文件） | 576 | **1 142** |
| **sans 需要的并集** | | **16 772** |
| **serif 需要的并集**（+ 经文 + 古籍） | | **20 616** |

### 3.6 其它已确认的事实

- `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` 出现在**每一个** HTML 响应上 → 任何 CDN 或 nginx 微缓存都无法缓存 HTML。
- 仓库的 nginx 配置**只有 gzip**，brotli 三行是注释掉的（需要 `nginx-module-brotli`）。
- 仓库的 nginx 配置**没有 `proxy_cache`**。
- 仓库的 nginx 配置**没有开启 QUIC**（`listen 443 ssl http2`），但**线上服务器**的响应里带 `Alt-Svc: quic=":443"; h3=":443"` → **线上 nginx 版本与仓库配置已不一致**，需要核对。
- 仓库配置里的 Cloudflare `set_real_ip_from` 是注释掉的，且响应头里没有 `cf-ray` → **线上没有 Cloudflare**。
- `/font/`、`/fonts/`、`/strokes/` 的 `Cache-Control: immutable` 已在 `next.config.ts` 配好；`/font/` 的样式表带 `?v=<hash>`。
- `font-kai` 在全站出现 106 处，其中 105 处不带字重，**仅 1 处**用 `font-bold` → 楷体可以只发布 Regular 一个字面。

---

## 4. 方案

### 4.1 W2-1 字体子集重建（最大杠杆）

> ⚠️ **本节的机制与数字已被实施期裁决取代——请先读这段，再读小节。**
>
> §4.1.2～§4.1.8 写的是**设计提案**（每族分三档、每档一个 font-family 名、Ext 按 256 个连续码位切）。落地时这套做法被实测推翻并重做了一遍，**理由与最终数字全部登记在计划 `docs/superpowers/plans/2026-10-29-site-optimization-wave2-plan.md` 的《裁决记录》**（R14–R18、F25、F27、F31）。差异是：
>
> | 本节写的 | 实际落地的 |
> |---|---|
> | 每族三个 font-family（`Noto Sans SC 1/2/Ext`），CSS 变量串成回退链 | **一族一名**（`Noto Sans SC`），靠**互不相交的精确 `unicode-range`** 决定命中哪个文件（R15） |
> | 档 1 = 前 200 字，档 2 = 200–800 字 | **热区 = 300 字**（sans/serif/kai 三族都有热区；R14「楷体无热区」已作废，F27-j-d） |
> | Ext 按 **256 个连续码位**一块 | Ext 按**频率序 6 字**一块（F25 推翻 R10） |
> | 每块约 29–38 KB | 每块 **≤ 7 KB**（实测 sans max 5 368 B / serif max 6 600 B / 楷体 400+700 合计 max 8 928 B ⇒ 单份约 4.5 KB） |
> | 投影载荷 163 / 283 / 103 / 380 KB | **实测 308 / 308 / 221 / 308 KB**（预算 330 / 330 / 240 / 330 KB） |
> | 校验器断言「档 1 ≤ 100 KB、档 2 ≤ 260 KB、每块 ≤ 60 KB、每份 CSS ≤ 200 条 face / ≤ 60 KB」 | 见 §4.1.6 的**现行**阈值（`LIMITS`） |
>
> **为什么改**：多档 font-family 会让浏览器在同族多份 `@font-face` 之间出现命中顺序歧义，且档位越多、每个页面要下的文件越多（实测 148–177 个/页）。改成「一族一名 + 精确 unicode-range」之后，浏览器只会下载**真正命中**的文件，页面请求数降到 **4 个**。
>
> 本节其余部分（§4.1.1 的核心思路、§4.1.4 的字符集来源、§4.1.8 的风险表）仍然成立，**照着做**；被取代的只有上表列出的那几处。

#### 4.1.1 核心思路

不再按码位区间切分（Google 的做法），而是**按站内实际用字的频率重新切分**，并让每个页面只下载**恰好覆盖它所需字形**的一小组文件。

#### 4.1.2 每一族分三档，每档一个字体族名

对 sans / serif / kai 三族，各产出**三个 font-family**，在 CSS 变量里组成 fallback 链：

```css
--font-han-sans:  'Noto Sans SC 1',  'Noto Sans SC 2',  'Noto Sans SC Ext',  system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
--font-han-serif: 'Noto Serif SC 1', 'Noto Serif SC 2', 'Noto Serif SC Ext', Georgia, 'Songti SC', 'SimSun', serif;
--font-wenkai:    'LXGW WenKai TC 1','LXGW WenKai TC 2','LXGW WenKai TC Ext','Kaiti SC', 'KaiTi', 'STKaiti', serif;
```

浏览器按字符逐个在链上找**第一个拥有该字形的族**——这是 CSS 字体回退的标准行为。因此：

- 档 1 覆盖的字 → 只下载档 1 的文件，档 2 / 档 Ext **完全不会被下载**
- 档 1 没覆盖、档 2 覆盖的字 → 下载档 1 + 档 2
- 只有档 Ext 覆盖的字 → 再加一个 Ext 分块文件

各档用**不同的 font-family 名**（而不是同一族内的多条 `@font-face`），是为了避开「同一族多条 @font-face 同时命中时谁生效」的顺序歧义，让行为完全由回退链决定。

| 档位 | 内容 | sans 文件大小 | serif | kai |
|---|---|---|---|---|
| **1（Core）** | 按全站语料频率排序的**前 200 字** | 45 KB | 60 KB | 58 KB |
| **2（Mid）** | 排名 200–800 的 **600 字** | 135 KB | 180 KB | 175 KB |
| **Ext** | 该族剩余字符集，按 **256 个码位一块**的连续区间切分 | 每块约 29 KB | 每块约 38 KB | 每块约 37 KB |

`Ext` 的分块用**连续码位区间**（不是显式列表），否则 20 616 个字符的显式列表会有 160 KB 的 CSS。

#### 4.1.3 为什么这样有效

实测各页所需的最少字形数（§3.2）：

| 页面 | sans | serif | kai |
|---|---|---|---|
| `/` | 169 | 21 | 37 |
| `/dictionary` | 736 | 80 | 7 |
| `/poetry` | 169 | 0 | 75 |
| `/stories` | 280 | 210 | 8 |
| `/rare-chars` | 483 | 0 | 6 |
| `/sutra/<id>`（服务端） | 485 | 0 | 15 |

**前 200 字覆盖除 `/dictionary` 的 sans 与 `/stories` 的 serif 之外的全部页面**；那两页落在档 1 + 档 2 内，仍然只下载 **2 个文件**。

投影后的字体载荷：

| 页面 | 现状 | 新方案 | 降幅 |
|---|---|---|---|
| `/` | 3 813 KB | ~163 KB | **−96 %** |
| `/dictionary` | 4 985 KB | ~283 KB | **−94 %** |
| `/poetry` | 4 638 KB | ~103 KB | **−98 %** |
| `/stories` | 3 746 KB | ~380 KB | **−90 %** |

#### 4.1.4 字符集与频率来源

新增 `scripts/fonts/webfont-charset.mjs`，为每一族产出「字符集 + 频次」：

1. `scripts/fonts/gb2312-7000.txt`——7 000 常用字
2. `data/content/*.json`——字典 8 105 字及其释义、组词、例句
3. `data/general-standard-chinese-characters.json`——通用规范汉字表
4. `data/poems/*.json`——诗词正文、标题、作者
5. `data/sutras/*.json`——经文正文（serif）
6. `data/classics/*.json`——古籍正文（serif）
7. **源码里的中文字面量**：扫描 `app/`、`components/`、`lib/` 的 `.ts`/`.tsx`/`.mjs`，抽出全部 CJK 字符——保证**每一个 UI 文案**都有字形
8. `data/rare-chars/`（若存在）

**频率打分**：`score = 语料出现次数 + 源码字面量出现次数 × 1000`。源码字面量加权，是因为 UI 文案出现在**每一个**页面上，而语料频次反映的是内容的重要性；两者都要进档 1。

各族的字符集：

| 族 | 字符集 | 规模 |
|---|---|---|
| sans | 1 + 2 + 3 + 4 + 7 + 8 | ~16 800 |
| serif | sans 的全部 + 5 + 6 | ~20 600 |
| kai | 7（UI 文案）+ 2 + 3（故事大字、后台事件等任意字场景） | ~2 000 |

> `scripts/fonts/charset.mjs`（古文字字体用）**不改**——它服务隶书/篆书/甲骨文，与本轮的三款 CJK 字体是两条链路。

#### 4.1.5 构建产物与目录

新脚本 `scripts/fonts/build-webfont-subsets.mjs`：

- **输入**：`scripts/fonts/staging/web/` 下的源字体（gitignored）
  - `NotoSansSC[wght].ttf`（16.9 MB，可变）
  - `NotoSerifSC[wght].ttf`（25.1 MB，可变）
  - `LXGWWenKaiTC-Regular.ttf`（13.1 MB，静态）
  - 下载脚本 `scripts/fonts/download-webfont-sources.ts`（与现有 `download-hard-pen-fonts.ts` 同一套路）
- **预处理**：sans / serif 先用 `fonttools varLib.instancer` 把 `wght` 裁到 `[400,700]`（站点只用到这四个字重）；⚠️ **别信「225 B/字」那个成本模型**——真实的子集成本是 `fixed(≈1 000 B) + perChar × 字数`（F25 实测）
- **切分**：`subset-font`（仓库已有），热区一个 woff2；Ext **每 6 字一块**（频率序，F25 推翻「256 码位一块」）
- **输出**：
  - `public/font/web/<family>/hot.woff2`（楷体是静态族，一块两份：`hot-400.woff2` / `hot-700.woff2`）、`ext-<NNN>.woff2`
  - `public/font/fonts-<family>.css`——**替换**现有的 `fonts-sans.css` / `fonts-serif.css` / `fonts-wenkai.css`
  - `public/font/fonts-manifest.json`——`version` 重新计算；`files` 结构保持 `{ sans, serif, wenkai }`（`lib/font-css.ts` 依赖它）
- **删除**：`public/font/noto-sans-sc/`、`public/font/noto-serif-sc/`、`public/font/lxgw-wenkai-tc/` 三个 Google 子集目录（21 MB / 437 个文件）

#### 4.1.6 校验

新增 `scripts/fonts/verify-webfont-subsets.mjs`：

- 每一族的每个字符**有且只有一个**块覆盖它
- 用 fontkit 打开每个产物，断言其 cmap 确实包含该块声明的所有字符
- 断言热区文件 ≤ `LIMITS.hotBytes`（**96 KB**；实测 sans 72 KB / serif 89 KB / 楷体 77 KB 每份），每个 Ext 块文件 ≤ `LIMITS.extBlockBytes`（**7 KB**；实测 sans max 5 368 B、serif max 6 600 B、楷体 400+700 两份合计 max 8 928 B ⇒ 单份约 4.5 KB）
- 断言三份 `fonts-<family>.css` **gzip 后合计** ≤ `LIMITS.cssBytes`（**175 KB**）；**无衬线那一份单独** ≤ `LIMITS.sansCssBytes`（**65 KB** —— `app/layout.tsx` 用普通 `<link rel="stylesheet">` 引入它，是**唯一渲染阻塞**的一份）；单份的 `@font-face` 条数 ≤ `LIMITS.maxFacesPerCss`（**3 400**）
- 断言 `public/font/fonts-manifest.json` 的 `version` 与样式表内容哈希一致（**算哈希之前先把 CRLF 归一化成 LF**，否则在 `core.autocrlf=true` 的 Windows 上会假红）
- **对 §3.2 表里的每个页面**跑一次覆盖率断言（用服务端渲染出的字符集）：字节 ≤ `LIMITS.pageFontBytes[path]`、文件数 ≤ `LIMITS.maxFontFilesPerPage`（**12**）

#### 4.1.7 应用侧改动

- `app/globals.css`（`:root` 块，约 465–470 行）：三个 `--font-*` 变量**各只点名一个 webfont 族**（R15），后面跟系统字体兜底 —— **不是**「档 1 / 档 2 / 档 Ext / 系统」的多档回退链（那套已作废，见本节开头的对照表）
- `app/globals.css`（约 29–31 行）：`--font-sans` / `--font-serif` / `--font-kai` 保持不变（它们已引用上面三个变量）
- `lib/font-css.ts`：**不改**（manifest 结构不变）
- `app/layout.tsx`：**不改**（三张样式表的加载方式不变）

#### 4.1.8 风险

| 风险 | 缓解 |
|---|---|
| 某个字没进字符集 → 豆腐块 | 字符集含源码全量中文字面量；校验脚本断言零缺失；用户生成内容（评论、后台备注）落到系统字体，不算缺陷 |
| 字体观感变化 | 字形来自同一份源字体，只是重新分组，**字形完全一致**；可变轴裁到 [400,700] 不改变 400/500/600/700 的插值结果 |
| 楷体没有 Bold | 全站仅 1 处 `font-kai font-bold`，由浏览器合成加粗；若视觉不可接受，单独补一个 Bold 档 1 |
| 构建耗时 | 实例化 3 × 73 s + 切分 ~150 块 × 0.25 s ≈ 6 分钟，一次性 |
| 仓库体积 | 删除 21 MB Google 子集，新增约 9 MB 自切产物（Ext 分块占大头），净减约 12 MB |

---

### 4.2 W2-2 nginx：brotli + HTML 微缓存

改 `deploy/nginx.ziyun.pudafo.com.conf`，并给出部署与回滚步骤。

#### 4.2.1 brotli

现状：只有 gzip；brotli 三行注释着「需要 nginx-module-brotli 编译」。

方案：**先探测，再启用**。

```bash
nginx -V 2>&1 | grep -o brotli
```

- 有 `brotli` → 启用 `brotli on; brotli_comp_level 6; brotli_static on;`，并在构建期对 `/font/` 的 CSS 与 `/_next/static/` 的 JS/CSS 预生成 `.br` 文件（新增 `scripts/precompress-assets.mjs`，用 Node 内置 `zlib.brotliCompress`）
- 无 `brotli` → 保持 gzip，并给出安装指引（`apt install libnginx-mod-http-brotli`）

收益：JS+CSS 133 KB → 约 100 KB；HTML 15 KB → 12 KB。

#### 4.2.2 HTML 微缓存

现状：所有 HTML 都是 `private, no-cache, no-store`，且 nginx 无 `proxy_cache` → HTML 永远不被缓存，重复访问仍要付 250 ms RTT + 传输。

方案（**必须绕过登录态**）：

```nginx
proxy_cache_path /var/cache/nginx/ziyun levels=1:2 keys_zone=ziyun_html:10m max_size=64m inactive=10m use_temp_path=off;

# 在 location / 内
proxy_cache ziyun_html;
proxy_cache_key "$scheme$request_method$host$request_uri";
proxy_cache_valid 200 10s;
proxy_cache_methods GET HEAD;
proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
proxy_cache_bypass $cookie_auth_token $http_rsc;   # 读：登录用户与 RSC 飞行请求不读缓存
proxy_no_cache  $cookie_auth_token $upstream_http_set_cookie $http_rsc;  # 写：同上，且带 Set-Cookie 的一律不写
proxy_cache_lock on;
proxy_ignore_headers Cache-Control;                # 只忽略 Cache-Control，不忽略 Set-Cookie
add_header X-Ziyun-Cache $upstream_cache_status always;

# 另加：API 一律不缓存（location / 下挂着 68 个 GET API 路由）
location /api/ { proxy_cache off; }
```

安全约束（**必须全部满足，否则本项不做**）：

1. `proxy_cache_bypass $cookie_auth_token $http_rsc` —— `auth_token` 是 `lib/auth.ts:18` 的会话 cookie 名。**它只管「读」，不管「写」**：它阻止命中缓存，却**照样会把带登录态的响应写进缓存**给别人看。⇒ 光有它不够，必须同时有第 2 条。
2. `proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc` —— **写的那道闸**。`$upstream_http_set_cookie`（nginx 1.7.5+ 自带）有值即表示上游这个响应种了 cookie，一并挡掉。⚠️ **早期草案写的是 `proxy_ignore_headers Cache-Control Set-Cookie;`——已作废**：忽略 `Set-Cookie` 等于允许把带 cookie 的响应写进缓存，与本条自相矛盾。**只忽略 `Cache-Control`**（Next 的 `private, no-cache, no-store` 必须被忽略才能缓存）。
3. `$http_rsc` 必须**同时**进上面两条：线上实测 `RSC: 1` 请求头返回的是 flight 数据（`Content-Type: text/x-component`），同一个 URL 不带该头返回 `text/html` 的完整页面——**两者只有这一个请求头不同**，缓存键（`$request_uri`）完全相同 ⇒ 不隔离就是把 HTML 喂给客户端路由 → 白屏。
4. `proxy_cache_valid 200 10s` —— TTL 只 10 秒；307→`/init`、4xx、5xx 都不入缓存。
5. `location /api/ { proxy_cache off; }` —— `location /` 下还挂着 68 个 GET API 路由，其中 `/api/chars/random`、`/api/poetry/random`、`/api/game/round`、`/api/stats`、`/api/audio/active` 的语义是「每次给新内容」，缓存 10 秒会让它们对所有用户返回同一个值；`/api/history`、`/api/notes`、`/api/membership/me`、`/api/worksheets/*` 是用户态数据。该块比 `/api/auth/`、`/api/init/` 短，nginx 取最长前缀匹配，那两个限流块不受影响。
6. 上线后必须用 `curl -I` 验证 `X-Ziyun-Cache` 从 `MISS` → `HIT`，且带 `auth_token` 的请求恒为 `BYPASS`。

> 风险提示：若站点未来新增任何「按用户区分」的 cookie 或请求头，**必须同时扩展 `proxy_cache_bypass` 与 `proxy_no_cache` 两条**——只改前者会让登录态响应被写进缓存。

收益：**重复访问 −250 ms（首字节）+ 免掉 HTML 传输**。

#### 4.2.3 线上 nginx 与仓库配置的对账

线上响应带 `Alt-Svc: quic=":443"; h3=":443"`，仓库配置却是 `listen 443 ssl http2`。**本项要求先在服务器上核对 `nginx -V` 与 `/etc/nginx/conf.d/` 的实际配置**，再决定是给仓库补 QUIC 还是把线上改回与仓库一致。同时核对 `nginx -V | grep brotli`。

> ⚠️ **更重要的发现（F30-a，实施期实测）：仓库这份 nginx 配置根本不是线上跑的那份，所以「改仓库里的文件」不等于「改线上」。**
>
> 线上 `/font/`、`/fonts/`、`/strokes/`、`/_next/static/`、`/audio/`、`= /logo.png` **全部由 Next.js 提供**（判据：ETag 是 `W/"<size-hex>-<mtime-ms-hex>"` 的 size-first 形状、**没有** `Expires:`、`Cache-Control` 与 `next.config.ts:45` 逐字相同、404 页面带 `X-Powered-By: Next.js`），而仓库配置里对应的 `alias` 块**在生产上没有生效**。
>
> ⇒ **绝不许把仓库这份整份 `cp` 覆盖到服务器上**。理由不是「会覆盖掉一些手工配置」，而是**会直接打挂静态资源**：仓库里的 `alias` 块一旦生效，`alias` + `try_files $uri =404` 会用 alias 目录拼**完整请求 URI**（路径多出一层前缀）⇒ 这一整段静态资源**全部 404**，而**页面上看不出任何错误**——字会悄悄回落到系统字体，本波次刚做出来的 7 936 个字体文件全部消失。
>
> ⇒ 正确做法：**先 `nginx -T` 对账**（并从 `# configuration file <路径>:` 行里读出线上那份配置的真实路径，记为 `LIVE_CONF`，**不许写死路径**）→ **只把缓存那几行手工合并进去** → `nginx -t` 通过 → `reload` → 冒烟 → 备好回滚命令。完整命令串见 `deploy/OPTIMIZATION.md`。

### 4.3 W2-3 服务器 TCP 调优（用户执行）

带宽 177 KB/s × 250 ms RTT ≈ 44 KB 的有效窗口，与 Linux 默认 TCP 窗口在这个 RTT 下的表现吻合。**开 BBR 通常能把这条跨境链路的吞吐提升数倍**，代价是几行 sysctl。

`deploy/tuning/ipv4-bbr.conf`：

```
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
```

应用：

```bash
cp deploy/tuning/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
sysctl --system
```

回滚：删掉该文件后 `sysctl --system`。**注意：BBR 只影响新建立的连接**，需要 `ss -tin` 观察是否生效。

### 4.4 W2-4 CDN（可选，用户决定）

实测确认线上**没有** Cloudflare（响应无 `cf-ray`，仓库里的 `set_real_ip_from` 也是注释状态）。若接入 Cloudflare：静态资源从就近边缘节点下发，RTT 从 250 ms 降到 30–60 ms，带宽从 177 KB/s 提升到数 MB/s；同时需要启用仓库 nginx 里的 `set_real_ip_from`（Cloudflare 官方 IP 段）+ `real_ip_header CF-Connecting-IP`。

**本项不在代码仓库内实施**（需要账号），但仓库里的 nginx 配置要**预留**这些指令并注释说明。

### 4.5 W2-5 性能基线进仓库

把本次用于诊断的探测脚本收进 `scripts/perf/`：

- `scripts/perf/paired-ttfb.mjs`——配对采样测服务端渲染 delta（§3.3）
- `scripts/perf/font-load.mjs`——按 class 归属计算每族真实命中的子集字节（§3.2）
- `scripts/perf/full-load.mjs`——冷连接 + 子资源阶段的总字节与总耗时（§2.2）

它们是本设计的**验收工具**，必须随代码一起进仓库。

> **实现注意（两条，缺一条就测出假数据）**：
>
> 1. **下标**。`re.split(r"<(\w+)([^>]*)>", html)` 的结果是
>    `[text, tag, attrs, text, tag, attrs, text, …]`，第 i 个标签的属性在 `3i+2`、正文在 `3i+3`。
>    本次诊断的第一版脚本按 2 步长取值，把标签名当成了属性，导致「多数文本块归入 sans」的假象，
>    把首页字体载荷低估成 2.83 MB（实为 3.81 MB）。新脚本必须带单元测试锁死这个下标。
> 2. **归属必须栈式**（F27-j-b）。元素**自己**的 `font-kai` / `font-serif` / `font-sans` class 决定它渲染成哪款字，
>    没有就**继承父元素**，再没有就是 `body` 的 sans。**不要**用「文本块的直属父元素的 class」那条平铺规则——
>    Next.js SSR 会用 `<!-- -->` 把文本拆开（`《<!-- -->在岳咏蝉<!-- -->》`），平铺规则只抓到 `《`，
>    楷体集合被掏空，剩下的字全被算成 sans。归因规则**只有一份**：`scripts/perf/class-attribution.mjs`；
>    fixture（`data/font-page-profiles.json`）与 `font-load.mjs` 的预算核算必须调**同一个模块**，否则测出来的载荷是假的。

---

## 5. 任务分解

| # | 任务 | 交付物 |
|---|---|---|
| W2-1a | 字体字符集构建器 | `scripts/fonts/webfont-charset.mjs` + 测试 |
| W2-1b | 源字体下载 + 轴裁剪 | `scripts/fonts/download-webfont-sources.ts`、`scripts/fonts/instance-webfont-axis.mjs` |
| W2-1c | 字体子集切分器 | `scripts/fonts/build-webfont-subsets.mjs` |
| W2-1d | 子集校验器 | `scripts/fonts/verify-webfont-subsets.mjs` |
| W2-1e | 接入应用 | `app/globals.css` 变量**核对**（实测已是单族写法，**不改**）、删除 Google 子集目录、manifest 更新、测试更新 |
| W2-2 | nginx 改动 | `deploy/nginx.ziyun.pudafo.com.conf`（brotli + microcache）+ 部署/回滚文档 |
| W2-3 | 预压缩脚本 | `scripts/precompress-assets.mjs`（brotli `.br`） |
| W2-4 | 服务器调优清单 | `deploy/tuning/ipv4-bbr.conf` + 操作说明 |
| W2-5 | 性能基线进仓库 | `scripts/perf/*.mjs` + 测试 |

依赖关系：W2-1a → W2-1b → W2-1c → W2-1d → W2-1e。W2-2/W2-3/W2-4/W2-5 相互独立。

---

## 6. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 切分后出现缺字 | 高 | 字符集含源码全量中文字面量；校验脚本断言零缺失；系统字体兜底 |
| 微缓存把登录态页面缓存给匿名 | 高 | **两道闸**：`proxy_cache_bypass $cookie_auth_token $http_rsc`（读）+ `proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc`（写）。⚠️ `bypass` 只管读不管写，**只写 bypass 会把登录态响应写进缓存**。上线后 `curl -I` 验证：匿名 MISS→HIT、带 `auth_token` 恒为 `BYPASS` |
| 源字体下载失败（网络/体积） | 中 | 已有 `LXGWWenKaiGB-Regular.ttf` 在 staging；Noto 源可从 `raw.githubusercontent.com` 取；下载失败时脚本给出明确报错并保留旧产物 |
| brotli 模块不存在 | 中 | 先探测再启用，无模块则退回 gzip 并给安装指引 |
| 热区太小导致页面要下很多 Ext 块 | 中 | 构建后按 §3.2 的页面表实测，必要时上调热区字数（300 → 450 更省请求数，→ 150 更省字节） |
| 切分耗时过长 | 低 | 一次性约 6 分钟，构建期执行 |
| 仓库体积 | 中 | ⚠️ **比原估计大得多，且方向相反**。原写「删 21 MB、新增 9 MB、净减 12 MB」——**实测净增**：删 Google 三目录 **19.9 MB / 432 文件**（磁盘 21 MB），新增 `public/font/web/` **26.8 MB / 7 939 文件**（磁盘 **41 MB**），三份样式表从 0.9 MB 涨到 1.9 MB ⇒ **净 +8.9 MB 字节 / 磁盘净 +21 MB / 文件数净 +7 506**。`.git` 相应再涨约 28 MB。缓解：产物**一次性提交**进仓库，部署时不跑构建 |

---

## 7. 验收

全部满足才算 Wave 2 完成：

1. `npm run fonts:verify-webfont` 通过（零缺字、无超限文件）
2. `npm test` 全绿（含新增的字体与 nginx 配置测试）
3. `npm run build` 成功
4. `scripts/perf/font-load.mjs` 报告 `/` ≤ 330 KB、`/dictionary` ≤ 330 KB、`/poetry` ≤ 240 KB、`/stories` ≤ 330 KB，且**单页字体请求数 ≤ 12 个**
5. `scripts/perf/paired-ttfb.mjs` 报告服务端渲染 delta 未劣化（≤ +24 ms）
6. nginx 配置通过 `nginx -t`（在服务器上）
7. 部署后 `curl -I` 显示 `X-Ziyun-Cache: HIT`（重复访问）且登录请求为 `BYPASS`

---

## 8. 未决事项（留给实施期裁决）

> ⚠️ 第 1–3 条写的是 §4.1 那套「档 1 / 档 2 / Ext 块」的机制，**已被实施期裁决取代**（见 §4.1 开头的对照表）。当前落地的是：**热区 300 字**（三族都有）+ **Ext 每 6 字一块**（频率序）+ **一族一名**。裁决依据见计划《裁决记录》的 R14–R18、F25、F27、F31。

1. ~~**档 1 的字数**：默认 200。若实测首页也命中档 2，上调到 300–400。~~ ⇒ **已裁决：热区 = 300 字**（sans / serif / kai 三族都有；R14「楷体无热区」已作废，见 F27-j-d）。
2. ~~**档 2 的字数**：默认 600（档 1 + 档 2 合计 800）。~~ ⇒ **已作废**：不再有「档 2」这一层，只有热区与 Ext 块。
3. ~~**Ext 块大小**：默认 256 码位一块。可在 128 / 256 / 512 之间调整。~~ ⇒ **已裁决：Ext 块 = 频率序 6 字**（F25 推翻 R10 的「256 码位一块」）。要调的是**块宽**（6 → 8 会让 CSS 变小、请求数变少但页面字节变多），不是码位区间。
4. **频率权重里的源码字面量系数**：默认 ×1000。
5. **是否接入 CDN**：属于用户的账号与成本决策，代码侧只预留配置。
6. **未测量页面的字体请求数**：`/game`、`/sutra`、`/ancient`、`/worksheet` 等页面的字符集**没有被 fixture 覆盖**（现网已初始化并锁定，抓不到它们的真实内容），它们只吃得到热区里的语料频率头，其余落到 Ext 块 ⇒ 这些页面的字体请求数可能明显高于四个测量页面的 4 个。**浏览器 smoke 时要按 `font/woff2` 过滤逐页记录**；若某个页面 > 12 个请求或 > 330 KB，说明热区的语料兜底不够，要回头重估热区种子。
