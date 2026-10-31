# 后台字体流水线（/admin/settings/webfonts）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在一个后台页面里跑完「下载 → 轴裁剪 → 切分 → 校验」四步字体流水线，把产物放进 staging，人工确认后显式应用到线上目录，**全程不产生豆腐块**。

**Architecture:** 一个 Next.js 后台页面 + 五个 API 路由 + 一个 DB 作业表。构建在服务端进程内异步跑，前端每 1.5 s 轮询作业状态。四步流水线全部**复用 wave-2 已有的脚本**，本波只给它们加「字体根目录可覆盖」「页面成本模式开关」与「可被调用的函数入口」，**不改切分逻辑、不改预算、不改字符集**。应用采用**发布目录模型**（每次 apply 新建 `public/font/web/r<令牌>/`，旧目录原封不动），从根上杜绝「旧样式表 + 新字节」造成的豆腐块。
⚠️ **本波会动 wave-2 已封板的 4 个文件**（只动一处：让 URL 解析器多认一种「可选的发布目录段」）——
理由、实测代价与披露见 ledger §十五（裁定二十六）与本计划 **Task 2**。

**Tech Stack:** Next.js 15.5.19（App Router）/ React 19 / TypeScript / MySQL（mysql2）/ vitest / Node `child_process` / Python `fontTools.varLib.instancer`。**零新增依赖。**

**Spec:** `docs/superpowers/specs/2026-10-31-admin-webfont-pipeline-design.md` —— **spec 是权威**，本计划是它的论证；两者冲突时以 spec 为准。

**Branch:** `feature/admin-webfont-pipeline`，**从 wave-2 的收尾 tip 切出**（不从 main 切）。

---

## Global Constraints

- **零新增运行时依赖**（G3）：`package.json` 的 `dependencies` 一个字都不许动，不许装新 npm 包。
- **不许改 wave-2 的 spec**（R-12）：`docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md` 一个字都不许动。
- **不许改 wave-2 的切分逻辑与预算**：`scripts/fonts/webfont-charset.mjs`、`scripts/fonts/verify-webfont-subsets.mjs` 的 `LIMITS`、`data/font-page-profiles.json`、`data/font-page-sample.json` 一律不许动。
  ⚠️ **只有三处例外，且必须分别落在 Task 1 与 Task 2 里**：
  ① `verify-webfont-subsets.mjs` 加「字体根目录可覆盖」（Task 1）；
  ② `verify-webfont-subsets.mjs` 加「页面成本模式开关」（Task 1）；
  ③ `parseFaceUrl()` 多认一个**可选的发布目录段** + 读盘路径带上它（Task 2）——
  **理由与实测代价见 ledger §十五（裁定二十六）与 spec §3.5.7**，并且**必须写进实施记录**。
  ⇒ `LIMITS` 的**每一个数字**不许动；14 条校验的**判据**不许动；
  wave-2 的**现有产物上的行为必须逐字节不变**。
- **两个 env 名字在本计划里定死，实施时不许改名**：
  - `WEBFONT_FONT_DIR` = **字体根目录**（缺省 `public/font`）⇒ 切分输出 = `<根>/web`、
    样式表 = `<根>/fonts-<族>.css`、manifest = `<根>/fonts-manifest.json`；
  - `WEBFONT_PAGE_COST` = **页面成本模式**（`enforce` 缺省 / `report`）⇒ 语义见 spec §3.5.7。
  ⚠️ **今天这两个 env 都不存在**（字体脚本里现在只有 `WEBFONT_SAMPLE_PATH` 与 `PYTHON`）⇒
  这两个是**新增**的。⚠️ **不许**再引入第三个 env 去指同一个根 ——
  两个入口指同一件事 = 迟早漂移。
- **后台绝不自动改预算**（G12 / spec §3.5.7 推论三）：
  `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage` **只能人工重新标定**。
  自动把门禁预算改成「让当前产物通过」= wave-2 修掉的**假绿灯**换个方向再来一次。
  ⇒ 后台页面只把**新旧数字并排显示**并指出要改哪几行。
- **不许改既有已发布产物**：`public/font/web/**` 与 `public/font/fonts-*.css` 在**本计划的实施期**一律不许手改（apply 动作由代码写，不由人手改）。
- **失败必须非零退出 / 非 2xx，且文案说真话**（G12）：不许静默失败、不许吞异常、不许把子进程 stderr 原样糊给用户。
- **日志与代码注释一律英文**；**页面文案中文**（与后台其它页面一致）。
- **零云端字体**：页面上线后不得引用任何 CDN 字体；流水线只从 `raw.githubusercontent.com/google/fonts` 下载源字体到本地。
- **不许 `git add .` / `git add -A`**：只用显式路径。
- **不许 push**：由用户单独授权。
- **不许 stage `data/sutras/manifest.json`**（它常年是 modified 状态，别碰）。
- **不许跑 `npm run build` 在开发树**：`build` 只在 `D:/Temp/pinyin-build-check` 沙箱里跑，且先 `rm -rf .next`。
- **子进程一律 `execFile`/`spawn` + argv 数组**：不许拼 shell 字符串（下载 URL 是常量，不来自用户输入 ⇒ 不存在 SSRF 面）。
- **commit 格式**：`type(scope): subject [YYYY-MM-DD HH.MM]`，`HH.MM` 取 `date "+%Y-%m-%d %H.%M"` 的真实时间；正文末尾必须有 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **一个 commit 一个任务**。

---

## Review Focus

本 spec 暗示、但没有任何一个任务的测试会自然覆盖的失败模式（按最可能咬人的顺序）：

1. **旧样式表在 apply 之后仍被使用** ⇒ 它声明的 woff2 URL 必须仍然返回**同样的字节**。任何「apply 时覆盖同名文件」的实现都会在这里炸。⇒ Task 6 的测试必须先证明它会红。
2. **apply 之后 HTML 里的样式表令牌没变**（`lib/font-css.ts` 在构建期读 manifest）⇒ 页面若不提示这一点，管理员会以为「新版本已经上线了」而实际没有。⇒ Task 8 的测试要断言页面上确实显示了这个提示。
3. **两个管理员同时点「开始构建」** ⇒ 两份产物写同一个 staging 目录 ⇒ 互相覆盖。⇒ Task 7 的测试要断言只有一个 202。
4. **服务器没有 Python / fontTools** ⇒ 后台若显示「成功」就是 G12 意义上的假绿。⇒ Task 4 的测试要断言探针在缺能力时 `ok:false` 且给出安装命令。
5. **下载被截断**（网络中断、Content-Length 与落盘字节不符）⇒ 一个残缺的源字体进入切分器 ⇒ 一批缺字的子集被发布。⇒ Task 5 的测试要断言「大小不符 ⇒ 该步失败」，不许沿用残缺文件。
6. **apply 的幂等**：同一个作业点两次「应用」⇒ 第二个必须 409，不许再写一遍。
7. **旧发布目录被提前清理** ⇒ 缓存了旧样式表的访客拿到 404。⇒ Task 6 的测试要断言「当前 + 前 2 份」**且**「超过 30 天」之外的目录才会被删。
8. **作业状态在进程重启后卡在 `running`** ⇒ 页面永远转圈。⇒ Task 3 的测试要断言「`running` 的作业可以被标成 `failed`（进程中断）」。
9. **两个令牌被混成一个** ⇒ manifest 里写的是 T（改写前的哈希）而不是 V（改写后的哈希）⇒ wave-2 的 `checkManifest` 立刻红 ⇒ 线上留下的是一份**过不了自己仓库门禁**的产物。⇒ Task 6 的测试要断言 `manifest.version === V` 且 `V !== T`。
10. **候选校验被跳过**（直接把 staging 的样式表写进线上）⇒ 线上可能是一份缺字的产物 ⇒ 「apply 之后 verify 变红」。⇒ Task 6 的测试要断言「校验子进程返回非 0 ⇒ 线上一个字都没动」。
11. **发布目录按令牌排序** ⇒ T 是哈希，**不是单调的** ⇒ 「最近 3 份」会算错 ⇒ 删掉了一个还有人缓存着的目录。⇒ Task 6 的测试要断言按**目录 mtime** 排序。
12. **新布局过不了自己仓库的门禁** ⇒ wave-2 的解析器只认一层目录 ⇒ 新产物一律报「文件缺失」。⇒ Task 2 的测试要断言「一个完整的发布布局目录能通过全部 14 条校验」。
13. **候选校验拿「描述线上那份」的并集样本预算判失败** ⇒ 语料一变 Ext 块就整体移位 ⇒
    任何一次语料变了的重建都会失败 ⇒ **功能不可用**。⇒ Task 1 的测试要断言
    `report` 模式下页面成本**不进 errors**、而内禀校验**照常判失败**。
14. **apply 之后服务器树里的仓库门禁变红** ⇒ 那是**漂移探测器**在正常工作，不是 bug。
    后台若自动把预算改成「让当前产物通过」= **假绿灯**换个方向再来一次。
    ⇒ Task 6 的测试要断言「apply **一个字都不许写** `LIMITS`」；
    Task 8 的测试要断言页面**并排显示**新旧数字并指出要改哪几行。

---

## 文件结构（锁定）

| 文件 | 职责 |
|---|---|
| `scripts/fonts/build-webfont-subsets.mjs` | 切分。**只加**：字体根目录可覆盖（`WEBFONT_FONT_DIR`） |
| `scripts/fonts/verify-webfont-subsets.mjs` | 校验。**只加**：字体根目录可覆盖 ＋ 页面成本模式（Task 1）＋ 认得可选发布目录段（Task 2） |
| `scripts/fonts/verify-webfont-subsets.d.mts` | 校验脚本的类型声明。**只加**：`PageCostMode` ＋ `PageCostReport` ＋ `WebfontVerificationReport` 的两个成员 `pageCostMode` / `pageCost`（Task 1）＋ `FaceUrl.release`（Task 2） |
| `scripts/perf/font-load.mjs` | 字体载荷探针。**只加**：盘上相对路径带上发布段（Task 2） |
| `tests/unit/scripts/verify-webfont-subsets.test.ts` | wave-2 的既有测试。**只加**：`release` 断言 + 发布布局用例（Task 2） |
| `scripts/fonts/instance-webfont-axis.mjs` | 轴裁剪。**只加**：导出可调用函数 |
| `scripts/fonts/download-webfont-sources.ts` | 下载。**不改**（复用已导出的 `downloadFont`） |
| `lib/webfont/jobs.ts` | 作业表的读写（**唯一**碰 `webfont_build_jobs` 的地方） |
| `lib/webfont/capability.ts` | 能力探针 |
| `lib/webfont/pipeline.ts` | 四步流水线的执行器 |
| `lib/webfont/apply.ts` | 发布目录模型的应用逻辑 |
| `lib/webfont/paths.ts` | staging / live 目录常量（避免路径散落在四处） |
| `app/api/admin/webfonts/capability/route.ts` | `GET` 能力探针 |
| `app/api/admin/webfonts/build/route.ts` | `POST` 开始构建 / `GET` 列表 |
| `app/api/admin/webfonts/build/[id]/route.ts` | `GET` 单个作业 |
| `app/api/admin/webfonts/build/[id]/cancel/route.ts` | `POST` 取消 |
| `app/api/admin/webfonts/build/[id]/apply/route.ts` | `POST` 应用 |
| `app/admin/settings/webfonts/page.tsx` | 服务端页面壳 |
| `components/admin/WebfontPipelinePanel.tsx` | 客户端面板（能力 / 构建 / 应用 三块） |
| `components/admin/AdminSidebar.tsx` | 导航加一项（**只加一行**） |
| `lib/audit-format.ts` | `AuditEvent` 联合类型 + `EVENT_LABEL` 加 4 个事件 |
| `next.config.ts` | `/font/**` 的 `max-age` 一年 → 30 天 |
| `scripts/migrations/2026-10-31-webfont-build-jobs.sql` | 作业表 |

