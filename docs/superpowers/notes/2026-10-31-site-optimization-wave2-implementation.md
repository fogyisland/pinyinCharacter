# Wave 2 站点优化 —— 实施记录（2026-10-31）

> ⚠️ **这份记录不是规格。**
> 规格（`docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`）是约束权威；
> 本记录只说三件事：**实际做了什么**、**实测是多少**、**哪些没做到**。

| 项 | 值 |
|---|---|
| 分支 | `perf/webfont-wave2-2026-10-29`（**未合并、未 push**） |
| 提交数 | 89（`origin/main..HEAD`） |
| 规格 | `docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`（**本波新建**） |
| 计划 | `docs/superpowers/plans/2026-10-29-site-optimization-wave2-plan.md`（**本波新建**） |
| 账本 | `.superpowers/sdd/2026-10-29-site-optimization-wave2-plan/progress.md` §一–§十九（全部裁决与实测数据） |

---

## 1. 这一波做了什么

一句话：**把「字体子集化」从「Wave 3 再做」提到 Wave 2 的第一优先级，并把页面字体预算的门禁从假绿灯改成真门禁。**

计划里的 9 个任务 + 1 个计划外任务：

| 计划任务 | 名称 | 落点 |
|---|---|---|
| Task 1 | 字体字符集构建器（W2-1a） | `scripts/fonts/webfont-charset.mjs` + `.d.mts` |
| Task 2 | 源字体下载 + 可变轴裁剪（W2-1b） | `scripts/fonts/download-webfont-sources.ts`、`scripts/fonts/instance-webfont-axis.mjs` + `.d.mts` |
| Task 3 | 字体子集切分器（W2-1c） | `scripts/fonts/build-webfont-subsets.mjs` + `.d.mts` |
| Task 4 | 子集校验器（W2-1d） | `scripts/fonts/verify-webfont-subsets.mjs` + `.d.mts` |
| Task 5 | 接入应用（W2-1e） | `lib/font-css.ts`、`app/globals.css`（未改）、`next.config.ts`、`middleware.ts`、`.gitattributes` |
| Task 6 | nginx —— brotli 与 HTML 微缓存（W2-2） | `deploy/nginx-brotli.conf`、`deploy/nginx.ziyun.pudafo.com.conf`、`deploy/README.md` |
| Task 7 | 预压缩脚本（W2-3） | `scripts/precompress-assets.mjs` + `.d.mts` |
| Task 8 | 服务器调优清单（W2-4） | `deploy/tuning/ipv4-bbr.conf`、`deploy/tuning/README.md` |
| Task 9 | 性能基线进仓库（W2-5） | `scripts/perf/{fetch-page,class-attribution,font-load,full-load,paired-ttfb}.mjs` + `.d.mts`、`scripts/perf/README.md` |
| Task 10 | 恢复本地拉丁层（W2-6，**计划外**） | `scripts/fonts/build-webfont-subsets.mjs`、三份 CSS |
| **W2-7** | **页面预算门禁去循环**（**计划外**） | `scripts/fonts/verify-webfont-subsets.mjs`、`scripts/perf/font-load.mjs`、`data/font-page-sample.json`（新）、`scripts/fonts/capture-page-font-profiles.mjs` |

---

## 2. 关键数字（全部实测，测量方式写在 §5）

### 2.1 改造前 → 改造后

| 指标 | 改造前（2026-10-29 线上实测） | 改造后（2026-10-31 实测） | 预算 |
|---|---|---|---|
| `/` 字体 woff2 | **3 813 KB** | **368–448 KB**（367 760–448 488 B） | ≤ 547 KB |
| `/dictionary` 字体 woff2 | **4 985 KB** | **331 KB**（330 688 B） | ≤ 403 KB |
| `/poetry` 字体 woff2 | **4 638 KB** | **241 KB**（241 204 B） | ≤ 294 KB |
| `/stories` 字体 woff2 | **3 746 KB** | **495–741 KB**（495 316–741 324 B） | ≤ 904 KB |
| 单页字体请求数 | 63 / 86 / 84 / 63 个 | 18–44 / 7 / 6 / 55–123 个 | ≤ 153 个 |
| 字体 CSS（gzip） | 132.9 KB（**单份合并**样式表） | **153.6 KB**（三份合计：sans 55 437 / serif 63 915 / wenkai 37 930） | ≤ 175 KB |
| 字体 CSS（gzip，无衬线那份，**唯一渲染阻塞**） | 30.9 KB | 54.1 KB | ≤ 65 KB |

⇒ 字体载荷降 **−80 % … −95 %**。

⚠️ **这一波让 CSS 变大了 20.7 KB（+16 %），这是故意的取舍。**
CSS 是首次访问的**一次性可缓存**成本，字体是**每次访问**的成本 ⇒ 预算该花在后者身上。
新模型的每条 face 带一条精确且互不相交的 `unicode-range`，加上每族的 R18 版本令牌，
CSS 必然比 Google 的逐码位逗号列表更啰嗦。
**若将来有人拿「CSS ≤ 25 KB」回来当门禁，那是拿一个做不到的数字当标准。**

