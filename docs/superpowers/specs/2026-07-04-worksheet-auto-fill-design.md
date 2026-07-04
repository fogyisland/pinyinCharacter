# Worksheet Auto-Fill Empty Cells — 最后一页不满时填满空白格子

**Goal:** 当 WorksheetGenerator 输入的字符数不能填满一页 (cellsPerPage(paperSize) 的倍数) 时,自动把最后那页补成空白格子 (char === ''),让用户拿到一张"格子铺满整页"的字帖 — 适配抄写/练字场景。

**Architecture:** 改 `lib/worksheet-types.ts:generateLayout` (非 four-line 分支),把 `content.map(...)` 改成把 content pad 到下一个 cellsPerPage(paperSize) 倍数。padding 部分 `char === ''`,WorksheetCell 已经在 `char === ''` 时不渲染 letter,只画格子框/横线/4-line 规则。Save 路径不存 padding — DB content 保持原始 length,exceedsFreeLimit 计算保持原语义。

**Tech Stack:** React 19, Next.js 15.5.19, Vitest + happy-dom. 纯 TypeScript helper 改动 + 单元测试。

## Global Constraints

- 不加 UI toggle (opt-out) — 默认开启,理由: 用户没意识到"不满一页"是 bug
- 不加数据迁移 — content 仍存原始 length,padding 是渲染层计算
- 不加新 cell style — 沿用现有 square/cross/lined/four-line
- 不动 `PracticeTemplate.tsx` / `PracticePDF.tsx` — 它们走自己的 `Array.from({length: count})`,不经过 generateLayout,本来就是填满的
- 不动 four-line 路径 — 它已经有自己的 pad 逻辑 (worksheet-types.ts:250-263),保留
- 不动 Save 路径 (`POST /api/worksheets`) — content 长度不变,exceedsFreeLimit 不变,会员门槛不变
- 不动 PrintButton / PrintButton 的 gate — pageCount 计算不变
- 文件改动限制: `lib/worksheet-types.ts` + `tests/unit/lib/worksheet-types.test.ts` 2 个文件
- 不加新 API / 新页面 / 新 deps

## Concept

### 当前行为

`generateLayout(content, style, paperSize)` 在 non-four-line 路径 (worksheet-types.ts:264) 是 `return content.map(...)`,cells 数等于 content length:

```
50 chars + A4 → 50 cells (1 页)
├── cells 0-49: 实际字符
└── cells 50-87: ❌ 不渲染 — WorksheetPreview 看到 cells.length=50,grid 50 个就停了

100 chars + A4 → 100 cells (2 页)
├── cells 0-87: 第 1 页 88 cells
└── cells 88-99: 第 2 页 12 cells,第 2 页剩 76 空格 ❌
```

后果: WorksheetPreview (WorksheetPreview.tsx:43) 渲染的 grid 只有实际字符数;打印时最后一页短一截,用户得自己塞空白格子。

### 期望行为

`generateLayout` 在 non-four-line 路径也把 cells pad 到下一个 cellsPerPage(paperSize) 倍数:

```
50 chars + A4 → 88 cells (1 页)
├── cells 0-49: 实际字符 (WorksheetCell 渲染 letter)
└── cells 50-87: char === '' (WorksheetCell 渲染格框 + 中心线,不渲染 letter)

1 char + A4 → 88 cells (1 页)  ← 用户可以"一页只练一字"
├── cells 0: '你'
└── cells 1-87: char === ''

89 chars + A4 → 176 cells (2 页)
├── cells 0-87: 第 1 页满 (88 字)
└── cells 88-175: 第 2 页 1 字 + 87 空白
```

### 为什么这样写

- WorksheetCell 已经有 `char === ''` 行为:
  - `pen-lined` (WorksheetCell.tsx:17-31): 不渲染 letter,只画 SVG 横线
  - `four-line` (WorksheetCell.tsx:57): `{char ? <text>...</text> : null}` — 空 char 不渲染 text 节点
  - `square`/`cross` (WorksheetCell.tsx:107-119): `<text>{char}</text>` — char 是空串,SVG text 节点为空,不显示字,只显示格框 + 引导线
- 仅改一个 helper,1 个 caller (WorksheetPreview.tsx:43) 自动获得统一行为
- PracticeTemplate / PracticePDF 路径不走 generateLayout,不受影响 — 它们本来就画满
- Save 路径不存 padding,`pageCountFor(content.length, paperSize)` 保持原语义,会员门槛不变

## File-by-File Changes

### `lib/worksheet-types.ts`

