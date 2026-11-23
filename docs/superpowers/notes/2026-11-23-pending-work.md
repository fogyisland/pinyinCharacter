# 待办：全站扫描发现的 11 项未完成（2026-11-23 晚）

基线：`a98ae8461`（Azure 音素级精评已提交）
状态：`main` 工作树除 `.worktrees/` 外干净；**53 个本地提交未 push**
用途：今晚按批次动手，每项都写了**证据（文件:行）**与**验收方法**，可直接照做。

测试口径：`npx vitest run --testTimeout=60000`（默认 5s 在满并发下会假失败）。
扫描时全量：**326 passed files（333 总）/ 3615 passed tests（3636 总）**，lint 0 error，tsc 干净。

---

## ⏱ 进度（滚动更新）

| # | 项 | 状态 |
|---|---|---|
| 1 | 缺表容错 | ✅ 已做（改 `lib/speech-schema-error.ts` + 路由翻译，**fail closed**） |
| 2 | `.worktrees/` 忽略 | ✅ 已做（`.gitignore` 一行） |
| 3 | SEO 标题 / canonical / sitemap | ✅ 已做（15 个页面 + 9 条 sitemap） |
| 4 | 班级听写作业接通 | ✅ 已做（`?classId=&assignmentId=` → 服务端取词） |
| 5 | 音素展示 | ✅ 已做（「最弱的音」最多 3 个） |
| 6 | 语音用量看板 | ✅ 已做（`/admin/speech` 三卡 + 最近 20 条） |
| 7 | 4 个 BMP 字 | ⬜ **卡在 AI 未配置**（`app_config` 无 `ai.api_key`） |
| 8 | 班级 401 英文 | ✅ 已做（`unauthorizedForLogin()`，11 处） |
| 9 | 集成测试空转 | ✅ 已做（`it.skipIf` + 顶层探测，实测 4 passed） |
| 10 | README 未更新 | ✅ 已做（功能/语音配置/测试数字/路线图） |
| 11 | 零引用导出 | ✅ 已做（删 `ASSESSMENT_SCORES`、`SpeechConfigKey`） |

测试规模：**3664 passed / 18 skipped / 0 failed**（338 文件，332 通过 / 6 跳过）。

> 跳过数从 21 降到 18：`seo.test.ts` 的 4 条现在真的会跑（dev 在时 4 passed）。


---

## 第一批 —— 上线当天就会踩（建议今晚先做，1 小时内）

### 1. 新表缺失时 `/api/speech/assess` 返回 500，而不是「请跑迁移」

**证据**

- `lib/speech-store.ts:44` `countAssessmentsToday()` 直接 `getPool().query`，**没有 try/catch**
- `lib/speech-store.ts:64` `recordAssessment()` 有 try/catch（只记 warn，不抛）
- `app/api/speech/assess/route.ts:91` 配额检查调用前者

**后果**：上线若忘了 `npm run db:migrate`（新增表 `speech_assessments`），
学生点「精评」拿到 `500 server error`，站长看到一条无信息量的日志；
而 `recordAssessment` 的容错让「表缺失」看起来像「只是没记账」。

**修法**（本仓已有现成工具，`lib/db-error.ts`）

- `isMissingTableError(error)` 已在 `wecom` / `config` / `setup` 使用
- ~~让 `countAssessmentsToday` 捕获并返回 0~~ —— **实际做法相反，见下**

**✅ 实际做法（2026-11-23 夜）**

第一版想「缺表就返回 0、别把功能打死」。想清楚后改成 **fail closed**：

- 配额存在的**唯一理由**是挡住「重试循环 → 无上限账单」。配额只能数
  `speech_assessments` 的行；表不存在时能数到的永远是 0，而「0 次」在配额判断里
  等于「还没用完」——付费路径会**完全失去上限**，正好是配额要防的事。
- 所以 `countAssessmentsToday` **故意不吞异常**（`lib/speech-store.ts` 的注释写了
  这个不对称：读失败=配额数不出→必须抛；写失败=只丢账单记录→只 warn）。
