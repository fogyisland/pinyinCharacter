# 字帖描红 · 循环填满整页 — 设计文档

**Goal:** 在描红（trace）模式下，把每一页的格子用**循环重复**的内容填满，而不是留空白格 —— 学生拿到的是一张「整页都是浅色范字、可以直接在上面描红」的练习纸。

**Architecture:** 改 `lib/worksheet-types.ts` 的 `generateLayout`，在**已有的 auto-fill（补空白格）** 基础上，把补位从 `''`（空白）改成**循环重复的内容**。触发条件只有一条：**cellStyle 是 trace 样式**。非 trace 样式的行为完全不变（仍然补空白格）。汉字格（square/cross）一格一字循环；英文四线格（four-line）一行一串字母循环。

**Tech Stack:** React 19, Next.js 15.5.29, Vitest 4.1.12 + happy-dom. 纯 TypeScript helper 改动 + 单元测试。**零新增依赖。**

---

## Global Constraints

- **只在描红模式下生效** —— 非 trace 样式（`brush-square` / `brush-cross` / `pen-square` / `pen-cross` / `pen-lined` / `pen-english`）行为**一字不变**
- **不加 UI toggle** —— 描红本来就意味着「照着描」，填满是它该有的样子。理由同 auto-fill spec：用户没意识到「不满一页」是 bug
- **不加新 cell style** —— 沿用现有 `brush-trace-square` / `brush-trace-cross` / `pen-english`
- **不加新纸张尺寸** —— 每种纸张用它自己的格数（A3=168, A4=88, B5=48, 毛笔 12/24/28）
- **不改 save 路径** —— DB 里存的仍是用户输入的原始 content，循环重复是**渲染层**的计算。`pageCountFor` / `exceedsFreeLimit`（会员门槛）语义不变
- **不动 `PracticeTemplate.tsx` / `PracticePDF.tsx`** —— 它们走自己的 `Array.from({length: count})`，不经过 `generateLayout`
- **文件改动限制:** `lib/worksheet-types.ts` + `tests/unit/lib/worksheet-types.test.ts`（+ 可能 `tests/unit/app/brush-print-a4.test.ts` 如果有 pin）
- **不加新 API / 新页面 / 新 deps**

---

## Concept

### 当前行为

`generateLayout(content, style, paperSize)` 已经把内容 pad 到整页（auto-fill spec，`2026-07-04-worksheet-auto-fill-design.md`），但补的是**空白格**：

```
输入 '永' + 毛笔 24 格纸 → 24 cells
├── cell 0:  '永'   ← 有字
└── cell 1-23: ''  ← 空格子（有格框和引导线，没有字）
```

结果：一张 24 格的纸上只有 1 个字可描，其余 23 格是废格。

### 期望行为

**描红模式下**，整份内容铺到最后一页的最后一个格子：

```
输入 '永' + 毛笔 24 格纸 → 24 cells（trace）
├── cell 0:  '永'
├── cell 1:  '永'
├── ...
└── cell 23: '永'    ← 整页都是浅灰范字，每格都能描

输入 ['永','安','乐'] + 毛笔 24 格纸 → 24 cells（trace）
├── cell 0:  '永'
├── cell 1:  '安'
├── cell 2:  '乐'
├── cell 3:  '永'    ← 循环
└── ...
```

**内容是一条连续的流，跨页不断开** —— 只在整份内容的末尾回绕一次：

```
输入 100 字 + A4（88 格/页）→ 176 格，2 页
├── 第 1 页 (88 格): 字0 字1 字2 ... 字86 字87
└── 第 2 页 (88 格): 字88 字89 字90 ... 字99
                     字0  字1  字2  ... 字72 字73 字74 字75
                     ↑ 接着第 1 页排；排到最后一格（第 2 页第 88 格 = 字75）
```

英文四线格同理，只是「格子」是行内的字母位置：

