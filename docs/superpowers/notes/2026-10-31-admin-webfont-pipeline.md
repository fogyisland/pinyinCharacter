# 后台字体流水线 —— 实施记录（2026-10-31）

> ⚠️ **这份记录不是规格。**
> 规格（`docs/superpowers/specs/2026-10-31-admin-webfont-pipeline-design.md`）是约束权威；
> 本记录只说三件事：**实际做了什么**、**实测是多少**、**哪些没做到**。

| 项 | 值 |
|---|---|
| 分支 | `feature/admin-webfont-pipeline`（**未合并、未 push**） |
| 提交数 | **35**（`main..HEAD`，含 Task 1…Task 8、Task 12、Task 13 与本任务的 Task 9） |
| 规格 | `docs/superpowers/specs/2026-10-31-admin-webfont-pipeline-design.md`（**本波新建**） |
| 计划 | `docs/superpowers/plans/2026-10-31-admin-webfont-pipeline-plan.md`（**本波新建**） |
| 账本 | `.superpowers/sdd/2026-10-31-admin-webfont-pipeline-plan/progress.md`（全部裁决与实测数据） |
| 运维手册的新一节 | `deploy/OPTIMIZATION.md` §「在后台重建字体（`/admin/settings/webfonts`）」 |

---

## 0. 一句话

这一波给管理员造了一条**后台重建字体**的流水线：后台把源字体重新切分、发布成一份
**新的 release 目录**、并把新旧成本并排显示出来；
**后台绝不碰 git** ⇒ 产物要由人用脚本**回灌**回仓库，再**人工重新标定**门禁里钉死的数字。

---

## 1. 这一波做了什么

| 任务 | 落点 |
|---|---|
| Task 1 | 字体根目录可覆盖（`WEBFONT_FONT_DIR`）+ 页面成本模式（`WEBFONT_PAGE_COST`） |
| Task 2 | 校验器认识**可选的发布目录**（`parseFaceUrl` 多认一段） |
| Task 3 | 作业模型（作业状态、落盘、重启后不卡在 `running`） |
| Task 4 | 能力探针（Python / fontTools / 网络 / 磁盘 / 工具链） |
| Task 5 | 下载步（按**大小**跳过 ⇒ 它的盲区见 §6） |
| Task 6 | apply（发布到 `web/r<T>/`、改写样式表、保留规则、**只算不写**） |
| Task 7 | 后台 API（build / apply / cancel / capability / releases / cleanup） |
| Task 8 | 后台页面（`/admin/settings/webfonts`） |
| Task 12 | 清理：按**被取代时间**而不是创建时间 |
| Task 13 | 回灌脚本 `scripts/fonts/import-webfont-release.mjs` |
| **Task 9（本记录）** | **运维手册的新一节 + `DEPLOY.md` 的两层 TTL + 本记录 + 收尾验收** |

---

## 2. 必须披露的三件事

> 这三段是**逐字引用**，不是转述。

### 2.1 解析器的超集（裁定二十六）

> 为了让后台重建字体不产生豆腐块，wave-2 的校验脚本的 URL 解析器被扩展了
> 一种可选的发布目录；它在现有产物上的行为完全不变。

### 2.2 页面成本模式（spec §3.5.7）

> wave-2 的校验脚本新增了一个模式开关 `WEBFONT_PAGE_COST`：
> `enforce`（缺省，仓库自己的行为一个字节都不变）与 `report`
> （后台的候选校验用；页面成本**只报不算**，内禀校验照常判失败）。
> 候选校验**必须**用 `report` —— 并集样本的预算描述的是**线上那一份**产物，
> 语料一变 Ext 块就整体移位 ⇒ 拿它判失败 = 任何一次语料变了的重建都会失败。

### 2.3 漂移探测器（spec §3.5.7 推论三）

> apply 之后，服务器树里的 `npm run fonts:verify-webfont` **会变红** ——
> 那是漂移探测器在正常工作。修法是**人工**重新标定
> `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`；
> 后台**绝不**自动改预算（自动改 = wave-2 修掉的假绿灯换个方向再来一次）。

---

## 3. 实际实现与计划的偏差（逐条）

### 3.1 任务归属的挪动（R-103 的八条）

| 计划说 | 实际发生 | 为什么 |
|---|---|---|
| Task 13 产出 `ApplyResult.reimport` / `.rebaseline` | **Task 6** 产出（在 `lib/webfont/rebaseline.ts`）；Task 7 透传 | apply 的响应是 Task 7 的契约；提前产出能去掉一个跨任务依赖（台账 R-53） |
| Task 13 改 `tests/unit/deploy/nginx-config.test.ts:672` | **Task 2** 把那条读盘路径改成认识发布目录 | 回灌是上线前的最后一步；不先修好，崩溃会发生在那一步（台账 R-88） |
| Task 13 改面板的两个块 | **Task 8** 渲染它们 | 面板是 Task 8 的交付物（台账 R-87） |
| releases GET 的响应是 `{ releases[], bytes, keep }` | 还多带一个推导出来的**每份 release 的 `canClean`** | 页面是客户端组件，算不出这个结论（台账 R-77） |
| apply 的响应（Task 7 的表）里没有 `pageCost` | **带了** `pageCost` | spec §3.5.7 推论三要求新旧页面成本并排（台账 R-78） |
| brief 的九个 Task-13 用例 | 其中三个住在 Task 7 / Task 8 的测试文件里 | 它们覆盖的代码是那两家的（台账 R-93） |
| 每个抛出的错误都带一个**已声明**的 kind | 轴裁剪器抛出的错误带 `kind: 'toolchain' \| 'clip'`，而 `instance-webfont-axis.d.mts` **没有**声明它 | **已接受的偏差**（台账 R-114）：本波没有任何 TypeScript 按 kind 分支 —— **消息**里已经带着正确的补救办法；而且声明同步守卫是**声明 → 运行时**方向跑的，一个没有运行时导出的声明会把 `instance-webfont-axis.test.ts` 弄红。⇒ **如果以后有任务要按 kind 分支，它必须先加运行时类型守卫 _和_ 它的声明。** |
| apply 的响应是 spec §5 的表：`{ job, manifestVersion, releaseDir, reimport, rebaseline }` | 那**五个**都在，**另外多带三个**：`releaseToken`、`summary`（`liveFiles`/`liveBytes`/`newFiles`/`newBytes`/`releaseBytes`）、`pageCost` | 五个 spec 字段**全部原样在位** ⇒ 扩展是**加法**，不是破坏契约。但它**确实**偏离了 spec 的路由表 ⇒ 如实披露。`pageCost`：apply 响应是候选门禁到面板的**唯一**通道（台账 R-78）。`summary`：spec 的 `rebaseline` 讲的是**钉死的数字**，不是面板并排显示的**字节/文件差值**。`releaseToken`：与 `releaseDir`（形如 `r<令牌>`）**冗余** ⇒ 留着是因为面板可能只要令牌（台账 R-131） |