- 新增 `lib/speech-schema-error.ts`：`isSpeechTableMissing`（**还核对错误里是否
  点名 `speech_assessments`**，否则缺的是 `users` 时会把原因说错）+
  `translateSpeechSchemaError` → 503 `schema_migration_pending` +
  「请管理员运行 npm run db:migrate 后重试；跟读功能不受影响」。
- 路由把 translator 传给 `withErrorHandling`（和 webfont 的现成做法一致）。

**验收**：`tests/unit/lib/speech-schema-error.test.ts`、`tests/unit/lib/speech-store.test.ts`、
`tests/unit/app/api/speech-assess.test.ts`（37 用例全绿）。


---

### 2. `.worktrees/` 没被 git 忽略

**证据**

```
git check-ignore -v .worktrees/worksheet-trace-fill   → 退出码 1（未忽略）
git status --short                                    → ?? .worktrees/
.grep '.gitignore' 里没有 worktrees 这一行
```

`base-check` / `base-cmp` 之所以安静，是因为里面的 `node_modules/` 命中了规则，
**目录本身没有被忽略**。

**风险**：哪天 `git add -A`，会把 worktree 的内容扫进主仓。

**修法**：`.gitignore` 加一行 `/.worktrees/`（用根锚定，避免误伤别处的同名目录）。
注意：worktree 自身的 git 操作不受 ignore 影响。

**顺手清理**（可选，需你确认）

- `.worktrees/base-check`、`.worktrees/base-cmp` 里只有 `node_modules`，是垃圾
- `.worktrees/worksheet-trace-fill` 的分支 `5d11ef980` **已并入 main**
  （`git merge-base --is-ancestor 5d11ef980 main` 退出码 0），可 `git worktree remove`

---

### 3. 公共页面的 title / canonical / sitemap 三处不一致

**实测（dev 4444，带 `setup_completed=1`）**

| 路由 | title | canonical |
|---|---|---|
| `/` | 首页通用 | 无 |
| `/worksheet` | 首页通用 | 无 |
| `/worksheet/practice` | 首页通用 | 无 |
| **`/dictation`** | **首页通用** | 无 |
| `/poetry` | 首页通用 | 无 |
| `/sutra` | 首页通用 | 无 |
| `/stories` | 首页通用 | 无 |
| `/membership` | 首页通用 | 无 |
| `/about` `/guide` `/notes` `/ancient` | 自己的 title | **无** |

首页通用 = `app/layout.tsx:13-16` 的
`title: '字·韵 — 汉字与拼音互转'`。

**已有现成工具没用上**：`lib/seo/metadata.ts` 的 `buildMetadata()`
（自动 canonical + og + twitter）。已用的仅 5 个：
`app/pinyin` `app/dictionary` `app/rare-chars` `app/game` `app/classes`。

**注意（别误判）**：`app/classes/page.tsx` **有** `generateMetadata`，
匿名访问会 `redirect('/?auth=login')` 所以看不到它的 title —— 这不是 bug。

**修法**

- 给缺的页面加 `generateMetadata`（`buildMetadata`）：
  `/worksheet` `/worksheet/practice` `/dictation` `/poetry` `/sutra` `/stories`
  `/membership` `/` 
- 给已有静态 `export const metadata` 的四页（`/about` `/guide` `/notes` `/ancient`）
  补 canonical —— 或直接换成 `buildMetadata`
- 详情页也缺：`/rare-chars/[char]` `/stories/[char]` `/sutra/[id]` `/etymology/[char]`
  `/worksheet/[id]` `/classes/[id]` `/ancient-texts`
- **`/dictation` 是纯客户端页**（`'use client'` 在 `app/dictation/page.tsx:1`），
  client 页不能 `export const metadata`，要拆出一个 server 层（外层 `page.tsx`
  做 metadata + 内层渲染原组件），或改用 `<Head>` 之外的正确做法

**✅ 实际做法（2026-11-23 夜）**

