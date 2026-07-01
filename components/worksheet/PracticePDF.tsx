'use client';

import { Document, Page, View, Text, Image, Svg, Rect, Line, StyleSheet, Font } from '@react-pdf/renderer';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { PRACTICE_LAYOUT, PRACTICE_GRID_CELL_SIZE, cellsPerPage, cellStyleLabel, getPresentation, linedHeightPx, linesPerPage } from '@/lib/worksheet-types';

// Register one CJK TTF for header/footer text. react-pdf subsets the font
// to only the glyphs we use ("字·韵", "空白字帖", domain), so the PDF stays
// small even though the source TTF is 6MB. Picked ZCOOL XiaoWei (站酷小薇)
// because it's a hard-pen 楷书 TTF (the calligraphy-style TTF fonts
// MaShanZheng/LongCang are WOFF2-only — react-pdf can't read WOFF2).
Font.register({
  family: 'ZCOOLXiaoWei',
  src: '/fonts/zcool-xiaowei.ttf',
});

// Page dimensions in pt (portrait). react-pdf's Page `size` treats unitless
// numbers as **pt** (1pt = 1/72 inch) — NOT mm and NOT px. Passing mm values
// directly (e.g. [210, 297] for A4) produces a tiny ~73×105pt page (~A6),
// so cells at 80pt overflow horizontally and react-pdf auto-paginates the
// single Page into ~40 empty pages. Convert mm → pt at definition time so
// the value matches what `padding: '1.5cm'` will resolve to (42.5pt each
// side). Brush sizes aren't valid PDF paper names — fall back to A4
// (matches the browser @page fallback in PracticeTemplate).
const MM_TO_PT = 72 / 25.4;
const PAGE_DIMENSIONS: Record<PaperSize, [number, number]> = {
  A3: [297 * MM_TO_PT, 420 * MM_TO_PT],
  A4: [210 * MM_TO_PT, 297 * MM_TO_PT],
  B5: [176 * MM_TO_PT, 250 * MM_TO_PT],
  'brush-12': [210 * MM_TO_PT, 297 * MM_TO_PT],
  'brush-24': [210 * MM_TO_PT, 297 * MM_TO_PT],
  'brush-28': [210 * MM_TO_PT, 297 * MM_TO_PT],
};

// react-pdf treats unitless SVG dimensions as pt too. The browser preview
// renders cells at PRACTICE_LAYOUT[paperSize].cellSize CSS px (1px = 1/96in
// = 0.75pt at print time). Convert px → pt so the PDF cells match the
// on-screen preview's physical size — otherwise A4 renders at 80pt ≈ 28mm
// per cell and the 8×10 grid (~640×800pt) overflows the 510×689pt printable
// area.
const PX_TO_PT = 72 / 96;

// Inner printable width per paper, in pt. Computed as
// `paperWidth_pt - 2 × 1.5cm_padding` so the lined cells span the same
// usable width as the grid cells. The 1.5cm padding matches the
// `<Page style={padding: '1.5cm'}>` set in `styles.page` below.
const PAGE_INNER_WIDTH_PT: Record<PaperSize, number> = {
  A3: 757,        // 841.9 - 2*42.5
  A4: 510,        // 595.3 - 2*42.5
  B5: 414,        // 498.9 - 2*42.5
  'brush-12': 510,
  'brush-24': 510,
  'brush-28': 510,
};

