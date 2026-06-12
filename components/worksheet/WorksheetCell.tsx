import type { CellStyle } from '@/lib/worksheet-types';

interface Props {
  char: string;
  style: CellStyle;
  size?: number;
}

export function WorksheetCell({ char, style, size = 80 }: Props) {
  const stroke = '#bbb';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      {/* outer border */}
      <rect x={2} y={2} width={96} height={96} fill="none" stroke={stroke} strokeWidth={1} />
      {/* common: vertical center */}
      <line x1={50} y1={2} x2={50} y2={98} stroke={stroke} strokeWidth={0.5} />
      {/* brush: two diagonals; square: horizontal center */}
      {style === 'brush' ? (
        <>
          <line x1={2} y1={2} x2={98} y2={98} stroke={stroke} strokeWidth={0.5} />
          <line x1={98} y1={2} x2={2} y2={98} stroke={stroke} strokeWidth={0.5} />
        </>
      ) : (
        <line x1={2} y1={50} x2={98} y2={50} stroke={stroke} strokeWidth={0.5} />
      )}
      {/* the char (faint guide) — 用 Noto Serif SC (SIL OFL) 避免 Times New Roman 侵权 */}
      <text
        x={50}
        y={50}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={60}
        fill={stroke}
        style={{ fontFamily: 'var(--font-han-serif), "Noto Serif SC", serif' }}
      >
        {char}
      </text>
    </svg>
  );
}