- 全部换成 `generateMetadata` + `buildMetadata`（连 `/about` `/guide` `/notes`
  `/ancient` 的静态 metadata 也换了 —— 它们本来就没有 canonical）
- `/dictation` 拆成 **`app/dictation/page.tsx`（server，只做 metadata）
  + `app/dictation/DictationClient.tsx`（原客户端内容）**。这是唯一正确的做法：
  `'use client'` 的页面不能导出 `generateMetadata`
- 详情页补了 title/canonical 的：`/rare-chars/[char]` `/stories/[char]`
  `/etymology/[char]` `/sutra/[id]`
  （`/dictionary/[char]` `/poetry/[id]` 本来就有）
- **未做**：`/worksheet/[id]` `/classes/[id]` `/ancient-texts` —— 前两个是登录后
  页面（无 SEO 价值），`/ancient-texts` 是内部工具页

**sitemap**：`app/sitemap.ts` 加了 9 条（`/pinyin` `/worksheet`
`/worksheet/practice` `/dictation` `/game` `/guide` `/about` `/notes` `/membership`），
`tests/unit/app/sitemap-readme-drift.test.ts` 的断言从 2 页扩到 11 页。

**验收（实测）**：15 个公共路由**全部有自己的 title 且有 canonical**；首页的 title
与 layout 相同是**正确**的（它就是首页）。sitemap 从 1377 → **1386** 条，
9 个新页面全部在列，missing = []。

**sitemap 缺 9 个公共页**（`app/sitemap.ts:63-102` 现有条目只有
`/` `/dictionary` `/rare-chars` `/stories` `/poetry` `/ancient` `/sutra` + 4 个子 sitemap）

缺：`/pinyin` `/worksheet` `/worksheet/practice` `/dictation` `/game` `/guide`
`/about` `/notes` `/membership`

`tests/unit/app/sitemap-readme-drift.test.ts:55` 目前只守 `['/rare-chars', '/stories']`，
**要把新页面加进这个断言**，否则以后又会漂。

**验收**

```
python .tmp/seo5.py   # 逐路由打印 title/canonical（脚本已存在）
curl -s http://localhost:4444/sitemap.xml | grep -c '<loc>'
```

---

## 第二批 —— 功能补完（用户能感觉到）

### 4. 班级「听写」作业没接通听写工具（最像功能坏了）

**证据**

- `components/classes/ClassDetailClient.tsx:208`
  ```tsx
  <Link href="/dictation">去听写</Link>     // 没有任何参数
  ```
  对照字帖作业（同一处上方）：
  ```tsx
  <Link href={`/worksheet?prefill=${...}`}>  // 真正预填
  ```
- `components/dictation/DictationTabs.tsx:34` 只读 `params?.get('tab')`
- `components/dictation/DictationPrep.tsx` **一个 URL 参数都不读**
- `payload.items` 在客户端**从未渲染**（全文件只有 `payload.chars`，用于 worksheet）

**后果**：老师派「本周 10 个词」，学生点进去看到**空表单**，要自己重敲；
而且连「要听写哪些词」都看不到，只看得到标题。

**修法与注意点**

- ~~`DictationTabs` 增加读 `?items=`（JSON 或 `词|拼音` 逐行编码，注意 URL 长度上限）~~
- ~~`DictationPrep` 接收初始 items~~
- ~~班级页把 `payload.items` 渲染出来~~

**✅ 实际做法（2026-11-23 夜）—— 换了方案，理由很硬**

第一版把词表编码进 `?items=`。**实测 60 个词 = 5480 个字符**（URL 里每个汉字是
9 个字符的 `%E5%AD%A6`）。代理在 2 KB 左右开始拒绝或截断，而一份作业可以有 200 条
——「老师派了 30 个词，学生只看到 12 个」会成为常态且无提示。

改成 **`/dictation?classId=<n>&assignmentId=<n>`**：