### 3.2 本任务（Task 9）自己的偏差

| 计划说 | 实际发生 | 为什么 |
|---|---|---|
| Task 9 只**核对** `DEPLOY.md` | Task 9 **必须改** `DEPLOY.md` 的 `/font/` 那一层 | 派工单 **R-176 / R-191 / R-207a**：Task 10 只在两处 `npm install --omit=dev` 旁边补了一句依赖说明，**没有**碰 `/font/` 的 nginx 块 ⇒ 那一层本来没人认领 |
| 派工单把 `DEPLOY.md` 的两处 `/font/` 记成 `:109` 与 `:167` | **实测就是 `:109` 与 `:167`**（改之前）⇒ 一致 | 控制器已订正过一次（早前记的 `:108` 是 `location /strokes/`） |
| 派工单把「只读不许改的 TTL 描述」记成 `:22` / `:23` / **`:327`** | **`:327` 是错的** —— 那个文件里 `:327` 是**验收用的 curl 命令块**（`# c2) 可变层…`），TTL 描述在 `:22` / `:23` / `:31-32` | 派工单 **R-98 / R-207e** 的控制器订正 |
| brief Step 3b 的 nginx 片段**漏了 `always;`** | 补上了 | 派工单 **R-207a**：Task 11 的模板 `deploy/nginx.ziyun.pudafo.com.conf:177` / `:184` 两处都带 `always;` ⇒ 缺了它 404/500 上就不带缓存头 |
| brief 说「`npm run build` 要跑」（甲组一次、乙组一次） | **Task 9 不需要 build** | 派工单 **R-207f** 的判据：Files 段里**没有 `app/` 下的任何文件** ⇒ **不需要**（不是「不许跑」，是「不需要」）。Task 9 最终改动的文件是 `DEPLOY.md` + `deploy/OPTIMIZATION.md` + `docs/…` + `tests/…` ⇒ 仍然**一个 `app/` 下的文件都没有** ⇒ build 跳过 |
| 验收项 1 要求「整份输出逐字节不变」 | **这条不可满足**；判据换成「**闸门相同**」 | 派工单 **R-221**（见 §5 的实测） |

### 3.3 规格与计划是**本分支自己的产物**（R-145）

`git log -- docs/superpowers/specs/2026-10-31-admin-webfont-pipeline-design.md` 显示**两个**提交：
文件的**创建**（`212561d4a`）与**一次**经用户明确授权的修订（`d6942b141`，**在 13 任务循环开始之前**）。
计划同理（`212561d4a` + `5ce267ba2`）。

⇒ **在 13 个任务执行期间，规格一个字都没有被改过**（它最后一次改动早于任务循环）
⇒ 否则，一个审阅整个分支 diff 的人会把这条 diff 读成「实现偷偷改了规格」。

---

## 4. 这一波动了哪些上一波的产物（R-111 的十一行）

派工单 **R-111** 要求：**每一个碰过 wave-2 文件的提交一行**，
以及「这次改了什么」与「**提交消息里披露了吗**」。

⚠️ **「否」是预期的**：披露句是**按任务**给的（一个任务的**第一个**提交里披露），
后面同一个任务的修复提交**不重复**。
⇒ **没有**为了补披露句去 amend 任何提交（R-111 已明令）。

| 提交 | 碰到的 wave-2 文件 | 这次改了什么 | 提交消息里披露了吗 |
|---|---|---|---|
| `c5fa7b786` (T1) | `build-webfont-subsets.mjs` + `.d.mts`、`verify-webfont-subsets.mjs` + `.d.mts`、`instance-webfont-axis.mjs` + `.d.mts` | 字体根目录可覆盖（`WEBFONT_FONT_DIR`）、页面成本模式（`WEBFONT_PAGE_COST`）、许可证跟着字体走、`instanceAll()` 可被调用 | **是** —— 消息里有一段「This commit changes files that the wave 2 review sealed …」 |
| `3e5237d9e` (T1 fix R=1) | `instance-webfont-axis.mjs`、`verify-webfont-subsets.mjs` | 工具链失败不再冒充「源字体坏了」（kind 化）、fontTools 探针按次记忆、`pagecost: null` 那行不再是坏 JSON、`pageCostOf()` 的注释与实际对齐 | **否** —— 同一个任务的后续修复轮，不重复披露 |
| `f4d2ad5bc` (T1 fix R=2) | `instance-webfont-axis.mjs` | 探针缓存从**模块级**缩到**单次 `instanceAll()` 调用**内 | **否** —— 同上 |
| `193c198af` (T1 fix R=2) | `instance-webfont-axis.d.mts` | JSDoc 说清 fontTools 探针**不做**缓存；只改注释 | **否** —— 同上 |
| `488038be3` (T2) | `verify-webfont-subsets.mjs` + `.d.mts`、`scripts/perf/font-load.mjs` | `parseFaceUrl()` 多认一段**可选**的发布目录；两段式**先**试 | **是** —— 消息明写这个提交改的是 wave-2 封板的文件 |
| `41717b039` (T2 fix) | `verify-webfont-subsets.mjs`、`scripts/perf/font-load.mjs` | 门禁**说出来**的路径带上发布段；端到端测试改成「**搬**」而不是「复制」；族目录保护对发布 URL 也生效 | **是** —— 消息里有一段 `DISCLOSURE:` |
| `ec30ddb73` (T5 fix) | `verify-webfont-subsets.mjs` | 落在盘上的文件名用 `fileLabel()` 统一打印（带族目录）；只改字符串，不改逻辑 | **是** —— 消息里有一段 `DISCLOSURE:` |
| `55f845a0e` (T11) | `next.config.ts`、`deploy/nginx.ziyun.pudafo.com.conf` | 字体缓存头**拆成两层**（一年 immutable / 30 天），用**否定前瞻**互斥 | **是** —— 消息明写这个提交改的是 wave-2 封板的文件 |
| `d6f6e3a65` (T11 fix) | `next.config.ts` | 否定先行从 `(?!web/)` 改成 `(?!web/|web$)` ⇒ 两层**按构造**互斥；顶层择一（Next 的 path-to-regexp 拒绝嵌套 `(`） | **否** —— 同一个任务的后续修复轮，不重复披露 |
| `9355d229f` (T6 fix, R-181) | `build-webfont-subsets.mjs` + `.d.mts` | 收窄校验器发现的提取、给 spawn 加护栏、尊重源目录 | **否** —— 同上 |
| `d6f6e3a65` / `9355d229f` / `3e5237d9e` / `f4d2ad5bc` / `193c198af` / `41717b039` / `ec30ddb73` | —— | **⚠️ R-111 预告过的「至少一行是『否』」就在这里** ⇒ 如实记录，**不 amend** | —— |