---

### Task 1: 脚本层 —— 字体根目录可覆盖 + 页面成本模式 + 可调用的入口

**Files:**
- Modify: `scripts/fonts/build-webfont-subsets.mjs`（`OUT_ROOT` / `FONT_DIR` / `MANIFEST_PATH` 三个常量）
- Modify: `scripts/fonts/verify-webfont-subsets.mjs`（`FONT_DIR` / `WEB_DIR` / `MANIFEST_PATH` 三个常量 ＋ 页面成本模式）
- Modify: `scripts/fonts/verify-webfont-subsets.d.mts`（加 `PageCostMode` ＋ `PageCostReport` ＋ `WebfontVerificationReport` 的两个成员，**只许追加**）
- Modify: `scripts/fonts/instance-webfont-axis.mjs`（`main()` 拆出 `instanceAll()`）
- Test: `tests/unit/scripts/webfont-pipeline-roots.test.ts`

**Interfaces:**
- Produces:
  - `build-webfont-subsets.mjs` → `export function resolveFontDir(env: NodeJS.ProcessEnv = process.env): string`
    - `env.WEBFONT_FONT_DIR` ⇒ **字体根目录**（缺省 `<repo>/public/font`）
    - **相对仓库根解析**（相对路径按仓库根算，不按 cwd 算 ⇒ 换 cwd 不会跑飞）
    - 由它派生：`OUT_ROOT` = `join(fontDir, 'web')`、`FONT_DIR` = `fontDir`、
      `MANIFEST_PATH` = `join(fontDir, 'fonts-manifest.json')`
    - ⚠️ **一个 env 指一件事** ⇒ 不许再有 `WEBFONT_OUT_ROOT`
      （两个 env 指同一个根 = 迟早漂移）。
  - `verify-webfont-subsets.mjs` → `export function resolveFontDir(env: NodeJS.ProcessEnv = process.env): string`
    - **同名同义** ⇒ 两个文件各导出一个；测试断言两者对同一 env 给出**同一个答案**
      ⇒ 证明「校验与切分指向同一个根」。
    - ⚠️ `WEB_DIR` 与 `MANIFEST_PATH` 必须**从 `FONT_DIR` 派生**，不许各自独立读 env。
  - `verify-webfont-subsets.mjs` → `export function resolvePageCostMode(env: NodeJS.ProcessEnv = process.env): 'enforce' | 'report'`
    - `env.WEBFONT_PAGE_COST` 缺省 `'enforce'`；只接受 `'enforce'` / `'report'`；
    - 其它值 ⇒ **抛错**（拼错不许静默降级成 `enforce`）。
    - 语义见 spec §3.5.7：`enforce` = 页面成本**照常判失败**；
      `report` = 页面成本**只报不算**（内禀校验照常判失败）。
  - `verify-webfont-subsets.d.mts` → `export type PageCostMode = 'enforce' | 'report';`
  - `instance-webfont-axis.mjs` → `export interface InstanceResult { source: string; out: string; status: 'done' | 'skipped'; bytes: number | null; reason: string | null }`
    - `export async function instanceAll(opts?: { stagingDir?: string; force?: boolean }): Promise<InstanceResult[]>`
    - `opts.stagingDir` 缺省 `STAGING_DIR`；`opts.force === true` 时**即使输出已存在也重跑**
    - `main()` 变成薄壳：调 `instanceAll()`、打印、失败时 `process.exitCode = 1`

**Steps:**

- [ ] **Step 1: 写失败的测试**（`tests/unit/scripts/webfont-pipeline-roots.test.ts`）

  **块一：根目录与模式（纯函数）——断言五件事：**
  1. 两个文件的 `resolveFontDir({})` 都返回 `<repo>/public/font`（末尾相等）；
  2. `resolveFontDir({ WEBFONT_FONT_DIR: 'tmp/y' })` 返回的是**仓库根下**的 `tmp/y`
     （用 `path.isAbsolute` + `startsWith(repoRoot)` 断言）；
  3. `resolvePageCostMode({})` === `'enforce'`；
  4. `resolvePageCostMode({ WEBFONT_PAGE_COST: 'report' })` === `'report'`；
  5. `resolvePageCostMode({ WEBFONT_PAGE_COST: 'nonsense' })` **抛错**。

  **块二：模式的效果（子进程，**必须能先红**）—— 复用 wave-2 测试里「超预算样本」的做法
  （`tests/unit/scripts/verify-webfont-subsets.test.ts` 的
  `'goes red when the sample is over its budget'`：把样本 `/` 的 serif 字符加上
  `/stories` 的 serif 字符 ⇒ 字节超预算）：**
  - 把那份**超预算样本**写到系统临时目录（**不许**落进仓库）；
  - **enforce**（不设 `WEBFONT_PAGE_COST`）跑一次校验器 ⇒
    **EXIT ≠ 0**，输出含 **`the budget is`**；
  - **report**（设 `WEBFONT_PAGE_COST=report`）跑**同一个**样本 ⇒
    **EXIT = 0**（这条样本唯一的缺陷就是页面成本 ⇒ 其余校验全绿），
    输出**不含** `the budget is`（页面成本不进 errors），
    且**含**下面钉死的两行新输出（标注行 + 机器可读行）；
  - ⇒ 这一条断言就是 spec §3.5.7「候选模式不削弱仓库门禁」的**证明**：
    页面成本这一层被摘掉了，**内禀校验一层都没动**（同一份样本在 enforce 下仍然红）。
  - ⚠️ 超时给 **300_000 ms**（wave-2 的同款测试也要 5 分钟）。
  - ⚠️ 跑完**必须**删掉临时目录，不许污染仓库。

- [ ] **Step 2: 跑测试，确认失败**

  Run: `npx vitest run tests/unit/scripts/webfont-pipeline-roots.test.ts`
  Expected: FAIL —— `resolveFontDir` / `resolvePageCostMode` 尚未导出；
  模式的那块也会红（report 模式还没实现 ⇒ 超预算样本仍然让校验器红）。

- [ ] **Step 3: 实现四个脚本的改动**

  - `build-webfont-subsets.mjs`：把
    ```js
    export const OUT_ROOT = resolve(ROOT, 'public', 'font', 'web');
    const FONT_DIR = resolve(ROOT, 'public', 'font');
    ```
    换成「由 `resolveFontDir()` 求值」的三行：
    `FONT_DIR = resolveFontDir()`、`OUT_ROOT = join(FONT_DIR, 'web')`、
    `MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json')`；
    **`FONT_DIR` 要导出**（apply 与校验都要用）。
    ⚠️ 脚本里**其它**引用 `OUT_ROOT` / `FONT_DIR` 的地方**一个字都不许改**（行为不变）。
  - `verify-webfont-subsets.mjs`：把 `FONT_DIR` 改成由 `resolveFontDir()` 求值，
    `WEB_DIR = join(FONT_DIR, 'web')`、`MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json')` 保持由 `FONT_DIR` 派生。
    ⚠️ `LIMITS` 的**每一个数字**不许动。
    ⚠️⚠️ **这条约束是相对于「本分支的 tip」说的，不是相对于 wave-2 的历史版本**：
    wave-2 的 **W2-7** 已经把 `LIMITS`（`pageFontBytes` / `unionSampleBytes` /
    `maxFontFilesPerPage` / `maxUnionSampleFilesPerPage`）与 `checkPageBudget`
    （种子=下限、样本=门禁、两条去循环守卫、`WEBFONT_SAMPLE_PATH`）**整个改过一遍**。
    ⇒ 实施者**不许**按旧版记忆去「恢复」或「对齐」任何东西：
    以**分支 tip 上的现状**为基准，**一个字都不许动**。
  - `instance-webfont-axis.mjs`：把 `main()` 里的循环抽成 `instanceAll()`：
    每个目标先看输出文件在不在、在且大小 > 0 ⇒ `status: 'skipped'`
    （**理由**：轴实例已存在时重跑会改字节 ⇒ 令牌变 ⇒ 全量重下载；这个取舍在 spec §3.3 已定）；
    否则跑 `python -I -m fontTools.varLib.instancer` ⇒ `status: 'done'` + 落盘字节数；
    失败 ⇒ 抛出带**具体原因**（缺 Python / 缺 fontTools / 剪裁失败）的错误，**不要**吞。

  **页面成本模式（spec §3.5.7）—— 改动点只有三处，其余一个字都不许动：**

  1. **模式解析**：`resolvePageCostMode(env)` 导出；非法值抛错
     （错误文案：`WEBFONT_PAGE_COST must be "enforce" or "report", got "<值>"`）。
     ⚠️ 在 `checkPageBudget()` **内部**求值（不许在模块顶层求值 ——
     顶层抛错会让「非法值」的报错变成一段栈回溯，而不是一句人话；
     `main()` 底部的 `.catch` 已经会把它变成 `[verify] the verification itself failed: …` + EXIT=1）。
  2. **摘掉页面成本那一条**（`checkPageBudget()` 里 `sampleResult` 那一次 `errors.push`）：
     - `enforce`（默认）⇒ **一个字都不许变**（`sampleResult.latinErrors` 与
       `sampleResult.budgetErrors` **照旧**都进 errors）；
     - `report` ⇒ **只有** `sampleResult.budgetErrors` **不进** errors，
       改为放进一个新的返回字段 `pageCost`；
       ⚠️ `sampleResult.latinErrors` **照常**进 errors
       （拉丁覆盖漏洞是产物的**内禀**缺陷，不是页面成本）；
       ⚠️ `checkSampleShape()` 与 `checkSampleIsDeeper()`（两条去循环守卫）
       **照常**进 errors（它们说的是**样本自身**的性质，与候选无关）；
       ⚠️ 种子的 `budgetErrors` 本来就只进 `floorNotes`（从不判失败）⇒ **一个字都不许动**。
  3. **输出**（只在 `report` 模式追加/改动，`enforce` 模式的输出必须**逐字节不变**）：
     - `[verify] pages  :` 那一行的行尾标记从 `OK` / `ERROR` 改成 **`REPORT`**
       （不许在 report 模式还写 `OK` —— 那是在说「没问题」，而这里只是「没判」）；
     - 追加一行**标注**：
       ```
       [verify] note   : PAGE COST IS REPORTED, NOT ENFORCED — these numbers describe the LIVE tree, not the candidate
       ```
     - 追加一行**机器可读**的 JSON（一行，不换行）：
       ```
       [verify] pagecost: {"bytes":{"/":838960,"/dictionary":330688,"/poetry":241204,"/stories":1214408},"files":{"/":175,"/dictionary":7,"/poetry":6,"/stories":255},"budgetBytes":{"/":839680,"/dictionary":330752,"/poetry":241664,"/stories":1214464},"budgetFiles":255}
       ```
       - `bytes` = 候选产物在**并集样本**口径下的字节数；`files` = 文件数；
         `budgetBytes` = `LIMITS.unionSampleBytes`；`budgetFiles` = `LIMITS.maxUnionSampleFilesPerPage`；
       - 页面键**按字典序排**（`/` < `/dictionary` < `/poetry` < `/stories`）；
       - ⚠️ 这行是 Task 6 的 apply **取新数字**的唯一来源 ⇒ 格式**定死**，不许改。
     - 超预算的页面**逐页**打印一行 info（**只报**）：
       ```
       [verify]   info: the sample page / is over its page budget (838960 B > 839680 B)
       ```
       ⚠️ **这句话不许含 `the budget is`** —— 那是 enforce 模式的**错误**文案；
       测试要靠「report 模式的输出里**没有** `the budget is`」来证明
       「页面成本这一层被摘掉了」。
       ⇒ 实现上用 `sampleResult.costs` 里的
       `{ path, bytes, files, budget, fileBudget }` **自己拼**这句话，
       **不许**把 `budgetErrors` 的原文打出来。
  - `verify-webfont-subsets.d.mts`：加
    ```ts
    /** Whether the page cost is enforced (the gate) or only reported. */
    export type PageCostMode = 'enforce' | 'report';
    /** The page cost of a candidate, measured against the union sample. */
    export interface PageCostReport {
      bytes: Record<string, number>;
      files: Record<string, number>;
      budgetBytes: Record<string, number>;
      budgetFiles: number;
    }
    ```
    并给 `WebfontVerificationReport` **追加**两个成员
    （`pageCostMode: PageCostMode; pageCost: PageCostReport | null;`）
    ⇒ ⚠️ **只许追加**，既有成员的签名/注释/顺序一个字都不许改。

  **⇒ 候选目录校验（Task 6）时**：`WEBFONT_FONT_DIR` 指向候选目录，
  但**两份 profile 仍从仓库的 `data/` 读**（`WEBFONT_SAMPLE_PATH` 默认
  `data/font-page-sample.json`）⇒ 候选的页面成本会被**测出来并报告**，
  但**不判失败**（`WEBFONT_PAGE_COST=report`）。
  ⚠️ **这是与 wave-2 历史行为的唯一一处语义差别，且只在候选模式下生效**。