- 链接只有 ~34 个字符，**永远完整**，与词数无关
- 词表**只有一份真相**（班级库里那份），不存在「URL 里的副本被改/被截断」
- 权限由已有的 `/api/classes/[id]` 判（非本班成员拿不到），所以链接本身不泄露内容
- 新增 `lib/dictation-url.ts`（纯函数、零 import）：
  `parseAssignmentLink`（拒绝 0/负数/小数/非数字/SQL 形状，永不抛）、
  `buildAssignmentDictationHref`
- `DictationTabs`：拿到链接 → `fetchClassDetail` → 找到那份作业 → **替换**草稿
  （不是追加：学生是为这一份作业来的）；三种失败都有明确文案（作业被删 / 是字帖 / 班级拒绝）
- 切换「出卷 ⇄ 报听写」时**保留 classId+assignmentId**，否则刷新后表单又空了
- 班级页的听写链接旁显示「N 个词」，学生点之前就知道任务多大

**验收（实测，真机）**

```
无链接：       无「来自班级作业」行，prep 空（且不发请求）
有链接：       「来自班级作业「第 4 课听写」， 3 条」，表单里能看到 学生/老师/同学
切到报听写：   URL 变成 ?tab=runner&classId=2&assignmentId=4，「来自班级作业」仍在
作业被删：     role=alert「这份作业不在该班级里，可能已被老师删除」
是字帖作业：   role=alert「这份作业是字帖，不是听写」
班级拒绝：     role=alert 显示服务端那句「班级不存在」
半截链接：     不发请求、不显示来源行
'7 OR 1=1'：   不发请求
```

- 补测：`ClassDetailClient` 断言听写链接**带 query**；`DictationTabs` 断言能从参数建出 items

**验收**：派一个听写作业 → 学生点「去听写」→ 表单里已经有那 10 个词。

---

### 5. 音素级数据拿到了却没展示

**证据**

- `lib/azure-assessment.ts:175` 解析 `phonemeScores.push(...)`
- `lib/azure-assessment.ts:193` 汇入 `assessment.phonemes`
- `lib/speech-types.ts:47` 类型已有 `phonemes: PhonemeScore[]`
- `components/dictionary/PronouncePanel.tsx:330` **只渲染 `syllables`**

**现状**：粒度停在音节（`xué 88`），没到「üe 半个音 86」——你当初要的就是音素级。

**修法**：音节条目下挂二级音素小字（`x 90 · ue 86`），低分音素用琥珀色。
注意 `phonemes` 是**整词平铺**，不与音节一一对应（Azure 的 `Words[].Phonemes` 在
word 级），要么按 `Words[]` 分组（需要顺手把解析改成保留分组），要么只做「最差 3 个音素」
的提示。**推荐后者**：一行「最弱：ue 86 / x 90」，性价比最高。

**✅ 实际做法（2026-11-23 夜）**

按「最弱几个」做，并定了一条口径：**低于 90 才点名，最多 3 个，最差在前**。

- 94/96 这种读得好的，不点名 —— 列一串高分是成绩单，不是建议，还会让读得好的学生
  以为自己错了
- `weakestPhonemes()` 是纯函数，`[]` 时不渲染那块（不留空行）
- 低于 60 用琥珀色标出（`text-amber-700`），其余 `text-ink-faint`

**验收**：`PronouncePanelAzure.test.tsx` 两个新用例 ——
`ue 58 / sh 82 / x 90 / eng 95` 时只出现 `ue 58` 和 `sh 82` 且 `ue` 在前；
全部 94+ 时 `pronounce-phonemes` 根本不渲染。

---

### 6. 语音评测用量对站长不可见

**证据**：`speech_assessments` 只被 `lib/speech-store.ts` 与
`app/api/speech/assess/route.ts` 引用，`app/admin/**` / `components/admin/**` **零引用**。

**后果**：付费了却看不到「今天谁用了几次 / 哪些词总低分 / 配额该调高还是调低」。

**修法（最小可用）**：`/admin/speech` 页面加一块统计卡（服务端读库）：
今天总次数 / 活跃人数 / 平均分 / 最近 20 条（词 · 分 · 时间）。
**不要**在这里展示录音（从来就不存）。

