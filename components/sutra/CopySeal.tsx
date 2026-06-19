interface Props {
  className?: string;
}

export function CopySeal({ className = '' }: Props) {
  return (
    <div
      className={`copy-seal flex flex-col items-center gap-6 ${className}`}
      role="img"
      aria-label="功德圆满"
    >
      <svg
        width={120}
        height={120}
        viewBox="0 0 80 80"
        xmlns="http://www.w3.org/2000/svg"
        className="copy-seal__svg"
      >
        <circle cx={40} cy={40} r={36} stroke="#B22B2B" strokeWidth={1.5} fill="none" />
        <text
          x={40}
          y={38}
          textAnchor="middle"
          fontSize={10}
          fill="#B22B2B"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          功德
        </text>
        <text
          x={40}
          y={52}
          textAnchor="middle"
          fontSize={10}
          fill="#B22B2B"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          圆满
        </text>
      </svg>
    </div>
  );
}