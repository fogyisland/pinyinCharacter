# 教学功能扩展 —— 实施记录（2026-11-21 → 2026-11-22）

分支：`main`（全部本地提交，**未 push**）
基线：`103c24aee`（听写 spec）→ 当前 `a22b1947b`

这一轮做的是「从工具站变成能带班上课的平台」。六次提交，全部 TDD、
全量测试绿、真机走查过、未 push。

---

## 一、提交清单

| 提交 | 内容 | 关键数据 |
|---|---|---|
| `ca5af03da` … `c50518a00` | **听写练习**（5 次提交：spec/plan、词条层、卷面+表单、报听写、收尾） | 答题卷与答案页同源渲染、编号 1:1；错词闭环；A4 一页 10 条 |
| `d09ab8b7d` | **拼音 → 汉字**（声调感知解码） | 1548 音节桶 / 339 KB；教师句集 **2/15 → 8/15** |
| `901c800ff` | **今日复习**（生字本复习曲线） | 0-1-2-4-7-15 天；答对进阶、答错回今天 |
| `851c2ef07` | **组词**（字典词级内容） | 2449 字 / 11073 词 / 0.5 MB |
| `bbca66cf6` | **形近字辨析** | 3500 一级字扫描 1.9 秒；2207 字 / 10572 条 / 54 KB |
| `e075b20d1` | **班级与作业（第一期）** | 3 张表 + 8 个路由 + 2 个页面；63 个新测试 |
| `a22b1947b` | **顶栏固定一行** | 三处像素回收，11 个宽度实测一行 |

测试规模：起步 3152 → 现在 **3398 passed / 21 skipped / 0 failed**。

---

## 二、明天要继续的三件事

### 1. 班级作业的「学生完成状态」（用户明确要求「整套体系完整」）

**现状**：第一期只做了「老师派作业 + 成员看到作业列表」。**没有**提交/完成状态，
所以老师看不到「谁做完了」。

**待补**：
- 新表 `class_submissions`（`assignment_id` + `user_id` + `completed_at` + 可选 `note`）
- 迁移 `scripts/migrations/2026-11-22-class-submissions.sql`（幂等，参考
  `2026-11-21-classes.sql` 的写法）
- `lib/classes-store.ts` 加 `recordSubmission` / `listSubmissions` / `clearSubmission`
- 路由 `POST /api/classes/[id]/assignments/[assignmentId]/submit`（学生提交）
- 班级详情页显示进度：`已完成 8 / 12 人`，逐行标「已完成/未完成」
- 老师看板（可选）：一页看到多个班的完成率

**⚠️ 开工前必须先问用户一个问题（未决）**：
> 「完成」怎么算？
> - A. 学生点「我练完了」手动勾选（最省事，也最诚实）
> - B. 点过「打印字帖」自动算完成（可追踪，但打印不等于练）
> - C. 听写作业按分数阈值判定（需要听写结果落库，目前听写结果是浏览器内存态）
>
> 我的建议是 **A 为主 + B 为辅**：手动勾选是学生自己的承诺，打印作为佐证显示
> 「已打印」而不作为完成条件。听写若要按分数判定，得先把听写结果持久化
> （那是另一项工作：`dictation_results` 表 + 报听写结束后 POST）。

### 2. 剩下两个优先级方向（用户此前排序中尚未做）

- **C. 例句**：组词已有「词」，但没「句子」。数据可用 Tatoeba 中文语料（CC-BY），
  做 `{ word: [ { zh, en } ] }` 表，字典页在组词旁显示 1-2 条例句。
  体量估：5000 常用词 / 10k 句，先只覆盖一级字与 HSK1-3。
- **D. 语音评测**：学生朗读打分纠声调。依赖外部服务（Azure Pronunciation
  Assessment 或同类），涉及**成本 + 隐私**，需要用户明确授权才开工。

### 3. 四个缺内容的常规字（几分钟即可）

`data/content/` 覆盖 7905 / 8105。缺的 200 个里 **196 个在增补平面**
（详情页已有「字库不支持该字符」空态），**只剩 4 个 BMP 字**：

```
乜  亟  龠  齉
```

其中「齉」连 `public/strokes` 都没有。用现成的后台接口补：

```
POST /api/admin/chars/generate
{ "chars": ["乜","亟","龠","齉"], "fields": { "etymology_story": true } }
```

接口内部每条间隔 1 秒，四条几秒钟。**注意**：`齉` 缺笔画数据，字源页的
字形演变会只剩楷书，这是数据缺失不是代码 bug。

---

## 三、这一轮踩到的坑（都已修复，记下来免得重犯）

### 1. client 组件 import 带 `node:fs` 的模块 → `next build` 在 chunk 生成阶段失败

两次踩到同一个坑：

- `lib/pinyin-tone-decode.ts` 里放 `readFileSync`，被 `PinyinFullSentence`
  （`'use client'`）import → `/pinyin` 页面 500