**✅ 实际做法（2026-11-23 夜）**

- `lib/speech-store.ts` 新增 `readSpeechUsage()`（读侧，和 `recordAssessment` 的写侧分开）
- `/admin/speech` 顶部三张 `StatCard`：今日精评次数 / 今日使用人数 / 近 7 天平均分
- 下方「最近的精评」表格：学生 · 练的词 · **听到的**（与目标不同才显示，这正是
  「某个词全班都读错」的信号）· 分 · 时间
- 空态是「还没有人用过精评」这句话，不是一张 0 的表
- **读失败给空面板而不是报错**（这是给人看的读，不是账单的守卫）；缺表也一样
- 有一条测试专门断言 SQL 里**不出现 `audio` / `wav`** —— 提醒后来人这张表不该存声音

**验收（实测）**：`/admin/speech` 三卡 + 表格 + 空态都在，390px 下表格不溢出。

---

### 7. 4 个 BMP 字仍缺内容（几分钟的活）

**证据**

```
data/content/乜.json  缺
data/content/亟.json  缺
data/content/龠.json  缺
data/content/齉.json  缺
```

`data/strokes-manifest.json` 里 `齉` 在 `missing`（总缺 1239，其余 1238 个都在增补平面，
详情页已有「字库不支持该字符」空态）。

**⬜ 未做 —— 需要 AI 凭据**

实测 `app_config` 里**没有 `ai.api_key`**（只有 `ai.model = gpt-4o-mini` 等），
`/api/admin/chars/generate` 会逐字失败、计数不动。所以这一步卡在**配置**上，
不是代码：

1. 后台 `/admin/ai` 配好 API key（或打开 mock 模式只验证链路）
2. 再打：
   ```
   POST /api/admin/chars/generate
   { "chars": ["乜","亟","龠","齉"], "fields": { "etymology_story": true } }
   ```
3. 注意 `齉` 无笔画数据，字源页字形演变只剩楷书 —— 数据缺失，不是 bug


**现成接口**（在 dev 上直接打）

```
POST /api/admin/chars/generate
{ "chars": ["乜","亟","龠","齉"], "fields": { "etymology_story": true } }
```

每条间隔 1 秒，四条几秒。**注意**：`齉` 无笔画数据，字源页字形演变只剩楷书 ——
这是数据缺失，不是 bug，别去改代码。

---

## 第三批 —— 一致性与收尾

### 8. 班级相关 11 处 401 还是英文

**证据**（`unauthorized()` 默认文案就是英文 `unauthorized`，见 `lib/api-handler.ts:95`）

```
app/api/classes/route.ts:19,36                      2
app/api/classes/join/route.ts:24                    1
app/api/classes/[id]/route.ts:33,78                 2
app/api/classes/[id]/assignments/route.ts:28,57     2
app/api/classes/[id]/assignments/[assignmentId]/route.ts:25   1
app/api/classes/[id]/assignments/[assignmentId]/submit/route.ts:35,76  2
app/api/classes/[id]/members/[userId]/route.ts:32   1
                                                合计 11
```

语音接口已经改成中文（`unauthorized('login_required', ...)`），这批没跟上。
**后果**：会话过期时学生在班级页看到英文 `unauthorized`。

**修法**：统一 `unauthorized('login_required', '请先登录。登录后回到本页即可。')`。
补测：任一路由断言 `error.message` 含中文字符。

**✅ 实际做法（2026-11-23 夜）**

没有在 11 处各写一句话，而是在 `lib/api-handler.ts` 里加了一个**共享出口**：

```ts
export const LOGIN_REQUIRED_MESSAGE = '请先登录，登录后回到本页即可。';
export function unauthorizedForLogin(init?: ResponseInit) { ... }
```

`code` 保持 `'unauthorized'`（面板与测试都按它分支，只有给人看的那句话变了）。
11 处全部换成 `unauthorizedForLogin()`。测试盯的是「这句话里**没有拉丁字母**」——
将来谁改回英文，测试会红。

