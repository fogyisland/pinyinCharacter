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
| `5b7062e43` | **跟读（D）** | 浏览器 SpeechRecognition（Edge 上即微软语音）+ 本站自比对；逐字判定 exact/tone/similar/wrong |
| （本轮） | **Azure 音素级精评（D+）** | 可选付费路径；音节级分数；配额；后台配置 + 测试连接 |

测试规模：起步 3152 → 现在 **3614 passed / 21 skipped / 0 failed**。

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
- **D. 语音评测** —— ✅ 已完成（`5b7062e43`）：`lib/pronunciation.ts`（逐字判定 +
  滑窗对齐）、`lib/pronunciation-client.ts`（浏览器 SpeechRecognition 封装）、
  `components/dictionary/PronouncePanel.tsx`。
  首版**没有用 Azure Pronunciation Assessment**（当时没有订阅）：识别走
  **浏览器自带**（Edge 上即微软语音，无 key、录音不出浏览器），打分用
  **本站自己的规则**（字级判定）。
- **D+ Azure 音素级精评** —— ✅ 已完成（2026-11-23）：用户提供订阅与后台配置后
  在免费路径之上加了一条**可选的付费路径**。见下一节。

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

## 二之二、Azure 音素级精评（2026-11-23）

用户提供订阅 + 后台配置后，在「跟读」之上加了一条**可选**的付费路径。
它不是替换，是叠加：没有 key 的站点仍然是原来那套（浏览器识别 + 本站判定）。

### 分层

| 文件 | 职责 |
|---|---|
| `lib/azure-speech.ts` | 配置读取（DB 优先、env 后备）、失败分类、评估头、每日上限、**凭据验证** |
| `lib/azure-assessment.ts` | 调 Azure 短音频端点、把冗长回复压成三层（词/音节/音素） |
| `lib/speech-types.ts` | 纯类型（**无 import**）—— 面板要 import，`import type` 也会被 bundler 追踪，这是本仓踩过两次的坑 |
| `lib/speech-store.ts` | 记分（谁/哪词/四分）、数今日次数（配额的唯一来源） |
| `lib/pronunciation-recorder.ts` | Web Audio 录音 → 单声道 → 16 kHz → WAV |
| `lib/api-speech.ts` | 客户端封装（状态探测返回 **两个** 布尔） |
| `app/api/speech/assess/route.ts` | GET 探测 + POST 打分（登录、配额、大小） |
| `app/api/admin/speech/config/route.ts` | 后台读写配置（key 永不回显、空值不清空、region 校验） |
| `app/api/admin/speech/verify/route.ts` | 测试连接（只测已存的那组，打令牌端点，不计费） |
| `components/admin/SpeechConfigForm.tsx` | 三个字段 + 测试连接 + 判定结果 |
| `app/admin/speech/page.tsx` | 配置页 + 「怎么拿到区域和密钥」四步 |
| `scripts/migrations/2026-11-23-speech-assessments.sql` | 记分表 |

### 五个决定（都有理由，不要随手改）

1. **录音只到本站，不到浏览器直连 Azure。** key 在服务端，浏览器永远拿不到。
   录音存在内存里、随请求丢弃，不落盘、不进日志。
2. **没有 key 时按钮根本不出现。** 不是灰掉、不是点了报错 —— 上传声音必须
   是显式选择的结果，不能是「代码能做就做了」。
3. **检测返回两个布尔**：`configured`（站长配了 key）与 `loggedIn`（调用者有
   会话）。合成一个会让面板要么给游客一个必然 401 的按钮，要么把已付费的
   功能对所有人藏起来。走查实测这两种文案都对。
4. **每日上限是配额，不是礼仪。** Azure 按音频秒计费；成功才记一条，
   400/429/5xx 都不记（那些没花钱）。`0` = 不限。
5. **失败分六类，每类对应动作**：auth 去后台改 key、rate-limit 等一下重试、
   upstream 稍后再试、unconfigured 回退免费路径、bad-request 重读、unknown 兜底。
   一个 429 报成「密钥错误」会让管理员去改一个没问题的密钥。

### 测试连接查的是「已存的那组」

表单里 key 框永远是空的（读不到已存值）。所以 verify 只能测**已保存**的
region+key。这不是妥协：它语义明确，也不用把密钥在浏览器里多传一次。
测试打 `https://<region>.api.cognitive.microsoft.com/sts/v1.0/issueToken`
—— 只验凭据、不收音频、**不产生计费**。401 的文案必须同时点名 region 和 key：
两者都在同一页复制，错 region 产生的 401 与错 key 一模一样。

