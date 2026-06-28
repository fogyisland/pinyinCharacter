'use client';

import { Document, Page, View, Text, Svg, Rect, Line, StyleSheet, Font } from '@react-pdf/renderer';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { PRACTICE_LAYOUT, cellsPerPage, getPresentation } from '@/lib/worksheet-types';

// Register one CJK TTF for header/footer text. react-pdf subsets the font
// to only the glyphs we use ("字·韵", "空白字帖", domain), so the PDF stays
// small even though the source TTF is 6MB. Picked ZCOOL XiaoWei (站酷小薇)
// because it's a hard-pen 楷书 TTF (the calligraphy-style TTF fonts
// MaShanZheng/LongCang are WOFF2-only — react-pdf can't read WOFF2).
Font.register({
  family: 'ZCOOLXiaoWei',
  src: '/fonts/zcool-xiaowei.ttf',
});

// Page dimensions in mm (portrait). Brush sizes aren't valid PDF paper
// names — fall back to A4 (matches the browser @page fallback in
// PracticeTemplate). React-pdf's Page `size` accepts [width, height].
const PAGE_DIMENSIONS: Record<PaperSize, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  B5: [176, 250],
  'brush-12': [210, 297],
  'brush-24': [210, 297],
  'brush-28': [210, 297],
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
  },
  footer: {
    fontSize: 9,
    color: '#999',
    textAlign: 'center',
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#3a2a141a',
  },
});

// One empty cell rendered as inline SVG. Mirrors WorksheetCell's geometry:
// outer border + vertical/horizontal center lines (田字格) + 2 diagonals
// (米字格). The character itself is omitted (practice template is blank).
function PracticeCell({ size, style }: { size: number; style: CellStyle }) {
  const presentation = getPresentation(style);
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
  const cellSize = PRACTICE_LAYOUT[paperSize].cellSize;
  const count = cellsPerPage(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);

  return (
    <Document>
      <Page size={PAGE_DIMENSIONS[paperSize]} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>字·韵</Text>
          <Text style={styles.subtitle}>空白字帖</Text>
        </View>
        <View style={styles.grid}>
          {cells.map((i) => (
            <View key={i}>
              <PracticeCell size={cellSize} style={cellStyle} />
            </View>
          ))}
        </View>
        {siteHost ? <Text style={styles.footer}>{siteHost}</Text> : null}
      </Page>
    </Document>
  );
}