⇒ 这张表就是「这一波到底动了哪些上一波的产物」的答案 ——
**审阅的人不必读整个 diff 就能知道。**

---

## 5. 这一波改了哪些 17 个之外的既有文件（R-144 的第二张表）

spec §3.7 说「除上面这 5 + 4 + 8 = 17 个文件之外的既有文件一律不许改」
⇒ 那是一份**下限**，不是穷举白名单（spec 自己的设计就要求改它没列进去的文件）。

⇒ 推导命令：`git diff --name-only --diff-filter=M 2549fd4941..HEAD`
⇒ **20 个既有文件**被这一波改过。其中 **8 个**在 wave-2 的 17 个文件清单里（§4 那张表），
**另外 12 个**在这里 —— **每一个都要写出「spec 的哪一条要求改它」**。

| 文件 | spec 的哪一条要求改它 |
|---|---|
| `scripts/fonts/build-webfont-subsets.d.mts` | §3.7 的表点名的是 `.mjs`；`allowJs: false` ⇒ `.d.mts` 是唯一的声明面 ⇒ 它必须跟着走 |
| `scripts/fonts/instance-webfont-axis.d.mts` | 同上（§3.7 的表：「暴露一个可被调用的函数」） |
| `lib/audit-format.ts` | §3.6 的**五个审计事件**住在那里；house pattern 是每个事件进**三处**（联合类型 / `AUDIT_EVENTS` / `EVENT_LABEL`） |
| `lib/api-handler.ts` | §3.6 的 apply 端点需要把 **409 冲突**（幂等：同一个作业点两次 apply ⇒ 第二个 409）带出自定义响应体 ⇒ `conflict()` 加一个可选的 `ResponseInit` |
| `components/admin/AdminSidebar.tsx` | §3.4 的后台页面 `/admin/settings/webfonts` 必须**进侧栏**才有人找得到 |
| `.gitignore` | 新建的 API 路由目录 `app/api/admin/webfonts/build/` 会被一条**裸的** `build/` 规则误伤（它匹配任意深度的 `build` 目录）⇒ 改成根锚定的 `/build/` |
| `package.json` | §3.4.1：`subset-font` / `typescript` / `tsx` 从 `devDependencies` 移到 `dependencies`（**换分类**，不是新增依赖） |
| `package-lock.json` | 同上：分类变了而锁文件没变 ⇒ `--omit=dev` 仍按旧分类装 ⇒ 依赖还是缺 |
| `tests/unit/lib/fonts-css.test.ts` | §3.5.9 第 1/2/3/4 条：回灌之后仓库里同时有 release 0 和新 release ⇒ 递归遍历的计数与字节数全变 ⇒ 门禁必须能重标定 |
| `tests/unit/deploy/nginx-config.test.ts` | §3.5.9 第 7 条：读盘路径要带发布段（`:672`），否则 `statSync` 直接抛 |
| `tests/unit/scripts/verify-webfont-subsets.test.ts` | §3.5.6：`parseFaceUrl` 的期望多一个 `release: ''`；补一条「带发布段的 URL」的用例 |
| `DEPLOY.md` | §3.5.4 的两层 TTL（**本任务改的**）：`/font/` 那一层拆成 `/font/web/`（一年 immutable）+ `/font/`（30 天）；⚠️ `/fonts/`（带 s，196 MB 笔刷字体）**不动** |
| `deploy/OPTIMIZATION.md` | §3.5.4 的两层 TTL（Task 11 写的那几行，**只读**）+ §3.6 的运维手册（**本任务新增一节**：「在后台重建字体」） |

⚠️ **另外三个提交碰的是 `tests/` 下的 npm 版本钉死测试**
（`72c09e4be` / `f05ffcea4` / `7e5344492`）⇒ 它们**不属于** wave-2 的 17 个文件
⇒ 不进 §4 那张表，但**进了**这张表。

---

## 6. 收尾验证 —— 甲组（仓库里只有 release 0）

### 6.1 验收项 1：`fonts:verify-webfont` 的产物行与预算行逐字节不变

**基线的出处（R-99 第 3 条：必须说得清「改动前」是从哪来的）**

- merge-base：`git merge-base HEAD main` = **`2549fd4941d098855af684542c6b387a5a3484ab`**
- 控制器给的基线：`D:/temp/verify-baseline-task9.txt`，
  **EXIT=0** / **34** 行 / md5 **`392fb6f9b82be73be4bca8cf8ef23909`**

⚠️ **控制器给的那份基线是「修复轮之后」的**，**不是** merge-base 的输出。
所以本任务**独立地**重新推导了一份 merge-base 的基线（R-99 第 5 条）：

```bash
git worktree add --detach D:/Temp/webfont-baseline 2549fd4941d098855af684542c6b387a5a3484ab
# Windows 上用**目录联接**把 node_modules 借过去（比重新 install 便宜得多）：
cmd /c mklink /J "D:\Temp\webfont-baseline\node_modules" "E:\ToolDevelop\PinYinCharacter\node_modules"
# ⚠️ 联接之后还必须把**源字体**也拷过去：scripts/fonts/staging/ 是 gitignored 的
#    ⇒ 新的 worktree 里没有它 ⇒ 校验器会报「源字体缺失」⇒ 基线跑的不是同一棵树。
mkdir -p D:/Temp/webfont-baseline/scripts/fonts/staging
cp -r scripts/fonts/staging/web D:/Temp/webfont-baseline/scripts/fonts/staging/
cd D:/Temp/webfont-baseline && npm run fonts:verify-webfont > before.txt 2>&1; echo "EXIT=$?"
```

