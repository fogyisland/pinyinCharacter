# 待办：全站扫描发现的 11 项未完成（2026-11-23 晚）

基线：`a98ae8461`（Azure 音素级精评已提交）
状态：`main` 工作树除 `.worktrees/` 外干净；**53 个本地提交未 push**
用途：今晚按批次动手，每项都写了**证据（文件:行）**与**验收方法**，可直接照做。

测试口径：`npx vitest run --testTimeout=60000`（默认 5s 在满并发下会假失败）。
当前全量：**326 passed files（333 总）/ 3615 passed tests（3636 总）**，lint 0 error，tsc 干净。

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
- 让 `countAssessmentsToday` 捕获 `isMissingTableError` → 返回 **0**（视作「今天还没用」，
  不让配额判断把功能打死），并 `console.warn` 明确提示
  「缺少 speech_assessments 表：请运行 npm run db:migrate」
- **不要**让它返回 `null` 或抛出：配额是防账单的，宁可放行一次也不能让整条链路 500
- 补一个单测：`query` 抛 `{ code: 'ER_NO_SUCH_TABLE' }` → 返回 0 且发出 warn

**验收**：`npx vitest run tests/unit/lib/speech-store.test.ts`

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

- `DictationTabs` 增加读 `?items=`（JSON 或 `词|拼音` 逐行编码，二选一，注意 URL 长度上限，
  10 个词没问题，但 200 条上限要截断到 60–80 条再进 URL，或只带前 N 条 + 提示「完整列表见班级页」）
- `DictationPrep` 接收初始 items（受控组件已有 `items`/`onChange` 协议，**不要改协议**）
- 班级页把 `payload.items` 渲染出来（词 + 拼音），学生至少看得见清单
- 编码要 `encodeURIComponent`，并处理「学生手改 URL 塞进超长内容」→ 服务端/客户端都截断校验
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

**验收**：`PronouncePanelAzure.test.tsx` 加一条：phonemes 有值时出现「最弱」文案。

---

### 6. 语音评测用量对站长不可见

**证据**：`speech_assessments` 只被 `lib/speech-store.ts` 与
`app/api/speech/assess/route.ts` 引用，`app/admin/**` / `components/admin/**` **零引用**。

**后果**：付费了却看不到「今天谁用了几次 / 哪些词总低分 / 配额该调高还是调低」。

**修法（最小可用）**：`/admin/speech` 页面加一块统计卡（服务端读库）：
今天总次数 / 活跃人数 / 平均分 / 最近 20 条（词 · 分 · 时间）。
**不要**在这里展示录音（从来就不存）。

**验收**：`/admin/speech` 能看到数字；无数据时显示空态而不是 0。

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

**验收**：`curl -s localhost:4444/guide | grep 跟读` 有输出。

---

### 11. 两个没被引用的导出（清理级）

```
lib/azure-assessment.ts:204  export const ASSESSMENT_SCORES   ← 全仓零引用
lib/azure-speech.ts:42       export type SpeechConfigKey      ← 全仓零引用
```

删掉或接进使用点。`lint` 不报（导出不算 unused），但属于「写了没用」的债。

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

## 铁律（这轮已经踩过的坑，别再来一次）

- **dev server 活着时绝不 `npm run build`**（`.next` 被清，dev 会 500）
- client 组件**不能** import 带 `node:fs` 的模块，**`import type` 也会被 bundler 追踪**
  （类型放纯模块，本轮的 `lib/speech-types.ts` 就是为此而生）
- 只在浏览器成立的能力探测必须 `useState<boolean|null>(null)` + `useEffect`，
  否则 hydration mismatch（本轮已踩）
- 后台「写不可读」的密钥字段，PUT 语义必须「空 = 不改」
- 付费接口配额要在**读 body 之前**判，且只记成功
- 路由新增 store 调用，记得同步补测试里的 `vi.mock`
- 不 push

## 别忘了

- robots 里的 `Sitemap: http://localhost:3000/sitemap.xml` 是 dev 的兜底值；
  **上线前必须在 `/admin/settings/site-url` 配真实域名**（或 `NEXT_PUBLIC_SITE_URL`），
  否则 canonical 和 robots 都会指向 localhost
