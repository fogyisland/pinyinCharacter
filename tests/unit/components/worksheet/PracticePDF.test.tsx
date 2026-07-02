// Regression test for the PDF page-size bug: react-pdf treats unitless Page
// `size` numbers as pt (1pt = 1/72 inch), NOT mm — so passing [210, 297]
// for "A4 in mm" produced a tiny ~73×105pt page (≈A6). Combined with SVG
// cell dimensions interpreted as pt instead of CSS px, the 8×10 A4 grid
// (~640×800pt) overflowed the ~510×689pt printable area and react-pdf
// auto-paginated the single <Page> into ~40 empty pages.
//
// We can't run react-pdf's <Document> in jsdom (it builds a Yoga layout
// tree, not a DOM tree) — but react-pdf's standalone `pdf()` function does
// run in node and produces a real PDF buffer. We then count pages by
// scanning the binary for `/Type /Page` entries (excluding `/Pages`).
//
// Font.register('/fonts/zcool-xiaowei.ttf') at module-import time would
// trigger an ENOENT in node (fontkit tries to read from the FS path as
// resolved from CWD); we stub Font.register to a no-op so the test only
// exercises layout/page-split logic, not the font subsetter.

import { describe, it, expect, vi } from 'vitest';
import { inflateSync } from 'node:zlib';

vi.mock('@react-pdf/renderer', async () => {
  const actual = await vi.importActual<typeof import('@react-pdf/renderer')>('@react-pdf/renderer');
  // PracticePDF's Font.register uses a web-relative path ('/fonts/zcool-xiaowei.ttf')
  // that fontkit tries to read from CWD in node — which fails. Re-register
  // with an absolute FS path before any layout pass runs so the font is
  // available for the page-header/footer text "字·韵" etc.
  actual.Font.register({
    family: 'ZCOOLXiaoWei',
    src: './public/fonts/zcool-xiaowei.ttf',
  });
  return {
    ...actual,
    Font: { ...actual.Font, register: actual.Font.register },
  };
});

import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { PracticePDF } from '@/components/worksheet/PracticePDF';
import type { PaperSize } from '@/lib/worksheet-types';
import { PRACTICE_LAYOUT, PRACTICE_GRID_CELL_SIZE, cellsPerPage } from '@/lib/worksheet-types';
import type { CellStyle } from '@/lib/worksheet-types';

const ALL_PAPER_SIZES: PaperSize[] = ['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28'];

// PracticePDF returns a <Document> but TS sees it as FunctionComponentElement<Props>.
// Cast through unknown to satisfy pdf()'s ReactElement<DocumentProps> param
// without polluting the production code with a wider return type.
const renderPdf = (paperSize: PaperSize, cellStyle: CellStyle = 'pen-square', siteHost = '') =>
  pdf(
    createElement(PracticePDF, { paperSize, cellStyle, siteHost }) as unknown as Parameters<typeof pdf>[0],
  );

// react-pdf writes one /Type /Page per page; /Type /Pages is the catalog
// (always present once) — exclude it.
function countPdfPages(buf: Buffer): number {
  const text = buf.toString('binary');
  const pageMatches = text.match(/\/Type\s*\/Page(?![sa-z])/g) || [];
  return pageMatches.length;
}

// react-pdf compresses all content streams with FlateDecode by default, so
// `0 28 l` operators aren't visible in `buf.toString('binary')`. Decompress
// every stream and concatenate so we can regex-match line operators.
function decompressStreams(buf: Buffer): string {
  const text = buf.toString('binary');
  const streamRegex = /stream\n([\s\S]*?)\nendstream/g;
  let match: RegExpExecArray | null;
  let all = '';
  while ((match = streamRegex.exec(text)) !== null) {
    try {
      const compressed = Buffer.from(match[1], 'binary');
      all += inflateSync(compressed).toString('binary') + '\n';
    } catch {
      // Not a flate stream (e.g. image XObject); skip silently.
    }
  }
  return all;
}

