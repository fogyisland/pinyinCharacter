# 听写练习（出卷 + 报听写）· 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老师一键生成听写卷（田字格答题卷 + 答案页）打印上课；「报听写」模式逐条朗读、揭晓自评、错词再练。覆盖单字/词语/成语。

**Architecture:** 三层。词条层 `lib/dictation.ts`（纯函数）→ 卷面层 `DictationPaper`（`blank`/`answer` 两模式，复用 `WorksheetCell`）→ 报听层 `DictationRunner`（TTS 播音 + 间隔翻条 + 错词闭环）。入口 `app/dictation/page.tsx`，BentoGrid 加卡。

**Tech Stack:** Next.js 15 + React 19 + TypeScript strict + Vitest 4 + happy-dom。pinyin-pro、Edge TTS、`WorksheetCell` 全部现有。**零新增依赖。**

**Spec:** `docs/superpowers/specs/2026-11-21-dictation-design.md`

## Global Constraints

- **只加不改** —— `generateLayout` / `WorksheetPreview` / `PracticeTemplate` / `PracticePDF` / `WorksheetCell` 现有行为一字不变（`WorksheetCell` 仅被复用渲染）
  - **唯一例外**：若 `ReadAloudButton` 内联了朗读逻辑，允许把它提取为 `lib/speak.ts` 并让按钮改为调用（行为不变、现有测试全绿为准）——报听写需要程序化播音
- **零新增 npm 依赖**
- **拼音默认关闭、可逐条编辑**（机器注音只作初值）
- **词条 1~4 字**，超长词条丢弃并在表单可见提示（不静默截断）
- **一页 10 条**（A4）；听写卷不接会员门槛（免费）
- **TDD 强制**：先写失败测试、看着它红、再实现；每个 Task 末尾做变异验证
- **UI 文案中文**，代码注释/commit subject 英文；commit 主题尾加 `[YYYY-MM-DD HH.MM]`；**不 push**
- 改了 `app/**/page.tsx` 必须 `npm run build`；**dev server 存活时不 build**
- Windows 上 Python/控制台输出前处理编码（`PYTHONIOENCODING=utf-8`）；不用 `grep -P` 统计非 ASCII

## Review Focus

（与 spec 的 Review Focus 表一致，测试归属见各 Task。）

| 输入 / 条件 | 应该得到什么 | 归哪个 Task |
|---|---|---|
| 自定义词表含超 4 字的词 | 丢弃 + 表单可见提示 | Task 1 |
| 多音字拼音初值 | 可编辑，改后预览/打印用新值 | Task 1 + 2 |
| 词条表空/全丢弃 | 不出卷，空态，打印禁用 | Task 2 |
| 答题卷 vs 答案页 | 编号/顺序/条数 1:1 | Task 2 |
| 打印 | 控件不上纸、不溢出第二页 | Task 2 + 4 |
| TTS 失败 | 报错但不阻塞揭晓/翻条 | Task 3 |
| 错词再出卷 | 新一轮只含错词、题号从 1 起 | Task 3 |
| 手动翻条 | 不自动跳条 | Task 3 |

## 文件结构

| 文件 | 责任 |
|---|---|
| `lib/dictation.ts` | 新建 — 词条模型与构建、拼音标注、分页（纯函数） |
| `tests/unit/lib/dictation.test.ts` | 新建 — 词条层测试 |
| `components/dictation/DictationPaper.tsx` | 新建 — 卷面渲染（blank/answer） |
| `components/dictation/DictationPrep.tsx` | 新建 — 出卷表单 |
| `components/dictation/DictationRunner.tsx` | 新建 — 报听写播放器 |
| `components/dictation/DictationTabs.tsx` | 新建 — 出卷/报听写 两 tab 容器（Task 3 提升共享状态） |
| `app/dictation/page.tsx` | 新建 — 页面入口 |
| `components/BentoGrid.tsx` | 改 — 加「听写练习」卡 |
| `lib/speak.ts` | 视情况新建 — 提取程序化播音（见约束唯一例外） |

---

### Task 1: 词条层 —— 拆词、注音、分页

**Files:**
- Create: `lib/dictation.ts`
- Test: `tests/unit/lib/dictation.test.ts`