### 顺手修的两个真问题

- **`unauthorized()` 会说英文 `unauthorized`**，学生看到的是一句英文。
  改成 `unauthorized('login_required', '精评需要登录后使用。跟读不需要登录，可以先用它。')`。
- **`buildAssessmentHeader` 缺 `EnableProsodyAssessment`**：Azure 不给
  `ProsodyScore`，声调/语调错误会被当成满分。补上 `Dimension: 'Comprehensive'`
  + `EnableProsodyAssessment: true`。

### 验收

- 全量 **3614 passed / 21 skipped / 0 failed**（+129 个新测试）
- lint 0 errors、tsc 干净
- 迁移已应用：31 文件 / 77 语句（新增 `speech_assessments`）
- 真机走查 `.tmp/azure-speech-walkthrough.mjs`：
  ```
  /admin/speech：三个字段 ✓ key 是 password 且为空 ✓ 测试连接禁用 ✓
                 门户四步文案 ✓ F0 免费层 ✓ 不落盘说明 ✓
  DOM 里没有 key 的回显 ✓
  字典页（无 key）：无「精评」按钮、无「需要登录」、无上传提示，免费路径在 ✓
  字典页（有 key + 游客）：无「精评」按钮、「需要登录后使用」在、无上传提示 ✓
  390px：无横向滚动、三个字段都在视口内 ✓
  console errors 0
  ```

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

### 11. `useState(() => 探测浏览器能力())` 会 hydration mismatch

`PronouncePanel` 最初写 `useState(() => isSpeechSupported())`：服务端没有
`window` → false，客户端 → true，React 报 `Hydration failed` 并重建整棵树
（每个字典页 3 条 Uncaught）。**规则**：任何只在浏览器成立的能力探测
（`SpeechRecognition`、`localStorage`、`matchMedia`）都必须
`useState<boolean | null>(null)` + `useEffect` 里探测，让服务端与客户端先渲染
同一个占位符。单测看不见这类问题，只有真机走查或 build 能抓。

### 12. 服务端才知道的布尔值，必须走「探测接口」而不是「页面里猜」

精评按钮是否出现有两个条件，都在服务端：站长配了 key（`configured`）、
调用者登录了（`loggedIn`）。页面里猜任何一个都会错：猜 key 会把功能对所有人
藏起来，猜 login 会给游客一个必然 401 的按钮。**规则**：服务端才知道的条件，
由 `GET /api/xxx` 明确返回**两个分开的布尔**，面板两个都读、两种文案分开写。
把两个条件合成一个布尔是本轮已经修掉的一个缺陷。

### 13. 后台密钥表单：**空值 = 不改**，且接口必须有对应语义

表单读不到已存的 key，所以 key 框渲染时一定是空的。如果「空值」被当成
「删除」，管理员每次点保存都会把密钥擦掉，功能静默失效——而 UI 看起来
完全正常。**规则**：只要一个字段是「写不可读」（密码、密钥、token），
PUT 语义必须是「空/缺 = 不改」；同时配一条「测试连接」，否则保存成功
和密钥真的可用是两件事。

### 14. 验证付费凭据要用**不计费**的端点

「测试连接」如果打的是评估端点，每点一次就产生一次计费，而且还要构造
一段音频。改用令牌端点（`<region>.api.cognitive.microsoft.com/sts/v1.0/
issueToken`）：只验凭据、不收音频、**零成本**。401 的文案必须同时点名
region 和 key —— 两者从同一页复制，错 region 与错 key 的响应一模一样。

### 15. 付费接口的配额必须在**读 body 之前**判

`/api/speech/assess` 的每日上限如果放在读完 `arrayBuffer()` 之后，一个
6 MB 的重试循环仍然会把内存和带宽打满，而且每次都要先把音频读完才知道
该不该拒绝。**规则**：配额 → 鉴权 → 体积 → 内容，顺序固定。同样地，
只有**成功**的打分才记入配额：429/5xx 没花钱，不能吃掉学生的次数。

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

1. 是否做**跨班看板**（一页看到所有班的完成率）
2. 是否 **push 到 `origin/main`**（目前 53 个本地提交未推送）

> 📌 **2026-11-23 晚的全站扫描见 [`2026-11-23-pending-work.md`](./2026-11-23-pending-work.md)**：
> 11 项未完成（缺表容错、.gitignore、SEO 标题/canonical/sitemap、听写作业没接通、
> 音素未展示、语音用量看板、4 个缺字、401 英文、集成测试空转、README 未更新），
> 每项都带文件行号与验收方法，按三批排好序。