const styles = StyleSheet.create({
  page: {
    padding: '1.5cm',
    fontFamily: 'ZCOOLXiaoWei',
    color: '#3a2a14',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#3a2a1433',
    paddingBottom: 8,
    marginBottom: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 18,
    height: 18,
    marginRight: 6,
  },
  brand: {
    fontSize: 14,
  },
  subtitle: {
    fontSize: 12,
    color: '#5a4530',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linedStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  footer: {
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#3a2a141a',
  },
  footerText: {
    fontSize: 9,
    color: '#999',
    textAlign: 'center',
  },
});

// One empty cell rendered as inline SVG. Mirrors WorksheetCell's geometry:
// outer border + vertical/horizontal center lines (田字格) + 2 diagonals
// (米字格) + 4 horizontal rules (four-line English). The character itself
// is omitted (practice template is blank).
function PracticeCell({ size, paperSize, style }: { size: number; paperSize: PaperSize; style: CellStyle }) {
  const presentation = getPresentation(style);
  const width = PAGE_INNER_WIDTH_PT[paperSize];
  if (presentation === 'lined') {
    // Lined: single 1px line stretched across the full inner width.
    return (
      <Svg width={width} height={size}>
        <Line x1={0} y1={size - 0.5} x2={width} y2={size - 0.5} stroke="#bbb" strokeWidth={1} />
      </Svg>
    );
  }
  if (presentation === 'four-line') {
    // Four-line (English trace): 4 horizontal rules — top + upper-mid dashed
    // + lower-mid dashed + bottom. Cell is taller than wide (height = size ×
    // 1.25) so descenders fit. Coordinates match WorksheetCell's viewBox 0..100
    // × 0..125, but rescaled to actual size for the PDF.
    const cellH = size * 1.25;
    const yTop = cellH * (10 / 125);
    const yUpper = cellH * (45 / 125);
    const yLower = cellH * (95 / 125);
    const yBottom = cellH * (115 / 125);
    return (
      <Svg width={size} height={cellH}>
        <Line x1={0} y1={yTop} x2={size} y2={yTop} stroke="#999" strokeWidth={1} />
        <Line x1={0} y1={yUpper} x2={size} y2={yUpper} stroke="#bbb" strokeWidth={0.6} />
        <Line x1={0} y1={yLower} x2={size} y2={yLower} stroke="#bbb" strokeWidth={0.6} />
        <Line x1={0} y1={yBottom} x2={size} y2={yBottom} stroke="#999" strokeWidth={1} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size}>
      <Rect x={0} y={0} width={size} height={size} fill="none" stroke="#bbb" strokeWidth={1} />
      <Line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke="#bbb" strokeWidth={0.5} />
      <Line x1={0} y1={size / 2} x2={size} y2={size / 2} stroke="#bbb" strokeWidth={0.5} />
      {presentation === 'cross' ? (
        <>
          <Line x1={0} y1={0} x2={size} y2={size} stroke="#bbb" strokeWidth={0.5} />
          <Line x1={size} y1={0} x2={0} y2={size} stroke="#bbb" strokeWidth={0.5} />
        </>
      ) : null}
    </Svg>
  );
}

interface Props {
  paperSize: PaperSize;
  cellStyle: CellStyle;
  siteHost: string;
}

export function PracticePDF({ paperSize, cellStyle, siteHost }: Props) {
  const isLined = getPresentation(cellStyle) === 'lined';
  // Lined mode: cellSize = row height in pt (CSS px × 72/96). Grid mode: cell side in pt.
// Brush papers fall back to PRACTICE_LAYOUT (they don't need the practice-grid
// adjustment — they already fit and have their own per-paper sizing).
  const cellSize = (isLined
    ? linedHeightPx(paperSize)
    : (PRACTICE_GRID_CELL_SIZE[paperSize] ?? PRACTICE_LAYOUT[paperSize].cellSize)
  ) * PX_TO_PT;
  // Lined mode: count = lines per page. Grid mode: count = cells per page.
  const count = isLined ? linesPerPage(paperSize) : cellsPerPage(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);
  const innerWidth = PAGE_INNER_WIDTH_PT[paperSize];

  return (
    <Document>
      <Page size={PAGE_DIMENSIONS[paperSize]} style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image src="/logo.png" style={styles.brandLogo} />
            <Text style={styles.brand}>字·韵 · {cellStyleLabel(cellStyle)}</Text>
          </View>
          <Text style={styles.subtitle}>空白字帖 · 公益网站，多多支持</Text>
        </View>
        <View style={isLined ? styles.linedStack : styles.grid}>
          {cells.map((i) => (
            <View key={i} style={isLined ? { width: innerWidth } : undefined}>
              <PracticeCell size={cellSize} paperSize={paperSize} style={cellStyle} />
            </View>
          ))}
        </View>
        {siteHost ? (
          <View style={styles.footer}>
            <Text style={styles.footerText}>{siteHost}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