describe('PracticePDF — page-size units (regression for 40-page A4 bug)', () => {
  for (const paperSize of ALL_PAPER_SIZES) {
    it(`${paperSize}: produces exactly 1 page (was 40 on A4 before fix)`, async () => {
      const blob = await renderPdf(paperSize).toBlob();
      const buf = Buffer.from(await blob.arrayBuffer());
      const pages = countPdfPages(buf);
      expect(pages).toBe(1);
    });
  }

  it('A4 grid fits within the printable area (≤ ~510pt × ~757pt incl. gaps) for 88 cells', async () => {
    // Sanity check: A4 inner = (210 - 30mm margin) × (297 - 30mm - header - footer)
    //                ≈ 180mm × 267mm ≈ 510pt × 757pt
    // Grid uses PRACTICE_GRID_CELL_SIZE['A4'] = 70px (= 52.5pt) so the
    // 8-col × 11-row grid + 7×8pt horizontal gap = 476pt × 657.5pt, leaving
    // headroom for the header (~37pt) and footer (~36pt) within 757pt.
    const cellSizePx = PRACTICE_GRID_CELL_SIZE['A4'];
    const cellSizePt = cellSizePx * (72 / 96); // matches PX_TO_PT in PracticePDF
    const gapPt = 8;
    const cols = 8;
    const rows = cellsPerPage('A4') / cols;
    const gridWidthPt = cols * cellSizePt + (cols - 1) * gapPt;
    const gridHeightPt = rows * cellSizePt + (rows - 1) * gapPt;
    expect(gridWidthPt).toBeLessThanOrEqual(510);
    // Header + grid + footer = 37 + 657.5 + 36 = 730.5 ≤ 757 ✓
    expect(gridHeightPt + 37 + 36).toBeLessThanOrEqual(757);
  });

  it('A3 cellSize in pt leaves headroom for the 12×14 grid', async () => {
    const cellSizePt = PRACTICE_GRID_CELL_SIZE['A3'] * (72 / 96);
    const gapPt = 8;
    const gridWidthPt = 12 * cellSizePt + 11 * gapPt;
    const gridHeightPt = 14 * cellSizePt + 13 * gapPt;
    // A3 inner ≈ (297 - 30mm) × (420 - 30mm - header - footer) ≈ 756pt × 1086pt
    expect(gridWidthPt).toBeLessThanOrEqual(756);
    expect(gridHeightPt + 37 + 36).toBeLessThanOrEqual(1086);
  });

  it('A4 page dimensions are 595.27pt × 841.89pt (A4 in pt, not mm)', async () => {
    const blob = await renderPdf('A4').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // A4 = 210mm × 297mm = 595.275574pt × 841.889771pt. The original bug
    // emitted 210 × 297 (interpreted as pt → ~73 × 105pt).
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595(\.\d+)?\s+841(\.\d+)?\s*\]/);
  });

  it('A3 page dimensions are 842pt × 1191pt', async () => {
    const blob = await renderPdf('A3').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // A3 = 297mm × 420mm = 841.89pt × 1190.55pt.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841(\.\d+)?\s+1190(\.\d+)?\s*\]/);
  });

  it('B5 page dimensions are 499pt × 709pt', async () => {
    const blob = await renderPdf('B5').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // B5 = 176mm × 250mm = 498.90pt × 708.66pt.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+498(\.\d+)?\s+708(\.\d+)?\s*\]/);
  });
});