**Interfaces:**
- Consumes: `data/idioms.json`（`{word, pinyin, meaning, level, category}` 378 条）、`data/hsk-vocab.json`（`{1..5: [{char}]}` 单字表）、`lib/pinyin-client.ts` 的 pinyin-pro 加载（或直接 `pinyin-pro`）
- Produces:
  ```ts
  export interface DictationItem {
    word: string;        // 1~4 个汉字
    pinyin: string;      // 空串 = 未注音（卷面不印拼音）
    chars: string[];     // word 拆开的字，逐字入田字格
  }
  export function parseCustomList(text: string): { items: DictationItem[]; rejected: string[] };
  export function itemsFromHsk(level: number, count: number, seed: number): DictationItem[];
  export function itemsFromIdioms(level?: number, count?: number, seed?: number): DictationItem[];
  export function annotatePinyin(items: DictationItem[]): Promise<DictationItem[]>;
  export function paginate<T>(items: T[], perPage?: number): T[][];  // perPage 默认 10
  ```

- [ ] **Step 1: 写失败测试**

`tests/unit/lib/dictation.test.ts` 的 describe 与断言（实现按断言反推）：

```ts
describe('parseCustomList', () => {
  it('splits on commas, spaces and newlines');            // '你好 世界,长大\n书' → 4 items
  it('keeps items of 1 to 4 characters');                 // chars.length 1..4
  it('drops items longer than 4 characters and reports them'); // rejected 含 '中华人民共和国'
  it('dedupes repeated words, keeping the first');
  it('returns an empty list for blank input');
});

describe('annotatePinyin', () => {
  it('fills empty pinyin from the dictionary');            // [{word:'你好',pinyin:''}] → 'nǐ hǎo'
  it('keeps an edited pinyin untouched');                  // {word:'长大', pinyin:'zhǎng dà'} 不被覆盖
});

describe('paginate', () => {
  it('packs 10 items per page by default');
  it('keeps the order across pages');
  it('puts the tail on its own page');                     // 12 items → [10, 2]
});

describe('itemsFromIdioms', () => {
  it('produces 4-character items with pinyin from the real idiom table'); // 读 data/idioms.json
});

describe('itemsFromHsk', () => {
  it('produces single-character items from the level pool'); // 读 data/hsk-vocab.json
  it('is reproducible from its seed');                     // 同 seed 同结果
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run tests/unit/lib/dictation.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/dictation'`

- [ ] **Step 3: 实现 `lib/dictation.ts`**

要点：
- `parseCustomList`：按 `[,，\s]+` 拆；`Array.from(word)` 数字符（防代理对）；长度 0 或 >4 → `rejected`；去重（首现保留）。
- `annotatePinyin`：只填**空** `pinyin`；词级注音用 pinyin-pro（`pinyin(word, { toneType: 'symbol', type: 'array' })` 之类以空格连接）；**不覆盖**已有值（老师编辑权）。
- `itemsFromHsk(level, count, seed)`：从 `hsk-vocab[level]` 的 `{char}` 列表用 mulberry32（照 `lib/magic-char-rules` 既有算法重写一份，不跨文件引用无关模块——直接放本文件）采样 count 个，每字一条，pinyin 留空（听写单字由老师决定是否注音）。
- `itemsFromIdioms(level?, count?, seed?)`：成语自带 `pinyin`，直接成条；默认全量顺序、count/seed 可选。
- `paginate(items, perPage = 10)`：不满一页不补空——**与字帖不同，听写卷不留空白行**（答题卷 12 条就是 10+2）。

- [ ] **Step 4: 跑测试确认绿**

Expected: 全部 PASS。

- [ ] **Step 5: 变异验证**

1. 把长度上限 4 改成 3 → `drops items longer than 4 characters` 红；
2. `annotatePinyin` 改成无条件覆盖 → `keeps an edited pinyin untouched` 红；
3. `paginate` 的 `perPage` 默认改 8 → `packs 10 items per page` 红。
逐个改、逐个看红、恢复。

- [ ] **Step 6: `npx tsc --noEmit` 干净**

- [ ] **Step 7: 提交**

```bash
git add lib/dictation.ts tests/unit/lib/dictation.test.ts
git commit -m "feat(dictation): the item layer of the dictation tool [YYYY-MM-DD HH.MM]"
```
正文写明：词条 1~4 字、超长丢弃并报告、机器注音只填空位（老师可改）、分页不补空行。

---

### Task 2: 出卷 —— 卷面 + 表单 + 打印