⇒ **独立推导出来的 merge-base 基线与继承来的那份 `verify-enforce-before.txt` 逐字节相同**
（两份的 md5 都是 **`57920eb87c89d514c968a5d7dc2779a8`**）⇒ 基线可信。

**「基线取自 merge-base 的哪个树」这句话也要说清（R-99 第 3 条）**

控制器继承下来的那份基线取自 `5ce267ba2` 那个树；
`git diff --stat 2549fd4941 5ce267ba2` ⇒ **只有两个 docs 文件**
（`…-design.md` 与 `…-plan.md`，全是新增）⇒ **那个树与 merge-base 在代码上逐字节相同**
⇒ 它是有效的「改动前」基线。

**实测结果**

```
before（merge-base 2549fd4941）：EXIT=0，0 error(s)
after （HEAD 7504470c2）        ：EXIT=0，0 error(s)
```

**diff —— 只有三行 `charset`，产物行与预算行全部逐字节相同：**

```
5,7c5,7
< charset wenkai: 8204 chars (hot 300 / ext 1318 blocks) + latin 144 chars (hot 31 / ext 10 blocks)
< charset sans:   16968 chars (hot 300 / ext 2778 blocks) + latin 186 chars (hot 95 / ext 8 blocks)
< charset serif:  19888 chars (hot 300 / ext 3265 blocks) + latin 197 chars (hot 42 / ext 13 blocks)
---
> charset wenkai: 8204 chars (hot 300 / ext 1318 blocks) + latin 150 chars (hot 31 / ext 10 blocks)
> charset sans:   16968 chars (hot 300 / ext 2778 blocks) + latin 188 chars (hot 95 / ext 8 blocks)
> charset serif:  19888 chars (hot 300 / ext 3265 blocks) + latin 199 chars (hot 42 / ext 14 blocks)
```

⇒ **判据（「闸门相同」，R-221 订正后）：**

| 判据 | 结果 |
|---|---|
| 运行 **EXIT=0** 且结尾是 `0 error(s)` | ✅ |
| 三行 `[verify] <family>`（产物行）**逐字节相同** | ✅ |
| 三行 `[verify]   latin:` **逐字节相同** | ✅ |
| 三行 `[verify]   info:` **逐字节相同** | ✅ |
| CSS 预算行 `[verify] css : 158848 B gzip of 179200 B   OK` **逐字节相同** | ✅ |
| 页面预算行与并集预算行 **逐字节相同** | ✅ |
| 中文层 8204 / 16968 / 19888 与块数 | ✅ 全部相同 |
| 三行 `charset` 的 `latin N` | ⚠️ **变了**（见下） |

**`latin N` 为什么变了 —— 差异来自仓库源码的哪些字符（R-99 第 2 条）**

那三行印的是 **Task 1 的字符集计划**，不是产物。
latin 层来自 `loadScores(root)` → `scanSourceCode(root)` ⇒ 它扫的是
**本仓库自己的源码**：`app` / `components` / `lib` 三个目录
（`scripts/fonts/webfont-charset.mjs:759`）。

⇒ 本分支**新增的后台页面**把六个符号带进了 latin 层。
用同一个 `LATIN_RANGES`（`scripts/fonts/webfont-charset.mjs:121`）
对两棵树做源码扫描对比，结果是**恰好六个**新字符进入 latin 层：

| 码位 | 字符 | 出现在（本分支新增的文件） |
|---|---|---|
| `U+21D2` | `⇒` | `components/admin/WebfontApplyBlock.tsx`、`lib/webfont/capability.ts` |
| `U+2260` | `≠` | `components/admin/WebfontApplyBlock.tsx` |
| `U+2460` | `①` | `components/admin/WebfontCapabilityBlock.tsx`、`components/admin/WebfontPipelinePanel.tsx` |
| `U+2461` | `②` | `components/admin/WebfontPipelinePanel.tsx` |
| `U+2462` | `③` | `components/admin/WebfontPipelinePanel.tsx` |
| `U+2463` | `④` | `components/admin/WebfontPipelinePanel.tsx` |

⇒ **这六个字符落在 `LATIN_RANGES` 里**（arrows `0x2190–0x21ff`、
mathematical operators `0x2200–0x22ff`、enclosed alphanumerics `0x2460–0x24ff`）⇒
它们**该**进 latin 层。
⇒ sans 从 186 → 188（两个：`⇒` 与 `≠`），
serif 从 197 → 199（两个：`①` 与 `④`），
wenkai 从 144 → 150（六个全在）。
⇒ **serif 的 ext 块数从 13 → 14** 也是同一个原因：latin 层多了字符 ⇒ 尾块多了一块。
⇒ **移走的字符：一个也没有**（REMOVED = 0）。

⇒ ⚠️ **结论：产物本身一个字节都没变。**
变化的只是**计划**（哪几个字符该进 latin 层），
而计划变了是因为**仓库自己的源码变了** —— 这正是「门禁跟着仓库走」的设计。

⚠️ **另注**：控制器给的 `D:/temp/verify-baseline-task9.txt` 与本任务跑出来的
`after` **逐字节相同**（md5 都是 `392fb6f9b82be73be4bca8cf8ef23909`）
⇒ 也就是说，**控制器那份基线已经是修复轮之后的**，与本任务的输出之间 diff 为空。

### 6.2 验收项 2：`npm test` 全绿

**收尾那一次跑（Task 9 自己的改动全在树里之后）：**

```
Test Files  163 passed | 6 skipped (169)
     Tests  1839 passed | 17 skipped (1856)
EXIT=0
```

⚠️ **控制器给的下界是 1823**（Task 13 收工时是 1825）⇒ **1839 > 1825** ⇒ 正常。
（比 1828 多出来的 **11 个**是 Task 9 自己新增的
`tests/unit/deploy/deploy-doc-font-cache.test.ts` —— 见 §9 末尾。）

### 6.3 验收项 3：`npx tsc --noEmit`

```
EXIT=0
```

### 6.4 验收项 4：`npm run build`

⚠️ **本任务没有跑 build —— 是「不需要」，不是「不许跑」。**

判据（R-196 / R-207f）：**Files 段里有没有 `app/` 下的任何文件**。
Task 9 最终改动的文件是：