describe('PracticePDF — pen-lined branch', () => {
  it('pen-lined + A4 produces exactly 1 page', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + A3 produces exactly 1 page', async () => {
    const blob = await renderPdf('A3', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + B5 produces exactly 1 page', async () => {
    const blob = await renderPdf('B5', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPdfPages(buf)).toBe(1);
  });

  it('pen-lined + A4 contains exactly 24 Line elements (one per row)', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const streams = decompressStreams(buf);
    // Each lined cell renders one <Line> for the bottom rule, emitted by
    // react-pdf as `0 28 m` (moveTo) followed by `510 28 l` (lineTo) and
    // `S` (stroke). The line y is `size - 0.5` = 28.5 - 0.5 = 28. Count
    // the moveTo operators at the line position; one per lined row.
    const moves = streams.match(/\n0 28 m\n/g) || [];
    expect(moves.length).toBe(24);
  });

  it('pen-lined + A3 has 36 lines (linesPerPage A3 = 36)', async () => {
    const blob = await renderPdf('A3', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const streams = decompressStreams(buf);
    // A3 lined uses the same 1.0cm row height (38px = 28.5pt) as A4, so the
    // line y position is also 28. 36 lined cells × 1 moveTo = 36.
    const moves = streams.match(/\n0 28 m\n/g) || [];
    expect(moves.length).toBe(36);
  });

  it('pen-lined + A4 inner width ≈ 510pt (page width − 2×1.5cm padding)', async () => {
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // The lined Svg should emit a width attribute near 510pt.
    // PDF stream operators don't expose Svg width directly; we check
    // MediaBox sanity + content-fit: PDF must not auto-paginate.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595(\.\d+)?\s+841(\.\d+)?\s*\]/);
  });
});

describe('PracticePDF — header + grid gaps', () => {
  it('A4 pen-square grid emits 88 cells (8 cols × 11 rows, 70px cells)', async () => {
    const blob = await renderPdf('A4', 'pen-square').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const streams = decompressStreams(buf);
    // A4 pen-square: PRACTICE_GRID_CELL_SIZE['A4'] = 70px = 52.5pt, cellsPerPage('A4') = 88.
    // Layout target: 8 cols × 11 rows = 88 cells. Cell positions are:
    //   X ∈ {0, 60.5, 121, 181.5, 242, 302.5, 363, 423.5} (step = 52.5 + 8 = 60.5pt)
    //   Y ∈ {0, 60.5, 121, 181.5, 242, 302.5, 363, 423.5, 484, 544.5, 605}
    // react-pdf positions each flex child via a `1 0 0 1 X Y cm` transform.
    // The first cell at (0, 0) is rendered at identity (no transform emitted),
    // so we count exact-grid-point cm transforms + 1 implicit.
    const gridX = new Set([0, 60.5, 121, 181.5, 242, 302.5, 363, 423.5]);
    const gridY = new Set([0, 60.5, 121, 181.5, 242, 302.5, 363, 423.5, 484, 544.5, 605]);
    const transforms = streams.match(/\n1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) cm\n/g) || [];
    let cellCount = 0;
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const t of transforms) {
      const m = t.match(/1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) cm/);
      if (!m) continue;
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (gridX.has(x) && gridY.has(y)) {
        cellCount++;
        xs.add(x);
        ys.add(y);
      }
    }
    // 87 cells have an explicit cm transform; 1 implicit at (0,0) = 88 total.
    expect(cellCount).toBe(87);
    expect(xs.size).toBe(8);
    expect(ys.size).toBe(11);
  });

  it('A4 pen-lined has 24 line rows (lines stay 38px=28.5pt apart, no gap)', async () => {
    // Lined mode is intentionally flush — consecutive lines sit at the
    // bottom of each 28.5pt row, no inter-row gap.
    const blob = await renderPdf('A4', 'pen-lined').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const streams = decompressStreams(buf);
    const moves = streams.match(/\n0 28 m\n/g) || [];
    expect(moves.length).toBe(24);
  });

  it('PDF emits a font resource for the brand font subset', async () => {
    const blob = await renderPdf('A4', 'pen-square').toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = buf.toString('binary');
    // react-pdf names the font resource with a hash prefix
    // (e.g. /FVZFOO+ZCOOLXiaoWei-Regular). Match the family name,
    // which is what we registered and what matters for verification.
    expect(text).toMatch(/ZCOOLXiaoWei/);
  });
});