### 2.2 机制

- **热区 300 字**（三族都有）；
- **扩展块 = 频率序 6 字一块**（F25 推翻 R10 的「256 码位一块」）；
- **拉丁层**（W2-6 装回）：sans 9 / serif 14 / wenkai 22 条 face，指向 **共 45 个本地 woff2**，
  拉丁热层那四个文件 **合计 20 508 B**（≈ 20.1 KB）⇒ **零云端请求**。

---

## 3. 落地的东西

### 3.1 字体流水线（五步，全部本地，不引用任何云端字体）

```
fonts:download-web     # 下载源字体到 scripts/fonts/staging/（git-ignored，不入库）
fonts:instance-web     # 裁掉可变字体的多余轴（Python fontTools.varLib.instancer）
fonts:subset-web       # 按频率切分，写出 woff2 + 三份 CSS + manifest
fonts:verify-webfont   # 门禁：覆盖率 / 缺字 / 尺寸 / 页面预算 / 版本令牌
fonts:capture-page-profiles  # 抓真实页面的字符集样本
```

### 3.2 产物（入库）

| 路径 | 内容 |
|---|---|
| `public/font/fonts-manifest.json` | 版本令牌 + 三份 CSS 的哈希 + 每族文件清单 |
| `public/font/fonts-{sans,serif,wenkai}.css` | 三份样式表（**无衬线那份是唯一渲染阻塞的**） |
| `public/font/web/<族>/` | `hot.woff2` + `latin*.woff2` + `latin-ext-*.woff2` + `ext-*.woff2` |
| `public/font/web/OFL-*.txt` | 三份字体许可证 |

- 跟踪文件 **7 988 个**，磁盘 **43 MB**；
- **源字体不入库**（`scripts/fonts/staging/` 是 git-ignored 的暂存目录）。

⚠️ `scripts/fonts/build-fonts-css.mjs` 与 `public/font/fonts.css`（旧的单份合并样式表）
**已被本波删除** ⇒ 旧的「一份合并 CSS」模型不再存在。

### 3.3 性能探针（全部进仓库，可复现）

| 脚本 | 用途 |
|---|---|
| `npm run perf:fonts` | 单页字体载荷与请求数（活页探针） |
| `npm run perf:load` | 首屏冷加载 |
| `npm run perf:ttfb` | 服务端渲染 delta（成对对比） |
| `scripts/perf/fetch-page.mjs` / `class-attribution.mjs` | 抓页面 + 归因到 CSS 类 |

### 3.4 部署侧

- `deploy/nginx-brotli.conf`、`deploy/nginx.ziyun.pudafo.com.conf`（brotli + 匿名 HTML 微缓存）；
- `scripts/precompress-assets.mjs`（`.br` / `.gz` 旁车文件，**不生成 `.env`**）；
- `deploy/tuning/ipv4-bbr.conf` + `deploy/tuning/README.md`（BBR 与 TCP 缓冲调优清单）。

### 3.5 顺带修的（不属于字体，但在同一分支上）

- `app/admin/settings/site-url/page.tsx`、`app/api/admin/site-url/route.ts`、
  `components/admin/SiteUrlForm.tsx` —— 后台站点域名页在未配置时不再 500（提交 `a1c36ee10`）。

---

## 4. 门禁：这一波最有价值的部分

**问题（本波最高严重度缺陷 C-1）**：页面字体预算门禁拿的是**热区的种子**当页面的样本
⇒ 它永远测不到扩展区，也永远测不到一页真实要下多少个文件 ⇒ **它报的是假绿灯**。

**做法（W2-7）**：把一个数字拆成**三个角色**。

| 角色 | 数据 | 判失败吗 | 判据 |
|---|---|---|---|
| **种子** | `data/font-page-profiles.json`（1 轮，2026-10-29） | **不判**（只报告，明写 LOWER BOUND / 下限） | —— |
| **并集样本** | `data/font-page-sample.json`（8 轮，2026-10-31） | **判** | `unionSampleBytes[path]`、`maxUnionSampleFilesPerPage` |
| **活页探针** | `scripts/perf/font-load.mjs` 打真实页面 | **判** | `pageFontBytes[path]`、`maxFontFilesPerPage` |

**四条去循环守卫**（任一不满足 ⇒ 校验器非 0 退出，消息说清「门禁是循环的」）：

1. 样本的扩展层字符总数 > 种子的（739 > 196）；
2. 至少一个页面样本的文件数 > 种子的（175 > 8、255 > 8）；
3. 样本声明 `rounds >= 2`；
4. 确定性页面（`/dictionary`、`/poetry`）的样本与种子**逐字符相同**。

⇒ 门禁**先证明自己在测东西**，再谈测得准不准。

