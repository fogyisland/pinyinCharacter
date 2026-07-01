# Practice Lined Paper — 横线信纸打印

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/worksheet/practice` 页面添加"钢笔·横线"格子形式 — 标准作文本/信纸样式（每行一条横线，1.0cm 行高，A4 ≈ 24 行），作为第 5 个 `CellStyle` 选项，复用现有 cell 抽象 + 纸张尺寸联动 + PracticePDF。

**Architecture:** 走 cell 抽象：1 列 × N 行网格，每个 "cell" 是一条横线（SVG 100% 宽 + 底部 1px 灰线）。新加 `'pen-lined'` 到 `CellStyle` union；扩展 `getPresentation` / `cellStyleLabel` / `getIsTrace` 容纳新值；新增 CSS grid 模板 `.worksheet-grid--{a3,a4,b5}-lined`（1 列铺满）；PRACTICE_LAYOUT 的 `cellSize` 在 lined 语义下变"行高"（A4 = 38px ≈ 1.0cm）。`cellsPerPage(paperSize)` 对所有 cell style 都返回每页行数（lined 模式 = 行数）。

**Tech Stack:** React 19, Next.js 15.5.19, @react-pdf/renderer 4.5.x, Vitest, happy-dom. 复用现有 `PracticeCell` SVG / `WorksheetCell` 渲染。

## Global Constraints

- 不加新纸张尺寸 — lined 沿用 A3/A4/B5（钢笔纸张）
- 不加新工具 — `pen-lined` 走 `tool: 'pen'`，跟现有 `handleCellStyleChange` 的 paperSize 联动自动适用
- 不加行数滑块 — 行数由 `cellsPerPage(paperSize)` 算出（行高 × 打印可写高）
- 不加装订线/页码/日期栏 — 标准信纸最简形态
- 不支持毛笔 — 横线信纸是硬笔场景，硬加毛笔跟 brush-12/24/28 纸张冲突
- PDF + 浏览器双路径同时支持（browser CSS + react-pdf SVG）
- 文件改动限制：`lib/worksheet-types.ts`、`components/worksheet/WorksheetCell.tsx`、`components/worksheet/PracticePDF.tsx`、`components/worksheet/PracticeTemplate.tsx`、`app/globals.css`（新增 3 个 class）、`tests/unit/components/worksheet/PracticePDF.test.tsx`（新增 case）
- 不改 `composeCellStyle`/`defaultToolFor`/`generateLayout` — WorksheetCell 内部按 `cellStyle` 自行决定 SVG 内容
- `tts.ts` 的 batch 逻辑跟本次无关，不动

---

## Concept

当前 `/worksheet/practice` 有 4 个 `CellStyle`：
- `brush-square` / `brush-cross` — 毛笔，田字格/米字格
- `pen-square` / `pen-cross` — 钢笔，田字格/米字格

每个 cell 是一个方框 + 内部导引线。`PRACTICE_LAYOUT[paperSize].cellSize` 是 cell 的边长（px CSS），`cellsPerPage(paperSize)` 是每页 cell 数。

新增第 5 个：`pen-lined`（钢笔·横线）。把 cell 抽象重解读为"一条横线"：
- 1 列 × N 行（CSS grid 1 列铺满）
- 每个 cell = 一个 SVG，宽 100%，高 = lineHeight，底部一条 1px 灰线
- `cellSize` 在 lined 语义下 = 行高（A4 = 38px ≈ 1.0cm，~24 行）
- `cellsPerPage(paperSize)` 改成"每页行数"（A3=36, A4=24, B5=14）

## File-by-File Changes

### `lib/worksheet-types.ts`

**`CellStyle` union（line 5-8）**：
```ts
export type CellStyle =
  | 'brush-square' | 'brush-cross'
  | 'pen-square'   | 'pen-cross'
  | 'brush-trace-square' | 'brush-trace-cross'
  | 'pen-lined';