---

### 9. 集成测试写了但从来没跑

**证据**

- `tests/integration/` 共 **12 个文件**
- **7 个** `describe.skipIf(!process.env.DATABASE_URL)`（有 `DATABASE_URL` 时会跑）
- `tests/integration/seo.test.ts` 3 个 `it.skip`（robots / pinyin title / JSON-LD）
- `tests/integration/api/game-round.test.ts` 2 个 `it.skip`
- `package.json` 的 `test` = `vitest run`（会扫到它们，`.env` 里有 `DATABASE_URL` 时 7 个会跑）

**含义**：SEO 三条断言（robots 禁 `/init`、`/pinyin` title、首页 JSON-LD）**从来没验证过**。
我今天用 HTTP 手工验过：robots / JSON-LD / search target 都是对的，
`/pinyin` title 本体没问题（之前看到「错」是终端编码显示问题）。

**修法**：把 `seo.test.ts` 的三个 `it.skip` 改成 `it.skipIf(!SERVER_UP)`，
用 `fetch` 探一下 4444；dev 活着就跑，不在就跳。这样既不破坏 CI，也不再是永久死代码。

**✅ 已做（2026-11-23 夜），但踩了一个坑**

第一版把探测放在 `beforeAll` 里 → **仍然 4 条全跳**。原因：`it.skipIf(...)` 在
**收集阶段**求值，早于任何 hook 运行，那时 `serverUp` 还是 `false`。

改成**模块顶层 `await probeServer()`**（顶层 await 在 ESM 里合法），
`it.skipIf(!serverUp)` 拿到的才是真实结果。实测 dev 在跑时 **4 passed**。

另外两处细节：

- `AbortSignal.timeout` 从 15s 提到 **60s**：dev 里首次访问某路由要现编译，
  `/pinyin` 冷启动超过 15s，第一次跑就是这么「失败」的
- 请求带 `setup_completed=1` cookie —— 否则未完成的站点会把每页重定向到 `/init`，
  title 断言读到的是向导页，失败原因与 SEO 无关
- 顺手加了第 4 条：sitemap 必须列 `/dictation` `/worksheet` `/pinyin` `/game`


---

### 10. README（= `/guide` 用户指南页）完全没提新功能

**证据**

- `app/guide/page.tsx:21` 直接渲染 `README.md` → **README 就是用户看到的指南**
- README 里对以下关键词出现次数：跟读 / 语音评测 / 班级 / 听写 / 形近字 /
  今日复习 / 例句 / `AZURE_SPEECH_KEY` **全部为 0**
- README 说「测试基础设施已经恢复到使用中：vitest,**246 个测试文件,约 2500 个测试**」
  → 实际 **326 passed / 3615**（333 总 / 3636 总）

**要写的四块**

1. 功能清单补：听写、拼音→汉字、今日复习、形近字、班级与作业（含完成状态）、
   例句、跟读、Azure 精评
2. 运维段补：`/admin/speech` 配置（region / key / 每日上限）+「测试连接」不计费，
   以及 env 后备 `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` / `AZURE_SPEECH_DAILY_LIMIT`
3. 上线步骤补：`npm run db:migrate` 会建 `speech_assessments`；缺表时精评会退化为
   「今天没用过」（第 1 项修完后的新行为）
4. 测试数字改成 326 / 3615（顺手把「246 / 2500」改掉）

**✅ 实际做法（2026-11-23 夜）**

- 功能清单新增「教学功能（2026-11 起）」小节，八项一条不少
- 新增「派生数据」命令块（`dict:tone` / `dict:words` / `lookalike:build` / `examples:build`）
- 环境变量表补两行（Azure 的后备 key/region/limit）
- 新增「语音评测（可选，付费）」小节：四步开通 + 缺表时的行为 + 「只存分数不存录音」
- 测试数字改成实测值（**338 文件 / 3660 用例**）+ 补上「满并发要加
  `--testTimeout=60000`」这条踩过的坑
