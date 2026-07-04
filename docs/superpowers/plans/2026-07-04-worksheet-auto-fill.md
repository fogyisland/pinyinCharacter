# Worksheet Auto-Fill Empty Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WorksheetGenerator 在用户输入字符数不能填满一页 (cellsPerPage 倍数) 时,自动把最后那页补成空白格子 (char === ''),让用户拿到一张"格子铺满整页"的字帖。

**Architecture:** 改 `lib/worksheet-types.ts:generateLayout` 的 non-four-line 分支,把 `content.map(...)` 改成 pad 到下一个 cellsPerPage(paperSize) 倍数。padding 部分 `char === ''`,WorksheetCell 在 `char === ''` 时不渲染 letter (已存在的行为)。Save 路径不存 padding — DB content 保持原 length,member 门槛 + pageCount 不变。

**Tech Stack:** Next.js 15.5.19, React 19, Vitest 2.x + happy-dom 15.x, TypeScript 5.6, npm. 纯 TypeScript helper 改动 + 单元测试。

## Global Constraints

- 不加 UI toggle (opt-out) — 默认开启
- 不加数据迁移 — content 仍存原始 length,padding 是渲染层计算
- 不加新 cell style — 沿用现有 square/cross/lined/four-line
- 不动 `PracticeTemplate.tsx` / `PracticePDF.tsx` — 它们走自己的 `Array.from({length: count})`,不经过 generateLayout
- 不动 four-line 路径 — 它已有 pad 逻辑 (worksheet-types.ts:250-263),保留
- 不动 Save 路径 (`POST /api/worksheets`) — content 长度不变,exceedsFreeLimit 不变
- 不动 PrintButton / pageCountFor / cellsPerPage / exceedsFreeLimit
- 文件改动限制: `lib/worksheet-types.ts` + `tests/unit/lib/worksheet-types.test.ts` 共 2 个文件
- 不加新 API / 新页面 / 新 deps
- 项目用 npm — 命令是 `npx vitest run` / `npx next build`,不要用 pnpm
- Commit message 加 `[YYYY-MM-DD HH.MM]` 时间戳后缀 (per memory `feedback-commit-timestamps.md`)
- 不 push — per memory `no-prod-env-2026-06-21`,所有 commit 留在本地
- 每 task reviewer 跑 `npx next build` 验证 (per memory `feedback-per-task-build-check.md`)

---

## File Structure

| File | Role | Change |
|------|------|--------|
| `lib/worksheet-types.ts` | worksheet 域 helpers (Cell / Worksheet / generateLayout / validateWorksheetInput 等) | modify `generateLayout` (line 264) — 把 `content.map(...)` 换成 pad 逻辑 |
| `tests/unit/lib/worksheet-types.test.ts` | worksheet-types 的单元测试 | modify line 72-76 现有 case (改断言) + append 6 个新 case (新 describe block) |

没有新文件。

---

## Task 1: Write failing tests (RED phase)

**Files:**
- Modify: `tests/unit/lib/worksheet-types.test.ts:72-76` (replace assertion in existing `it`) + append new `describe` block after line 77

**Consumes:** `generateLayout` from `@/lib/worksheet-types` (already imported at line 8)
**Produces:** 1 modified test + 6 new tests that exercise CJK grid + lined padding behavior

- [ ] **Step 1.1: Replace existing non-four-line test (line 72-76)**

Open `tests/unit/lib/worksheet-types.test.ts` and replace the existing `it('non-four-line styles fall through to per-char cells', ...)` block (lines 72-76) with the following:

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

- [ ] **Step 1.2: Append new describe block for auto-fill behavior**

At the end of the existing `describe('generateLayout — four-line row packing (English trace)', ...)` block (after line 77, before the closing `});` of the describe on line 77 — actually the describe ends at line 77 with `});`), insert a NEW describe block:

