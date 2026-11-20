# 字帖描红 · 循环填满整页 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在描红模式下，字帖的内容作为一条连续的流铺满所有格子的最后一格 —— 每一格都是浅灰范字，学生可以直接在上面描红。

**Architecture:** 改 `lib/worksheet-types.ts` 的 `generateLayout`：汉字格分支在 trace 模式下用 `content[i % content.length]` 铺满；英文四线格分支把整份内容拼成一条流，循环到 `rowsTotal × perRow` 长度，再按行切片。新增一个 `repeatToFill` helper。非 trace 样式行为完全不变。

**Tech Stack:** React 19, Next.js 15.5.29, TypeScript strict, Vitest 4.1.12 + happy-dom。**零新增依赖。**

**Spec:** `docs/superpowers/specs/2026-11-20-worksheet-trace-fill-page-design.md`

## Global Constraints

- **只在描红模式下生效** —— 非 trace 样式（`brush-square` / `brush-cross` / `pen-square` / `pen-cross` / `pen-lined`）行为**一字不变**，仍补空白格
- **四线格（`pen-english`）无条件循环** —— 它是唯一的 four-line 样式，且在 `WorksheetCell` 里写死了浅灰范字（`fill="#ddd"` + `stroke="#c0392b"`），不存在「非描红的四线格」
- **不改渲染层** —— 浅灰实心字 + 红边已经存在（`components/worksheet/WorksheetCell.tsx`），本计划不碰这个文件
- **不加 UI toggle / 不加新 cell style / 不加新纸张尺寸** —— 每种纸张用它自己的格数（A3=168, A4=88, B5=48, 毛笔 12/24/28）
- **不改 save 路径** —— DB 里存的仍是用户输入的原始 content，循环重复是渲染层的计算。`pageCountFor` / `exceedsFreeLimit`（会员门槛）语义不变
- **不动 `PracticeTemplate.tsx` / `PracticePDF.tsx`** —— 它们走自己的 `Array.from({length: count})`，不经过 `generateLayout`
- **改动文件限制** —— `lib/worksheet-types.ts` + `tests/unit/lib/worksheet-types.test.ts` 两个文件
- **不加新 API / 新页面 / 新 deps**
- Commit 主题尾加时间戳 `[YYYY-MM-DD HH.MM]`；**不 push**

## Review Focus

- **跨页连续性** —— 内容从第 1 页第 1 格流到最后一页最后一格，只在整份内容末尾回绕一次。中间任何一页的开头必须**接着上一页的结尾**，不能重新从头开始。
- **四线格每一行都必须铺满** —— 每行的长度必须**恰好等于** `englishCharsPerRow(paperSize)`，多一个字符就会撑破格子宽度、把网格挤到第二页。
- **非描红模式必须一字不变** —— 补位格子仍然是空白（`''`），不能变成重复内容。用户在字帖上写字，字帖不该替他把字填好。
- **空内容不能崩** —— `content.length === 0` 时取模会得到 `NaN`。必须回退到空白格。
- **页数不能变** —— 循环只改变每格**显示什么**，不改变**有多少格**。`total` 的计算公式保持原样，否则会员门槛会跟着变。

---

## Task 1: 循环铺满汉字格的描红字帖

**Files:**
- Modify: `lib/worksheet-types.ts`（`generateLayout` 的非 four-line 分支，line 521-536）
- Test: `tests/unit/lib/worksheet-types.test.ts`

**Interfaces:**
- Consumes: `getIsTrace(style: CellStyle): boolean`（已在 `lib/worksheet-types.ts` 中定义，返回 `s.includes('-trace-')`）；`cellsPerPage(paperSize: PaperSize): number`（从 `./worksheet-page-count` 导入）
- Produces: 无新导出。本任务只改 `generateLayout` 的非 four-line 分支的行为。

