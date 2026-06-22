import type { CellStyle, FontFamily } from '@/lib/worksheet-types';
import { getPresentation, getIsTrace, fontFamilyCssVar } from '@/lib/worksheet-types';

interface Props {
  char: string;
  style: CellStyle;
  size?: number;
  fontFamily?: FontFamily;
}

export function WorksheetCell({ char, style, size = 80, fontFamily = 'song' }: Props) {
  const isTrace = getIsTrace(style);
  const stroke = isTrace ? '#666' : '#bbb';
  const fontStack = `${fontFamilyCssVar(fontFamily)}, "Noto Serif SC", serif`;
  const guideFontSize = isTrace ? size : Math.round(size * 0.6);
  const presentation = getPresentation(style);
  const showDiagonals = presentation === 'cross';
  const showHorizontal = true;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={stroke} strokeWidth={1} />
      <line x1={50} y1={2} x2={50} y2={98} stroke={stroke} strokeWidth={0.5} />
      {showDiagonals ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
        </>
      ) : null}
      {showHorizontal ? (
        <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
      ) : null}
      {/* Baseline guide for cross presentation (米字格 lower bound) */}
      {showDiagonals ? (
        <line x1={2} y1={90} x2={98} y2={90} stroke={stroke} strokeWidth={0.5} />
      ) : null}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={guideFontSize}
        fill={stroke}
        style={{ fontFamily: fontStack }}
      >
        {char}
      </text>
    </svg>
  );
}