---

## 5. 测量方式（数字从哪来，可复核）

| 数字 | 量法 |
|---|---|
| 页面字符集 | `scripts/fonts/capture-page-font-profiles.mjs` 抓**线上** `https://ziyun.pudafo.com` 的四个页面 |
| 字节与文件数 | 仓库已发布的样式表 + 仓库磁盘上的 woff2，按 `@font-face` 的 `unicode-range` 展开后逐块求和 |
| 方法校验 | 同一把尺子在**种子**上的结果与校验器**逐字节相同**（336 052 B / 8 个文件）⇒ 量法本身被交叉验证过 |
| 活页探针 | `npm run perf:fonts -- --base <base>`（真实下载，计入真实请求数） |

⚠️ **「32 次抽样」= 本地 4444 十六次 + 生产十六次**（2026-10-31），
取**最大值**再加 25 % 余量做预算。

⚠️ **版本错位（skew）**：仓库这一版的字体令牌是 `b3f4e8e92be1`，
线上引用的令牌是 `5496b6a601ac` ⇒ **线上跑的是 wave 1 的字体构建，本波未部署**。
这**不推翻**任何一个数字，因为每一个成本都是
「仓库这一版的字体文件，对某一页画出的字符」（字符集来自线上，字节来自仓库磁盘）。
⇒ 探针打线上时**一定**会打出 skew 警告（它就该打）；读数字的人必须知道「差值是版本错位，不是性能回退」。

---

## 6. 规格改动清单（R-12 的抬起记录）

R-12 规定「规格是约束权威，不得修改」。本波对规格的每一次改动都在下面列出，
**依据是用户在三个节点上的明确授权**。

| # | 授权 | 内容 | 依据 |
|---|---|---|---|
| 1 | **裁定二十六**（发布目录模型） | 规格里确定「产物发布进 `public/font/web/r<token>/<族>/`，重写 CSS 的 URL 前缀，旧发布目录永不覆盖」 | 用户明确选择「产物落地 = staging + 显式「应用」」 |
| 2 | **裁定二十七**（`WEBFONT_FONT_DIR`） | 规格里确定「校验器与探针都支持 `WEBFONT_FONT_DIR` 指向候选目录」 | 用户明确选择「流水线能力 = 完整四步，缺能力就报错」 |
| 3 | **用户裁定「① 上调预算到实测值」** | 规格里 6 处「引用页面字体预算数字的地方」改成实测值 + 25 % 余量 | 用户原话 |

### 6.1 第 3 项的逐行清单（最后一次）

| 位置 | 旧 | 新 |
|---|---|---|
| `:31` | 221–308 KB/页（预算 ≤ 330 KB，−92…−95 %） | **241–741 KB/页（预算 ≤ 904 KB，−80…−95 %）** |
| `:42` | ≤ 330 KB | **≤ 547 KB（实测 368–448 KB）** |
| `:43` | ≤ 330 KB | **≤ 403 KB（实测 331 KB）** |
| `:44` | ≤ 240 KB | **≤ 294 KB（实测 241 KB）** |
| `:45` | ≤ 330 KB | **≤ 904 KB（实测 495–741 KB）** |
| `:46` | ≤ 12 个 | **≤ 153 个（实测 18–44 / 7 / 6 / 55–123；原目标 ≤ 12 个未达成）** |
| `:169` | 实测 308/308/221/308 KB（预算 330/330/240/330 KB） | **实测 448/331/241/741 KB（32 次抽样的最大值，2026-10-31；预算 547/403/294/904 KB）** |
| `:281` | 文件数 ≤ `LIMITS.maxFontFilesPerPage`（**12**） | **（153）**（第六处，**裁定二十九** 补掉；不改就自相矛盾） |
| `:465` §7 第 4 条 | ≤ 330/330/240/330 KB、≤ 12 个 | **≤ 547/403/294/904 KB、≤ 153 个** |
| `:481` §7 第 6 条 | > 12 个或 > 330 KB | **> 153 个或 > 904 KB** |

⚠️ `:87` 的「12 个字体文件顺序下载 757 KB / 4.267 s」是**带宽表**的历史口径，
**不是**页面请求数上限 ⇒ 未动。

### 6.2 新增的门禁数值（`LIMITS`）

```
hotBytes                 96 * 1024      不变
extBlockBytes             7 * 1024      不变
cssBytes                175 * 1024      不变
sansCssBytes             65 * 1024      不变
maxFacesPerCss            3400          不变
latinBytes               12 * 1024      不变
maxFontFilesPerPage         153          变了（123 × 1.25 向下取整）
pageFontBytes['/']        560128         变了（实测最大值 × 1.25 向下取整到整 KB）
pageFontBytes['/dictionary'] 412672
pageFontBytes['/poetry']    301056
pageFontBytes['/stories']   925696
unionSampleBytes          839680 / 330752 / 241664 / 1214464   新增（实测向上取整到整 KB）
maxUnionSampleFilesPerPage    255        新增
```