- `lib/look-alike-data.ts` 里放 `readFileSync`，被 `DictionaryDetailTabs`
  用**仅类型导入**（`import type`）引用 → 同样 500

**教训**：`import type` 也会被 bundler 追踪。**修法**：纯逻辑与数据读取分成两个
文件（`pinyin-tone-decode.ts` 纯 / `pinyin-tone-data.ts` 读盘；
`look-alike.ts` 纯 / `look-alike-data.ts` 读盘），类型声明放在**纯模块**里。

**这类错误单测看不见**，只有 `npm run build` 或真机走查能抓到。

### 2. `data/look-alikes.json` 曾经不对称（1160 对）

两侧各自截断 top-12 → 「十」列了「未」而「未」没列「十」。修法：**双向都保留
才留**（先各自排序截断，再只保留互指的配对）。

### 3. 形近字预过滤误杀 白/自

签名用「字符自身尺寸」分桶 → 自比白高，同样的笔画落进不同桶。修法：按
**字自身包围盒归一化**（0..1），gap 上限 2→3。

### 4. `mysql2` 的 `DATE` 列会偏一天

`DATE` 读成本地午夜的 `Date`，`JSON.stringify` 变 UTC 时间戳，东八区看到
截止日早一天。修法：存储层统一格式化成 `YYYY-MM-DD`，出了存储层不再有 `Date`。

### 5. 顶栏换行的真因是「·」分隔点

9 个「·」= 108px，正好是溢出的量。别再用分隔符表达分组，用 `ml-*` 组间距。

### 6. 全量测试默认 5s 超时在满并发下会假失败

用 `npx vitest run --testTimeout=60000`。个别真慢的测试（如
`build-look-alikes.test.ts` 读 3500 个文件 ≈6s）自己在 `it()` 里声明
`{ timeout: 30_000 }`。

### 7. `.worktrees/**` 会被 vitest / eslint 当源码扫

已在 `vitest.config.ts` 与 `eslint.config.mjs` 的 exclude 里排除。

### 8. 无头 Chrome 的 CDP 走查里，`RECONNECT` 后 `Network.setCookie` 必须在导航前

`.tmp/*-walkthrough.mjs` 的脚本都是「先 `Page.navigate` 到 about:blank →
`Network.setCookie` → 再导航到目标页」。顺序反了会跳 `/init`。

---

## 四、数据资产一览（这一轮新增的）

| 文件 | 大小 | 生成命令 | 内容 |
|---|---|---|---|
| `data/pinyin-tone.json` | 339 KB | `npm run dict:tone` | 1548 带调音节 → 按 jieba 真实频率排序的字 |
| `data/char-words.json` | 0.5 MB | `npm run dict:words` | 2449 字 → 最多 10 个词（含拼音） |
| `data/look-alikes.json` | 54 KB | `npm run lookalike:build` | 2207 字 → 最多 12 个形近字（对称） |

三个构建脚本都从公网拉语料，**都带 CDN 镜像 + 重试**（`raw.githubusercontent.com`
在这台机器上会 TLS reset，`cdn.jsdelivr.net` / `fastly.jsdelivr.net` 可用）。

派生的验收数字（复现方式）：

```
npx tsx .tmp/measure-tone.ts        # 声调解码：8/15
npm run lookalike:build             # 形近字：2 秒建完
node .tmp/probe-header-nav.mjs      # 顶栏：11 个宽度全 rows=1
```

---

## 五、环境备忘

- dev server：`npm run dev`（**4444**）。启动后要先访问 `/init` 或带
  `setup_completed=1` cookie，否则中间件会跳转。
- **dev server 活着时绝不 `npm run build`**（`.next` 会被清，dev 会 500）。
- 端口 4444 上经常残留上一次 dev 的 node 子进程，表现为
  `EADDRINUSE`：`netstat -ano | Select-String ":4444"` 查 PID，
  `taskkill /PID <pid> /T /F` 清干净再起。
- 项目里同时跑着别的 Next 项目（`PudaFo:8888`、`VoiceMake:4888`、
  `Stockbouns:9002`），**不要误杀**。

### 顺带：VoiceMake 的「一直在刷新」

那不是本仓项目。症状是 `packages/voice-web/.next/dev/logs/next-development.log`
里反复出现 `Hydration failed` + `Encountered a script tag while rendering`。根因是
`voice-languages.ts` 用 `localeCompare` 排序原生语言名（服务端 Node 与浏览器
ICU 顺序不同）→ `<option>` 顺序两侧不一致 → React 整树重建 → 看起来像无限刷新。
修法（已在 VoiceMake 工作树里改了但**未提交**）：`compareLanguageNames()`
（lowercase → NFD 去变音符 → 按码点比较）。**明天若要处理，记得先确认那边
的改动是否已提交**。

---

## 六、用户未决的问题（明天开工先问）

1. **作业「完成」的判定口径**（见上，A/B/C 三选）
2. 是否继续做 **D 语音评测**（涉及外部付费服务 + 隐私）
3. 是否 **push 到 `origin/main`**（目前有 40+ 个本地提交未推送）