Find the line `});` that closes the `describe('generateLayout — four-line row packing (English trace)', ...)` block (line 77 — the second `});` after line 72-76's `it` ends). After it, add:

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

- [ ] **Step 1.3: Run tests to verify they fail (RED)**

Run:
```bash
npx vitest run tests/unit/lib/worksheet-types.test.ts
```

Expected: **6 of 7 new/modified tests FAIL** (the original `non-four-line styles fall through to per-char cells` test will also fail because its assertion was changed). The 4-line tests at the top of the file should still PASS (we didn't touch that branch).

Specifically expect failures with messages like:
- `expected 3 to be 88` (the modified test)
- `expected 50 to be 88`
- `expected 1 to be 88`
- etc.

The exact failure messages will vary based on which assertion trips first, but **at least 6 tests in `generateLayout` describes should fail**.

- [ ] **Step 1.4: Commit test changes**

```bash
git add tests/unit/lib/worksheet-types.test.ts
git commit -m "test(worksheet-types): pin auto-fill empty cells in generateLayout [2026-07-04 23.50]"
```

(Replace the timestamp with the actual commit time in `YYYY-MM-DD HH.MM` format per memory `feedback-commit-timestamps.md`.)

---

## Task 2: Implement padding in generateLayout (GREEN phase)

**Files:**
- Modify: `lib/worksheet-types.ts:263-264` (replace the `return content.map(...)` line + add pad loop above it)

**Consumes:** `cellsPerPage` (already re-exported from `./worksheet-page-count` at line 305)
**Produces:** `generateLayout` returns padded cells for non-four-line styles — `totalCells = max(perPage, ceil(content.length / perPage) * perPage)`, padding cells have `char: ''`

- [ ] **Step 2.1: Replace the non-four-line return statement**

Open `lib/worksheet-types.ts`. Find the `generateLayout` function (line 245-265). The four-line `if` branch returns at line 263, and immediately after that is the `return content.map((char, index) => ({ char, style, index }));` on line 264.

Replace line 264 (and the blank line 263.5 — keep the four-line `return` at line 263 intact) with the following block:

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
  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    cells.push({ char: i < content.length ? content[i] : '', style, index: i });
  }
  return cells;
```

So the new tail of `generateLayout` becomes (after the four-line `if` block which is unchanged):

```ts
  if (getPresentation(style) === 'four-line') {
    // ... unchanged ...
    return cells;
  }
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
  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    cells.push({ char: i < content.length ? content[i] : '', style, index: i });
  }
  return cells;
}
```

- [ ] **Step 2.2: Run worksheet-types tests to verify they pass (GREEN)**

Run:
```bash
npx vitest run tests/unit/lib/worksheet-types.test.ts
```

Expected: **All tests in the file pass** (the 6 new ones + the 1 modified one in addition to the 4-line + lined + validator + sizing tests that were already green).

- [ ] **Step 2.3: Run full test suite to confirm no regressions**

Run:
```bash
npx vitest run
```

Expected: All previously-passing tests still pass. **No new failures**.

If anything fails, investigate before continuing — the helper change must be fully backward-compatible except for the deliberately-padded non-four-line path.

- [ ] **Step 2.4: Run TypeScript check**

Run:
```bash
npx tsc --noEmit
```

Expected: Exit 0, no errors. (The function signature of `generateLayout` is unchanged, so this should be a clean pass.)

- [ ] **Step 2.5: Run Next.js build (per memory `feedback-per-task-build-check.md`)**

Run:
```bash
npx next build
```

Expected: Build succeeds. The 128 routes count is preserved (no route additions).

- [ ] **Step 2.6: Commit implementation**

```bash
git add lib/worksheet-types.ts
git commit -m "feat(worksheet): generateLayout pads CJK content to fill last page [2026-07-04 23.55]"
```

(Replace the timestamp with the actual commit time.)

---

## Verification

### 自动化

- `npx vitest run tests/unit/lib/worksheet-types.test.ts` — 全绿,1 modified + 6 new cases 加 4-line / lined / validator / sizing tests 共 25+ tests 全过
- `npx vitest run` — 全绿,无回归
- `npx tsc --noEmit` — exit 0
- `npx next build` — success,128 routes 保留

### 浏览器 smoke (人工,可选)

打开 `http://localhost:4444/worksheet`:

1. 「自由输入」输入「春夏秋冬」4 字,纸张 A4,格子选「钢笔·田字格」
2. 点「生成字帖」 → 预览显示 88 cells,前 4 个写「春夏秋冬」,其余 84 个空方框
3. 输入 89 字 → 预览显示 2 页,第 1 页满 (88 字),第 2 页 1 字 + 87 空白
4. 「从字库选」选 1 字 → 预览 1 页 88 cells,1 字 + 87 空白
5. 切到「英文描红」 → 行为不变 (four-line 路径独立)
6. 「保存」→ /api/worksheets POST → 跳 /worksheet/[id] → 预览仍显示 88 cells

## Commit Summary

2 commits on local main (not pushed):

1. `test(worksheet-types): pin auto-fill empty cells in generateLayout [2026-07-04 23.50]`
2. `feat(worksheet): generateLayout pads CJK content to fill last page [2026-07-04 23.55]`

按 memory `no-prod-env-2026-06-21`,暂不 push。

## Notes / Risks

- **`paperSize ?? 'A4'` fallback**: 跟 `englishCharsPerRow` 的 fallback 一致;WorksheetPreview 调用时永远传 paperSize (line 213),所以 fallback 仅在直接 unit test 调用或 future caller 不传时生效。
- **`cellsPerPage` re-export**: line 305 `export { cellsPerPage } from './worksheet-page-count'` 让 helper 在 worksheet-types.ts 里可以直接用,无需额外 import。
- **`breakpoints` Set 不受影响**: padding 加的空白 cells index 不会进 breakpoints (因为 `buildBreakpoints` 走 `ancientBook.chunks[chapterIdx].content` 长度)。验证场景:ancient mode 输入「春。」2 字 → breakpoints 含 cell.index=1,但 cell.index=2..87 是空白,不会出现意外的「· 句 ·」分隔线在空白处。
- **WorksheetHistoryList 不受影响**: 显示走 `content.length`(来自 DB),非 cells 数。
- **`pageCountFor` / `exceedsFreeLimit` 不变**: 仍读 content.length,member 门槛不变。
- **WorksheetCell 的 `char === ''` 行为已就位**:
  - `pen-lined`: 只画 line,不渲染 letter 节点
  - `four-line`: `{char ? <text> : null}` 跳过空 text
  - square/cross: `<text>{char}</text>` 空 char 渲染空 text 节点,letter 不显示,格框/引导线照常画
- **Commit message 时间戳**: 用本地时间,格式 `YYYY-MM-DD HH.MM`,按 memory `feedback-commit-timestamps.md` 从 2026-06-23 23:53 开始强制。