- [ ] **Step 4: 跑测试，确认通过**

  Run: `npx vitest run tests/unit/scripts/webfont-pipeline-roots.test.ts`
  Expected: PASS。

- [ ] **Step 5: 跑既有脚本测试，确认没打破**

  Run: `npx vitest run tests/unit/scripts/`
  Expected: 全绿（**不许**有 skipped 变成 failed）。

- [ ] **Step 6: 确认默认行为一个字没变**

  改动前后各跑一次，**整个输出**（不是只看 `pages` 那行）diff 一下：

  ```bash
  npm run fonts:verify-webfont > .superpowers/sdd/2026-10-31-admin-webfont-pipeline/verify-enforce-before.txt 2>&1; echo "EXIT=$?"
  # …改动之后…
  npm run fonts:verify-webfont > .superpowers/sdd/2026-10-31-admin-webfont-pipeline/verify-enforce-after.txt 2>&1; echo "EXIT=$?"
  diff .superpowers/sdd/2026-10-31-admin-webfont-pipeline/verify-enforce-before.txt \
       .superpowers/sdd/2026-10-31-admin-webfont-pipeline/verify-enforce-after.txt
  ```

  Expected: EXIT=0，**diff 为空**（逐字节相同）。
  ⚠️ `WEBFONT_PAGE_COST` **不许**在这个检查里被设上 ⇒ 默认必须是 `enforce`。

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/fonts/build-webfont-subsets.mjs scripts/fonts/verify-webfont-subsets.mjs scripts/fonts/verify-webfont-subsets.d.mts scripts/fonts/instance-webfont-axis.mjs tests/unit/scripts/webfont-pipeline-roots.test.ts
  git commit -m "feat(fonts): make the font root overridable and the page cost reportable [$(date '+%Y-%m-%d %H.%M')]"
  ```

  ⚠️ commit 消息里要写清：这是 wave-2 已封板文件的改动（披露义务）。

---

### Task 2: 解析器认得「可选的发布目录段」（本波第一次动 wave-2 的文件）

**为什么单列一个任务：** 发布目录模型把样式表里的 URL 从 `/font/web/<族>/<文件>`
变成 `/font/web/r<令牌>/<族>/<文件>`（多一层目录）。wave-2 的校验门禁
`parseFaceUrl()` 的正则**只允许一层** ⇒ 改写后的 URL 解析不出来 ⇒ 门禁**直接红**。
这是本波**第一次**要动 wave-2 已封板的文件 ⇒ 必须单独实施、单独评审、单独披露
（裁定二十六-A / ledger §十五）。

**Files:**
- Modify: `scripts/fonts/verify-webfont-subsets.mjs`（`parseFaceUrl()` `:145-151`；`:618` 的读盘路径）
- Modify: `scripts/fonts/verify-webfont-subsets.d.mts`（`FaceUrl` `:156-163`）
- Modify: `scripts/perf/font-load.mjs`（`:129` 的盘上相对路径）
- Modify: `tests/unit/scripts/verify-webfont-subsets.test.ts`（`parseFaceUrl` 断言 + 新用例）

**Interfaces:**
- Consumes: Task 1 的 `resolveFontDir()` / `WEBFONT_FONT_DIR`
  （测试要能在**别的根**上跑门禁 ⇒ 才造得出「发布布局」的候选目录）。
- Produces:
  - `verify-webfont-subsets.mjs` → `export function parseFaceUrl(src: string): { dir: string; file: string; token: string; release: string } | null`
    - `release` 是**可选的发布目录段**，缺省是**空字符串**（release 0 = 今天的布局）；
    - `/font/web/sans/hot.woff2?v=X` ⇒ `{ dir:'sans', file:'hot.woff2', token:'X', release:'' }`
    - `/font/web/r<令牌>/sans/hot.woff2?v=X` ⇒ `{ dir:'sans', file:'hot.woff2', token:'X', release:'r<令牌>' }`
    - ⚠️ **两段式必须先试**：先试今天的两段式（`^\/font\/web\/([^/]+)\/([^/?]+)`），
      失败再试三段式 ⇒ 现有产物的解析结果**逐字节不变**。
  - `verify-webfont-subsets.d.mts` → `export interface FaceUrl { dir: string; file: string; token: string; release: string }`

**⚠️ 硬约束（越权即判失败）：**
- `LIMITS` 的**每一个数字**不许动（`hotBytes` / `extBlockBytes` / `cssBytes` /
  `sansCssBytes` / `maxFacesPerCss` / `maxFontFilesPerPage` / `latinBytes` /
  `pageFontBytes` / `unionSampleBytes` / `maxUnionSampleFilesPerPage`）；
- 14 条校验的**判据**不许动（只许让解析器多认一种布局）；
- ⚠️ **「不许动」的基准是「本分支的 tip」，不是 wave-2 的历史版本** ——
  wave-2 的 **W2-7** 已经改过 `LIMITS` 与 `checkPageBudget`
  （种子=下限、样本=门禁、两条去循环守卫、`WEBFONT_SAMPLE_PATH`）
  ⇒ 以 tip 上的现状为基准，**一个字都不许动**；
- wave-2 的 spec（`docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`）
  一个字不许动（R-12）；
- `data/font-page-profiles.json`、`data/font-page-sample.json`、`public/font/**` 一律不许动；
- `scripts/fonts/webfont-charset.mjs` 一个字不许动。

**Steps:**

- [ ] **Step 1: 写失败的测试**（`tests/unit/scripts/verify-webfont-subsets.test.ts`）

  三块：

  1. **既有断言要改**：`parseFaceUrl('/font/web/sans/hot.woff2?v=f31ca9b32566')`
     的期望值多一个 `release: ''`（新字段 ⇒ 旧断言会红，这是**预期**）。
  2. **新能力**：
     `parseFaceUrl('/font/web/r0a1b2c3d4e5f/sans/hot.woff2?v=0a1b2c3d4e5f')`
     ⇒ `{ dir:'sans', file:'hot.woff2', token:'0a1b2c3d4e5f', release:'r0a1b2c3d4e5f' }`；
     发布段形状不对时（不是 `r` + 十六进制，例如 `/font/web/xyz/sans/hot.woff2`）
     ⇒ `parseFaceUrl` 返回 `null`（⇒ 门禁会报「face 没有指向 /font/web/…」，
     **如实**而不是默默当成一个族）。
  3. **发布布局要能通过全部 14 条校验**（这一条是本任务的核心判据）：
     - 用 `node:fs.cp` 把真实的 `public/font/` 复制到 `os.tmpdir()` 下的临时目录
       （约 41 MB；`afterAll` 里**必须**删掉临时目录）；
     - 把 `candidate/web/{sans,serif,wenkai}` 复制成 `candidate/web/r<令牌>/{sans,serif,wenkai}`；
     - 读三份 `candidate/fonts-*.css`，把 `/font/web/` 前缀换成 `/font/web/r<令牌>/`，写回；
     - 用 `build-webfont-subsets.mjs` 导出的 `manifestVersion(cssByFile)`（`:428`）
       算出**改写后**样式表的哈希，写进 `candidate/fonts-manifest.json` 的 `version`
       （⚠️ 门禁的 `checkManifest` 要求 `manifest.version` == 线上样式表的哈希 ⇒ 必须算改写后的）；
     - 设 `process.env.WEBFONT_FONT_DIR = <临时目录>`，**在动态 import 之前**设
       （模块级常量在 import 时求值）⇒ `vi.resetModules()` 后
       `const { verifyAll } = await import('…/verify-webfont-subsets.mjs')`；
     - `const result = await verifyAll();` ⇒ 断言 `result.errors` 是**空数组**；
     - ⚠️ 这条测试**必须能先红**：实现之前它会因为「解析器不认发布段」而红
       （`errors` 里会出现「face 没有指向 /font/web/…」与「文件缺失」）；
     - ⚠️ 测试结束**必须** `delete process.env.WEBFONT_FONT_DIR`（不许污染别的测试）。

- [ ] **Step 2: 跑测试，确认失败**

  Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
  Expected: FAIL —— 断言缺 `release` 字段、新用例解析不出来、发布布局跑不过门禁。

- [ ] **Step 3: 实现解析器扩展**

  - `scripts/fonts/verify-webfont-subsets.mjs` 的 `parseFaceUrl()`：
    ```js
    export function parseFaceUrl(src) {
      const plain = /^\/font\/web\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$/.exec(src);
      if (plain) {
        return { dir: plain[1], file: plain[2], token: plain[3] ?? '', release: '' };
      }
      const released = /^\/font\/web\/(r[0-9a-f]+)\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$/.exec(src);
      if (released) {
        return {
          dir: released[2],
          file: released[3],
          token: released[4] ?? '',
          release: released[1],
        };
      }
      return null;
    }
    ```
    ⚠️ **两个正则的顺序不能换**（先两段、再三段）—— 换了就会让某些两段式 URL
    被当成三段式解析。
    ⚠️ 函数的 JSDoc 要补一句：发布目录段是**可选**的。
  - 同文件 `:618` 的读盘路径：`join(WEB_DIR, url.release, url.dir, url.file)`
    —— `release` 为 `''` 时 `path.join` 会丢掉空段 ⇒ 路径与今天**完全相同**。
    ⚠️ `WEB_DIR` / `FONT_DIR` / `MANIFEST_PATH` 的定义**一个字都不许动**
    （Task 1 已经把它们接到 `resolveFontDir()` 上）。
  - `scripts/fonts/verify-webfont-subsets.d.mts`：`FaceUrl` 加 `release: string`
    （带一句 JSDoc：空串 = release 0）。
  - `scripts/perf/font-load.mjs` `:129`：
    `const key = \`${url.release ? \`${url.release}/\` : ''}${url.dir}/${url.file}\`;`
    —— 探针**按 URL 自己的路径**读盘（`:320` `readFile(join(WEB_DIR, key))`），
    不带发布段就会读到不存在的文件。
    ⚠️ 探针的其它逻辑（拉丁层合并、预算缺失就抛错、版本错位提示、退出码）
    **一个字都不许动**。

- [ ] **Step 4: 跑测试，确认通过**

  Run: `npx vitest run tests/unit/scripts/verify-webfont-subsets.test.ts`
  Expected: PASS。

- [ ] **Step 5: 确认门禁在**现有产物**上的行为一个字没变**

  ⚠️ **必须在改 `parseFaceUrl()` 之前**先跑一次并存档输出：

  ```bash
  npm run fonts:verify-webfont > .superpowers/sdd/2026-10-31-admin-webfont-pipeline/verify-before.txt 2>&1; echo "EXIT=$?"
  ```

  改完再跑一次存 `verify-after.txt`，然后 `diff` 两个文件 ⇒ **必须完全相同**。

- [ ] **Step 6: 跑既有测试 + 类型检查**

  ```bash
  npx vitest run tests/unit/scripts/
  npx tsc --noEmit
  ```
  Expected: 都 EXIT=0。

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/fonts/verify-webfont-subsets.mjs scripts/fonts/verify-webfont-subsets.d.mts scripts/perf/font-load.mjs tests/unit/scripts/verify-webfont-subsets.test.ts
  git commit -m "feat(fonts): teach the verifier the optional release directory [$(date '+%Y-%m-%d %H.%M')]"
  ```

  ⚠️ commit 消息里**必须**写清：这是 wave-2 已封板文件的改动（披露义务）。

---

### Task 3: 作业表 —— 迁移 + DB 层

**Files:**
- Create: `scripts/migrations/2026-10-31-webfont-build-jobs.sql`
- Create: `lib/webfont/jobs.ts`
- Test: `tests/unit/lib/webfont-jobs.test.ts`

**Interfaces:**
- Produces `lib/webfont/jobs.ts`：
  ```ts
  export type WebfontJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  export type WebfontJobStep = '' | 'download' | 'instance' | 'subset' | 'verify' | 'apply';
  export interface WebfontJob {
    id: string;
    status: WebfontJobStatus;
    step: WebfontJobStep;
    stepProgress: string;
    message: string;
    error: string | null;
    log: string;
    manifestVersion: string;
    releaseDir: string;
    startedBy: number | null;
    createdAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }
  export function createJob(input: { id: string; startedBy: number | null }): Promise<WebfontJob>;
  export function getJob(id: string): Promise<WebfontJob | null>;
  export function listJobs(limit?: number): Promise<WebfontJob[]>;
  export function appendLog(id: string, line: string): Promise<void>;
  export function updateJob(id: string, patch: Partial<Omit<WebfontJob, 'id' | 'createdAt'>>): Promise<void>;
  export function findActiveJob(): Promise<WebfontJob | null>;
  export function clearOldJobLogs(keep: number): Promise<number>;
  export function markStaleRunningJobsFailed(): Promise<number>;
  export function ensureStaleJobsMarked(): Promise<void>;   // 每个进程只跑一次
  ```
  ⚠️ **所有 SQL 只许出现在这个文件里**（其它模块一律走这里的函数）。
  ⚠️ `clearOldJobLogs(20)` 的语义（spec §9.1）：**保留最近 20 条**作业的完整日志，
  更早的**只清空 `log` 这一列**，元数据（状态/版本/时间）**一律保留**。
  ⚠️ `ensureStaleJobsMarked()`（spec §7 风险表第 3 行）：进程重启后遗留的
  `status = 'running'` 作业**必须**被标成 `failed`，错误文案写明「进程中断」，
  否则页面会永远转圈。用 `globalThis` 上的布尔标志保证**每个进程只执行一次**
  （模块级变量在 dev 热重载后会丢）。

- [ ] **Step 1: 写迁移文件**

  照抄 spec §4 的建表语句。硬要求：
  - `CREATE TABLE IF NOT EXISTS`；
  - ⚠️ **不许**出现 `ADD COLUMN` / `ADD KEY` / `ADD INDEX` / `CREATE INDEX` / `DROP …`
    （仓库的 `tests/unit/migrations-idempotent.test.ts` 会把含这些关键字且没有
    `information_schema` 守卫的文件判为违规）；
  - 索引直接写在 `CREATE TABLE` 里（`KEY idx_…`），不写 `ADD KEY`。

- [ ] **Step 2: 跑迁移幂等测试，确认通过**

  Run: `npx vitest run tests/unit/migrations-idempotent.test.ts`
  Expected: PASS。

- [ ] **Step 3: 写失败的测试**（`lib/webfont/jobs.ts` 还不存在）

  用 `vi.mock('@/lib/db')` 造一个假 pool（照抄 `tests/unit/lib/admin-pageviews.test.ts` 的写法），
  断言**发出的 SQL 形状**：
  1. `createJob` 发一条 `INSERT INTO webfont_build_jobs`，参数含 `id` 与 `started_by`；
  2. `findActiveJob` 的 SQL 里 `status IN ('pending','running')`；
  3. `appendLog` 用的是**拼接**（`log = CONCAT(log, ?)`）而不是「读出来再写回去」；
  4. `updateJob` 只更新**显式传入的字段**（不许拼一串固定字段覆盖没传的列 ⇒
     「更新 step 时不许把 status 抹掉」）；
  5. `markStaleRunningJobsFailed` 只动 `status = 'running'` 的行；
  6. `clearOldJobLogs(20)` 的 SQL **只 `UPDATE … SET log = ''`**，
     **不许 `DELETE`** 任何行（元数据必须留下）；
  7. `ensureStaleJobsMarked()` **第二次调用不重复执行**（`globalThis` 标志），
     且它把 `running` 的行改成 `failed` 时**同时写下「进程中断」**的 error 文案。

- [ ] **Step 4: 跑测试，确认失败**

  Run: `npx vitest run tests/unit/lib/webfont-jobs.test.ts`
  Expected: FAIL —— 模块不存在。

- [ ] **Step 5: 实现 `lib/webfont/jobs.ts`**

  用 `getPool()` + `pool.query`（与 `lib/admin-pageviews.ts` 同款）。
  ⚠️ **时间统一用 `DATE_FORMAT(NOW(), ...)` 或让 MySQL 生成**，不要在 JS 里拼时间戳；
  ⚠️ 行映射函数把 MySQL 的 `Date` 统一转成 **ISO 字符串**（`toISOString()`），
  这样前端拿到的格式与其它后台接口一致。

- [ ] **Step 6: 跑测试，确认通过**

  Run: `npx vitest run tests/unit/lib/webfont-jobs.test.ts`
  Expected: PASS。

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/migrations/2026-10-31-webfont-build-jobs.sql lib/webfont/jobs.ts tests/unit/lib/webfont-jobs.test.ts
  git commit -m "feat(admin): add the webfont build job table [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 4: 能力探针

**Files:**
- Create: `lib/webfont/capability.ts`
- Create: `app/api/admin/webfonts/capability/route.ts`
- Test: `tests/unit/lib/webfont-capability.test.ts`

**Interfaces:**
- Consumes: `SOURCES`（`scripts/fonts/download-webfont-sources.ts` 导出）；
  `PYTHON` 环境变量（`scripts/fonts/instance-webfont-axis.mjs` 用的同一个覆盖名）。
- Produces `lib/webfont/capability.ts`：
  ```ts
  export interface CapabilityReport {
    ok: boolean;
    node: string;
    python: { available: boolean; version: string | null; error: string | null };
    fonttools: { available: boolean; version: string | null; error: string | null; remedy: string | null };
    network: { available: boolean; checkedUrl: string; error: string | null };
    disk: { available: boolean; stagingDir: string; error: string | null };
    sources: { filename: string; label: string; present: boolean; size: number | null }[];
    missing: string[];
  }
  export async function probeCapability(opts?: {
    stagingDir?: string;
    runCommand?: (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
    fetchImpl?: typeof fetch;
  }): Promise<CapabilityReport>;
  ```
  ⚠️ `runCommand` / `fetchImpl` **必须可注入** ⇒ 测试不碰真网络、不碰真 python。

- [ ] **Step 1: 写失败的测试**

  断言：
  1. `runCommand` 抛 `ENOENT`（模拟没有 python）⇒ `report.ok === false`、
     `report.python.available === false`、`report.missing` 里含一条提到 Python 的说明；
  2. python 在但 `fontTools.varLib.instancer --help` 退出码非 0 ⇒
     `report.fonttools.available === false` 且 `report.fonttools.remedy` 含 **`fonttools`**；
  3. `fetchImpl` 抛 ⇒ `report.network.available === false`；
  4. 全部可用 ⇒ `report.ok === true`、`report.missing` 为空数组。

- [ ] **Step 2: 跑测试，确认失败** ⇒ FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/webfont/capability.ts`**

  - python 探测：`runCommand(process.env.PYTHON ?? 'python', ['--version'])`；
  - fontTools 探测：`runCommand(pythonBin, ['-I', '-m', 'fontTools.varLib.instancer', '--help'])`；
    缺 fontTools 时的 `remedy` 文案固定包含 `pip install fonttools`；
  - 网络探测：对 `SOURCES[0].urls[0]` 发一个 **`HEAD`** 请求（带 10 s 超时）；
    ⚠️ 只发 HEAD，**不许**在这里下载字体；
  - 磁盘探测：在 staging 目录写一个 `.probe` 文件再删掉；
  - 源字体现状：读 `SOURCES`，报告每个文件在不在、大小多少（**只读，不下载**）；
  - `missing`：人类可读的清单（中文），例如
    「找不到 Python 解释器（装一个，或设 PYTHON 环境变量指向它）」。

- [ ] **Step 4: 实现 API 路由 `app/api/admin/webfonts/capability/route.ts`**

  `GET` ⇒ `requireAdmin()` ⇒ 探针 ⇒ `NextResponse.json(report)`。
  ⚠️ 探针失败**不是**服务器错误 ⇒ 仍返回 **200**，用 `report.ok === false` 表达。

- [ ] **Step 5: 跑测试 + 类型检查**

  Run: `npx vitest run tests/unit/lib/webfont-capability.test.ts && npx tsc --noEmit`
  Expected: 两者都 EXIT=0。

- [ ] **Step 6: Commit**

  ```bash
  git add lib/webfont/capability.ts app/api/admin/webfonts/capability/route.ts tests/unit/lib/webfont-capability.test.ts
  git commit -m "feat(admin): probe the font pipeline capabilities [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 5: 四步流水线执行器

**Files:**
- Create: `lib/webfont/paths.ts`
- Create: `lib/webfont/pipeline.ts`
- Test: `tests/unit/lib/webfont-pipeline.test.ts`

**Interfaces:**
- Consumes: `WebfontJobStep`（Task 3 的 `lib/webfont/jobs.ts`）；
  `FontEntry` = `scripts/fonts/download-webfont-sources.ts` 里 `SOURCES` 的元素类型
  （**从那个文件 import，不要另写一份**）。
- Produces:
- `lib/webfont/paths.ts`：
  ```ts
  export const REPO_ROOT: string;
  export const SOURCE_DIR: string;        // scripts/fonts/staging/web
  export const BUILD_DIR: string;         // scripts/fonts/staging/build
  export function buildDirFor(jobId: string): string;   // BUILD_DIR/<jobId>
  export const LIVE_FONT_DIR: string;     // public/font
  ```
- `lib/webfont/pipeline.ts`：
  ```ts
  export interface PipelineCallbacks {
    log(line: string): void | Promise<void>;
    step(step: WebfontJobStep, text: string): void | Promise<void>;
  }
  export interface PipelineOptions {
    jobId: string;
    callbacks: PipelineCallbacks;
    sourceDir?: string;
    buildDir?: string;
    download?: (entry: FontEntry, destDir: string) => Promise<{ status: 'ok' | 'skip' | 'fail'; size: number; reason?: string }>;
    runCommand?: (bin: string, args: string[], opts?: { cwd?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
    shouldStop?: () => Promise<boolean>;   // 取消检查：每步**开始前**问一次
  }
  export interface PipelineResult {
    ok: boolean;
    step: WebfontJobStep;
    error: string | null;
    manifestVersion: string | null;
    cancelled: boolean;                  // true = 被管理员取消，不是失败
    // 候选产物在并集样本口径下的页面成本（spec §3.5.7）。
    // report 模式下由校验器打印的 `[verify] pagecost: {…}` 行解析而来；
    // 拿不到就是 null（**不许**编数字）。
    pageCost: PageCostReport | null;
  }
  export async function runPipeline(options: PipelineOptions): Promise<PipelineResult>;
  ```

  ⚠️ `PageCostReport` **从 `scripts/fonts/verify-webfont-subsets.d.mts` import**
  （Task 1 加的那个类型）⇒ **不许另写一份**形状。
  ⚠️ **进度按步骤数给**（spec §3.2）：`0 / 25 / 50 / 75 / 100`，
  **不许编造细粒度百分比**。切分那一步内部没有可信进度源 ⇒ 只给
  「subsetting family 2/3」这种**文本**（写进 `step_progress`）。

**Steps:**

- [ ] **Step 1: 写失败的测试**

  用注入的 `download` / `runCommand` 假实现，断言六条路径：
  1. 四步都成功 ⇒ `result.ok === true`、`result.step === 'verify'`、
     `callbacks.step` 依次收到 `download` → `instance` → `subset` → `verify`；
  2. `download` 返回 `fail` ⇒ `result.ok === false`、`result.step === 'download'`、
     `result.error` **点名「下载」并带原因**；
  3. 轴裁剪的 `runCommand` 返回非 0 且 stderr 含 `No module named fontTools`
     ⇒ `result.error` 里含 **`fonttools`**（G4：要说清怎么装）；
  4. 每一步都**至少调用一次** `callbacks.log`（不许出现「某一步一声不吭」）；
  5. **取消**：`shouldStop` 在第二步开始前返回 `true` ⇒
     `result.cancelled === true`、**第三步没有启动**（`runCommand` 只被调用了 1 次），
     且**没有任何子进程被强杀**（不许出现 `kill` / `taskkill`）；
  6. **① 复用本地**：`download` 返回 `'skip'` ⇒ 该步**仍然算成功**，
     日志里写的是 `skipped`（**不许**写成「已下载」）。
  7. **④ 校验的 env**：切分那一步的 env 里**有** `WEBFONT_FONT_DIR=<buildDir>`；
     校验那一步的 env 里**有** `WEBFONT_FONT_DIR=<buildDir>` **且**
     **`WEBFONT_PAGE_COST='report'`**（spec §3.5.7：候选的页面成本只报不算），
     ⚠️ **不许**出现 `WEBFONT_OUT_ROOT`。
  8. **④ 把 pagecost 数字摘出来**：校验那一步的 stdout 里有一行
     `[verify] pagecost: {"bytes":{…},"files":{…},…}` ⇒
     `result.pageCost` **不为 null**，且 `result.pageCost.bytes['/']` 是**数字**；
     ⚠️ 摘不出来就是 `null`（**不许**编数字、不许吞掉那行）。

- [ ] **Step 2: 跑测试，确认失败** ⇒ FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/webfont/paths.ts`** —— 纯路径常量，**零逻辑**。

- [ ] **Step 4: 实现 `lib/webfont/pipeline.ts`**

  - **① 下载**：遍历 `SOURCES`（从 `scripts/fonts/download-webfont-sources.ts` 导入），
    调注入的 `download`（默认实现包一层 `downloadFont`）；
    **大小不符 ⇒ 该文件失败**（不许沿用残缺文件 —— Review Focus #5）；
    任一文件失败 ⇒ 整步失败，错误里写明**哪个文件**、**为什么**。
    ⚠️ 文件已存在且大小对得上 ⇒ 走 `downloadFont` 自带的跳过逻辑，
    这一项**记成 `skipped`**（spec §9.3），**不许**记成「已下载」。
  - **② 轴裁剪**：调 `instanceAll({ stagingDir: sourceDir })`；
    ⚠️ **默认不 `force`**（轴实例已存在就 skip，避免改字节 ⇒ 避免令牌变 ⇒ 避免全量重下载）；
    跳过时日志写 `skipped (axis instance already present)`。
  - **③ 切分**：`runCommand(process.execPath, [subsetScriptPath], { cwd: REPO_ROOT })`
    且 **env 里带** `WEBFONT_FONT_DIR=<buildDir>`
    ⇒ 切分输出 = `<buildDir>/web`、样式表 = `<buildDir>/fonts-<族>.css`、
    manifest = `<buildDir>/fonts-manifest.json`。
    ⚠️ **只有这一个 env**（**不许**有 `WEBFONT_OUT_ROOT` —— 两个 env 指同一件事 = 迟早漂移）。
    ⚠️ 用 `process.execPath`（当前 node 的绝对路径），**不许**用 `'node'`（PATH 可能不同）。
  - **④ 校验**：同上，`env.WEBFONT_FONT_DIR=<buildDir>` **且**
    `env.WEBFONT_PAGE_COST='report'`（spec §3.5.7：候选的页面成本**只报不算**）；
    退出码非 0 ⇒ 失败，错误里**摘出** stdout 里那几行超限信息
    （**不要**把整段 stderr 糊给用户）。
    ⚠️ **内禀校验**（覆盖率 / 不相交 / 字形 / 块大小 / CSS 大小 / face 数 /
    manifest / 令牌 / identity / 字重 / 目录 / 拉丁）**照常判失败**
    ⇒ 「把块宽从 6 字改成 64 字」这种病态产物照样被挡住。
    ⚠️ stdout 里那行 `[verify] pagecost: {…}` **必须**被摘出来 ⇒ `result.pageCost`
    （管理员要在页面上看到新旧数字）。摘不出来就是 `null`，**不许编数字**。
  - 每一步前后各 `callbacks.step(step, 文本)`；文本用**英文**（日志约定）。
  - **每步开始前**调一次 `options.shouldStop?.()`；返回 `true` ⇒
    **不再启动下一步**，返回 `{ ok:false, cancelled:true, error:'cancelled by admin' }`。
    ⚠️ **不强杀正在跑的子进程**（spec §9.2：强杀可能留下半个 woff2）⇒
    当前那一步**自然跑完**，只是不再进入下一步。

- [ ] **Step 5: 跑测试 + 类型检查** ⇒ 都 EXIT=0。

- [ ] **Step 6: Commit**

  ```bash
  git add lib/webfont/paths.ts lib/webfont/pipeline.ts tests/unit/lib/webfont-pipeline.test.ts
  git commit -m "feat(admin): run the four-step font pipeline as a job [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 6: 发布目录模型 —— apply 逻辑 + 旧样式表的字节不变性

**Files:**
- Create: `lib/webfont/apply.ts`
- Modify: `next.config.ts`（`/font/**` 的 `max-age`）
- Test: `tests/unit/lib/webfont-apply.test.ts`

**Interfaces:**
- Consumes:
  - `lib/webfont/paths.ts` 的 `LIVE_FONT_DIR` / `REPO_ROOT`（Task 5）；
  - Task 1 的 `WEBFONT_FONT_DIR`（校验根可覆盖）—— apply 的**候选校验**要用它；
  - Task 1 的 `WEBFONT_PAGE_COST`（页面成本模式）—— apply 的**候选校验**必须用
    `report`（候选的页面成本**只报不算**，spec §3.5.7）；
  - Task 1 的 `PageCostReport` 类型（**从 `.d.mts` import，不许另写一份**）；
  - Task 2 的解析器扩展 —— apply 产出的新布局**必须**能过 wave-2 的门禁。
- Produces `lib/webfont/apply.ts`：
  ```ts
  export interface ApplyResult {
    ok: boolean;
    manifestVersion: string | null;   // V：写进 manifest 的那个（改写后样式表的哈希）
    releaseToken: string | null;       // T：发布令牌（= staging manifest 的 version）
    releaseDir: string | null;         // 'r<T>'
    rewrittenFaces: number;
    swept: string[];
    error: string | null;
    // 与「仓库当前产物」的差异摘要（spec §9.6 / §7 风险表最后两行）
    summary: {
      liveFiles: number;      // apply 之前 live 里有多少个 woff2
      liveBytes: number;
      newFiles: number;       // 新产物有多少个 woff2
      newBytes: number;
      releaseBytes: number;   // 新发布目录占多少字节（磁盘占用）
    } | null;
    // 候选产物在并集样本口径下的页面成本 + 旧预算（spec §3.5.7 推论三）。
    // 页面要把这两组数字**并排显示**，并指出要改的是哪几行。
    // ⚠️ 后台**绝不**据此改 `LIMITS` —— 那是假绿灯。
    pageCost: PageCostReport | null;
  }
  export function countFaceRules(css: string): number;
  export function rewriteStylesheetUrls(
    css: string,
    releasePrefix: string,      // 例如 '/font/web/r0a1b2c3d4e5f'
  ): { css: string; rewritten: number; expected: number };
  export async function applyStagedBuild(options: {
    jobId: string;
    stagedFontDir: string;      // staging 的字体根（含 fonts-*.css 与 web/）
    liveFontDir?: string;        // 缺省 LIVE_FONT_DIR
    keepReleases?: number;       // 缺省 3（当前 + 前 2）
    maxAgeDays?: number;         // 缺省 30
    runCommand?: (
      bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<{ code: number; stdout: string; stderr: string }>;
  }): Promise<ApplyResult>;
  ```

**两个令牌（裁定二十六-B）—— 为什么不是一个：**

| 令牌 | 怎么算 | 用在哪 |
|---|---|---|
| **发布令牌 T** | staging manifest 里已有的 `version`（= **改写前**样式表的哈希） | 发布目录名 `web/r<T>/` |
| **清单版本 V** | **改写后**三份样式表的哈希（wave-2 的 `manifestVersion` 规则） | 写进 `public/font/fonts-manifest.json` ⇒ `lib/font-css.ts` 用它做样式表的 `?v=` |

⚠️ **V ≠ T 是正常的、也是必须的**：`checkManifest` 要求清单版本等于**线上**样式表的哈希，
而发布令牌要**写进**样式表 ⇒ 鸡生蛋 ⇒ 两个令牌。
两者都是**内容的函数** ⇒ 内容不变 ⇒ 两者都不变 ⇒ apply 会发现「线上已经是这一份」并**拒绝**。

**apply 的顺序是「先搭后验再换」（裁定二十六-C）—— 只有最后一步会动线上。**

**Steps:**

- [ ] **Step 1: 写失败的测试**（先证明它会红）

  在一个**临时目录**里造出「旧发布」：
  `live/web/sans/hot.woff2`（内容 `OLD`）、`live/fonts-sans.css`（内容里含
  `url(/font/web/sans/hot.woff2?v=oldtoken)`）、`live/fonts-manifest.json`。

  再造出「staging 发布」：`staged/web/sans/hot.woff2`（内容 `NEW`）、
  `staged/fonts-sans.css`（同样一条 URL）、`staged/fonts-manifest.json`。

  ⚠️ **候选校验用注入的 `runCommand` 假实现**（返回 `{ code: 0, stdout: '', stderr: '' }`）
  —— 单元测试里没有真的 7 981 个 woff2，不注入就会永远失败。
  真机上真跑一次校验这件事**写进实施记录**（spec §8 第 6 条 ⚠️ 项）。

  断言：
  1. `applyStagedBuild` 之后：`live/web/sans/hot.woff2` 的内容**仍然是 `OLD`**
     （**这一条是 G-3 的直接证明**）；
  2. `live/web/r<T>/sans/hot.woff2` 存在且内容是 `NEW`；
  3. `live/fonts-sans.css` 里的 woff2 URL **全部**指向 `/font/web/r<T>/`，
     且**条数**等于改写前的 face 条数；
  4. `live/fonts-manifest.json` 的 `version` **变了**，且**等于 V**（改写后三份样式表的哈希），
     且 **≠ T**（T 是 staging manifest 里那个）；
  5. `rewriteStylesheetUrls` 在「CSS 里没有可改写的 URL」时返回 `expected > 0 && rewritten === 0`
     ⇒ 调用方**必须**报错（G12：不允许「改写了一条都没改」还当成功）；
  6. **旧样式表的每个 URL 都还活着**（spec §8 第 8 条的自动化版）：
     把 apply **之前**那份 `fonts-sans.css` 里的**每一条** woff2 URL 抽出来，
     apply 之后逐条断言「对应文件**仍然存在**，且字节与 apply 之前**完全一致**」。
     ⇒ 这一条**必须覆盖全部 URL**，不许只测一条；
  7. **保留规则（最近 3 份）**：`live/web/` 下预先造出 `r<A>`、`r<B>`、`r<C>` 三个旧发布目录
     （mtime 设成很久以前）⇒ apply 之后**这三个都还在**（当前 + 前 2 = 3 份），
     再预先造出 `r<D>`（同样很老、不在最近 3 份里）⇒ apply 之后**只有 D 被删**；
  8. **保留规则（30 天）**：再预先造出 `r<E>`（不在最近 3 份里，但 mtime 是**昨天**）
     ⇒ apply 之后 **E 还在**（不许删）—— `/font/**` 的 max-age 降到 30 天之后，
     访客可能还缓存着 30 天内的旧样式表；
  9. **release 0 永远不许删**：断言 `live/web/sans`、`live/web/serif`、`live/web/wenkai`
     在 apply 之后**都还在**，且字节**一个字都没变**；
  10. **候选校验失败 ⇒ 线上一个字都不动**：把注入的 `runCommand` 换成返回
      `{ code: 1, stdout: '[verify]   [sans] the face ... is missing\n[verify] 3 error(s)\n', stderr: '' }`
      ⇒ apply 返回 `ok:false`、`error` 里**含那行关键信息**（不许含整段 stderr），
      并且 `live/` 下**除刚建又被删掉的 `web/r<T>/` 外，每一个文件都逐字节没变**，
      且 `web/r<T>/` 最终**不存在**；
  11. **幂等**：同一个 staging 连续 apply 两次 ⇒ 第二次 `ok:false`
      （内容不变 ⇒ T 不变 ⇒ V 不变 ⇒ 「线上已经是这一份」），
      且第二次**没有动过** `live/` 的任何文件；
  12. **face 计数不许漂**：断言 `countFaceRules(css) === parseFaces(css).length`
      （`parseFaces` 从 `scripts/fonts/verify-webfont-subsets.mjs` import），
      对仓库里**三份真实样式表**各验一次。
      ⇒ 这是「抄了一份」的唯一保险：**抄的那份被测试钉在权威实现上**。
  13. **候选校验必须跑在 `report` 模式**：断言注入的 `runCommand` 收到的
      `opts.env.WEBFONT_PAGE_COST === 'report'`
      ⇒ 候选的页面成本**只报不算**（spec §3.5.7：并集样本的预算描述的是**线上那份**，
      语料一变就必然超 ⇒ 拿它判失败 = 功能不可用）。
  14. **新数字要被摘出来**：让注入的 `runCommand` 返回一段带
      `[verify] pagecost: {"bytes":{"/":838960},"files":{"/":175},"budgetBytes":{"/":839680},"budgetFiles":255}`
      的 stdout ⇒ `result.pageCost` **不为 null**，
      `result.pageCost.bytes['/'] === 838960`，
      `result.pageCost.budgetBytes['/'] === 839680`
      ⇒ 页面要把这两组数字**并排显示**（新 vs 旧）。
  15. **后台绝不改预算**：apply 前后对比
      `scripts/fonts/verify-webfont-subsets.mjs` 与 `scripts/fonts/verify-webfont-subsets.d.mts`
      的内容 ⇒ **逐字节相同**。
      ⚠️ apply **一个字都不许写** `LIMITS.unionSampleBytes` / `maxUnionSampleFilesPerPage`
      —— 自动把门禁预算改成「让当前产物通过」= wave-2 修掉的**假绿灯**换个方向再来一次
      （spec §3.5.7 推论三）。

- [ ] **Step 2: 跑测试，确认失败** ⇒ FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/webfont/apply.ts`**

  - `countFaceRules(css)`：数 `@font-face` 的出现次数。
    ⚠️ 这是 wave-2 `parseFaces()` 的一小部分逻辑，**不许**当成权威 ——
    测试里必须有上面第 12 条那个断言把它钉住。
  - `rewriteStylesheetUrls(css, releasePrefix)`：
    用正则找出**所有** `/font/web/` 引用，逐个替换成 `<releasePrefix>/`；
    `expected` = `countFaceRules(css)`（**应该**被改写的条数），
    `rewritten` = 实际替换条数；
    ⚠️ `rewritten !== expected` ⇒ 调用方**判失败**（不许「改了一部分还当成功」）。
  - `applyStagedBuild(options)`：
    1. 读 staging 的 `fonts-manifest.json` ⇒ **发布令牌 T** = `manifest.version`；
       manifest 不存在 ⇒ 失败（`error` 说清「staging 里没有 manifest」）。
    2. 读 staging 的三份样式表 ⇒ **在内存里**改写 ⇒ 每份都要 `rewritten === expected`，
       不等 ⇒ 失败（**此时线上一个字都没动**）。
    3. **清单版本 V** = 改写后三份样式表的哈希（**沿用 wave-2 的算法**：
       `build-webfont-subsets.mjs` 里的 `manifestVersion()` 规则 —— 实现时**读那个函数**并保持一致，
       **不许另写一份**）。
    4. **幂等检查**：读线上 `fonts-manifest.json` 的 `version`；**等于 V** ⇒ 拒绝
       （`error`：「线上已经是这一份」），**不动线上**。
    5. `mkdir -p <live>/web/r<T>/{sans,serif,wenkai}`，复制 staging 的
       `web/<family>/*.woff2`（以及 `OFL-*.txt` 等许可文件）；
       ⚠️ **不覆盖任何旧目录**。
    6. **搭候选**：在 `os.tmpdir()` 下的临时目录里放三份**改写后**的样式表 +
       新 manifest（`version = V`）+ `web/r<T>/`
       （用**目录联接/符号链接**指向第 5 步建好的那个目录；Windows 上用
       `fs.symlink(target, path, 'junction')`；建不出来就**复制**，41 MB 可接受）。
    7. **跑 wave-2 的门禁**：
       ```ts
       await runCommand(
         process.execPath,
         [join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs')],
         {
           cwd: REPO_ROOT,
           env: {
             ...process.env,
             WEBFONT_FONT_DIR: candidateDir,
             WEBFONT_PAGE_COST: 'report',   // 候选的页面成本只报不算（spec §3.5.7）
           },
         },
       );
       ```
       ⚠️ 用 `process.execPath`（当前 node 的绝对路径），**不许**用 `'node'`（PATH 可能不同）。
       ⚠️ `WEBFONT_PAGE_COST: 'report'` **必须**在这里 ⇒ 候选的并集样本字节数
       会变（语料一变 Ext 块就整体移位）⇒ 拿「描述线上那份」的近零余量预算判失败
       = **任何一次语料变了的重建都会失败** = 功能不可用。
       ⚠️ **内禀校验照常判失败** ⇒ 候选缺字 / 块超宽 / CSS 超大 / face 太多 / 拉丁没覆盖
       **照样**让 apply 失败。
       ⚠️ 跑完后从 stdout 里解析那行 `[verify] pagecost: {…}` ⇒ 填进 `result.pageCost`；
       解析不出来就是 `null`（**不许编数字**）。
    8. **校验失败** ⇒ 删掉刚建的 `web/r<T>/`、删临时目录，
       `ok:false`，`error` 里**摘出**子进程输出里的关键行
       （取 `/^\[verify\] {3}(?!info:)/` 的行，最多 **10** 行，再带上最后一行
       `[verify] N error(s)`；**不许**把整段 stderr 糊给用户 ——
       stderr 可能含路径与内部信息）。
    9. **校验通过** ⇒ 才把三份样式表与 manifest 写进线上目录
       （**只有这一步会动线上**）⇒ 「apply 之后 verify 变红」这件事不可能发生。
    10. **清理**：列出 `<live>/web/` 下**以 `r` 开头**的目录，按**目录 mtime 倒序**排序
        （⚠️ 发布令牌 T 是哈希，**不是单调的** ⇒ **不许**按 T 排序）；
        保留**最近 3 份**（`keepReleases`，含当前这一份）；
        再保留**创建时间不超过 `maxAgeDays`（30）天**的其余目录；
        **两条都满足「可删」的**目录才删。
        ⚠️ **非 `r` 开头的目录（release 0 的 `sans/` 等）一个字都不许删**
        —— 那是旧样式表的依赖。
    11. 统计并返回 `summary`：apply 前 live 里 woff2 的**文件数 + 总字节**、
        新产物的**文件数 + 总字节**、新发布目录占用的字节；
    12. 返回 `swept`（被删掉的目录名）。
    13. ⚠️ **apply 过程一个字都不许写** `scripts/fonts/verify-webfont-subsets.mjs`
        或 `scripts/fonts/verify-webfont-subsets.d.mts`
        ⇒ 门禁预算**只能人工重新标定**（spec §3.5.7 推论三）。

- [ ] **Step 4: 改 `next.config.ts` 的 `/font/**` `max-age`**

  一年（31536000）→ **30 天**（2592000）。
  ⚠️ 必须在同一个文件里加一句注释说明理由：**版本令牌机制负责改版，字体文件不需要 immutable 一年**；
  保留 3 份发布目录 + 30 天 ⇒ 「缓存了旧样式表但没缓存某个 woff2」的访客不会拿到 404。

- [ ] **Step 5: 跑测试 + 类型检查** ⇒ 都 EXIT=0。

- [ ] **Step 6: 跑一遍既有字体门禁，确认没被影响**

  Run: `npm run fonts:verify-webfont`
  Expected: EXIT=0，输出与改动前**逐字节相同**。

- [ ] **Step 7: Commit**

  ```bash
  git add lib/webfont/apply.ts next.config.ts tests/unit/lib/webfont-apply.test.ts
  git commit -m "feat(admin): publish font builds as versioned release directories [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 7: API 路由 —— 构建 / 查询 / 取消 / 应用

**Files:**
- Create: `app/api/admin/webfonts/build/route.ts`
- Create: `app/api/admin/webfonts/build/[id]/route.ts`
- Create: `app/api/admin/webfonts/build/[id]/cancel/route.ts`
- Create: `app/api/admin/webfonts/build/[id]/apply/route.ts`
- Modify: `lib/audit-format.ts`（`AuditEvent` + `EVENT_LABEL` 加 4 个事件）
- Test: `tests/unit/app/api/admin/webfonts.test.ts`

**Interfaces:**
- Consumes:
  - `lib/webfont/jobs.ts` 的 `createJob / getJob / listJobs / appendLog / updateJob /
    findActiveJob / clearOldJobLogs / ensureStaleJobsMarked`（Task 3）；
  - `lib/webfont/capability.ts` 的 `probeCapability`（Task 4）；
  - `lib/webfont/pipeline.ts` 的 `runPipeline`（Task 5）；
  - `lib/webfont/apply.ts` 的 `applyStagedBuild`（Task 6）；
  - `lib/webfont/paths.ts` 的 `buildDirFor`（Task 5）。
- Produces:
- 路由契约（spec §5）：
  | 方法 | 路径 | 成功 | 失败 |
  |---|---|---|---|
  | `POST` | `/api/admin/webfonts/build` | `202 { ok:true, jobId }` | `409 { ok:false, error:{code:'job_active', message, jobId} }` |
  | `GET` | `/api/admin/webfonts/build` | `200 { ok:true, jobs:[…] }`（最近 **10** 条） | — |
  | `GET` | `/api/admin/webfonts/build/[id]` | `200 { ok:true, job }` | `404` |
  | `POST` | `/api/admin/webfonts/build/[id]/cancel` | `200 { ok:true, job }` | `409`（已结束） |
  | `POST` | `/api/admin/webfonts/build/[id]/apply` | `200 { ok:true, job, manifestVersion, releaseToken, releaseDir, summary }` | `409` / `500` |
- **入参用 zod 校验**（spec §5，与 `/api/admin/chars/generate` 同款）：
  `build` / `cancel` / `apply` 三个 POST **都没有请求体** ⇒
  用一个**允许空对象**的 schema 解析（`z.object({}).strict().optional()` 或等价写法），
  这样「body 里有未知字段」会被拒，而不是被静默忽略。
  ⚠️ `apply` **不许**接受任何自定义路径参数（防止把产物写到任意目录）。
- 新增审计事件（`lib/audit-format.ts` 的 `AuditEvent` 联合 + `EVENT_LABEL` 映射）：
  `'admin_webfont_build_started' | 'admin_webfont_build_failed' | 'admin_webfont_build_applied' | 'admin_webfont_build_apply_failed'`
  ⚠️ `lib/audit-format.ts` 里还有一张 `as const satisfies readonly AuditEvent[]` 的清单
  （约 `:163`）⇒ **两处都要加**，否则 `tsc` 报错。

**Steps:**

- [ ] **Step 1: 写失败的测试**

  用 `vi.mock('@/lib/auth')`（`requireAdmin` 返回 ok/401/403）、`vi.mock('@/lib/webfont/jobs')`、
  `vi.mock('@/lib/webfont/pipeline')`、`vi.mock('@/lib/webfont/apply')` 造假实现，断言：
  1. 未登录 ⇒ 401；非管理员 ⇒ 403（**两个都要测**）；
  2. `POST /build` 已有活跃作业 ⇒ **409**，响应体带 `jobId`；
  3. `POST /build` 无活跃作业 ⇒ **202**，且**后台**（不 await）跑起了 `runPipeline`；
  4. `POST /build/[id]/apply` 对一个 `status !== 'done'` 的作业 ⇒ **409**；
  5. 同一个作业**连续 apply 两次** ⇒ 第二次 **409**（幂等）；
  6. apply 成功 ⇒ 写了审计事件 `admin_webfont_build_applied`，metadata 里带**新版本号**；
  7. `POST /build/[id]/cancel` 对一个 `status ∈ {done, failed, cancelled}` 的作业 ⇒ **409**；
     对一个 `running` 的作业 ⇒ **200** 且作业状态变成 `cancelled`；
  8. `POST /build` 会调用 `clearOldJobLogs(20)`（spec §9.1：只留最近 20 条作业的完整日志）；
  9. `POST /build` 传了一个**未知字段**的 body ⇒ **400**（zod 生效，不许静默忽略）。

- [ ] **Step 2: 跑测试，确认失败** ⇒ FAIL（路由不存在）。

- [ ] **Step 3: 实现四个路由**

  - 全部：`const auth = await requireAdmin(); if (!auth.ok) return auth.response;`
  - 全部用 `withErrorHandling` 包住，错误响应形状统一为
    `{ ok: false, error: { code, message } }`（与 `lib/api-handler.ts` 一致）。
  - `POST /build`：
    1. `findActiveJob()` ⇒ 有 ⇒ 409（带那条作业的 id）；
    2. 生成 id（`crypto.randomUUID()` 取前 16 位十六进制，去掉 `-`）⇒ `createJob`；
    3. `clearOldJobLogs(20)`（spec §9.1：更早的作业清空 `log`，元数据保留）；
    4. **不 await** 地跑 `runPipeline({ jobId, callbacks, shouldStop })`，
       回调里 `appendLog` + `updateJob`；
       `shouldStop` = 读该作业的 `status`，`=== 'cancelled'` 就返回 `true`；
       ⚠️ 这条异步链**必须有 `.catch()`**：抛出的异常 ⇒ 作业标 `failed` +
       写审计 `admin_webfont_build_failed`（**不许**静默吞掉，让页面永远转圈）；
    5. 写审计 `admin_webfont_build_started`；
    6. 返回 202。
    ⚠️ **进程内互斥**：在 `globalThis` 上放一个标志（模块级 `Map` 在 dev 热重载后会丢 ⇒ 必须挂 `globalThis`），
    与 DB 闸门**两道都要有**。
    ⚠️ **闸门必须释放**：作业进入终态（done/failed/cancelled）时把 `globalThis` 标志清掉，
    否则一次失败会让后台永远起不了新作业。
  - `GET /build`（列表）：开头调 `ensureStaleJobsMarked()`（进程重启后清理僵死作业），
    再 `listJobs(10)`。
  - `POST /build/[id]/cancel`：
    1. 取作业；不存在 ⇒ 404；
    2. `status ∈ {done, failed, cancelled}` ⇒ **409**（已结束，取消不了）；
    3. `status ∈ {pending, running}` ⇒ 置 `cancelled` ⇒ 返回 200。
    ⚠️ **不许强杀子进程**（spec §9.2）⇒ 取消只改状态；
    正在跑的那一步自然跑完，下一步之前 `shouldStop` 生效。
    ⚠️ 取消**不是失败** ⇒ **不写** `admin_webfont_build_failed` 审计。
  - `POST /build/[id]/apply`：
    1. 取作业；不存在 ⇒ 404；`status !== 'done'` ⇒ 409；
    2. 作业已应用过（`releaseDir !== ''`）⇒ 409（幂等）；
    3. `applyStagedBuild({ jobId, stagedFontDir: buildDirFor(id) })`；
    4. 成功 ⇒ 更新作业（`manifestVersion`、`releaseDir`、`step='apply'`）+ 审计；
       响应里带上 `summary`（新旧文件数/字节数）；
       ⚠️ `releaseToken` **不许**为它在 `webfont_build_jobs` 上加一列 ——
       `releaseDir` = `r<T>` ⇒ 去掉前缀 `r` 就是 T（**不要**存两份会漂的数据）；
    5. 失败 ⇒ 作业标 `failed` + 审计 `admin_webfont_build_apply_failed` + **500**。

- [ ] **Step 4: 跑测试 + 类型检查** ⇒ 都 EXIT=0。

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/admin/webfonts lib/audit-format.ts tests/unit/app/api/admin/webfonts.test.ts
  git commit -m "feat(admin): expose the font pipeline over the admin API [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 8: 页面与导航

**Files:**
- Create: `app/admin/settings/webfonts/page.tsx`
- Create: `components/admin/WebfontPipelinePanel.tsx`
- Modify: `components/admin/AdminSidebar.tsx`（**只加一行**）
- Test: `tests/unit/components/admin/webfont-pipeline-panel.test.tsx`

**Interfaces:**
- Consumes: `WebfontJob` 类型（Task 3 的 `lib/webfont/jobs.ts`，**client-safe 的形状**
  —— 只含可序列化的字段，不许把 mysql2 的 `Date` 直接传给客户端组件）。
- Produces:
- `app/admin/settings/webfonts/page.tsx`（服务端）：
  ```tsx
  export const dynamic = 'force-dynamic';
  export default async function AdminWebfontsPage() { /* requireAdmin() → <AdminShell> → <WebfontPipelinePanel /> */ }
  ```
  ⚠️ 与 `app/admin/settings/fonts/page.tsx` **同构**（先读那个文件照抄结构）。
- `components/admin/WebfontPipelinePanel.tsx`（客户端，`'use client'`）：
  ```tsx
  export interface WebfontPipelinePanelProps { initialJobs?: WebfontJob[] }
  export default function WebfontPipelinePanel(props: WebfontPipelinePanelProps): JSX.Element
  ```
  职责：
  - 挂载时 `GET /api/admin/webfonts/capability` ⇒ 渲染**能力面板**（齐备 / 缺什么 / 怎么装）；
  - 「开始构建」⇒ `POST /api/admin/webfonts/build` ⇒ 拿 `jobId` ⇒ **每 1.5 s** 轮询
    `GET /api/admin/webfonts/build/[id]` ⇒ 状态变成终态就停；
  - 日志区**增量追加**（只渲染新增行）；
  - 「取消」按钮在 `status ∈ {pending, running}` 时可点 ⇒ `POST …/cancel`
    ⇒ 提示「已取消；正在跑的那一步会自己跑完」；
  - 「应用」按钮**只在** `status === 'done'` 时可点；
  - **应用面板**（spec §3.1 的第三块）必须显示：
    - staging 里的产物摘要（文件数 + 总字节）；
    - apply 后的**新旧 manifest 版本号**；
    - **两个令牌都要显示，并且要说清哪个是哪个**（裁定二十六-B）：
      - **发布令牌 T**（= 新发布目录名 `r<T>`）——「这一批字体文件放在哪个目录」；
      - **清单版本 V**（= 写进 manifest 的那个）——「HTML 里样式表的 `?v=` 会用它」；
      ⚠️ T ≠ V 是**正常的**（T 是改写前的哈希，V 是改写后的）⇒
      面板**不许**把两者混为一谈，也不许因为它们不同就报「异常」。
    - **新产物与当前线上产物的差异摘要**（文件数 + 总字节，spec §9.6）；
    - 磁盘占用（新发布目录 + 三份 release 合计）；
    - 一句明话（spec §3.5.5 的原意）：
      「样式表文件已经更新了（访客下次请求就会拿到新的），
      但 **HTML 里的令牌要等下一次构建/部署**才更新；
      现在不影响正确性，只是新版本还没有被令牌化。」
    - 一条**告警**（spec §7 风险表）：「apply 只改服务器上的文件，**不会**自动 commit；
      要让仓库与线上一致，请把 `public/font/` 的变更提交并部署。」
    - **新旧页面成本并排显示**（spec §3.5.7 推论三）：
      左列 = 候选产物在并集样本口径下的实测（`pageCost.bytes` / `pageCost.files`），
      右列 = **旧**预算（`pageCost.budgetBytes` / `pageCost.budgetFiles`），
      并写明：「这一组预算描述的是**线上那一份**产物；apply 之后服务器树里的
      `npm run fonts:verify-webfont` **会变红** —— 那是漂移探测器在正常工作，
      不是 bug。修法是**人工**把 `scripts/fonts/verify-webfont-subsets.mjs` 里的
      `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`
      更新成新的实测值。」
      ⚠️ **不许**提供「一键改预算」的入口（自动改 = 假绿灯）。
  - 离开页面**不取消**作业，但要提示「作业仍在运行」。

- [ ] **Step 1: 写失败的组件测试**

  按仓库的组件测试约定（happy-dom pragma + `cleanup()` + 动态 import）断言：
  1. 能力探针返回 `ok:false` 且 `missing` 非空 ⇒ 页面**显示**缺什么，
     且「开始构建」按钮 **disabled**；
  2. 探针返回 `ok:true` ⇒ 按钮可点；
  3. 轮询到 `status === 'failed'` ⇒ 页面**显示失败原因**（`error` 字段里的文字）；
  4. apply 成功响应里带新旧版本与 `summary` ⇒ 页面**同时显示**：
     新旧版本号、文件数/字节差异、以及「**不会**自动 commit」那句告警
     （缺任何一句都判红 —— 这三句是 spec §3.5.5 / §7 / §9.6 的硬要求）；
  5. apply 成功响应里 `releaseToken` 与 `manifestVersion` **不同** ⇒
     页面**照样正常显示**这两个令牌（不许报错、不许只显示一个）——
     这是裁定二十六-B 的**正常**状态。
  6. apply 成功响应里带 `pageCost`（含 `bytes` 与 `budgetBytes`）⇒ 页面**并排显示**
     这两组数字，并明写「这一组是**描述线上那份**的预算；要改的是
     `scripts/fonts/verify-webfont-subsets.mjs` 里的 `LIMITS.unionSampleBytes` 与
     `LIMITS.maxUnionSampleFilesPerPage`」——
     ⚠️ 缺任何一样都判红（spec §3.5.7 推论三）。
     ⚠️ 页面**不许**提供「一键改预算」的按钮 —— 自动改预算 = 假绿灯。

- [ ] **Step 2: 跑测试，确认失败** ⇒ FAIL（组件不存在）。

- [ ] **Step 3: 实现页面与组件**

  ⚠️ **轮询不许用 `setInterval` 叠加**：用 `setTimeout` 链（一次排一次），
  组件卸载时 `clearTimeout`。
  ⚠️ 轮询间隔 **1500 ms**。
  ⚠️ 页面文案**中文**；错误码原样显示，但**不显示**堆栈。
  ⚠️ **视觉沿用后台的「宣纸案牍」风格**（spec §6）⇒
  **先读 `app/admin/settings/fonts/page.tsx`，照抄它的容器 class 与排版**，
  不要另起一套样式。
  ⚠️ 服务端页面先 `requireAdmin()` ⇒ `listJobs(10)` ⇒ 把最近 10 条作为
  `initialJobs` 传给客户端组件（省掉首屏一次往返）。

- [ ] **Step 4: 加导航项**

  `components/admin/AdminSidebar.tsx` 的 `站点` 组（该组现在是
  站点设置 / 下载 / 语音设置）里加
  `{ href: '/admin/settings/webfonts', label: '网站字体', icon: <某个 lucide 图标> }`
  ⚠️ **`Type` 已经被「字源字体」占用**（`AdminSidebar.tsx:96`，在「内容」组）⇒
  这里**必须换一个不同的** lucide 图标（例如 `CaseUpper` / `Languages`），
  避免两个菜单项长得一模一样；并且**要 import 那个图标**。
  ⚠️ 加完「站点」组变 4 项，仍在「≤10 项/组」的扁平约定内。

- [ ] **Step 5: 跑测试 + 类型检查** ⇒ 都 EXIT=0。

- [ ] **Step 6: Commit**

  ```bash
  git add app/admin/settings/webfonts/page.tsx components/admin/WebfontPipelinePanel.tsx components/admin/AdminSidebar.tsx tests/unit/components/admin/webfont-pipeline-panel.test.tsx
  git commit -m "feat(admin): add the webfont pipeline page [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