**背景：** `generateLayout` 现在把内容 pad 到整页（`total = max(perPage, ceil(content.length / perPage) * perPage)`），但补位格子是**空白**（`char: ''`）。描红模式下，用户要的是每一格都有浅灰范字可描。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/lib/worksheet-types.test.ts` 里新增一个 describe block（放在 `describe('generateLayout — auto-fill empty cells (CJK grid + lined)')` 之后）：

```ts
describe('generateLayout — trace fills the page by repeating the content', () => {
  it('repeats a single character across the whole brush-trace page', () => {
    const cells = generateLayout(['永'], 'brush-trace-square', 'brush-24');
    expect(cells).toHaveLength(24);
    expect(cells.every((c) => c.char === '永')).toBe(true);
  });

  it('cycles through the characters in order', () => {
    const cells = generateLayout(['永', '安', '乐'], 'brush-trace-square', 'brush-12');
    expect(cells).toHaveLength(12);
    expect(cells.map((c) => c.char)).toEqual([
      '永', '安', '乐', '永', '安', '乐',
      '永', '安', '乐', '永', '安', '乐',
    ]);
  });

  it('fills a cross-grid trace page too', () => {
    const cells = generateLayout(['水'], 'brush-trace-cross', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells.every((c) => c.char === '水')).toBe(true);
  });

  it('runs the content on across the page break', () => {
    // 100 chars on A4 (88 per page) → 2 pages. The second page starts
    // where the first one stopped — the content is one stream, and it
    // only wraps around at the very end.
    const chars = Array.from({ length: 100 }, (_, i) => `字${i}`);
    const cells = generateLayout(chars, 'brush-trace-square', 'A4');
    expect(cells).toHaveLength(176);
    expect(cells[0].char).toBe('字0');
    expect(cells[87].char).toBe('字87');
    expect(cells[88].char).toBe('字88');
    expect(cells[99].char).toBe('字99');
    // The stream wrapped: cell 100 is the first character again.
    expect(cells[100].char).toBe('字0');
    expect(cells[175].char).toBe('字75');
  });

  it('leaves a non-trace sheet blank instead of repeating', () => {
    // The auto-fill behaviour is unchanged for a sheet the user writes
    // ON: the extra cells stay empty for their own characters.
    const cells = generateLayout(['永'], 'brush-square', 'brush-24');
    expect(cells).toHaveLength(24);
    expect(cells[0].char).toBe('永');
    expect(cells.slice(1).every((c) => c.char === '')).toBe(true);
  });

  it('leaves a trace sheet blank when there is no content', () => {
    // content.length === 0 would make `i % 0` NaN, so the helper has to
    // fall back to the blank cells.
    const cells = generateLayout([], 'brush-trace-square', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells.every((c) => c.char === '')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: **FAIL** —— `repeats a single character across the whole brush-trace page` 期望 24 格全是「永」，实际是 1 个「永」+ 23 个 `''`。

- [ ] **Step 3: 实现**

在 `lib/worksheet-types.ts` 的 `generateLayout` 里，把非 four-line 分支改成：

```ts
  // Pad content to the next cellsPerPage(paperSize) multiple so the final
  // page is full of practice cells (empty char === blank cell — WorksheetCell
  // draws the grid/lines but omits the letter). Without this, a 50-char
  // worksheet on A4 (88 cells/page) renders only 50 cells and the page
  // has 38 missing slots — printers / users see a short sheet instead of
  // a full practice page. Math.max guards the empty-content case so we
  // still return one full page of blanks (defensive — UI hides empty
  // previews via canPreview, but the helper must not return []).
  const perPage = cellsPerPage(paperSize ?? 'A4');
  const total = Math.max(perPage, Math.ceil(content.length / perPage) * perPage);
  // ⚠️ The trace layout fills every cell with the content REPEATED, so a
  // one-character worksheet on an 88-cell page is 88 practice cells
  // instead of one character and 87 blank ones. A non-trace sheet keeps
  // the blank cells: those are the places to write a character of a
  // longer text, and repeating the content there would copy it over
  // the handwriting.
  //
  // The content is ONE stream across all the pages: cell 88 continues
  // where cell 87 stopped. It only wraps around at the very end, so
  // "fill the page to the last cell" means what it says.
  const isTrace = getIsTrace(style);
  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    if (isTrace && content.length > 0) {
      cells.push({ char: content[i % content.length], style, index: i });
    } else {
      cells.push({ char: i < content.length ? content[i] : '', style, index: i });
    }
  }
  return cells;
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: **PASS** —— 新增的 6 个 case 全绿，现有 case 也全绿。

- [ ] **Step 5: 变异验证（证明测试真的会红）**

临时把 `content[i % content.length]` 改成 `content[0]`，跑测试。

Expected: `cycles through the characters in order` 和 `runs the content on across the page break` **FAIL**（前者第二个格子是「永」不是「安」，后者第 88 格是「字0」不是「字88」）。

改回来。

再做第二次变异：把 `isTrace && content.length > 0` 改成 `true`（去掉空内容保护）。

Expected: `leaves a trace sheet blank when there is no content` **FAIL**（`NaN`）。

改回来。

- [ ] **Step 6: 跑类型检查**

Run: `npx tsc --noEmit`

Expected: 无输出（干净）。

- [ ] **Step 7: 提交**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): the trace sheet fills every cell with the content [YYYY-MM-DD HH.MM]"
```

**Commit 正文里要写清楚**：内容是一条流，跨页连续，只在末尾回绕；非描红模式不变。

---

## Task 2: 循环铺满英文四线格

**Files:**
- Modify: `lib/worksheet-types.ts`（新增 `repeatToFill` helper + 改 `generateLayout` 的 four-line 分支）
- Test: `tests/unit/lib/worksheet-types.test.ts`

**Interfaces:**
- Consumes: `englishCharsPerRow(paperSize: PaperSize): number`（A4=88, A3=168, B5=48）、`fourLineRowsPerPage(paperSize: PaperSize): number`（A4=16, A3=21, B5=12）—— 都已在 `lib/worksheet-types.ts` 中定义
- Produces: **`repeatToFill(content: string[], length: number): string`** —— 新导出。返回恰好 `length` 个字符的重复串；`content` 为空返回 `''`。

**背景：** 四线格现在按顺序切片（`content.slice(i, i + perRow)`），内容用完就留空行。用户要的是**每一行的最后一个字母位置也有内容**。整份四线格是一条流：先把内容循环到 `rowsTotal × perRow` 长度，再按行切片。

**⚠️ 本任务会改变 3 个现有测试** —— 它们断言旧的「切片 + 空白」行为。这是 spec 内的行为变更，不是外加行为。

- [ ] **Step 1: 写失败的测试 —— 先加 `repeatToFill` 的**

在 `tests/unit/lib/worksheet-types.test.ts` 里新增（放在文件末尾）：

```ts
describe('repeatToFill', () => {
  it('repeats the content to the requested length', () => {
    expect(repeatToFill(['a', 'b', 'c'], 8)).toBe('abcabcab');
  });

  it('truncates instead of overflowing', () => {
    expect(repeatToFill(['abc'], 5)).toBe('abcab');
  });

  it('returns an empty string for no content', () => {
    expect(repeatToFill([], 10)).toBe('');
  });

  it('returns an empty string for a zero length', () => {
    expect(repeatToFill(['a'], 0)).toBe('');
  });
});
```

同时在该文件的 import 里加上 `repeatToFill` —— 该文件现在用的是多行 import 块（第 2-10 行），在 `generateLayout,` 后面加一行：

```ts
import {
  getPresentation,
  cellStyleLabel,
  linedHeightPx,
  linesPerPage,
  PRACTICE_GRID_CELL_SIZE,
  generateLayout,
  repeatToFill,
  validateWorksheetInput,
} from '@/lib/worksheet-types';
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: **FAIL** —— `repeatToFill is not a function`（TS 编译错误或运行时 undefined）。

- [ ] **Step 3: 实现 `repeatToFill`**

在 `lib/worksheet-types.ts` 里，`generateLayout` 之前加上：

```ts
/**
 * Repeats `content` until it is exactly `length` characters long.
 *
 * The trace layout fills a page by repeating what the user typed, so a
 * 3-character worksheet on an 88-cell page shows the same three
 * characters in every cell. The repeat is TRUNCATED to `length` — a
 * row that overflowed its cell would push the grid onto a second page.
 *
 * @param content the characters to repeat.
 * @param length how many characters the result must have.
 * @returns the repeated string, exactly `length` characters.
 */
export function repeatToFill(content: string[], length: number): string {
  if (content.length === 0) return '';
  const source = content.join('');
  if (source === '') return '';
  const repeats = Math.ceil(length / source.length);
  return source.repeat(repeats).slice(0, length);
}
```

- [ ] **Step 4: 跑测试，确认 `repeatToFill` 的 case 绿了**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: `repeatToFill` 的 4 个 case **PASS**；four-line 的现有 case 仍然全绿（还没改行为）。

- [ ] **Step 5: 写失败的测试 —— four-line 的新行为**

在 `describe('generateLayout — trace fills the page by repeating the content')` block 里追加：

```ts
  it('fills the four-line rows with the repeated letters', () => {
    // A4: 88 letters per row, 16 rows.
    const cells = generateLayout(['a', 'b', 'c'], 'pen-english', 'A4');
    expect(cells).toHaveLength(16);
    expect(cells[0].char).toHaveLength(88);
    expect(cells[0].char).toBe('abcabcabc');
    expect(cells[15].char).toHaveLength(88);
  });

  it('runs the four-line letters on across the row break', () => {
    // 89 letters on A4: row 0 holds the first 88, row 1 continues with
    // the 89th and then wraps around.
    const letters = Array.from({ length: 89 }, (_, i) => String.fromCharCode(65 + (i % 26)));
    const cells = generateLayout(letters, 'pen-english', 'A4');
    expect(cells[0].char).toBe(letters.slice(0, 88).join(''));
    expect(cells[1].char).toHaveLength(88);
    expect(cells[1].char[0]).toBe(letters[88]);
    expect(cells[1].char[1]).toBe(letters[0]);
  });

  it('fills a four-line row exactly, never past the row width', () => {
    const cells = generateLayout(['x'], 'pen-english', 'B5');
    expect(cells[0].char).toHaveLength(48);
    expect(cells[0].char).toBe('x'.repeat(48));
  });

  it('leaves the four-line rows blank when there is no content', () => {
    const cells = generateLayout([], 'pen-english', 'A4');
    expect(cells).toHaveLength(16);
    expect(cells.every((c) => c.char === '')).toBe(true);
  });
```

- [ ] **Step 6: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: **FAIL** —— `fills the four-line rows with the repeated letters` 期望 `cells[15].char` 长度 88，实际是 `''`；`runs the four-line letters on across the row break` 期望 `cells[1].char[0]` 是 `letters[88]`，实际是 `''`（第 2 行现在只有第 89 个字母，后面的都是空）。

- [ ] **Step 7: 实现 four-line 的循环**

把 `lib/worksheet-types.ts` 的 `generateLayout` 的 four-line 分支改成：

```ts
  if (getPresentation(style) === 'four-line') {
    const perRow = paperSize ? englishCharsPerRow(paperSize) : 88;
    const rowsTotal = paperSize ? fourLineRowsPerPage(paperSize) : 14;
    const cells: Cell[] = [];
    // ⚠️ The four-line paper has exactly ONE presentation: the trace
    // layout (the pale red-outlined letters ARE the guide). So its rows
    // are always filled by repeating what the user typed — there is no
    // non-trace four-line style to leave blank.
    //
    // The whole sheet is ONE stream: the letters run from the first
    // cell of the first row to the last cell of the last row, and only
    // wraps around at the very end. A row is therefore a slice of that
    // stream, not a repetition of the content on its own.
    const stream = repeatToFill(content, rowsTotal * perRow);
    for (let rowIdx = 0; rowIdx < rowsTotal; rowIdx++) {
      const start = rowIdx * perRow;
      cells.push({ char: stream.slice(start, start + perRow), style, index: rowIdx });
    }
    return cells;
  }
```

- [ ] **Step 8: 改 3 个现有测试**

`tests/unit/lib/worksheet-types.test.ts` 的 `describe('generateLayout — four-line row packing (English trace)')` 里有 3 个 case 断言旧行为，必须改：

**case 1** —— `packs 88 letters into a single A4 row; fills the rest of the page with blanks`

改前：

```ts
    expect(cells[0].char).toBe(letters.join(''));
    expect(cells[0].style).toBe('pen-english');
    expect(cells.slice(1).every((c) => c.char === '')).toBe(true);
```

改后：

```ts
    expect(cells[0].char).toBe(letters.join(''));
    expect(cells[0].style).toBe('pen-english');
    // The sheet is one stream: every row repeats the same 88 letters.
    expect(cells.slice(1).every((c) => c.char === cells[0].char)).toBe(true);
```

**case 2** —— `always renders rowsPerPage rows even with short content (blank practice lines fill the page)`

改前：

```ts
    expect(cells[0].char).toBe('A');
    expect(cells.slice(1).every((c) => c.char === '')).toBe(true);
```

改后：

```ts
    expect(cells[0].char).toBe('A'.repeat(88));
    expect(cells.slice(1).every((c) => c.char === cells[0].char)).toBe(true);
```

**case 3** —— `splits 89 letters across 2 A4 rows; the rest of the page is blank practice`

改前：

```ts
    expect(cells[0].char).toHaveLength(88);
    expect(cells[1].char).toHaveLength(1);
    expect(cells.slice(2).every((c) => c.char === '')).toBe(true);
```

改后：

```ts
    expect(cells[0].char).toHaveLength(88);
    // Row 1 continues with the 89th letter and then wraps around.
    expect(cells[1].char).toHaveLength(88);
    expect(cells[1].char[0]).toBe(letters[88]);
    expect(cells[1].char[1]).toBe(letters[0]);
    expect(cells.slice(2).every((c) => c.char === cells[0].char)).toBe(true);
```

⚠️ 改完后**这 3 个 case 的标题也要改** —— 标题里的 "fills the rest of the page with blanks" / "blank practice lines fill the page" / "the rest of the page is blank practice" 都不再成立。新标题：

1. `packs 88 letters into a single A4 row; every row repeats them`
2. `always renders rowsPerPage rows even with short content (the letters repeat to fill the page)`
3. `splits 89 letters across 2 A4 rows; the second row continues and wraps around`

- [ ] **Step 9: 跑测试，确认全绿**

Run: `npx vitest run tests/unit/lib/worksheet-types.test.ts`

Expected: **PASS** —— 所有 case 全绿。

- [ ] **Step 10: 变异验证**

临时把 `repeatToFill(content, rowsTotal * perRow)` 改成 `repeatToFill(content, perRow)`（每行各自循环，而不是一条流）。

Expected: `runs the four-line letters on across the row break` **FAIL**（第 2 行开头会变成 `letters[0]` 而不是 `letters[88]`）。

改回来。

再做第二次变异：把 `stream.slice(start, start + perRow)` 改成 `stream.slice(start)`。

Expected: `fills a four-line row exactly, never past the row width` **FAIL**（行长度会一路增长到 1408）。

改回来。

- [ ] **Step 11: 跑类型检查**

Run: `npx tsc --noEmit`

Expected: 无输出（干净）。

- [ ] **Step 12: 提交**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): the four-line trace sheet fills every row [YYYY-MM-DD HH.MM]"
```

**Commit 正文里要写清楚**：四线格从「切片 + 空白行」变成「一条流铺满每一行的最后一个位置」—— 这是行为变更，影响「用四线格抄长文」的体验。

---

## Task 3: 真机验证

**Files:**
- 不改代码（只有当真机走查发现问题时才改）

**Interfaces:**
- Consumes: Task 1 + Task 2 的 `generateLayout` 行为
- Produces: 走查记录（写进最终报告，不进仓库）

**背景：** 这次改动影响**打印出来的样子**，单元测试只能证明「格子里填了什么字符」，证明不了「打印出来是一页铺满的浅灰范字」。按项目的规矩，环境依赖类的代码光有注入测试不够。

**⚠️ 真机走查前先确认 dev server 在跑**，且**不要在 dev server 存活时 build**。

- [ ] **Step 1: 确认 dev server 存活**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4444/worksheet`

Expected: `200`。

如果 4444 没起，看 `npm run dev` 的日志确认端口；**不要在已有 dev server 存活时跑 `npm run build`**。

- [ ] **Step 2: 用 CDP 驱动浏览器走查**

用项目已有的 CDP 走查手法（参考 `memory/browser-walkthrough-tooling`：不引新依赖，用 Chrome DevTools Protocol 驱动本机 Chrome）。

⚠️ `document.cookie` 需要真实 origin —— **先导航到页面，再设 cookie**。

走查这 6 步，每一步都要记录截图或读到的 DOM：

1. 打开 `http://localhost:4444/worksheet`
2. 切到「自由输入」tab → 输入 `永`
3. 工具选「毛笔」→ 格子选「田字格」→ **勾上「描红」** → 纸张选「24 字 · 毛笔」→ 点「生成字帖」
   - **期望**：预览显示 24 格，**每格都是浅灰「永」**，每格带红色描边
4. 取消「描红」→ 点「返回修改」→ 再「生成字帖」
   - **期望**：预览显示 1 个「永」+ 23 个空格（**非描红行为不变**）
5. 输入 `永安乐` → 「生成字帖」
   - **期望**：预览按 `永 安 乐 永 安 乐 ...` 循环
6. 切到「英文描红」tab → 输入 `abc` → 「生成字帖」
   - **期望**：预览显示 16 行，每行 88 个字母 `abcabcabc...`，浅灰带红边

- [ ] **Step 3: 打印媒体的实测（不是看代码）**

⚠️ 打印白名单只能靠 `setEmulatedMedia` 实测（`memory/browser-walkthrough-tooling`）。

用 CDP 的 `Emulation.setEmulatedMedia`（`media: 'print'`）然后量 DOM：

- 汉字格描红页：`.worksheet-grid` 的高度是否 ≤ A4 可打印区（**不能溢出到第二页**）
- 四线格：每行的 `.four-line-paper-row` 高度是否固定 38px（**每行多一个字母就会挤到第二页**）

- [ ] **Step 4: 确认没有第二页**

`PrintButton` 的 `gate="multi_page"` 依赖 `pageCountFor` —— trace 模式没改页数计算，所以单页字帖仍应是 1 页。

⚠️ 如果走查发现页数变了，说明 `total` 的计算被改坏了 —— 那是 bug，回 Task 1 查。

- [ ] **Step 5: 跑全量测试套件**

Run: `npx vitest run`

Expected: 全绿。

- [ ] **Step 6: 报告**

最终报告里写明：真机走查的 6 步各自的结果、打印媒体实测的数字、有没有发现问题。

---

## Verification

### 自动化

- `npx vitest run tests/unit/lib/worksheet-types.test.ts` —— Task 1、2 的 case 全绿
- `npx vitest run` —— 全绿（回归覆盖）
- `npx tsc --noEmit` —— 干净

### 真机（Task 3）

- 汉字格描红页：24 格全是浅灰「永」+ 红边
- 非描红页：1 个「永」+ 23 个空格
- 英文四线格：16 行，每行 88 个字母
- 打印媒体下不溢出到第二页

## Commit Summary

2 个 commit on local main：

1. `feat(worksheet): the trace sheet fills every cell with the content [YYYY-MM-DD HH.MM]`
2. `feat(worksheet): the four-line trace sheet fills every row [YYYY-MM-DD HH.MM]`

按 `memory/no-prod-env-2026-06-21`，**不 push**。

## Notes / Risks

- **`repeatToFill` 的 `.length` 计数** —— 它处理的是英文字母（A-Z/a-z），BMP 内，`.length` 等于字符数。英文描红只接受 ASCII 字母（`SINGLE_LATIN` 校验），不存在代理对问题。汉字格走 `content[i % content.length]`，不经过 `repeatToFill`。
- **`content.length > perPage` 时页数偏多** —— trace 模式下 100 字 + A4 是 2 页（第 2 页开头接着第 88 字，末尾循环回绕填满）。这是既有 auto-fill 行为的延续（非 trace 也是 2 页），页数计算不变 → 会员门槛不变。
- **四线格的行为变更影响抄写长文本** —— 改前「逐行切片，内容用完就留空行」，改后「每行最后一个位置也有内容（循环回绕）」。用户的需求明确指向铺满，但「用四线格抄一段长英文」的体验变了：抄完那 200 个字母后，后面的行会是循环内容而不是空行。**这是 spec 里明确标出的取舍**。
- **`.tmp/` 里有旧副本** —— `E:\ToolDevelop\PinYinCharacter\.tmp\up-old-2026-11-04-1552\` 和 `.tmp\up-mut-2\` 里也有 `worksheet-types.ts`。它们被 vitest 的 `exclude: ['.tmp/**']` 排除，不会被测试跑到；eslint 的 ignores 里有 `.tmp/**`，也不会被扫到。**改动只针对 `lib/worksheet-types.ts`**。
- **`WorksheetPreview` 的 breakpoints** —— `breakpoints` 是 cell index 的 `Set`，padding 加的格子 index 不会进 breakpoints（`buildBreakpoints` 走 chapter content 的长度）。循环填满不改变 index 语义（`total` 的算法没变）。
- **`PracticeTemplate` / `PracticePDF`** —— 不经过 `generateLayout`，不受影响。