**Files:**
- Create: `components/dictation/DictationPaper.tsx`, `components/dictation/DictationPrep.tsx`, `app/dictation/page.tsx`
- Modify: `components/BentoGrid.tsx`（加一张卡）
- Test: `tests/unit/components/dictation/DictationPaper.test.tsx`

**Interfaces:**
- Consumes: `lib/dictation.ts` 全部；`components/worksheet/WorksheetCell.tsx`（格子渲染，props 现状为准）
- Produces: `DictationPaper({ items, mode: 'blank'|'answer', showPinyin, gridStyle, pages })`；`DictationPrep`（表单 + 预览 + 打印）

- [ ] **Step 1: 写失败测试**

`tests/unit/components/dictation/DictationPaper.test.tsx`（happy-dom + `installLocalStorageShim` 惯例）：

```ts
it('renders one numbered row per item');                   // 3 items → 3 行，题号 1..3
it('blank mode draws empty cells, one per character');     // '长大' → 2 空格，无范字
it('answer mode fills the pale model character');          // 格内文本 == 字
it('shows the pinyin row when asked, and on the answer page'); // showPinyin/answer 模式
it('hides the pinyin row by default in blank mode');
it('marks the name/date header as no-print');              // 含 worksheet-no-print
it('renders items of four characters without wrapping');   // 成语一条一行
```

- [ ] **Step 2: 红 → Step 3: 实现 `DictationPaper` + `DictationPrep` + 页面**

要点：
- 一行 = `题号 + [拼音行] + chars.map(WorksheetCell)`；格子类型默认田字格（`pen-square` 口径），可选米字格。
- `answer` 模式：格内填字（浅灰范字样式沿用描红约定 `#ddd`+红边由 WorksheetCell 现状决定，不改 WorksheetCell——如现状分「有字/无字」两态，answer 即「有字」态），拼音行必显。
- 表单：来源三选一（HSK 级别 + 条数 / 成语级别 + 条数 / 自定义粘贴框）、词条列表（每行：词、拼音输入框、删除）、`rejected` 提示条（黄条列出被丢弃的词）、选项（格子类型、拼音提示、姓名栏）、预览切换（答题卷/答案页）、打印按钮（`window.print()`，@page 样式复用字帖的 `size/margin: 1.5cm` 内联 style 惯例）。
- 空态：items 为空 → 提示「还没有词条」，打印按钮 disabled。
- `app/dictation/page.tsx`：本 Task 先只挂 `DictationPrep`（不做占位 tab——tab 在 Task 3 引入）。

- [ ] **Step 4: 绿 + 变异验证**

变异：去掉「拼音行必显」（answer 模式）→ 对应测试红；去掉题号 → `renders one numbered row per item` 红。

- [ ] **Step 5: `npx tsc --noEmit` 干净**

- [ ] **Step 6: 提交**

```bash
git add components/dictation app/dictation/page.tsx components/BentoGrid.tsx tests/unit/components/dictation/DictationPaper.test.tsx
git commit -m "feat(dictation): the dictation paper and its prep form [YYYY-MM-DD HH.MM]"
```
正文写明：答题卷/答案页同源渲染 1:1、拼音默认关且可改、超长词条可见提示。

---

### Task 3: 报听写 —— 播放器 + 错词闭环

**Files:**
- Create: `components/dictation/DictationRunner.tsx`, `components/dictation/DictationTabs.tsx`
- Modify: `app/dictation/page.tsx`（换 `DictationTabs` 承载共享词条草稿）
- 视情况 Create: `lib/speak.ts`（提取程序化播音；唯一允许的既有文件微调是 `ReadAloudButton` 改调用它）
- Test: `tests/unit/components/dictation/DictationRunner.test.tsx`

**Interfaces:**
- Consumes: `ReadAloudButton` 同款朗读路径（`lib/tts-cache.ts` / `lib/speak.ts`）；`lib/dictation.ts`
- Produces: `DictationRunner({ items, intervalSec: 5|8|12|null })`（null = 手动）

- [ ] **Step 1: 写失败测试**（mock `lib/speak.ts`）

```ts
it('speaks the current item on entry');                    // speak 被调用 with 词条 word
it('auto-advances after the interval');                    // vi.useFakeTimers
it('manual mode does not auto-advance');                   // intervalSec: null
it('reveals the answer on demand');                        // 显示 word + pinyin
it('marks wrong items and collects them');                 // 错词进错词清单
it('regenerates a round from the wrong items only');       // 「用错词再出卷」→ 新一轮 items === 错词
it('survives a speak failure without blocking');           // speak reject → 仍可翻条/揭晓
```