### Task 9: 文档 + 收尾验证

**Files:**
- Modify: `deploy/OPTIMIZATION.md`（加一节「在后台重建字体」）
- Create: `docs/superpowers/notes/2026-10-31-admin-webfont-pipeline.md`（实施记录，**不是 spec**）

- [ ] **Step 1: 在 `deploy/OPTIMIZATION.md` 加一节**

  内容必须包含：后台页面的路径与用途、四步各自做什么、**缺能力怎么办**、
  **apply 之后为什么要 rebuild**、**apply 不会自动 commit**（仓库与线上会不一致）、
  以及「不要就地覆盖 `public/font/web/`」这条硬约束的理由。
  ⚠️ 还要写清**两个令牌**：发布令牌 T（发布目录名 `r<T>`）与清单版本 V
  （写进 manifest、给 HTML 的 `?v=` 用）—— **T ≠ V 是正常的**，
  以及**旧 release 的保留规则**（「最近 3 份」**且**「超过 30 天」才可删）。
  ⚠️ 还要写清**两个新增 env**（`WEBFONT_FONT_DIR` = 字体根目录、
  `WEBFONT_PAGE_COST` = 页面成本模式 `enforce`/`report`）与
  **「apply 之后仓库门禁会变红」这件事**：
  它是**漂移探测器**在正常工作，修法是**人工**重新标定
  `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`；
  后台**绝不**自动改预算（自动改 = 假绿灯）。