```
输入 'abc' + A4 四线格（每行 88 字母，每页 16 行 = 1408 个位置）→ 16 行
├── row 0:  'abcabcabc...abc'   (88 字母)
├── row 1:  'abcabcabc...abc'
└── row 15: 'abcabcabc...abc'   ← 最后一行的最后一个字母位置也有内容
```

**非描红模式完全不变**：

```
输入 '永' + 毛笔 24 格纸 → 24 cells（non-trace）
├── cell 0:  '永'
└── cell 1-23: ''     ← 仍然是空白格
```

---

## 设计决策

### 决策 1：循环发生在哪一层？

**汉字格**：一格一字，循环在**字符**层面 —— `content[i % content.length]`。

**英文四线格**：一行一串字母，循环在**字母串**层面 —— 先把 content 拼成一个串，再循环到每行的长度。

为什么不统一成「字符层面」？因为四线格的 `Cell.char` 是整行字符串（`'Hello World'`），不是单字符。要填满一行 88 个字母，得先算出这一行该是什么。

### 决策 2：循环的边界 —— 内容是一条连续的流

**整份内容是一个环，铺满所有格子的最后一格。**

具体算法（汉字格）：

```
perPage = cellsPerPage(paperSize)
total   = max(perPage, ceil(content.length / perPage) * perPage)
cell[i] = content[i % content.length]     ← trace 模式
```

`i % content.length` 让内容**跨页连续**：第 1 页排完前 88 个字，第 2 页开头接着第 89 个字继续，不是每页从头开始。

```
输入 100 字 + A4（88 格/页）→ 176 格，2 页
├── 第 1 页 (88 格): 字0 字1 字2 ... 字86 字87
└── 第 2 页 (88 格): 字88 字89 字90 ... 字99
                     字0  字1  字2  ... 字72 字73 字74 字75
                     ↑ 接着第 1 页排；排到最后一个格子（第 2 页第 88 格 = 字75）
```

**「铺到最后一个格子」就是这个意思** —— 循环只在整份内容的末尾回绕一次，不在每页的边界回绕。

⚠️ 与「每页从头循环」的区别：如果每页独立循环，第 2 页开头会是 `字0`；这里第 2 页开头是 `字88`（接着排）。

**content 为空怎么办？**

`content.length === 0` 时不能取模。回退到原来的补空白行为（返回一页空白格）。`WorksheetGenerator` 的 `canPreview` 已经禁用空内容按钮，这里是 defensive。

### 决策 3：英文四线格怎么算「一行」？

四线格现有逻辑（`generateLayout` 的 four-line 分支）：

```
perRow    = englishCharsPerRow(paperSize)   // A4=88, A3=168, B5=48
rowsTotal = fourLineRowsPerPage(paperSize)  // A4=16, A3=21, B5=12
row.char  = content.slice(i, i + perRow).join('')
```

**注意**：four-line 分支目前**不 pad**，它总是渲染 `rowsTotal` 行，超出 content 的行是空行（`''`）。所以英文那边**已经是「填满整页」**了 —— 只是填的是空行。

新的 trace 行为：**整份四线格内容也是一条连续的流**，从第一个字母开始，一路铺到最后一行的最后一个字母位置。

```
输入 'abc' + A4（每行 88 字母，16 行 = 1408 个位置）
├── row 0:  'abcabcabc...abc'   (88 个字母)
├── row 1:  'abcabcabc...abc'
└── row 15: 'abcabcabc...abc'   ← 最后一行的最后一个字母位置也有内容
```

**关键**：整份内容先拼成一个串，循环到 **总长度 = `rowsTotal × perRow`**，然后按 `perRow` 切片成行。

```
total = 16 × 88 = 1408
stream = 'abc'.repeat(ceil(1408/3)).slice(0, 1408)   ← 1408 个字母
row[i] = stream.slice(i * perRow, (i+1) * perRow)      ← 每行恰好 88 个
```