- `deploy/OPTIMIZATION.md`（新增一节）
- `DEPLOY.md`（两处 `/font/` 的两层 TTL）
- `docs/superpowers/notes/2026-10-31-admin-webfont-pipeline.md`（本记录）
- `tests/unit/deploy/deploy-doc-font-cache.test.ts`（R-207b 新增的守卫）

⇒ **一个 `app/` 下的文件都没有** ⇒ **build 可以跳过**。
⇒ 并且**绝不在开发树跑 build**（dev server 占着 4444）—— 本任务**一次 build 都没跑**。

### 6.5 收尾验证 —— 乙组（apply 之后、回灌已提交）

> 乙组（apply 之后、回灌已提交）**本机未做真实验证**：
> 本分支没有对着真服务器执行 apply，仓库里没有 `r<T>/` 目录、
> 没有新的 manifest 版本、没有回灌后的提交 ⇒
> 「变红 → 重标定 → 重新全绿」这条链**只能在真机 apply 之后由人执行**。

⇒ **下面是那条链的配方**（R-101 要求的就是这份配方）。

**怎么跑**

```bash
# ① 在服务器上（或把服务器上的 public/font/ 同步下来之后，在仓库里）
node scripts/fonts/import-webfont-release.mjs --release r<令牌>

# ② 把脚本打印出来的数字填进 tests/unit/lib/fonts-css.test.ts
# ③ 语料变了的话，还要重标定 LIMITS.unionSampleBytes / LIMITS.maxUnionSampleFilesPerPage
# ④ npm test          ⇒ 应当重新全绿
# ⑤ npm run build     ⇒ 沙箱里跑（先 rm -rf .next），读 build.log 里的 EXIT=
```

**哪些**钉死的数字会红（`tests/unit/lib/fonts-css.test.ts` 的行号）：

| 行 | 钉住的是什么 | 回灌之后会红吗 |
|---|---|---|
| `:293`（×3） | 每个族的 **raw CSS** 字节（`623 000` / `726 882` / `673 293`） | **会** —— URL 多了 `r<T>/` 前缀 |
| `:298` | 三份样式表的 raw 字节合计（`2 023 175`） | **会** |
| `:303` | `≤ SANS_RAW_BYTES`（`700 × 1024` = 716 800） | **只有**跨过上限才红 ⚠️ |
| `:310` | woff2 **文件数**（`7 981`） | **会** —— 递归遍历现在看见 release 0 **和**新 release |
| `:311` | woff2 **总字节**（`28 236 168`） | **会** |
| `:323`（×3）/ `:325` | 每个族的 **gzip** 字节（`55 821` / `64 536` / `38 491`） | **会** |
| `:326` | 三份样式表的 gzip 合计（`158 848`） | **会** ⚠️ 这一条**不在** spec §3.5.9 的七项表里 |
| `:327` | `≤ LIMITS.cssBytes`（`175 × 1024` = 179 200） | **只有**跨过上限才红 ⚠️ |
| `:328` | `≤ LIMITS.sansCssBytes`（`65 × 1024` = 66 560） | **只有**跨过上限才红 ⚠️ |

⇒ **「恰好 7 条」数的是「种类」，不是「断言条数」** ——
上面那张表里 `:293` / `:298` / `:310` / `:311` / `:323` / `:325` / `:326`
属于**钉死的数字**（预期漂移），
`:303` / `:327` / `:328` 是**上限预算**（不是钉死值）。
⇒ **上限预算跨线不是「重新标定」，是一个 finding** ——
发布目录前缀把某份样式表顶出了预算 ⇒ **报告，不要重新标定**。
⇒ **红在别处（既不是钉死数字、也不是预算）就是 bug。**

**哪两条只有语料变了才红**

`LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`
（在 `scripts/fonts/verify-webfont-subsets.mjs` 里）——
它们描述的是**并集样本**（`data/font-page-sample.json`）的成本
⇒ **语料没变却红 ⇒ 说明候选产物不对，是 bug，不是漂移。**

**把什么填到哪里**

`node scripts/fonts/import-webfont-release.mjs --release r<令牌>`
会**打印**出要重新钉的数字，**但一个数字都不写**（§2.3 的纪律）。

### 6.6 验收项 6：只装生产依赖时构建工具链还在

⚠️ **不在本仓库里跑 `npm install`**（那会重写 lockfile、把 devDependencies 拉回来）。
做法：把 `package.json` + `package-lock.json` **复制**到干净目录，在那里装。

```bash
mkdir -p D:/Temp/pinyin-proddeps-task9
cp package.json package-lock.json D:/Temp/pinyin-proddeps-task9/
npm install --prefix D:/Temp/pinyin-proddeps-task9 --omit=dev --legacy-peer-deps
```

⇒ **两条 `require.resolve` 都成功**：

```
subset-font OK
typescript OK
tsx OK
```

⇒ Task 10 的依赖切分**到位**（`subset-font` ^2.4.0 / `typescript` ^5.6.3 / `tsx` ^4.19.2
三个都在 `dependencies`，`devDependencies` 里没有）。

---

## 7. 十二条验收的实测结果