- 路线图补「教学层（已交付）」与「未完成：跨班看板 / 4 个缺字」

**验收**：`/guide` 页面（就是 README）现在包含「跟读」「班级」「精评」等字样。

---

### 11. 两个没被引用的导出（清理级）

```
lib/azure-assessment.ts:204  export const ASSESSMENT_SCORES   ← 全仓零引用
lib/azure-speech.ts:42       export type SpeechConfigKey      ← 全仓零引用
```

删掉或接进使用点。`lint` 不报（导出不算 unused），但属于「写了没用」的债。

**✅ 已删（2026-11-23 夜）**：两个都直接删除（没有使用点值得接）。

---

## 今晚的操作顺序（照这个走）

```
1. 起 dev：npm run dev（4444）。若 EADDRINUSE：
   netstat -ano | Select-String ":4444" → taskkill /PID <pid> /T /F
   （别误杀 PudaFo:8888 / VoiceMake:4888 / Stockbouns:9002）
2. 先做第一批 1+2（半小时）：缺表容错 + .gitignore
3. 再做第一批 3（SEO/sitemap，最容易看到效果）
4. 跑 npx vitest run --testTimeout=60000 + npx tsc --noEmit + npm run lint
5. 提交（subject 末尾带 [YYYY-MM-DD HH.MM]，正文带 Co-Authored-By）
6. 时间够就继续第二、三批；不够就停在干净的绿线上
```

## 2026-11-23 夜的实际进度

第一批 + 第二批（除第 7 项）+ 第三批三项（8/10/11）都已**做完并实测**：
全量 **3664 passed / 18 skipped / 0 failed**（338 文件，332 通过 / 6 跳过），
`tsc` 干净，`lint` 0 error，真机走查 6 项全过（见各条「验收（实测）」）。

**只剩一项**：

| # | 项 | 为什么停 |
|---|---|---|
| 7 | 4 个 BMP 字缺内容 | 卡在**配置**：`app_config` 里没有 `ai.api_key`，生成接口会逐字失败 |

本轮改动已提交：`c40ad11a7`（50 个文件，+2011 / −161）。**55 个本地提交待 push。**

## 铁律（这轮已经踩过的坑，别再来一次）

- **dev server 活着时绝不 `npm run build`**（`.next` 被清，dev 会 500）
- client 组件**不能** import 带 `node:fs` 的模块，**`import type` 也会被 bundler 追踪**
  （类型放纯模块，本轮的 `lib/speech-types.ts` 就是为此而生）
- 只在浏览器成立的能力探测必须 `useState<boolean|null>(null)` + `useEffect`，
  否则 hydration mismatch（本轮已踩）
- **带 `'use client'` 的页面不能导出 `generateMetadata`** —— 要拆成 server 页面
  + client 组件（`/dictation` 就是这么修的）
- 后台「写不可读」的密钥字段，PUT 语义必须「空 = 不改」
- 付费接口配额要在**读 body 之前**判，且只记成功；**读失败必须 fail closed**
  （返回 0 = 失去上限，正是配额要防的）（本轮想清楚后改的）
- 把一个词表塞进 URL 前先算长度：汉字在 URL 里是 9 个字符，60 个词 = 5.5 KB，
  代理会截断 → 用编号 + 服务端取，不要用内容
- 路由新增 store 调用，记得同步补测试里的 `vi.mock`
- 不 push

## 别忘了

- robots 里的 `Sitemap: http://localhost:3000/sitemap.xml` 是 dev 的兜底值；
  **上线前必须在 `/admin/settings/site-url` 配真实域名**（或 `NEXT_PUBLIC_SITE_URL`），
  否则 canonical 和 robots 都会指向 localhost
- 走查用的账号 token：`.tmp/admin-token.json`（admin #1）、
  `.tmp/walk-owner-token.json`（class #2 的老师 #111）。
  **班级接口按成员身份判权限**，用 admin 的 cookie 读不到别人的班——这是对的，不是 bug
