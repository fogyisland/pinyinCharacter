import type { CellStyle, FontFamily } from '@/lib/worksheet-types';
import { getPresentation, getIsTrace, fontFamilyCssVar } from '@/lib/worksheet-types';

interface Props {
  char: string;
  style: CellStyle;
  size?: number;
  fontFamily?: FontFamily;
}

export function WorksheetCell({ char, style, size = 80, fontFamily = 'song' }: Props) {
  // Lined mode (钢笔·横线): render a stretched SVG with a single 1px bottom
  // rule. `vectorEffect="non-scaling-stroke"` keeps the stroke 1px regardless
  // of how the container scales the SVG; `viewBox="0 0 100 ${size}"` +
  // `preserveAspectRatio="none"` lets the line stretch to fill any width.
  // No character is rendered — lined is blank ruled paper.
  if (style === 'pen-lined') {
    return (
      <svg width="100%" height={size} viewBox={`0 0 100 ${size}`} preserveAspectRatio="none" className="block">
        <line
          x1={0}
          y1={size - 0.5}
          x2={100}
          y2={size - 0.5}
          stroke="#bbb"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  // Four-line (英文描红 / 听写本): one ruled row, lines stretch across the
  // full SVG width and never break between letters. 4 horizontal rules —
  // top solid + upper-mid dashed + lower-mid dashed + bottom solid — with
  // the letter string centered in the x-height band. The SVG uses
  // viewBox="0 0 100 38" + preserveAspectRatio="none" so the rules expand
  // to any row width without scaling stroke thickness (`vectorEffect` on
  // each line keeps it 1px regardless). `char` here is the whole row
  // (e.g. "Hello World"); WorksheetPreview's generateLayout slices the
  // content array into per-row substrings of `charsPerRow`.
  const presentation = getPresentation(style);
  if (presentation === 'four-line') {
    // viewBox height = row height = 38px (1.0cm, matches PRACTICE_LINED_HEIGHT).
    // y coordinates map to fractions of row height so SVG scales cleanly.
    const fontStack = `${fontFamilyCssVar(fontFamily)}, "Times New Roman", serif`;
    return (
      <svg width="100%" height={size} viewBox="0 0 100 38" preserveAspectRatio="none" className="block">
        {/* Top solid line (capital cap height) — y ≈ 8/38 */}
        <line x1={0} y1={8} x2={100} y2={8} stroke="#999" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {/* Upper-mid dashed (x-height for lowercase) — y ≈ 14/38 */}
        <line x1={0} y1={14} x2={100} y2={14} stroke="#bbb" strokeWidth={0.6} strokeDasharray="4,3" vectorEffect="non-scaling-stroke" />
        {/* Lower-mid dashed (baseline) — y ≈ 29/38 */}
        <line x1={0} y1={29} x2={100} y2={29} stroke="#bbb" strokeWidth={0.6} strokeDasharray="4,3" vectorEffect="non-scaling-stroke" />
        {/* Bottom solid (descender line) — y ≈ 35/38 */}
        <line x1={0} y1={35} x2={100} y2={35} stroke="#999" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {char ? (
          <text
            x={50}
            y={21}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={16}
            fill="#ddd"
            stroke="#c0392b"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
            style={{ fontFamily: fontStack }}
          >
            {char}
          </text>
        ) : null}
      </svg>
    );
  }

  const isTrace = getIsTrace(style);
  // Trace mode (传统描红): the character is filled light gray with a red
  // outline (字体的外边缘是红色). The user traces over the red outline
  // with ink. Cell border and guide lines stay light gray.
  const guideStroke = '#bbb';
  const borderStroke = '#bbb';
  const charFill = isTrace ? '#ddd' : '#bbb';
  const charStroke = isTrace ? '#c0392b' : 'none';
  const charStrokeWidth = isTrace ? 1.5 : 0;
  const fontStack = `${fontFamilyCssVar(fontFamily)}, "Noto Serif SC", serif`;
  const guideFontSize = isTrace ? size : Math.round(size * 0.6);
  const showDiagonals = presentation === 'cross';
  const showHorizontal = true;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={borderStroke} strokeWidth={1} />
      <line x1={50} y1={2} x2={50} y2={98} stroke={guideStroke} strokeWidth={0.5} />
      {showDiagonals ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={guideStroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={guideStroke} strokeWidth={0.5} />
        </>
      ) : null}
      {showHorizontal ? (
        <line x1={2} y1={50} x2={98} y2={50} stroke={guideStroke} strokeWidth={0.5} />
      ) : null}
      {/* Baseline guide for cross presentation (米字格 lower bound) */}
      {showDiagonals ? (
        <line x1={2} y1={90} x2={98} y2={98} stroke={guideStroke} strokeWidth={0.5} />
      ) : null}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={guideFontSize}
        fill={charFill}
        stroke={charStroke}
        strokeWidth={charStrokeWidth}
        style={{ fontFamily: fontStack }}
      >
        {char}
      </text>
    </svg>
  );
}