⚠️ **1.25 余量落在「−80 %」的分母里** ⇒ 报出来的降幅比按实测值直接算的略保守。

---

## 7. 已知限制（如实披露）

| # | 限制 | 为什么没在本波修 |
|---|---|---|
| L-1 | **原目标「单页字体请求数 ≤ 12」未达成**（实测 18–44 / 7 / 6 / 55–123） | 根因是扩展块**每块 6 字**（F25 裁决）⇒ 块宽 6 → 8 能减请求数但会增字节，与本波「压字节」的优先级相反。要改就得**重新裁决机制**并重测，属下一波 |
| L-2 | **并集样本预算没有余量**（向上取整到整 KB） | **有意为之**：它是「守住上界」的封顶线，不是「均值预警」。多捕一轮就会红 ⇒ 想要余量得先决定「多捕一轮算不算超」 |
| L-3 | **`parseFaces` 不剥离 CSS 注释** ⇒ 样式表里一条注释里的 face，校验器与探针**都**会算进去（方向是**多算**，不会造假绿） | 派工不许动那个函数，且方向安全 ⇒ 记在这里 |
| L-4 | **扩展区并非全部落系统字体** | 控制器 2026-10-31 自己用 fontkit 量了源字体的 cmap 与已发布样式表的 `unicode-range`：<br>· **源字体**（`scripts/fonts/staging/web/`）里扩展区（B/C/D/E/F）码位：sans **220**、serif **217**、wenkai **1 617**；<br>· **站点实际发布的本地子集**覆盖的扩展区码位：sans **209**、serif **208**、wenkai **196**。<br>⇒ **扩展区有相当一部分是本地 webfont 画的**，真正落系统字体的是**源字体本身就没有的那些码位**（实测 `U+206C1` 三族都没有、`U+27221` 三族都没有、`U+200A4` wenkai 有而 sans/serif 没有）⇒ 那是**源字体的边界**，不是本波的取舍 |
| L-5 | **校验器单跑 23–55 s** ⇒ 该测试文件约 **116 s / 42 用例** | 本仓**没有 CI**，超时风险只在本地 ⇒ 记录下来，不为此改实现 |
| L-6 | **活页探针对着生产跑过一次（2026-10-31，EXIT=0，四页全在预算内），但那批数字不是线上此刻的真实字节** | 线上跑的仍是 **wave 1 的字体**（线上令牌 `5496b6a601ac` vs 仓库 `b3f4e8e92be1`）⇒ 探针量的是「**本分支的字体语料 × 线上页面的字符**」⇒ 数字作数的前提是**线上已经是这一支** ⇒ **wave 2 部署后必须重跑并存档**（见 §8.1 第 7 条）。原始输出存 `.superpowers/sdd/2026-10-29-site-optimization-wave2-plan/perf-fonts-production-2026-10-31.txt` |

### 7.1 评审的六条 Minor（M-1…M-6）的处置

> 这六条来自 W2-7 的任务评审（Critical 0 · Important 1 · Minor 6）。
> 处置依据见账本 `.superpowers/sdd/2026-10-29-site-optimization-wave2-plan/progress.md` §二十一（裁定三十三）与 §二十二（复审裁定 + 修复轮 4）。

| # | 处置 | 改了什么 / 为什么不改 |
|---|---|---|
| M-1 | ✅ **已改** | `checkProfileHasLatin` 抽成**纯函数**并导出（`scripts/fonts/verify-webfont-subsets.mjs`）；报告里新增**第三条错误通道** `fixtureErrors`：**种子与样本都判失败**（夹具坏了 ⇒ 报告里每个数字都是假的，不许它自己通过）。种子的**页成本**仍然只降级成 `floorNotes`（这一条**没动**），`latinErrors` 与「没有一份 face 认领这个字」的信息行为也**没动**。`.d.mts` **只追加**了声明（`PageFontCost.fileBudget`、`floorCosts`、`floorNotes`、`sample`、`fixtureErrors`）—— 没有改动、删除或重排任何一条既有声明行 |
| M-2 | ⚠️ **只做了一半** | 25 % 余量的**出处**已经在 `deploy/OPTIMIZATION.md:623`（「取实测最大值再加 25 % 余量」）—— 但**规格里没有**，而且 R-12 **禁止**往规格加行 ⇒ 「读规格的人查不到余量怎么来的」这一点**没有解决**。如实记录，**不假装解决** |
| M-3 | ✅ **已改** | 新增**一行**输出 `[verify] union : …`，说出**最紧的那个页面**还剩多少字节、多少文件的余量，并写明**零余量是故意的**。**没有**新增任何会判失败的断言（`/stories` 实测 255 个文件 = 预算 255，字面上「文件数必须严格小于上限」今天就是红的；做成双向断言，语料变小时也会红）。口径与代价见 §7.2 |
| M-4 | ❌ **没改（如实披露）** | 见 §7.3 |
| M-5 | ✅ **已改** | `verify-webfont-subsets.mjs` 里那行**硬编码**的种子路径改成 `displayPath(SEED_PATH)`（输出文字今天不变，但仓库根目录以外跑时不再说错路径） |
| M-6 | ✅ **已改**（且**又修了一轮**） | 三个口径统一成 **7 981**（= 7 936 个中文字块 + 45 个拉丁文件；**样式表引用**的去重文件数 sans 2 468 / serif 2 855 / wenkai 2 658），并加了一条**机器检查**让它**不能再漂**（见 §9.2）。复审发现那条检查里的期望值是**抄进去的常数**而不是**实测推出来的** ⇒ 修复轮 4 改成从实测推出（见 §9.3） |

