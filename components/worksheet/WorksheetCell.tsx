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
  const presentation = getPresentation(style);
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
        <line x1={2} y1={90} x2={98} y2={90} stroke={guideStroke} strokeWidth={0.5} />
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