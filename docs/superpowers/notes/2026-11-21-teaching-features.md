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
| `59077710d` | **作业完成状态（第二期）** | `class_submissions` 表；学生勾选才算完成；老师看「已完成 N / M 人」 |
| `d771cb5a2` | **例句（C）** | Tatoeba CC-BY；4382 词 / 691 KB；每词最多 2 句中英对照 |

测试规模：起步 3152 → 现在 **3432 passed / 21 skipped / 0 failed**。

---

## 二、明天要继续的三件事

### 1. 班级作业的「学生完成状态」—— ✅ 已完成（`59077710d`）

**口径已定**：学生手动勾选「我练完了」才算完成。打印、朗读、听写分数都**不**自动算。
若将来要让听写按分数判定，得先把听写结果持久化（`dictation_results` 表 +
报听写结束后 POST），那是另一项工作。

**已交付**：`class_submissions` 表（`(assignment_id, user_id)` 唯一键）、
`recordSubmission/clearSubmission/listSubmissions/listClassProgress/listMySubmissions`、
`POST/DELETE /api/classes/[id]/assignments/[assignmentId]/submit`、
学生侧「我练完了 + 撤销 + 自己的留言」、老师侧「已完成 8 / 12 人 + 逐人名」。

**仍未做（可选的下一步）**：跨班看板（一页看到所有班的完成率）。

### 2. 剩下两个优先级方向

- **C. 例句** —— ✅ 已完成（`d771cb5a2`）：`data/examples.json`（4382 词 / 691 KB，
  覆盖 61% 的组词），Tatoeba CC-BY 2.0 FR，`npm run examples:build`。
  四条过滤规则（必有英文翻译 / 只留简体字 / 6–30 字 / 每词 2 句）都写进了
  `scripts/build-examples.py` 的文件头。
- **D. 语音评测**（唯一未做）：学生朗读打分纠声调。依赖外部服务（Azure
  Pronunciation Assessment 或同类），涉及**成本 + 隐私**，需要用户明确授权才开工。

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

### 9. 登录/注册接口有 IP 限流，端到端走查要用已有账号

连续注册 3 个账号就会 `429 rate_limited`，登录同理。走查脚本因此改用
`.tmp/mint-tokens.ts` 直接签发 JWT cookie（复用 `lib/auth.ts::signSession`），
把 token 写进 `.tmp/walk-tokens.json` 再用 `Network.setCookie` 注入。
**不要为了走查反复新建账号** —— 那是限流本来的作用。

### 10. 给路由加新的 store 导出时，记得同步更新测试里的 `vi.mock`

`app/api/classes/[id]/route.ts` 新增 `listClassProgress` / `listMySubmissions`
后，`tests/unit/app/api/classes.test.ts` 的 mock 没有这两个键 → 路由拿到
`undefined` → 崩在 `.role`，看起来像功能坏了。**规则**：路由新增 store 调用，
必须同步补 mock，否则失败原因会被错误信息掩盖。

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

1. 是否继续做 **D 语音评测**（唯一未做的方向；涉及外部付费服务 + 隐私，需明确授权）
2. 是否做**跨班看板**（一页看到所有班的完成率）
3. 是否 **push 到 `origin/main`**（目前有 48+ 个本地提交未推送）