| # | 验收项 | 怎么验 | **实测结果** |
|---|---|---|---|
| 1 | `fonts:verify-webfont` 的**产物行与预算行逐字节不变** | merge-base 的独立基线 vs 本树 | ✅ **能验**：EXIT=0、`0 error(s)`；**产物行、预算行、页面行、并集行全部逐字节相同**；三行 `charset` 的 `latin N` 变了（144/186/197 → 150/188/199）⇒ 原因是**仓库自己的源码**新增了 6 个符号（`⇒` `≠` `①` `②` `③` `④`），详见 §6.1 |
| 2 | `npm test` 全绿 | 跑 | ✅ **能验**：**1839 passed / 17 skipped**（169 个文件），EXIT=0 |
| 3 | `tsc --noEmit` EXIT=0 | 跑 | ✅ **能验**：EXIT=0 |
| 4 | `npm run build` 成功 | 沙箱里跑 | ✅ **能验（按判据跳过）**：本任务的 Files 段**没有 `app/` 下的文件** ⇒ R-207f 判据 ⇒ **不需要跑** ⇒ build **未跑**（不是「跑了没过」） |
| 5 | 能力探针：缺 Python ⇒ 按钮不可点 | 单元测试注入假 `runCommand` | ⚠️ **注入式**：`tests/unit/lib/webfont-capability.test.ts`（52 用例）通过。**本机未做真实验证**，原因：需要一台**真的没有 Python** 的机器 —— 本机有，探针会返回 `available: true`，那个分支走不到 |
| 6 | 四步流水线 + 断网 / 缺 fontTools 的失败文案 | 单元测试注入假实现 | ⚠️ **注入式**：`tests/unit/scripts/webfont-pipeline-roots.test.ts`（13 用例）通过。**本机未做真实验证**，原因：需要一次**真的断网**或**真的缺 fontTools** 的运行 —— 本机两者都在，那个分支走不到 |
| 7 | apply 的五条（版本变 / 目录在 / release 0 未变 / URL 全改写 / 审计有记录） | Task 6 的测试 + Task 7 的测试 | ✅ **能验，但只是文件级**：`tests/unit/lib/webfont-apply.test.ts` + `tests/unit/app/api/admin/webfonts.test.ts` 全绿。**真机 apply 未做**：本分支没有对着真服务器执行过 apply ⇒ 「apply 的五条」在**真机**上未验证 |
| 8 | 无豆腐块：旧样式表的每个 URL 仍 200 且字节一致 | Task 6 的测试（文件级）+ **真机 HTTP 级** | ⚠️ **文件级能，HTTP 级不能**：`tests/unit/lib/webfont-apply.test.ts` 证明文件级的不变式。**本机未做真实验证**，原因：需要**真机 HTTP 级**验证（对着线上发 HEAD 请求比对字节）—— 本机没有部署后的服务器 |
| 9 | 并发：两个 POST 只一个 202 | 单元测试 | ✅ **能验**：`tests/unit/app/api/admin/webfonts.test.ts:342`（「lets only ONE build start at a time (the in-process mutex)」） |
| 10 | 权限：401 / 403 | 单元测试 | ✅ **能验**：同上文件 |
| 11 | 门禁相容性：未 apply 的仓库上 verify 逐字节不变 + 带发布目录的目录 14 条校验全照常生效 | Task 2 的测试 | ✅ **能验**：`tests/unit/scripts/verify-webfont-subsets.test.ts`（58 用例） |
| 12 | 候选模式不削弱仓库门禁：`WEBFONT_PAGE_COST` 缺省 `enforce` ⇒ 仓库 verify 逐字节不变；`report` 下**内禀**校验照常判失败、页面成本**只报不算** | Task 1 的测试 | ✅ **能验**：`tests/unit/scripts/webfont-pipeline-roots.test.ts:134`（「can be told to report instead」）+ `:182`（「fails the over-budget sample when the page cost is enforced」）+ `:192`（「reports the same over-budget sample instead of failing on it」） |

⚠️ **本记录里没有任何一处把「注入式测试通过」写成「真机验证通过」。**
标 ⚠️ 的三条（5、6、8）都写明了「本机未做真实验证」与**具体的原因**。

### 7.1 乙组在第 12 条表里的位置

乙组（apply + 回灌之后）的实测结果**没有**填进上表 ——
它**跑不了**（§6.5）。上表第 2 条的 1839 是**甲组**（仓库里只有 release 0）的数字。

---

## 8. 三份文档的核对结果

| 文档 | 谁改 | 核对什么 | **结果** |
|---|---|---|---|
| `DEPLOY.md` | Task 10（依赖说明）+ **Task 9（`/font/` 两层）** | 两处 `npm install --omit=dev` 旁边都要有「字体构建工具链已是生产依赖」那句 | ✅ **通过**：`:29-30` 与 `:248-249` 两处都在，**一字未动**（⚠️ 行号是 **Task 9 改完之后**的；第二处在 §4 完整示例里，被本任务新增的 `/font/` 两层往下推了 18 行 ⇒ 改之前它在 `:230-231`） |
| `deploy/nginx.ziyun.pudafo.com.conf` | Task 11 | `location /font/web/` 与 `location /font/` **两层**，每层**只有一个** `Cache-Control` | ✅ **通过**：`:176`（`/font/web/`，一年 immutable）与 `:183`（`/font/`，30 天），两个块都**不带** `expires`、都带 `always;` ⇒ 每层一个 `Cache-Control` |
| `deploy/OPTIMIZATION.md` | Task 9（本任务）+ Task 11（TTL） | `:22` / `:23` / `:31-32` 的 `Expires:` / `Cache-Control` 描述与两层 TTL 的散文 | ✅ **通过**：三层都描述**两层**（`:22`「新模板**两层都不带** `expires`」、`:23`「新模板每个块只留**一个** `add_header Cache-Control`、不用 `expires`」、`:31-32`「字体的缓存分两层」）；字体那节的 Latin 数字（sans 9 条 / serif 14 条 / wenkai 22 条 face、共 45 个 woff2、20 508 B）**保持现状**未动 |

⚠️ **`deploy/OPTIMIZATION.md:327` 不是 TTL 描述** —— 它是**验收用的 curl 命令块**
（`# c2) 可变层(样式表与 manifest)必须 30 天、不带 immutable`）⇒ 本任务**没碰它**，
也**不需要**碰它。

### 8.1 记成 finding、本波**不修**的

| finding | 位置 | 说明 |
|---|---|---|
| `/fonts/` 的 TTL 与 `next.config.ts` 不一致 | `DEPLOY.md`（`/fonts/` 那一行）与 `next.config.ts:74` | `next.config.ts` 给 `/fonts/:path*` 的是 **30 天**，而 `DEPLOY.md` 的片段与线上 nginx 模板给 `/fonts/` 的是 **一年 immutable**。⇒ **wave-2 遗留**（`next.config.ts` 那一行在本波之前就是 30 天，Task 11 也没碰它）⇒ **不是本波引入的缺陷** ⇒ **本波不许「顺手统一」** —— `/fonts/` 是 196 MB 笔刷字体，改缓存期是**产品决定**，不是技术决定 ⇒ **留给 wave-3 / 运维决定** |
| `/strokes/` 的同一类不一致 | `DEPLOY.md`（`/strokes/` 那一行）与 `next.config.ts:75` | 同上：`next.config.ts` 给 30 天，`DEPLOY.md` 给一年 ⇒ **同一类不一致，只记录、不修** |
| `next.config.ts` 的行号引用漂了 | `deploy/OPTIMIZATION.md:23` 写着「与 `next.config.ts:64` 的 `/font/web/:path*` **逐字相同**」 | 实际的行号是 **`:72-73`**（`:64` 早已不是那一行）。⇒ **文字错误，不是行为错误** ⇒ 该行属于 Task 11 的 TTL 文本，本任务**只读不改** ⇒ 记成 finding |