**这与汉字格是同一套逻辑**，只是「格子」变成了「行内的字母位置」。

⚠️ **一个必须说清的行为变更**：改前四线格是**按顺序切片**（第 1 行是前 88 个字母，第 2 行接着的 88 个），内容用完就留空行。改后**每一行的最后一个字母位置都有内容**（循环回绕）。

如果用户输入 200 个字母 + A4：
- 改前：row0 = 第1-88个, row1 = 第89-176个, row2 = 第177-200个 + 空白, row3-15 全空
- 改后：row0 = 第1-88个, row1 = 第89-176个, row2 = 第177-200个 + 循环回绕填满, row3-15 = 循环内容

**这是用户要的**（「铺到最后一个格子」）。

### 决策 4：什么算「描红模式」？

用现有的 `getIsTrace(style)`：

```ts
export function getIsTrace(s: CellStyle): boolean {
  return s.includes('-trace-');
}
```

它返回 `true` 的样式：`brush-trace-square`、`brush-trace-cross`。

**英文四线格（`pen-english`）怎么办？**

`pen-english` 的名字里没有 `-trace-`，所以 `getIsTrace('pen-english')` 是 `false`。但：
1. 它的 tab 名就叫「英文描红」
2. 它的渲染本来就是浅色范字（`fill="#ddd" stroke="#c0392b"`）
3. 用户明确选了「两者都要」

**所以：four-line 分支的循环不看 `getIsTrace`，而是永远循环** —— 因为 four-line 只有「描红」这一种呈现（`pen-english` 是唯一的 four-line 样式，没有非描红的四线格）。

这需要在本 spec 里明确写出来，否则实现者会以为 four-line 也要加 toggle。

**更精确地说**：判定条件是「这个 cellStyle 的呈现方式是描红」，对汉字格 = `getIsTrace(style)`，对 four-line = `true`（因为 four-line 只有描红一种）。

### 决策 5：浅灰色实心字

**已经存在**，不需要改渲染。

`WorksheetCell.tsx` 里：

```ts
const charFill = isTrace ? '#ddd' : '#bbb';        // 描红=浅灰，普通=更浅
const charStroke = isTrace ? '#c0392b' : 'none';   // 描红=红色描边
```

- 汉字格描红：`fill="#ddd"` 浅灰实心 + `#c0392b` 红边 ✓
- 四线格：`fill="#ddd"` 浅灰 + `#c0392b` 红边 ✓（写死在 four-line 分支里）

**「实心」** —— 是的，`fill` 是实心的（不是虚线空心字）。这与用户选的「浅灰色实心字」一致。

**一个已知的小差异**：汉字格的 `guideFontSize` 在 trace 模式下是 `size`（满格），非 trace 是 `size * 0.6`（小字）。也就是说描红的字**比普通字大**。这是既有行为，不改。

### 决策 6：`content` 长度是 1 时

`content.length === 1` → `i % 1 === 0`，永远是那一个字。正确。

### 决策 7：`content.length > perPage` 时的页数

不变。`total = max(perPage, ceil(content.length / perPage) * perPage)`。trace 只改变每格**显示什么**，不改变**有多少格**。

⚠️ 这意味着 trace 模式下**页数可能比需要的多**。例如输入 100 字 + A4 描红 → 176 格 = 2 页，而第 2 页的内容是循环来的。用户输入 100 字本来就要练 100 字，多一页循环内容可能不是他想要的。

**但这是既有 auto-fill 行为的延续** —— 非 trace 模式下 100 字 + A4 也是 2 页（第 2 页 12 字 + 76 空白）。所以行为一致。

**页数计算不变** → 会员门槛不变 → 不需要改 `pageCountFor` / `exceedsFreeLimit`。

---

## File-by-File Changes

### `lib/worksheet-types.ts`

**改动 1: 新增 helper `repeatToFill`**

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

**改动 2: `generateLayout` 的 four-line 分支**

修改前：