### 7.2 并集预算的口径，**以及它的代价**（M-3，账本 §21.4）

**口径**：并集样本的预算**不是**「页面应该有多重」的体重预算，而是**漂移探测器**。

- 样本（`data/font-page-sample.json`，8 轮）超过预算 ⇒ **红**；
- 语料变了（多捕一轮、页面内容变了）⇒ **红** ⇒ 由**人**手工重新定基
  （改 `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`）；
- **后端永远不会自动改预算** —— 自动改预算 = 门禁自己给自己发通行证。

**⚠️ 代价：这条只被单向守着。**
「预算 == 当前样本」这个等式**只在一个方向上被守**：
**超了 ⇒ 红**（有人会看见）；**变小了 ⇒ 绿**，而且**预算会悄悄地变松**，
没有人会注意到 ⇒ 「预算慢慢烂掉」这条路是敞着的。
这是本波**明确接受**的代价（账本 §21.4）。要堵它得改成双向断言，
而双向断言在**语料变小**时也会红 ⇒ 得把「变好」与「变坏」分成两种信号，
属下一波的事。

### 7.3 活页那半道门禁，本波**没**在可用的 base 上跑过（M-4）

- 本地 4444 在 `/init` 上 **307** ⇒ 本地**不是**一个可用的 base；
- **线上跑的还是 wave 1 的字体**：线上令牌 `5496b6a601ac`，仓库这一版是 `b3f4e8e92be1`；
- **本仓没有 CI** ⇒ 两道门禁（`npm run fonts:verify-webfont` 与 `npm run perf:fonts`）
  **都是手工跑的 npm 脚本**：没人提醒，坏了也没人知道。

**⇒ 上线后的义务（欠账，不是可选项）**：部署 wave 2 之后，在**活 base** 上重跑并归档：

```bash
npm run perf:fonts -- --base https://ziyun.pudafo.com
```

---

## 8. 未验证项 / 上线前必须做的事

### 8.1 必须由人做的（控制器代劳不了）

1. **轮换 MySQL 口令**：`root@127.0.0.1` 与 `piyin@139.5.108.245` 两个账号
   （旧口令进过 git 历史与 GitHub）；
2. **写生产 `.env`**（`JWT_SECRET` ≥ 32 字符 / `COOKIE_SECURE` / `DATABASE_URL` / `SITE_URL`；
   ⚠️ 2026-10-28 实测：生产 `.env` **缺 `DATABASE_URL`** ⇒ 全站 DB API 500；
   `validateEnv` 只 warn 不 throw）；
3. **服务器侧 nginx 部署与回滚**（`nginx -t` → 改 `LIVE_CONF` → 灰度 → 回滚预案在 `deploy/README.md`）；
4. **BBR 启用**（`deploy/tuning/ipv4-bbr.conf`）；
5. **CDN 决策**（属账号与成本决策，代码侧只预留配置）；
6. **wave 2 部署后的浏览器 smoke**：逐页按 `font/woff2` 过滤记录请求数与字节；
   并核对 `𠕁`（U+20541）/ `𠛁`（U+206C1）/ `𠂤`（U+200A4）/ `𧈡`（U+27221）的兜底表现。
7. **wave 2 部署后重跑活页探针并归档**（§7.3 / L-6）：
   `npm run perf:fonts -- --base https://ziyun.pudafo.com`
   —— 控制器在 2026-10-31 已经对着生产跑过一次（EXIT=0，四页全在预算内），
   但那时线上还是 wave 1 的字体 ⇒ 那批数字是「本分支语料 × 线上页面字符」，
   **不是线上此刻的真实字节** ⇒ **wave 2 上线后必须重跑**，那时令牌才不偏、数字才作数。

### 8.2 控制器已跑 / 未跑的