---

## 9. Review Focus 的 21 条：分别被谁钉住

派工单要求：对 21 条**逐条**说明「哪个任务的测试钉住了它」，
或者**明说**没有测试钉它（那是 finding，不是四舍五入）。
⇒ 下表的每一行都是**本任务自己 grep 出来并核对过测试名**的，不是照抄任务归属表。

| # | 一句话 | 钉它的**文件**与**用例名** |
|---|---|---|
| 1 | 旧样式表在 apply 之后仍被使用 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「keeps every URL of the old stylesheet alive, byte for byte」 |
| 2 | apply 之后 HTML 里的样式表令牌没变 | ✅ `tests/unit/components/admin/webfont-pipeline-panel.test.tsx` —「says the stylesheet token only changes at the next build」 |
| 3 | 两个管理员同时点「开始构建」 | ✅ `tests/unit/app/api/admin/webfonts.test.ts` —「lets only ONE build start at a time (the in-process mutex)」 |
| 4 | 服务器没有 Python / fontTools | ✅ `tests/unit/lib/webfont-capability.test.ts` —「reports "not installed" when the interpreter does not exist」/「still names fontTools when python itself is missing」 |
| 5 | 下载被截断 | ✅ `tests/unit/lib/webfont-pipeline.test.ts:208` —「fails the download step when a file does not match its size」（用例里的注释明写 "Review focus #5"；断言 `error` 含 `'size mismatch'`，且切分步**一次都没跑**） |
| 6 | apply 的幂等（第二次 409） | ✅ `tests/unit/app/api/admin/webfonts.test.ts` —「answers 409 when the same job is applied twice」 |
| 7 | 旧发布目录被提前清理 | ✅ `tests/unit/lib/webfont-releases.test.ts` —「keeps a release that was superseded yesterday, even though it was created 90 days ago」/「plans the removal of a release superseded 40 days ago and outside the kept 3」 |
| 8 | 作业状态在进程重启后卡在 `running` | ✅ `tests/unit/app/api/admin/webfonts.test.ts` —「marks the stale jobs before it lists them」 |
| 9 | 两个令牌被混成一个 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「shows both tokens without complaining when they differ」（面板）+「derives the release token from the release directory」（API） |
| 10 | 候选校验被跳过 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「refuses to publish when the gate fails, and changes nothing」 |
| 11 | 发布目录按令牌排序 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「the release ledger ranks by mtime, never by token (review focus #11)」/ `tests/unit/lib/webfont-releases.test.ts` —「ranks the kept 3 by directory mtime, not by the publish token」 |
| 12 | 新布局过不了自己仓库的门禁 | ✅ `tests/unit/scripts/verify-webfont-subsets.test.ts` —「passes every check on a tree that uses the release directory」 |
| 13 | 候选校验拿「描述线上那份」的预算判失败 | ✅ `tests/unit/scripts/webfont-pipeline-roots.test.ts` —「fails the over-budget sample when the page cost is enforced」/「reports the same over-budget sample instead of failing on it」 |
| 14 | apply 之后仓库门禁变红（**前半**：一个字都不许写 `LIMITS`） | ✅ `tests/unit/lib/webfont-apply.test.ts` —「never writes the gate budget」 |
| 14 | apply 之后仓库门禁变红（**后半**：面板并排显示） | ✅ `tests/unit/components/admin/webfont-pipeline-panel.test.tsx` —「shows the new and old page cost side by side and names the lines to change」 |
| 15 | 构建工具链没进生产依赖 | ✅ `tests/unit/lib/webfont-capability.test.ts` —「lists the three build packages as production dependencies」/「the capability probe finds the whole toolchain in the production install」；**外加**本记录 §6.6 的**独立实测**（干净目录里 `--omit=dev` 装完，三条 `require.resolve` 都成功） |
| 16 | apply 的产物没回灌 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「carries the re-import command and the rebase checklist」+ `tests/unit/components/admin/webfont-pipeline-panel.test.tsx` —「renders the pending re-import block with the copyable command」（断言页面写着「回灌之前不要部署」） |
| 17 | 回灌之后仓库树的 `npm test` 变红 | ✅ `tests/unit/lib/webfont-rebaseline.test.ts` —「prints the recursive all-release file count and byte total」等（导入脚本打印的数字 = 填进去之后能过的数字）；⚠️ **真机那条链没跑** ⇒ 见 §6.5 的配方 |
| 18 | 一刀切把 `/font/**` 改成 30 天 | ✅ `tests/unit/deploy/font-cache-headers.test.ts` —「keeps the woff2 subsets on the one-year immutable TTL」/「puts the stylesheets on the thirty-day TTL」/「matches every font path with exactly one rule」 |
| 19 | 清理按创建时间而不是被取代时间 | ✅ `tests/unit/lib/webfont-releases.test.ts` —「keeps a release that was superseded yesterday, even though it was created 90 days ago」（注释里明写 "review focus #19"） |
| 20 | release 目录里没有 OFL 许可证 | ✅ `tests/unit/lib/webfont-apply.test.ts` —「writes the licences in both places of the release」+ `tests/unit/scripts/webfont-pipeline-roots.test.ts` —「keeps the three licences on the root of the shipped tree」 |
| 21 | `checkFaceDirectory()` 被「顺手改坏」 | ✅ `tests/unit/scripts/verify-webfont-subsets.test.ts` —「reports a release face that points at the directory of another family」+「reads the release directory of a URL that carries one」 |

⇒ **21 条全部有测试钉住** ⇒ **没有「没人钉」的条目。**

⚠️ **两条要说清边界**：

- **第 17 条**钉住的是「**导入脚本打印的数字**是对的」这一半；
  「**填进去之后 `npm test` 真的变绿**」那一半**本机没跑**（§6.5）。
- **第 15 条**除了单元测试，本任务还**独立实测**了一遍（§6.6）——
  在一个**干净目录**里只装生产依赖，然后跑 `require.resolve`。

⚠️ **补充（Task 9 自己加的）**：R-207b 要求给 `DEPLOY.md` 的两层 TTL 加一条守卫
⇒ 新增 `tests/unit/deploy/deploy-doc-font-cache.test.ts`（**11 个用例**）：
两处 `/font/web/`、两处 `/font/`、两个块都没有 `expires`、`/font/web/` 在 `/font/` 之前、
两个块都带 `always`、以及 **`/fonts/` / `/strokes/` / `/_next/static/` 仍然带着 `expires 1y`**
（证明只动了 `/font/`，没把笔刷字体的缓存策略连坐改掉）。
⇒ **这条测试的变异证明**：把文档里的 `/font/` 那一层改成
`"public, max-age=2592000, immutable"` 之后，这条测试**真的变红**
（用真实的 vitest runner 跑过，`AssertionError: expected … not to contain 'immutable'`）
⇒ **它不是假绿。**

---

## 10. 没做的事（四条，各带一句理由）

| 没做 | 为什么 |
|---|---|
| **自动 commit** | 后台**绝不**碰 git（spec §9 第 5 条）⇒ 回灌由**脚本 + 人工**完成（`scripts/fonts/import-webfont-release.mjs`） |
| **自动回滚** | 已发布的 release **没有**自动回滚 ⇒ 回滚是一条**人工**决定：重跑一次构建、apply 成新的 release、再回灌 |
| **后台可调热区 / 块宽** | 热区（300 字）与块宽（汉字 6 / 拉丁 12）是**切分计划**的参数，属于 `scripts/fonts/webfont-charset.mjs` ⇒ **后台不暴露**（暴露它 = 后台开始改门禁的判据） |
| **后台自动改门禁预算** | 自动把预算改成「让当前产物通过」= wave-2 修掉的**假绿灯**换个方向再来一次 ⇒ 后台只**并排显示**新旧数字并指出要改哪几行 |

### 10.1 下载跳过的盲区（R-116）

下载步按**大小**跳过（响应的 `Content-Length` 对本地文件）。
⇒ **大小相同但内容不同的情况判不出来** ——
**这不是内容校验**。而且**服务器不可达时绝不允许授权跳过** ——
那是「没拿到证据」，不是「证据是相同的」。

### 10.2 本波**故意**没做的其它事

- **apply 不删任何东西** —— 清理是**单独、显式**的一个动作。
- **后台不写 git** —— 同上第一条。
- **`LIMITS` 的每一个数字一个都没动** —— 只有「apply 之后由人重新标定」那一条路。
- **wave-2 的 spec 一个字都没动**（R-12）。
- **切分逻辑与语料一个字节都没动**（`webfont-charset.mjs`、`data/font-page-profiles.json`、
  `data/font-page-sample.json`）—— 唯一的例外是 §2.1 / §2.2 披露的那两条。

---

## 11. 留给人的活

1. **真机 apply 一次**，然后按 §6.5 的配方走一遍乙组（变红 → 重标定 → 重新全绿）。
2. **回灌之后重新构建并部署** —— HTML 里的令牌在构建期烤进去。
3. **决定 `/fonts/` 与 `/strokes/` 的缓存期**（§8.1 的两条 finding）。
4. **本记录与规格的 diff 要连着看** —— 规格是**本分支自己的产物**（§3.3）。

---

## 12. 本波改动的文件

| 文件 | 改了什么 |
|---|---|
| `scripts/fonts/build-webfont-subsets.mjs` + `.d.mts` | `WEBFONT_FONT_DIR`；许可证跟着字体走 |
| `scripts/fonts/verify-webfont-subsets.mjs` + `.d.mts` | `WEBFONT_FONT_DIR`；`WEBFONT_PAGE_COST`；`parseFaceUrl()` 多认一段可选发布目录 |
| `scripts/fonts/instance-webfont-axis.mjs` + `.d.mts` | 暴露 `instanceAll()`；失败的 kind 化 |
| `scripts/perf/font-load.mjs` | 盘上相对路径带上发布段 |
| `scripts/fonts/import-webfont-release.mjs`（**新建**） | 回灌脚本 |
| `lib/webfont/{pipeline,capability,run-command,jobs,apply,rebaseline,releases,paths}.ts`（**新建**） | 四步流水线、探针、作业、apply、重标定、release 台账 |
| `app/api/admin/webfonts/**`（**新建**） | build / apply / cancel / capability / releases / cleanup |
| `app/admin/settings/webfonts/page.tsx`（**新建**） | 后台页面 |
| `components/admin/Webfont*.tsx`（**新建**） | 面板的三个块 |
| `components/admin/AdminSidebar.tsx` | 侧栏加一条 |
| `lib/audit-format.ts` | 五个审计事件 |
| `lib/api-handler.ts` | `conflict()` 支持自定义响应体 |
| `next.config.ts` | 字体缓存头拆成两层 |
| `deploy/nginx.ziyun.pudafo.com.conf` | 同上（nginx 侧） |
| `deploy/OPTIMIZATION.md` | Task 11 的 TTL 两层（只读）+ **Task 9 的新一节「在后台重建字体」** |
| `DEPLOY.md` | Task 10 的两句依赖说明 + **Task 9 的两处 `/font/` 两层 TTL** |
| `package.json` + `package-lock.json` | 三个包从 devDependencies 移到 dependencies |
| `tests/unit/**` | 各任务自己的测试 + **Task 9 的 `deploy-doc-font-cache.test.ts`** |
| `.gitignore` | `build/` → `/build/` |

---

## 13. 必须披露的三件事（再说一次，放在末尾）

> 为了让后台重建字体不产生豆腐块，wave-2 的校验脚本的 URL 解析器被扩展了
> 一种可选的发布目录；它在现有产物上的行为完全不变。
>
> wave-2 的校验脚本新增了一个模式开关 `WEBFONT_PAGE_COST`：
> `enforce`（缺省，仓库自己的行为一个字节都不变）与 `report`
> （后台的候选校验用；页面成本**只报不算**，内禀校验照常判失败）。
> 候选校验**必须**用 `report` —— 并集样本的预算描述的是**线上那一份**产物，
> 语料一变 Ext 块就整体移位 ⇒ 拿它判失败 = 任何一次语料变了的重建都会失败。
>
> apply 之后，服务器树里的 `npm run fonts:verify-webfont` **会变红** ——
> 那是漂移探测器在正常工作。修法是**人工**重新标定
> `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`；
> 后台**绝不**自动改预算（自动改 = wave-2 修掉的假绿灯换个方向再来一次）。

---

*本记录只报告**做了什么**与**实测到了什么**；设计论证在规格里，人还要做的事在 §11。*
