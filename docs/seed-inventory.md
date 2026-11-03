# 内容 seed 对账表

> 核对日期：2026-11-03　核对方式：读代码 + 读 `DEPLOY.md`，未连库。
> 目的：为「所有内容都是 seed ＋ 支持手动导入」建立**唯一权威清单**。

## 结论速览

| # | 数据集 | 规模 | 目标 | seeder | 每次启动自动跑？ | `DEPLOY.md §9` 怎么说 |
|---|---|---|---|---|---|---|
| 1 | HSK 分级 | 2632 | `chars.hsk_level` | `scripts/import-hsk.ts` | ❌ **否** | "必跑" |
| 2 | 通用规范汉字 | 8105 | `chars` | `init-db.ts::initChars` | ✅ 是 | 未列 |
| 3 | 罕用字 | 1412 | `rare_chars` | `init-db.ts::initRareChars` | ✅ 是 | **"仓库里暂无 seeder 脚本"（过期）** |
| 4 | 古籍 | 196 | `classics` | `init-db.ts::initClassics` | ❌ **函数存在但 `initDb()` 没调用** | "必跑 build-classics*" |
| 5 | 诗词 | 1165 | `poems` | `init-db.ts::initPoems` | ✅ 是 | 未列 |
| 6 | 经文 | 12 | `sutras` | `init-db.ts::initSutras` | ✅ 是 | 未列 |
| 7 | 字源 etymology | 7905 | `char_etymology` | `init-db.ts::initCharEtymology` | ❌ **函数存在但 `initDb()` 没调用** | "必跑 import-content.ts" |
| 8 | 部首 | — | `chars.radical` | `scripts/import-radicals.ts` | ❌ 否（`radicals:import` 是独立 npm script） | 未列 |
| 9 | app_config 默认 | — | `app_config` | `init-db.ts::initAppConfig` | ✅ 是 | 未列 |
| 10 | 激活 singleton | — | `activate` | `init-db.ts::initActivate` | ✅ 是 | 未列 |

### 自动 seed 的实际入口

`instrumentation.ts` → `lib/setup.ts::isSetupComplete()` → `scripts/init-db.ts::initDb()`。

`initDb()` 的调用序列（实测自 `scripts/init-db.ts:892`）：

```
initTables → initAppConfig → initPoems → initSutras
→ initChars → initRareChars → initActivate
```

`initClassics` 和 `initCharEtymology` **都不在这个序列里**。

## 四个确凿的缺陷

**① `initCharEtymology()` 从未被调用**（真 bug）

`scripts/init-db.ts:762` 定义了它，但 `initDb()` 的调用序列里没有它
⇒ 字源永远不会被自动 seed ⇒ 这解释了为什么 `DEPLOY.md §9` 第 3 条
让运维去跑 `import-content.ts`：因为自动路径根本没实现。

**② `initClassics()` 同样从未被调用**

`scripts/init-db.ts:580` 定义了它，`initDb()` 里也没有。
⇒ `classics` 表只能靠 `build-classics.ts` 手工灌。

**③ `DEPLOY.md §9` 与代码不符（两处）**

- 第 4 条说 rare_chars "**仓库里暂无 seeder 脚本**" —— 实际
  `init-db.ts::initRareChars()` 存在且**每次启动自动跑**。注释过期。
- 第 3 条让运维跑 `import-content.ts` —— 但字源的自动 seeder
  `initCharEtymology()` 同样存在，**只是 `initDb()` 里忘了调用它**。
  两条路指向同一件事，而文档描述的是没有自动路径的那个版本。

**④ 所有 seeder 都是「有行就 skip」，不会修复半成品**

`initChars` / `initRareChars` / `initPoems` / `initClassics` / `initSutras`
统一是 `COUNT(*) > 0 → skip`（`scripts/init-db.ts:559,583,604,628,695`）。
⇒ 表里有 **1 行**也算"已 seed"，永远不补齐。
⇒ 部分导入的库会一直保持残缺，而所有检查项都显示"非空 = 就绪"。

（唯一的例外是 `initCharEtymology` —— 它用的是
`LEFT JOIN ... WHERE e.char IS NULL` 补洞逻辑，
**但正因为 ① 它从来没生效过**。）

## 「手动导入/追加」的现状

| 能力 | 现状 |
|---|---|
| 命令行导入 | ✅ 有脚本，但散落、无统一入口；`import-hsk` 连 npm script 都没有 |
| 后台页面导入 | ❌ **没有** —— `/admin/chars` 只有 `generate/` 子页 |
| 后台查看覆盖率 | ✅ `/admin/chars` 有 `getContentCoverage()`，只统计字库覆盖率 |
| 后台手动加单个字 | ✅ `/admin/chars/generate` |
| 幂等性 | ✅ 大多 `INSERT ... ON DUPLICATE KEY` / `INSERT IGNORE` |
| 进度可观测 | ❌ `scripts/show-stats.ts` / `check-progress.ts` 散落，不在发布流程里 |

`package.json` 里与内容相关的 npm script 只有：
`chars:import`、`radicals:import`、`build:classics`、`poetry:build`、
`sutras:build`、`dict:build`。**没有 `import-hsk`。**

## 缺口清单

### A. 统一 seed 清单（单一事实来源）

把上表变成代码里的**一份清单**，而不是文档和代码各一份。
建议 `scripts/seed-registry.ts` 导出数据集描述数组
（名称 / 数据来源 / 目标表 / seeder / 规模 / 是否自动），
让 `init-db.ts`、`/admin/init` 检查清单、发布脚本**全部读它**
⇒ 新增数据集时只改一处，三处自动同步。

### B. 补齐自动 seed

- `initDb()` 里补上 `initCharEtymology()`（缺陷 ①）
- `initDb()` 里补上 `initClassics()`（缺陷 ②）
- 新增 `initHskLevels()`：批量 UPSERT，缺失才灌
  （现 `import-hsk.ts` 是 2632 次单条往返，放启动路径上太慢）
- `radicals` 是否自动灌，待定

### C. 「有行就 skip」改成「够才算 seed」

每个 seeder 声明**期望规模**，与实际比对：
- 达标 → skip
- 不足 → **补齐差额**（而不是全跳过）
- 超出 → 只报，不删

这同时修掉缺陷 ④，也是 `/admin/init` 第 13 步（HSK 覆盖检查，
已在 `f051eff4a` 加入）能真正用起来的前提。

### D. 后台手动导入入口

`/admin/chars` 加"导入"页：选数据集 → 显示覆盖率与缺口 → 触发导入
→ 进度与结果。要求**走同一份 registry**，复用同一批 seeder，
不另写一套逻辑。

### E. 就绪度作为可验证的断言

把"内容就绪度"收敛成一个查询（每个数据集：期望 / 实际 / 缺口），
由 `/admin/init` 与发布脚本共用；发布脚本据此决定"这次发布的数据是齐的"。

## 待定的问题

1. **哪些数据集属于"内容 seed"？** 上表 10 条都算，还是排掉
   `app_config` / `activate`（那是配置不是内容）？
2. **缺额时自动补，还是只报告？** 自动补 = 启动时写库；
   只报告 = 需要人 / 发布脚本触发。
3. **"手动导入"走 CLI 还是必须做后台页面？** 后台页面工作量大得多，
   但普通管理员没有服务器 shell。
4. **单次补齐耗时是否可接受？** `data/content/` 7905 个文件、
   196 本古籍。当前都是"缺才灌"，正常启动是零成本；
   首次补齐是另一回事。