```ts
if (getPresentation(style) === 'four-line') {
  const perRow = paperSize ? englishCharsPerRow(paperSize) : 88;
  const rowsTotal = paperSize ? fourLineRowsPerPage(paperSize) : 14;
  const cells: Cell[] = [];
  let i = 0;
  let rowIdx = 0;
  while (rowIdx < rowsTotal) {
    const slice = i < content.length ? content.slice(i, i + perRow).join('') : '';
    cells.push({ char: slice, style, index: rowIdx });
    i += perRow;
    rowIdx++;
  }
  return cells;
}
```

修改后：

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
  // The whole sheet is ONE stream: the letters run from the first cell
  // of the first row to the last cell of the last row, and only wrap
  // around at the very end. A row is therefore a slice of that stream,
  // not a repetition of the content on its own.
  const stream = repeatToFill(content, rowsTotal * perRow);
  for (let rowIdx = 0; rowIdx < rowsTotal; rowIdx++) {
    const start = rowIdx * perRow;
    cells.push({ char: stream.slice(start, start + perRow), style, index: rowIdx });
  }
  return cells;
}
```

⚠️ **注意这是一个行为变更**：原来四线格是**按顺序切片**（第 1 行是前 88 个字母，第 2 行接着的 88 个），内容用完就留空行。改后**每一行的最后一个字母位置都有内容**（循环回绕）。

例如 content = 200 个字母 + A4：
- 改前：row0 = 第1-88个, row1 = 第89-176个, row2 = 第177-200个 + 空, row3-15 全空
- 改后：row0 = 第1-88个, row1 = 第89-176个, row2 = 第177-200个 + 循环回绕填满, row3-15 = 循环内容

**这是用户要的**（「铺到最后一个格子」）。

**改动 3: `generateLayout` 的非 four-line 分支**

修改前：

```ts
const perPage = cellsPerPage(paperSize ?? 'A4');
const total = Math.max(perPage, Math.ceil(content.length / perPage) * perPage);
const cells: Cell[] = [];
for (let i = 0; i < total; i++) {
  cells.push({ char: i < content.length ? content[i] : '', style, index: i });
}
return cells;
```

修改后：

```ts
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

### `tests/unit/lib/worksheet-types.test.ts`

**⚠️ 3 个现有 four-line 测试必须改** —— 它们断言的是「按顺序切片 + 其余空白」，与新的循环行为冲突。这在 spec 内，不是外加行为。

| 测试 | 现有断言 | 新断言 |
|---|---|---|
| `packs 88 letters into a single A4 row; fills the rest of the page with blanks` | `cells[0].char === letters.join('')`；`cells.slice(1)` 全是 `''` | `cells[0].char === letters.join('')`（88 个字母刚好一行，循环后不变）；`cells.slice(1)` **全等于 `cells[0].char`**（88 个字母循环） |
| `always renders rowsPerPage rows even with short content (blank practice lines fill the page)` | `cells[0].char === 'A'`；`cells.slice(1)` 全是 `''` | `cells[0].char === 'A'.repeat(88)`；`cells.slice(1)` 全等于 `cells[0].char` |
| `splits 89 letters across 2 A4 rows; the rest of the page is blank practice` | `cells[1].char.length === 1`；`cells.slice(2)` 全是 `''` | `cells[1].char === letters.join('')`（第 2 行从第 1 个字母重新循环）；`cells.slice(2)` 全等于 `cells[0].char` |