| 项 | 状态 |
|---|---|
| `npm test` | ✅ 绿（见 §9.1） |
| `npx tsc --noEmit` | ✅ EXIT=0 |
| `npm run fonts:verify-webfont` | ✅ EXIT=0 |
| `npm run build`（沙箱 `D:/Temp/pinyin-build-check`） | ✅ EXIT=0（见 §9.1） |
| `npm run perf:fonts` 打真实 base | ⚠️ **已跑过一次（对着生产，EXIT=0，四页全在预算内）**，但线上仍是 wave 1 的字体 ⇒ 数字不是线上此刻的真实字节 ⇒ **wave 2 上线后必须重跑并存档**（§7.3 / §8.1 第 7 条） |
| `npm run perf:load` / `perf:ttfb` 打真实 base | ❌ 未跑（同上） |
| `nginx -t` | ❌ 未跑（需服务器） |
| 生产 `curl -I` 看 `X-Ziyun-Cache` | ❌ 未跑（需部署） |

### 8.3 计划文件里那个「恰好 7 936 个 woff2」现在要重算

`docs/superpowers/plans/2026-10-29-site-optimization-wave2-plan.md:2054`
（Task 5 的**暂存硬闸门**）写的是 **7 936**（sans 2 459 / serif 2 841 / wenkai 2 636）——
那是**装回拉丁层之前**的事实。拉丁层后来装回（**45 个**文件），
所以**今天磁盘上是 7 981**（sans 2 468 / serif 2 855 / wenkai 2 658，另有 3 份 OFL 许可证）。
⚠️ 计划文件**不改**（它记的是**执行当时**的事实），
但**执行 Task 5 暂存闸门的人必须按 7 981 重算**，否则会对着一个过期的数字点头。

## 9. 收尾验证

**四道关在 wave 2 的最终 tip `bda756dc5` 上跑。**
主树只跑**类型 / 校验器 / 测试**；**构建一律在沙箱**（4444 端口被 dev server 占着，
主树 build 会砸掉 dev 的缓存 —— 记忆 `dev-build cache stomp`）。

### 9.1 四道关的结果

| # | 关 | 命令 | 在哪跑 | 退出码 | 关键输出 |
|---|---|---|---|---|---|
| 1 | 类型 | `npx tsc --noEmit` | 主树 | **0** | 无输出（`tsc.log` 0 字节）。⚠️ `.mjs` 仍**不被检查**（`allowJs: false`）⇒ 类型面只有 `.d.mts` ⇒ 那张脸靠 §9.2 的第一条守卫盯着 |
| 2 | 校验器 | `npm run fonts:verify-webfont` | 主树 | **0** | `[verify] 0 error(s)`；三族 OK（sans **2 468** / serif **2 855** / wenkai **2 658** = **7 981** 文件）；CSS 158 848 B gzip；四页并集 838 960 / 330 688 / 241 204 / 1 214 408 B ⇒ 余量 **720 / 64 / 460 / 56 B**；`/stories` 文件数 **255 = 255（零余量）** |
| 3 | 全量测试 | `npm test` | 主树 | **0** | **147** 个测试文件通过 / 6 跳过（153）；**1 493** 个用例通过 / 17 跳过（1 510） |
| 4 | 构建 | `npm run build` | 沙箱 `D:/Temp/pinyin-build-check`（tip `bda756dc5`） | **0** | `BUILD_EXIT=0`；`✓ Compiled successfully in 81s`；Next 的成功路由表（46 条 app 路由）；First Load JS shared by all **102 kB**；Middleware 34.5 kB |

原始输出：`tsc.log` / `verify.log` / `test.log`（`/tmp/wave2-final/`）；构建日志 `/tmp/wave2-build.log`。

⚠️ **第 4 关第一次的跑法有缺陷，这里如实记下**：第一次的命令是
`npm run build 2>&1 | tail -60` ⇒ 管道的退出码是 **`tail` 的**（几乎恒为 0），
**不是** `next build` 的 ⇒ 「exited with code 0」**证明不了**构建成功。
控制器先用**产物证据**核实（`.next/BUILD_ID` + 全套 manifest + `export-marker.json`
+ 46 条 app 路由产物 + Next 的成功路由表），**随后重跑一次**并把真实退出码写进日志。
⇒ 教训：**任何 `cmd | tail` 的管道都不能拿来当退出码证据。**

⚠️ **第 2 关那个「零余量」不是坏了，是设计如此**：
`/stories` 的 255 个文件正好等于 `maxUnionSampleFilesPerPage` ⇒ 语料一改它就红 ⇒
它是**漂移检测器**，修法是**人手工重定基线**，后台**永远不许自动改预算**（§7.2）。

### 9.2 修复轮 3 加的三条机器检查