```

**`Presentation` type（line 4，新加值 'lined'）**：
```ts
export type Presentation = 'square' | 'cross' | 'lined';
```

**`getPresentation`（line 35-38）**：
```ts
export function getPresentation(s: CellStyle): Presentation {
  if (s.includes('cross')) return 'cross';
  if (s.includes('lined')) return 'lined';
  return 'square';
}
```

**`getIsTrace`（line 40-42）**：lined 永远不是 trace，保持原样。

**`cellStyleLabel`（line 146-150）**：
```ts
export function cellStyleLabel(s: CellStyle): string {
  const tool = getTool(s) === 'brush' ? '毛笔' : '钢笔';
  if (getPresentation(s) === 'lined') return `${tool}·横线`;
  const pres = getPresentation(s) === 'cross' ? '米字格' : '田字格';
  return getIsTrace(s) ? `${tool}·${pres}·描红` : `${tool}·${pres}`;
}
```

**`PRACTICE_LAYOUT`（line 101-108）**：`cellSize` 含义不变（grid 模式 cell 边长）。

**新增 `PRACTICE_LINED_HEIGHT` map**：lined 模式的行高（CSS px, 1px = 1/96in）：
```ts
const PRACTICE_LINED_HEIGHT: Record<PaperSize, number> = {
  A3: 66,        // 36 行 × 66px = 2376px, fits A3 inner 1480px (390mm @ 96dpi)
  A4: 38,        // 24 行 × 38px = 912px, fits A4 inner 1010px (267mm @ 96dpi)
  B5: 44,        // 14 行 × 44px = 616px, fits B5 inner 832px (220mm @ 96dpi)
  'brush-12': 0, 'brush-24': 0, 'brush-28': 0,  // lined 不支持 brush papers
};
export function linedHeightPx(paperSize: PaperSize): number {
  return PRACTICE_LINED_HEIGHT[paperSize];
}
```

**新增 `linesPerPage` 函数**（不复用 `cellsPerPage`）：
```ts
const LINES_PER_PAGE: Record<PaperSize, number> = {
  A3: 36, A4: 24, B5: 14, 'brush-12': 0, 'brush-24': 0, 'brush-28': 0,
};
export function linesPerPage(paperSize: PaperSize): number {
  return LINES_PER_PAGE[paperSize];
}
```

**为什么不复用 `cellsPerPage`**：grid 模式 A4 = 80 格（8×10，每格 80px = 1cm 不到），lined 模式 A4 = 24 行（每行 38px ≈ 1.0cm）。两个语义不同，强行合并会污染 grid 模式。

**`VALID_PAPER_SIZES`（line 159）** lined 不影响验证，保持。

### `components/worksheet/WorksheetCell.tsx`

新增 `pen-lined` 分支：渲染一个宽 100%、高 = size 的 SVG，底部一条 1px 灰线。

```tsx
const presentation = getPresentation(style);
if (presentation === 'lined') {
  return (
    <svg width="100%" height={size} viewBox={`0 0 100 ${size}`} preserveAspectRatio="none" className="block">
      <line x1={0} y1={size - 0.5} x2={100} y2={size - 0.5} stroke="#bbb" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

`vectorEffect="non-scaling-stroke"` 让线宽保持 1px 不随 SVG 缩放变化。`viewBox 0 0 100 ${size}` + `preserveAspectRatio="none"` 让线段在拉伸容器时始终铺满底部。

### `components/worksheet/PracticePDF.tsx`

`PracticeCell` 加 lined 分支：用 paper-aware 宽度常量（PDF SVG `width="100%"` 行为不可靠），底部一条横线：

新增 paper-aware inner width 常量（pt）：
```ts
// Print area width (page width - 2 × 1.5cm padding) in pt
const PAGE_INNER_WIDTH_PT: Record<PaperSize, number> = {
  A3: 757,        // 841.9 - 2*42.5
  A4: 510,        // 595.3 - 2*42.5
  B5: 414,        // 498.9 - 2*42.5
  'brush-12': 510, 'brush-24': 510, 'brush-28': 510,
};
```

注：这些值是 `paperWidth_pt - 2×42.5pt_padding`，确保 lined 纸跟 grid 模式的"可写宽度"一致（A4 = 510pt = 180mm ≈ 网格模式的 8 cols × 60pt inner width）。

Lined cell SVG：
```tsx
{presentation === 'lined' ? (
  <Svg width={PAGE_INNER_WIDTH_PT[paperSize]} height={size}>
    <Line x1={0} y1={size - 0.5} x2={PAGE_INNER_WIDTH_PT[paperSize]} y2={size - 0.5} stroke="#bbb" strokeWidth={1} />
  </Svg>
) : null}
```

PDF lined cell 容器宽度也要适配：`cells.map((i) => <View key={i} style={{ width: PAGE_INNER_WIDTH_PT[paperSize] }}>...</View>)`。

### `components/worksheet/PracticeTemplate.tsx`

**`PRACTICE_CELL_STYLES`（line 26-31）** 加 `pen-lined`：
```ts
const PRACTICE_CELL_STYLES = [
  { value: 'brush-square', label: '毛笔 · 田字格', tool: 'brush' },
  { value: 'brush-cross', label: '毛笔 · 米字格', tool: 'brush' },
  { value: 'pen-square', label: '钢笔 · 田字格', tool: 'pen' },
  { value: 'pen-cross', label: '钢笔 · 米字格', tool: 'pen' },
  { value: 'pen-lined', label: '钢笔 · 横线', tool: 'pen' },
];
```

**`handleCellStyleChange`（line 61-69）**：lined 属 'pen', 现有联动（`nextTool === 'pen' && isBrushSize(paperSize) → A4`）自动适用。

**`sizeClass`（line 71）**：当前 `worksheet-grid--${paperSize.toLowerCase()}`，对 lined 模式加后缀：
```ts
const isLined = getPresentation(cellStyle) === 'lined';
const sizeClass = isLined ? `worksheet-grid--${paperSize.toLowerCase()}-lined` : `worksheet-grid--${paperSize.toLowerCase()}`;
```

**`cellSize` 选 lined 还是 grid**（line 74）：
```ts
const cellSize = isLined ? linedHeightPx(paperSize) : PRACTICE_LAYOUT[paperSize].cellSize;
```

**`count` 选 lines 还是 cells**（line 78）：
```ts
const count = isLined ? linesPerPage(paperSize) : cellsPerPage(paperSize);
```

**渲染分支**（line 145-165 替换为）：
```tsx
{isLined ? (
  <div className="lined-paper mx-auto max-w-3xl" style={{ minHeight: `${count * cellSize}px` }}>
    {cells.map((i) => (
      <div key={i} className="lined-paper-row" style={{ height: `${cellSize}px` }}>
        <WorksheetCell char="" style="pen-lined" size={cellSize} />
      </div>
    ))}
  </div>
) : (
  // 现有 grid 渲染（保持原样）
  <div className={`worksheet-grid ... ${sizeClass}`}>
    {cells.map(...)}
  </div>
)}
```

### `app/globals.css`

新增 3 个 lined grid 模板 + 1 个 lined paper 容器样式：
```css
.worksheet-grid--a3-lined,
.worksheet-grid--a4-lined,
.worksheet-grid--b5-lined { grid-template-columns: 1fr; }

/* lined paper 容器：1 列铺满，每行高 = cellSize */
.lined-paper { display: flex; flex-direction: column; width: 100%; }
.lined-paper-row { display: block; width: 100%; }
```

### `tests/unit/components/worksheet/PracticePDF.test.tsx`

新增 2-3 个 lined 专项 case：
- `pen-lined + A4` 仍产 1 页
- `pen-lined + A3` 仍产 1 页
- A4 lined 模式 PDF 包含 ≥ 24 个 Line 元素（grep SVG path 数）
- `linesPerPage` unit test in `tests/unit/lib/worksheet-types.test.ts`（如有）或直接 inline

---

## Task Breakdown (TBD by writing-plans skill)

Implementation will be split into ~4 tasks:

1. **Task 1**: types 扩展 (`CellStyle` + `Presentation` + `cellStyleLabel` + `PRACTICE_LINED_HEIGHT` + `linesPerPage` + `linedHeightPx`)
2. **Task 2**: `WorksheetCell` lined SVG 分支 + CSS grid 模板
3. **Task 3**: `PracticeTemplate` UI 集成（select 选项 + isLined 分支渲染）
4. **Task 4**: `PracticePDF` lined 分支（PAGE_INNER_WIDTH_PT + Line 元素）+ 测试覆盖 + 浏览器人工 smoke（去 /worksheet/practice 选「钢笔·横线」看 24 行/A4；点下载 PDF 看 1 页 A4，每页 24 条横线）

---

## Verification (human smoke)

1. 访问 `/worksheet/practice`
2. 「格子形式」下拉选「钢笔·横线」
3. 看到整页是 24 条横线（默认 A4）
4. 切到 A3 → ~36 条
5. 切到 B5 → ~14 条
6. 点「下载 PDF」→ 1 页 A4, 每页 24 条横线
7. 切到「钢笔·田字格」→ 回到 80 格 grid（验证不影响其他 cell style）
8. 刷新页面 → 默认还是「钢笔·田字格」(默认不变)

## Out of Scope

- 行数滑块
- 装订线 / 页码 / 日期栏
- 横线 + 拼音位（拼音在上，线在下）
- 横线 + 田字格组合（"作文本"扩展样式）
- 毛笔横线
- 横线密度自定义（行高固定 1.0cm）

这些如果需要，另开 spec。