**`generateLayout` (line 245-265) 改动**: non-four-line 分支 pad 到 cellsPerPage(paperSize) 倍数。

修改前 (line 263-264):
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
  return content.map((char, index) => ({ char, style, index }));
```

修改后 (替换最后一行 + 加 helper):
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
  // Pad content to next cellsPerPage(paperSize) multiple so the final page
  // is full of practice cells (empty char === blank cell — WorksheetCell
  // draws the grid/lines but omits the letter). Without this, a 50-char
  // worksheet on A4 (88 cells/page) renders only 50 cells and the page
  // has 38 missing slots — printers / users see a short sheet instead of
  // a full practice page.
  const perPage = cellsPerPage(paperSize ?? 'A4');
  const total = Math.max(perPage, Math.ceil(content.length / perPage) * perPage);
  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    cells.push({ char: i < content.length ? content[i] : '', style, index: i });
  }
  return cells;
```

边界:
- `content.length === 0` (前端 `canPreview` 已禁用,但 defensive): `Math.max(perPage, ...)` 保证返回 perPage 个空白 cells,合理
- `content.length === perPage` (恰好 1 页): `Math.ceil(perPage/perPage) * perPage = perPage`,total = perPage,0 空白 — 正确
- `content.length < perPage`: total = perPage,补 `perPage - content.length` 个空白 — 正确
- `content.length > perPage`: total = ceil(content.length/perPage)*perPage,补最后一页的空白 — 正确

`paperSize ?? 'A4'`: 现有函数 (worksheet-types.ts:248) 已经允许 paperSize 是可选的,fallback 到 A4 跟原来 `englishCharsPerRow` 的 fallback 一致。

**不动**: `composeCellStyle` / `defaultToolFor` / `validateWorksheetInput` / `cellsPerPage` / `pageCountFor` / `exceedsFreeLimit` / `FOUR_LINE_ROWS_PER_PAGE` / `PRACTICE_LAYOUT`。

### `tests/unit/lib/worksheet-types.test.ts`

**修改 line 72-76** (`non-four-line styles fall through to per-char cells` 测试) — 断言改成 "non-four-line also pads":

修改前:
```ts
  it('non-four-line styles fall through to per-char cells', () => {
    const cells = generateLayout(['A', 'b', 'C'], 'pen-square');
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.char)).toEqual(['A', 'b', 'C']);
  });
```

修改后:
```ts
  it('non-four-line styles pad to cellsPerPage multiple (blank cells fill the page)', () => {
    // 3 chars + A4 (88 cells/page) → 88 cells (3 chars + 85 blanks)
    const cells = generateLayout(['A', 'b', 'C'], 'pen-square', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells[0].char).toBe('A');
    expect(cells[1].char).toBe('b');
    expect(cells[2].char).toBe('C');
    expect(cells[3].char).toBe('');
    expect(cells[87].char).toBe('');
    expect(cells.map((c) => c.style)).toEqual(Array(88).fill('pen-square'));
  });
```

**加 4 个新 cases** (在 line 76 后,放在同一个 describe block `generateLayout — four-line row packing (English trace)` 后面,新建 describe `generateLayout — auto-fill empty cells (CJK grid + lined)`):

```ts
describe('generateLayout — auto-fill empty cells (CJK grid + lined)', () => {
  it('50 chars + A4 → 88 cells (50 chars + 38 blanks; 1 page full)', () => {
    const chars = Array.from({ length: 50 }, (_, i) => String.fromCharCode(0x4e00 + i));
    const cells = generateLayout(chars, 'pen-square', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells.slice(0, 50).map(c => c.char)).toEqual(chars);
    expect(cells.slice(50).every(c => c.char === '')).toBe(true);
  });

  it('1 char + A4 → 88 cells (one-char-per-page practice mode)', () => {
    const cells = generateLayout(['你'], 'pen-square', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells[0].char).toBe('你');
    expect(cells.slice(1).every(c => c.char === '')).toBe(true);
  });

  it('88 chars + A4 → 88 cells (exact fit, zero blanks)', () => {
    const chars = Array.from({ length: 88 }, () => '字');
    const cells = generateLayout(chars, 'pen-square', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells.every(c => c.char === '字')).toBe(true);
  });

  it('89 chars + A4 → 176 cells (cross-page: page 1 full, page 2 = 1 char + 87 blanks)', () => {
    const chars = Array.from({ length: 89 }, (_, i) => `字${i}`);
    const cells = generateLayout(chars, 'pen-square', 'A4');
    expect(cells).toHaveLength(176);
    expect(cells.slice(0, 88).every(c => c.char !== '')).toBe(true);
    expect(cells[88].char).toBe(`字88`);
    expect(cells.slice(89).every(c => c.char === '')).toBe(true);
  });

  it('100 chars + A3 (per=168) → 168 cells (100 chars + 68 blanks; A3 sized)', () => {
    const chars = Array.from({ length: 100 }, (_, i) => `字${i}`);
    const cells = generateLayout(chars, 'brush-square', 'A3');
    expect(cells).toHaveLength(168);
    expect(cells.slice(0, 100).map(c => c.char)).toEqual(chars);
    expect(cells.slice(100).every(c => c.char === '')).toBe(true);
  });

  it('pads lined style too (pen-lined cells are blank ruled lines, no letter)', () => {
    const cells = generateLayout(['爱', '国'], 'pen-lined', 'A4');
    expect(cells).toHaveLength(88);
    expect(cells[0].char).toBe('爱');
    expect(cells[1].char).toBe('国');
    expect(cells.slice(2).every(c => c.char === '')).toBe(true);
  });
});
```