| 检查 | 挡的是什么 |
|---|---|
| **声明面 ≡ 实现面**（`tests/unit/scripts/verify-webfont-subsets.test.ts`） | `allowJs: false` ⇒ `.mjs` **永远不被类型检查**，`.d.mts` 是唯一的手写声明面 ⇒ 两张脸会**静默漂移**。现在由一个**括号配平的取名器**逐个比对两张脸的成员集合（`.d.mts` 用 `;` 分隔、可以有嵌套类型；`.mjs` 用 `,` 分隔、可以是简写）。它**已证红过**：从 `.d.mts` 临时删掉一个成员 ⇒ 测试立刻红 |
| **`checkProfileHasLatin` 的单元测试** | 夹具里一个拉丁字都没有 ⇒ 拉丁层那半道检查是**空集** ⇒ 从没建过的拉丁层会报绿。补上三个用例（无拉丁 / 有拉丁 / 标签确实被替换） |
| **7 981 / 7 936 的散文一致性** | 四处「总数」与五处「中文字块数」的散文必须带着**实测推出来的**分组数（不是抄进去的常数）。计数**数的是样式表引用的文件**（去查询串、去重），**不是磁盘** —— 下一波的后台流水线会写 `public/font/web/r<token>/<族>/` 并保留旧版本，数磁盘的话下一波就红 |

### 9.3 修复轮 4（控制器执行）的落地

scoped 复审判定 M-6「期望值从实测推出来」**未做到** ——
计数断言里是**抄进去的常数**。控制器判为**承重**（不是「Minor」）：
语料一变，人得手工重基线；若只改了计数、**忘了改散文**，
散文检查照样绿、而散文在撒谎 —— 正是 M-6 要堵的那个洞。

修复轮 4 由**控制器亲自执行**（偏离 SDD「R≥4 ⇒ 换新实施者」的规矩，
四条理由与代价记在账本 §22.9），
改动只落在一个文件 `tests/unit/scripts/verify-webfont-subsets.test.ts`，
提交 `bda756dc5`（1 文件，+95/−23）。

| 改动 | 挡的是什么 |
|---|---|
| **期望值从实测推出**：三份样式表引用到的文件集**只测一次**（`SHIPPED`，去查询串、去重），散文期望值改成 `grouped(SHIPPED.total)` / `grouped(SHIPPED.chinese)` | 散文不再抄常数 ⇒ 语料一动，**没改的散文变红**。⚠️ 计数断言（2 468 / 2 855 / 2 658 / 7 981 / 45 / 7 936）**保持字面量** —— 那是「语料是不是我们以为的那个」的**漂移探测器**，不该变成恒真式 |
| **词元匹配**：新增 `carriesNumber(line, number)` ⇒ 命中两侧**不许有数字** | `toContain` 的**邻接漏洞**：`7 981` 会被 `17 981` / `7 9810` 蹭到 ⇒ 散文检查假绿 |
| **守卫不许瞎比**：`blockMembers` 遇**顶层** `...` 展开直接**抛错** | 守卫自己的盲区：看不见展开成员 ⇒ 两张脸可能**看起来相等**而实现多带一个成员 —— 正是这个守卫要抓的缺陷 |

**两条常驻单测**（把新守卫锁死，不能只靠一次性验证）：
`does not accept a number that is only a part of a bigger one`；
`refuses to compare a block that hides a member behind a spread`。

**三条红证据（控制器亲跑）**：

| 证 | 做法 | 结果 |
|---|---|---|
| A | 测量集里塞一个假文件（`all.add('__RED_PROOF_dummy.woff2')`）⇒ 测量变 7 982 | **红**：`…/verify-webfont-subsets.mjs does not carry 7 982 as a number of its own` ⇒ 证明散文期望值**绑在测量上**（修复前这个场景会一直绿） |
| B | 把 nginx 散文改成「17 981 个 woff2」 | **红**：`…/nginx.ziyun.pudafo.com.conf does not carry 7 981 as a number of its own` ⇒ 证明相邻数字漂移被抓住（旧的 `toContain` 会放行） |
| C | 两处都还原 | **绿**（`1 passed`），`git status` 显示 nginx 文件已回到干净 |

**门禁**：`npx tsc --noEmit` EXIT=0；`npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts` **54/54 绿**（52 + 新增 2）。

---

## 10. 账本索引

| 想找什么 | 去哪 |
|---|---|
| 每一条裁决与它的依据 | `.superpowers/sdd/2026-10-29-site-optimization-wave2-plan/progress.md` §一–§二十二 |
| 计划里被推翻的机制与实测数据（R8–R18、F25、F27、F27-j） | 计划文件的《裁决记录》三节 |
| W2-7 的派工单 / 报告 / 评审清单 / 修复轮 | 同一目录下的 `w2-7-*.md` |
| 最终修复轮（F-1…F-7）的评审 | 同一目录下的 `final-re-review.md` |

---

## 11. 下一波：后台字体流水线（未开始）

用户的要求：**「字体下载放到后台配置中的一个界面」**，并已裁定：

- **范围** = 下载 + 重建整条流水线；
- **位置** = 新开 `/admin/settings/webfonts`，放在「站点」组；
- **执行方式** = 异步任务 + 轮询进度；
- **产物落地** = staging + 显式「应用」；
- **流水线能力** = 完整四步，缺能力就报错。