- [ ] **Step 2: 写实施记录**

  记录：实际实现与本计划的偏差（逐条）、验收 **12** 条的实测结果、
  以及**没做的事**（自动 commit、自动回滚、后台可调热区/块宽、
  **后台自动改门禁预算**）。
  ⚠️ **必须写进实施记录的披露**（裁定二十六）：
  「为了让后台重建字体不产生豆腐块，wave-2 的校验脚本的 URL 解析器被扩展了
  一种可选的发布目录；它在现有产物上的行为完全不变。」
  ⚠️ **必须写进实施记录的披露**（spec §3.5.7）：
  「wave-2 的校验脚本新增了一个模式开关 `WEBFONT_PAGE_COST`：
  `enforce`（缺省，仓库自己的行为一个字节都不变）与 `report`
  （后台的候选校验用；页面成本**只报不算**，内禀校验照常判失败）。
  候选校验**必须**用 `report` —— 并集样本的预算描述的是**线上那一份**产物，
  语料一变 Ext 块就整体移位 ⇒ 拿它判失败 = 任何一次语料变了的重建都会失败。」
  ⚠️ **必须写进实施记录的披露**（spec §3.5.7 推论三）：
  「apply 之后，服务器树里的 `npm run fonts:verify-webfont` **会变红** ——
  那是漂移探测器在正常工作。修法是**人工**重新标定
  `LIMITS.unionSampleBytes` / `LIMITS.maxUnionSampleFilesPerPage`；
  后台**绝不**自动改预算（自动改 = wave-2 修掉的假绿灯换个方向再来一次）。」

