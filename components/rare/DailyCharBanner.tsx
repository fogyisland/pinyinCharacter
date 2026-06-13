import Link from 'next/link';

interface Props {
  char: string;
  pinyin: string;
  meaning: string;
  date: string;
}

export function DailyCharBanner({ char, pinyin, meaning, date }: Props) {
  return (
    <Link
      href={`/stories/${encodeURIComponent(char)}`}
      className="block rounded-lg border-2 border-seal/20 bg-seal/10 p-6 transition hover:border-seal"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-seal">
        今日一字 · {date}
      </div>
      <div className="mt-3 flex items-baseline gap-4">
        <span className="text-6xl font-bold text-ink">{char}</span>
        <span className="text-2xl text-ink-soft">{pinyin}</span>
      </div>
      <div className="mt-2 text-sm text-ink-soft">{meaning}</div>
    </Link>
  );
}
