import type { CellStyle, FontFamily } from '@/lib/worksheet-types';
import { fontFamilyCssVar } from '@/lib/worksheet-types';

interface Props {
  char: string;
  style: CellStyle;
  size?: number;
  fontFamily?: FontFamily;
}

export function WorksheetCell({ char, style, size = 80, fontFamily = 'song' }: Props) {
  const stroke = '#bbb';
  const fontStack = `${fontFamilyCssVar(fontFamily)}, "Noto Serif SC", serif`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      {/* outer border */}
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={stroke} strokeWidth={1} />
      {/* common: vertical center */}
      <line x1={50} y1={2} x2={50} y2={98} stroke={stroke} strokeWidth={0.5} />
      {/* brush: diagonals only; square: horizontal; pen: nothing extra; cross: horizontal + diagonals (米) */}
      {style === 'brush' || style === 'cross' ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
        </>
      ) : null}
      {style === 'square' || style === 'cross' ? (
        <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
      ) : null}
      {/* the char (faint guide) — Chinese font chosen via fontFamily prop (default 宋) */}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={60}
        fill={stroke}
        style={{ fontFamily: fontStack }}
      >
        {char}
      </text>
    </svg>
  );
}