- [ ] **Step 3: 收尾验证（全部在仓库根或沙箱里跑）**

  ```bash
  npm test                                              # 期望全绿
  npx tsc --noEmit                                     # 期望 EXIT=0
  npm run fonts:verify-webfont                          # 期望 EXIT=0，输出逐字节不变
  # 沙箱构建（不动 4444 那棵树）
  git -C D:/Temp/pinyin-build-check checkout --force --detach <tip>
  rm -rf D:/Temp/pinyin-build-check/.next
  cd D:/Temp/pinyin-build-check && npm run build > build.log 2>&1; echo "EXIT=$?"
  ```

  然后**逐条对 spec §8 的 12 条验收**，在实施记录里写下**每条的实际结果**：

  | # | 验收项 | 怎么验 | 本机能验吗 |
  |---|---|---|---|
  | 1 | `fonts:verify-webfont` 逐字节不变 | 改动前后各跑一次，diff 输出 | ✅ 能 |
  | 2 | `npm test` 全绿 | 跑 | ✅ 能 |
  | 3 | `tsc --noEmit` EXIT=0 | 跑 | ✅ 能 |
  | 4 | `npm run build` 成功 | 沙箱里跑 | ✅ 能 |
  | 5 | 能力探针：缺 Python ⇒ 按钮不可点 | 单元测试注入假 `runCommand` | ⚠️ **注入式**；真机缺 Python 的情形**如实写「未在真机验证」** |
  | 6 | 四步流水线 + 断网 / 缺 fontTools 的失败文案 | 单元测试注入假实现 | ⚠️ 同上 |
  | 7 | apply 的五条（版本变 / 目录在 / release 0 未变 / URL 全改写 / 审计有记录） | Task 6 的测试 + Task 7 的测试 | ✅ 能（**文件级**；真机 apply 需要真机环境，**如实写**） |
  | 8 | 无豆腐块：旧样式表的每个 URL 仍 200 且字节一致 | Task 6 的测试（文件级）+ **真机 HTTP 级** | ⚠️ 文件级能；HTTP 级要真机，**如实写** |
  | 9 | 并发：两个 POST 只一个 202 | 单元测试 | ✅ 能 |
  | 10 | 权限：401 / 403 | 单元测试 | ✅ 能 |
  | 11 | 门禁相容性：未 apply 的仓库上 verify 逐字节不变 + 带发布目录的目录 14 条校验全照常生效 | Task 2 的测试 | ✅ 能 |
