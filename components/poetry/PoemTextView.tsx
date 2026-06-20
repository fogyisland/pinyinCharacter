import { isPunct } from '@/lib/punctuation';
import type { TextGridMode } from '@/lib/text-grid';

interface Props {
  content: string[];
  fontFamily?: string;
  gridMode?: TextGridMode;
}

const PUNCT_RE = /[，。！？、；：""''「」『』《》（）·]/;

function GridChar({ ch, mode }: { ch: string; mode: 'tian' | 'mi' }) {
  const size = 'w-10 h-10 sm:w-12 sm:h-12';
  if (mode === 'tian') {
    return (
      <span
        className={`inline-flex items-center justify-center ${size} border border-ink relative align-middle mx-0.5`}
      >
        <span className="absolute inset-x-0 top-1/2 h-px bg-ink/60 pointer-events-none" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink/60 pointer-events-none" />
        <span className="relative">{ch}</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center ${size} border border-ink relative align-middle mx-0.5`}
      style={{
        backgroundImage:
          'linear-gradient(to top right, transparent calc(50% - 0.5px), rgb(var(--ink-rgb, 0 0 0) / 0.6) 50%, transparent calc(50% + 0.5px)), linear-gradient(to top left, transparent calc(50% - 0.5px), rgb(var(--ink-rgb, 0 0 0) / 0.6) 50%, transparent calc(50% + 0.5px))',
      }}
    >
      <span className="relative">{ch}</span>
    </span>
  );
}

export function PoemTextView({ content, fontFamily, gridMode = 'default' }: Props) {
  const inGrid = gridMode === 'tian' || gridMode === 'mi';
  return (
    <div
      className="text-2xl sm:text-3xl text-ink leading-loose text-center tracking-wide"
      style={fontFamily ? { fontFamily } : undefined}
    >
      {content.map((line, lineIdx) => (
        <p key={lineIdx} className="my-2">
          {Array.from(line).map((c, i) => {
            if (inGrid) {
              if (isPunct(c)) return null;
              return <GridChar key={i} ch={c} mode={gridMode as 'tian' | 'mi'} />;
            }
            return (
              <span key={i} className={PUNCT_RE.test(c) ? 'mx-1.5 text-seal' : ''}>
                {c}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}