**不动**: 现有 four-line 测试 (line 34-71) — 它们断言 four-line 行为不变,新代码保留 four-line 路径。

## Verification

### 自动化

- `npx vitest run tests/unit/lib/worksheet-types.test.ts` — 1 个修改的 test + 6 个新 case 全绿
- `npx vitest run` — 全绿 (回归覆盖)
- `npx tsc --noEmit` — 干净 (helper 函数签名不变)
- `npx next build` — 128 routes 保留 (per memory `feedback-per-task-build-check.md`,每 task 都跑)

### 浏览器 smoke (人工,可选)

打开 `http://localhost:4444/worksheet`:

1. 切到「自由输入」tab,输入 `春夏秋冬` 4 字
2. 纸张选 A4,格子选「钢笔·田字格」
3. 点「生成字帖」 → 预览应该显示 88 cells,前 4 个写「春夏秋冬」,其余 84 个空方框
4. 输入 89 字 → 预览显示 2 页,第 1 页满 (88 字),第 2 页 1 字 + 87 空白
5. 切到「从字库选」随便选 1 字 → 预览 1 页 88 cells,1 字 + 87 空白 (一页只练一字)
6. 切到「英文描红」 → 行为不变 (four-line 路径独立)
7. 「保存」→ /api/worksheets POST → 跳 /worksheet/[id] → 预览仍显示 88 cells (padding 在前端重算)

## Commit Summary

1 commit on local main:

1. `feat(worksheet): generateLayout pads CJK content to fill the last page (blank cells)`

按 memory `no-prod-env-2026-06-21`,暂不 push。

## Notes / Risks

- **WorksheetPreview 的 breakpoints**: `breakpoints` (句号分割点) 是 `Set<number>` of cell indices;padding 加的空白 cells index 不会进 breakpoints (因为 `buildBreakpoints` 走 `ancientBook.chunks[chapterIdx].content` 长度),所以不会有意外的「· 句 ·」分隔线在空白处。验证: 用 ancient mode 输入「春。夏」2 字 → breakpoints 应该包含 cell.index=1,第 1 页前 2 字 + 86 空白。
- **WorksheetHistoryList 显示**: 走 `content.length` (来自 DB),不受 padding 影响。显示「88 cells」如果加 padding 会让人困惑 — 但当前 list 显示的是 content.length (4 字) 而不是 cells count,所以无影响。
- **pageCountFor / exceedsFreeLimit**: 不变,因为它们读 content.length。
- **旧的测试 pin "non-four-line styles fall through to per-char cells"**: 必须改成新断言,否则失败 — 这是 spec 内的修改,不是外加行为。
- **`paperSize` 是 undefined 时**: 走 fallback `'A4'`,跟 `englishCharsPerRow` 一致;current non-four-line 路径不读 paperSize,所以是新增依赖,但 `WorksheetPreview` 调用时永远传 paperSize (line 213)。
- **WorksheetCell 的 `char === ''` 路径**:
  - `pen-lined`: SVG 只有 line,letter 节点本就不存在,正常
  - `four-line`: `{char ? <text> : null}` — 不渲染 text 节点,但 chars !== '' 时仍渲染。padding 仅作用于 non-four-line 路径,不影响
  - square/cross: `<text>{char}</text>` — 空 char 渲染空 text 节点,letter 不显示,但格框 + 引导线都画。视觉上正确