规格 `docs/superpowers/specs/2026-10-31-admin-webfont-pipeline-design.md`
与计划 `docs/superpowers/plans/2026-10-31-admin-webfont-pipeline-plan.md` 已写好，
**待用户批准后**切分支 `feature/admin-webfont-pipeline` 开始。

---

## 附录 A. 字体下载到本地（**不走云端**）的完整方法

> 这一节是用户那句「**不要引用云端字体，提供字体下载到本地方法**」的落地说明。
> 下一波的后台界面（§11）就是把这套流程搬进 `/admin/settings/webfonts`。

### A.1 一句话

源字体从 GitHub 上 `google/fonts` 的原始字节拉到本机 → 切成 **7 981 个本地 woff2** →
**连同三份样式表一起入 git** → 线上**只**服务 `public/font/web/**` 这些本地文件。
**没有任何一个页面引用过云端字体。**

### A.2 七个源文件

`scripts/fonts/download-webfont-sources.ts` 的 `SOURCES` 里写着（**全部**在 `raw.githubusercontent.com/google/fonts`）：

| 文件 | 是什么 |
|---|---|
| `NotoSansSC-wght.ttf` | 无衬线可变字体（wght 100..900） |
| `NotoSerifSC-wght.ttf` | 宋体可变字体（wght 200..900） |
| `LXGWWenKaiTC-Regular.ttf` | 霞鹜文楷 TC 常规 |
| `LXGWWenKaiTC-Bold.ttf` | 霞鹜文楷 TC 粗体 |
| `NotoSansSC-OFL.txt` / `NotoSerifSC-OFL.txt` / `LXGWWenKaiTC-OFL.txt` | 三份许可证（**必须随产物一起走**） |

### A.3 命令

```bash
npm run fonts:download-web        # ① 下载到 scripts/fonts/staging/web/（git-ignored）
npm run fonts:instance-web        # ② 裁掉可变字体多余的轴（Python fontTools）
npm run fonts:subset-web          # ③ 按语料频率切分，写出 woff2 + 三份 CSS + manifest
npm run fonts:verify-webfont      # ④ 门禁：覆盖率 / 缺字 / 尺寸 / 页面预算 / 版本令牌
npm run fonts:capture-page-profiles  # ⑤ 抓真实页面的字符集样本（更新门禁的语料）
```

### A.4 「下载完了」的判据 —— **大小契约**

这一步是整个下载器唯一容易出错的地方，脚本里写死了三条：

1. **只有「载着这些字节的那次响应」的 `Content-Length` 算数。**
   HEAD 探针**只**用来决定「磁盘上已有的文件能不能跳过」，
   它**永远不能**用来验收刚下下来的字节。
2. **服务器够不着 ⇒ 绝不许跳过。**
   够不着的时刻正是上一次跑到一半的残片最可能躺在盘上的时刻；
   拿一个「服务器没回话」去认可那个残片，就等于把截断的字体喂进切分器。
3. **请求头带 `Accept-Encoding: identity`。**
   不带的话服务器可以回一个 gzip 载荷，那时 `Content-Length` 描述的是**压缩后**的大小
   （4 390 字节的 LXGW 许可证会变成 1 964 字节）⇒ 每个文件都会被判成「损坏」。

落地顺序：先写 `<name>.part` → 字节数与声明的大小比对 → **一致才 `rename` 成正式文件**；
任何一次失败都把 `.part` 删掉 ⇒ 半截文件**不可能**被当成完整的下载。

其余参数：单次下载超时 **10 分钟**（最大的源 25 125 512 B，慢链路上要几分钟）、
每个 URL 重试 **3 次**、间隔 **2 秒**。

### A.5 手工兜底

下载一直卡住时，脚本会把 URL 打出来。**按精确文件名**把文件丢进
`scripts/fonts/staging/web/` 即可，下次跑 `fonts:download-web` 会自动认领它
（认领的前提仍然是：大小与服务器声明的一致）。

### A.6 产物的形状

| 路径 | 入库？ | 内容 |
|---|---|---|
| `scripts/fonts/staging/web/` | ❌ git-ignored | 源 TTF（约 70 MB），只活到切分完为止 |
| `public/font/web/{sans,serif,wenkai}/` | ✅ | **7 981** 个 woff2（无衬线 2 468 / 宋体 2 855 / 楷体 2 658） |
| `public/font/web/OFL-*.txt` | ✅ | 三份许可证 |
| `public/font/fonts-{sans,serif,wenkai}.css` | ✅ | 三份分族样式表 |
| `public/font/fonts-manifest.json` | ✅ | 版本令牌 + 三份 CSS 的哈希 + 每族文件清单 |

⚠️ **源字体不入库**（`scripts/fonts/staging/` 是 git-ignored 的暂存目录），
但**切分产物全部入 git** ⇒ 部署时**不需要**跑 `fonts:download-web`，
线上也不需要任何外网字体源。