- [ ] **Step 2: 红 → Step 3: 实现**

要点：
- 状态机：`playing(当前条) → revealed(揭晓) → next`；结束态显示错词清单 + 「用错词再出卷」（题号从 1 重编，直接换 items 重启）。
- 间隔档：5 / 8 / 12 秒 / 手动（按钮「下一条」）。揭晓在播音后**随时可点**（不等间隔）。
- TTS 失败（promise reject）：toast/内联报错「朗读失败，可继续手动进行」，计时器照常。
- `DictationTabs`：`useState<DictationItem[]>` 提升到 tab 容器，出卷表单与报听写共用同一批词条（出卷里配好 → 切到报听写即用）。

- [ ] **Step 4: 绿 + 变异验证**

变异：自动翻条去掉 clearInterval → `manual mode does not auto-advance` 红；错词按钮误记对词 → `marks wrong items and collects them` 红。

- [ ] **Step 5: `npx tsc --noEmit` + `npx vitest run tests/unit/components/WorksheetCell.test.tsx tests/unit/components/worksheet`（确认「只加不改」未破坏字帖）**

- [ ] **Step 6: 提交**

```bash
git add components/dictation app/dictation/page.tsx lib/speak.ts components/ReadAloudButton.tsx tests/unit/components/dictation/DictationRunner.test.tsx
git commit -m "feat(dictation): the classroom dictation runner [YYYY-MM-DD HH.MM]"
```
正文写明：播音/计时/揭晓/记错四职责、手动模式节奏归老师、TTS 失败降级、错词卷内闭环。

---

### Task 4: 真机验证与收尾

**Files:** 不改代码（走查发现问题才改）

- [ ] **Step 1: 全量测试** `npx vitest run` → 全绿
- [ ] **Step 2: Lint** `npm run lint` → 0 errors，warning 不增加
- [ ] **Step 3: 构建** 先停 dev server → `npm run build` → 通过 → 起回 dev server
- [ ] **Step 4: CDP 浏览器走查**（照 spec「真机 smoke」6 步，含打印媒体实测：卷面高度 ≤ A4 可打印区、表单控件不上纸、答案页与卷面编号一致；截图存档；console error 必须为 0）
- [ ] **Step 5: 报告** —— 6 步结果、打印实测数字、已知限制（多音字初值、词语来源本期靠自定义/成语库）

---

## Verification

### 自动化
- `npx vitest run tests/unit/lib/dictation.test.ts` 全绿
- `npx vitest run` 全绿（回归）
- `npx tsc --noEmit` 干净

### 真机（Task 4）
- HSK 10 字卷：答题卷 10 行空田字格 + 题号；答案页同版式浅灰字 + 拼音
- 超长词条丢弃 + 表单提示
- 拼音编辑生效于预览与打印
- 打印控件不上纸、单页 A4
- 报听写全链路（播音/间隔/手动/揭晓/错词再出卷）
- TTS 断网降级不阻塞

## Commit Summary

3 个 commit（feature 分支，不 push）：
1. `feat(dictation): the item layer of the dictation tool [YYYY-MM-DD HH.MM]`
2. `feat(dictation): the dictation paper and its prep form [YYYY-MM-DD HH.MM]`
3. `feat(dictation): the classroom dictation runner [YYYY-MM-DD HH.MM]`

## Notes / Risks

- **多音字**：pinyin-pro 词级注音不保证正确（「长大」），以「可编辑 + 默认不印」兜底；测试里断言注音的词条选无歧义词（你好/书本）。
- **hsk-vocab 是单字表**：「词语听写」的词语来自自定义粘贴与成语库；自动组词表列入后续路线（不在本期）。
- **`WorksheetCell` 现状决定 answer 模式的取法**：若它的「有字」态不是描红浅灰样式，answer 页用外层 CSS 包一层达成浅灰，不改 WorksheetCell（走查以打印效果为准）。
- **TTS 自动播音**依赖浏览器媒体策略（需一次用户手势起播）：进入报听写的第一次点击（选 tab/点开始）即作为手势起点，走查验证 Chrome 行为。
- **一页 10 条**是 A4 预设；A3/B5 本期不单独调版。