**新增 describe block** `generateLayout — trace fills the page by repeating the content`:

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

  it('fills the four-line rows with the repeated letters', () => {
    // A4: 88 letters per row, 16 rows → 1408 positions.
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
});
```

**新增 describe block** `repeatToFill`:

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

---

## Verification

### 自动化

- `npx vitest run tests/unit/lib/worksheet-types.test.ts` —— 新增 case 全绿
- `npx vitest run` —— 全绿（回归覆盖）
- `npx tsc --noEmit` —— 干净

⚠️ **可能受影响的现有测试**：`tests/unit/lib/worksheet-types.test.ts` 里 four-line 的现有测试断言「按顺序切片」。**必须改成新断言**（这在 spec 内，不是外加行为）。

### 浏览器 smoke（人工）

1. `http://localhost:4444/worksheet` → 「自由输入」tab → 输入 `永`
2. 工具选「毛笔」→ 格子选「田字格」→ **勾上「描红」** → 纸张选「24 字 · 毛笔」
3. 点「生成字帖」→ 预览应显示 **24 格全是浅灰「永」**，每格带红色描边
4. 取消「描红」→ 预览应显示 1 个「永」+ 23 个空格（**非描红行为不变**）
5. 输入 `永安乐` → 预览应显示 `永 安 乐 永 安 乐 ...` 循环
6. 切到「英文描红」tab → 输入 `abc` → 预览应显示 16 行，每行 88 个字母 `abcabcabc...`，浅灰带红边
7. 「保存」→ `/api/worksheets` POST → 跳 `/worksheet/[id]` → 预览仍是循环填满（padding 在前端重算，DB 里存的还是 `['永']`）

---

## Notes / Risks

- **`content.length > perPage` 时页数可能偏多** —— trace 模式下 100 字 + A4 是 2 页，第 2 页开头接着第 88 字继续，末尾循环回绕填满。这是既有 auto-fill 行为的延续（非 trace 也是 2 页），页数计算不变 → 会员门槛不变。
- **四线格的行为变更影响抄写长文本** —— 改前是「逐行切片，内容用完就留空行」，改后「每行最后一个位置也有内容（循环回绕）」。用户的需求明确指向铺满，但「用四线格抄一段长英文」的体验变了：现在那 200 个字母抄完，后面几行会是循环内容而不是空行。已在本 spec 的「设计决策 3」里标出。
- **`repeatToFill` 用 `.slice(0, length)` 截断** —— `repeatToFill` 处理的是英文字母（A-Z/a-z），BMP 内，`.length` 等于字符数。**但保险起见用 `Array.from()` 计数**？—— 英文描红只接受 ASCII 字母（`SINGLE_LATIN`），不存在代理对问题，`.length` 安全。汉字格走 `content[i % content.length]`，不经过 `repeatToFill`。
- **`getIsTrace` 对 `pen-english` 返回 false** —— 这正是需要 four-line 分支单独处理的原因。已核实：`pen-english` 是唯一的 four-line 样式，且它在 `WorksheetCell` 的 four-line 分支里**写死** `fill="#ddd"` + `stroke="#c0392b"`（浅灰范字 + 红边），不存在「非描红的四线格」。
- **`.tmp/` 里有旧副本** —— `E:\ToolDevelop\PinYinCharacter\.tmp\up-old-2026-11-04-1552\` 和 `.tmp\up-mut-2\` 是旧版本的拷贝，里面也有 `worksheet-types.ts`。**它们被 vitest 的 `exclude: ['.tmp/**']` 排除，不会被测试跑到**；但 `eslint .` 会扫到（eslint 的 ignores 里有 `.tmp/**`，所以也不会）。改动只针对 `lib/worksheet-types.ts`。
- **`WorksheetPreview` 的 breakpoints** —— `breakpoints` 是 cell index 的 `Set`，padding 加的格子 index 不会进 breakpoints（`buildBreakpoints` 走 chapter content 的长度）。循环填满不改变 index 语义。**但** trace 模式下 `total` 不变（还是按 content.length 算的页数），所以 index 范围也不变。
- **保存后重新打开** —— `/worksheet/[id]` 从 DB 读 content（原始长度）再走同一个 `generateLayout`，循环会重新算出来。不需要存任何新字段。
- **`PracticeTemplate` / `PracticePDF`** —— 不经过 `generateLayout`，不受影响。