| 12 | 候选模式不削弱仓库门禁：`WEBFONT_PAGE_COST` 缺省 `enforce` ⇒ 仓库 verify 逐字节不变；`report` 下**内禀**校验照常判失败、页面成本**只报不算** | Task 1 的测试（块二：同一份超预算样本在 enforce 下红、在 report 下绿） | ✅ 能 |

  ⚠️ **不许把「注入式测试通过」写成「真机验证通过」**（G12）。
  凡是标了 ⚠️ 的条目，实施记录里**必须**写明「本机未做真实验证，原因：…」。

- [ ] **Step 4: Commit**

  ```bash
  git add deploy/OPTIMIZATION.md docs/superpowers/notes/2026-10-31-admin-webfont-pipeline.md
  git commit -m "docs(admin): document the webfont pipeline [$(date '+%Y-%m-%d %H.%M')]"
  ```

---

## 执行顺序与依赖

**推荐实施顺序（一个一个派实施者，不许并行）：**
`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`

**依赖关系：**

| 任务 | 依赖 | 为什么 |
|---|---|---|
| Task 2 | Task 1 | 测试要能**在别的根**上跑门禁 ⇒ 需要 Task 1 的 `WEBFONT_FONT_DIR` |
| Task 4 | — | 能力探针只依赖既有脚本，可与 1/2/3 并行**准备**，但实施仍按顺序派 |
| Task 5 | Task 1、Task 3 | 切分/校验要写进 staging（Task 1 的可覆盖根）＋ 校验要跑在 `report` 模式（Task 1 的页面成本模式）；作业类型来自 Task 3 |
| Task 6 | Task 1、Task 2、Task 5 | 候选校验要用可覆盖的根 ＋ `report` 模式（Task 1）；发布布局必须过门禁（Task 2）；路径常量来自 Task 5 |
| Task 7 | Task 3、Task 4、Task 5、Task 6 | 路由把四层串起来 |
| Task 8 | Task 3 | 面板要渲染 `WebfontJob` |
| Task 9 | 全部 | 收尾验证 |

⚠️ **Task 2 必须单独派实施者、单独过一次评审**（本波第一次动 wave-2 已封板的文件）。
⚠️ **不许并行派两个实施者**（同一个仓库 ⇒ 会互相踩工作区）。
