# 后台结构迁移 —— 实施记录（2026-11-20）

> ⚠️ **这份记录不是规格。**
> 它只说三件事：**实际做了什么**、**实测是多少**、**哪些没做到**。

| 项 | 值 |
|---|---|
| 分支 | `main`（**未 push**） |
| 提交数 | **7**（`0523667fa..3aff8391f`） |
| 运维手册的新一节 | `DEPLOY.md` §7.1「后台一键补齐(不用登录服务器)」 |

---

## 0. 一句话

给管理员一条**看得见结构差**的路：后台逐表逐列对比数据库与代码声明的结构，
**点名**缺了什么，并一键跑迁移补上。

---

## 1. 起因

2026-11-20 用户问「初始化完成后，复制代码上去会升级架构吗」。

答案：**不会**。而且坏得很隐蔽：

- `/init` 向导走完后**自我锁死**（`setup.route_enabled='false'`）
- 每次启动跑的 `initDb()` **只建基础表**，不读 `scripts/migrations/*.sql`
- ⇒ 只在新迁移文件里加的表/列，**永远不会被创建**
- ⇒ 启动不崩、不相关页面照常工作，只有用到新表的那一块报 `ER_NO_SUCH_TABLE`
- ⇒ `/admin/init` 的「必需表」检查项**显示全绿**（它只数表数量，**缺列根本不动那个数**）

最后一格是这次改动的核心价值：**一个不会说出自己坏在哪里的健康检查，比没有检查更糟**。

---

## 2. 做了什么

| 提交 | 内容 |
|---|---|
| `0523667fa` | `lib/schema-expectations.ts` —— 期望值**从仓库自身推导**（`scripts/init-db.ts` 的 DDL + `scripts/migrations/*.sql`） |
| `61132676e` | `lib/schema-check.ts` —— 逐表逐列对比，只缓存成功结果，失败可重试 |
| `5d8f1854b` | `app/api/admin/migrate/route.ts` —— `requireAdmin()` 守卫 + 审计日志 |
| `0eff475ef` | `components/admin/SchemaMigratePanel.tsx` —— 点名显示缺什么 + 一键迁移 |
| `df1a72614` | `app/admin/seed/page.tsx` —— 面板挂到「数据结构」区块 |
| `de5186fc4` | `lib/init-checklist.ts` —— **「必需表」检查项改成点名**，探针失败报**失败** |
| `512423478` | **真机暴露的三个解析 bug**（见 §4） |
| `3aff8391f` | `DEPLOY.md` §7.1 |

### 为什么期望值从仓库推导，而不是手写清单

手写的期望值放在一个会动的目标旁边必然漂移。而仓库里有**两个**建表的地方
（基础 DDL + 增量迁移），所以规则必须说清楚谁说了算 ——
见 `lib/schema-expectations.ts` 的「Which version of a table counts」。

---

## 3. 实测

### 真机（`pinyin_test` 库，`npx tsx` 直连）

```
=== compareSchema() ===
upToDate: true
tables: 36 / expected 36
columns: 293 / expected 293
missingTables: 0
missingColumns: 0
```

### 单元测试

- `tests/unit/lib/schema-expectations.test.ts` —— 23
- `tests/unit/lib/schema-check.test.ts` —— 8
- `tests/unit/app/api/admin/migrate.test.ts` —— 9
- `tests/unit/components/admin/SchemaMigratePanel.test.tsx` —— 6
- `tests/unit/app/admin/seed/page.test.tsx` —— 4
- `tests/unit/lib/init-checklist-schema.test.ts` —— 7

**全套**：2810 通过 / 21 跳过 / 1 超时（`client-server-boundary.test.ts` 的 5s
超时，既有问题，非回归 —— 已用 stash 对照实测：基线 1.75–1.83s，改动后
1.69–1.90s，单独跑 26/26 绿）。

### HTTP 真机（未登录）

```
/api/admin/migrate  GET   → 401 {"code":"unauthenticated"}   ← fail-closed
/api/admin/migrate  POST  → 401，且没有执行任何迁移
/admin/seed                → 307 → /?auth=login
```

---

## 4. 真机暴露的三个 bug（单元测试全绿时看不到）

**注入测试骗了我。** 真机 probe 报 7 个「缺列」，而库里的结构是完整的。

| # | bug | 症状 | 根因 |
|---|---|---|---|
| 1 | **转义反斜杠没解** | `chars.char` 等 7 个真列被报成缺失 | 基础 DDL 在 JS 模板字符串里，源码里 MySQL 的标识符引号是 `` \` ``。解析器读文件**文本**，把反斜杠留在了列名里 |
| 2 | **关键字列名被丢弃** | `app_config.key` 不在期望里 | `key` 是保留字，所以列名带反引号；而解析器按裸词匹配「约束关键字」列表，把这个**列**当成了索引 |
| 3 | **被取代的表版本被当成期望** | `classics.chunks` / `chunk_count` 永久假阳性 | 迁移文件建的是旧版 `classics`（带 `chunks`），当前基础 DDL 建的是新版（不带）。基础 DDL 每次部署先跑，`CREATE TABLE IF NOT EXISTS` 不改已存在的表 ⇒ `chunks` **永远不会出现**，而期望一直要求它 |

第 3 条尤其重要：**它会报告一个永远缺、且点「运行迁移」也修不好的列** ——
正是这个特性要消灭的那类假阳性。

修复后：期望与真实库**完全一致**（36/36 表、293/293 列、零缺失）。

### 教训

> **「期望值从仓库推导」把仓库自身的不一致也带进来了。**
> 推导出来的期望必须再问一句：**这条期望真的会被实现吗？**
> `CREATE TABLE` 声明的列只在表不存在时才会到达数据库；
> `ALTER TABLE ADD COLUMN` 才无条件生效。

### 另一个教训：转义地狱

写测试时用 `String.raw` 复现文件里的**字节**。普通模板字符串会在**构造时**
把 `` \` `` 吃掉，于是测的是另一个输入 —— 而且这个测试会**绿**，
因为解析器正好处理了那个形态。

另外，heredoc 里写正则字面量 `\\` 会被 shell 吃掉一层。
用 `String.fromCharCode(92, 96)` 构造，或直接用 Edit 工具写文件。

---

## 5. 没做到 / 待办

- **浏览器走查没做** —— 需要一个已登录的管理员会话；签发 session cookie
  属于签发凭证，被权限策略拦下。已用 HTTP 真机（401/307）+ 组件测试
  （渲染、按钮、错误展示、重复点击防护）覆盖其余部分。
- **没有把 `/api/admin/migrate` 的 GET 用在页面上** —— 页面走的是服务端
  `compareSchema()`，省一次往返。
- **后台迁移不写审计到 `metadata.title` 之外的字段** —— 只记了文件数与语句数，
  没有记「迁移前缺什么、迁移后缺什么」。

---

## 6. 相关

- 记忆：`checklist-count-blind-spot`（数量代替点名的盲区）、
  `init-wizard-covers-migrations-and-seed`（向导自锁 ⇒ 复制代码不升级 schema）、
  `missing-table-is-a-state-not-a-failure`、
  `real-machine-vs-injection-tests`（注入测试不够，要真机）
