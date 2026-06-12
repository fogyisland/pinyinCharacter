import Link from 'next/link';

interface Props {
  char: string;
  pinyin: string;
  meaning: string;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function RareCharCard({ char, pinyin, meaning }: Props) {
  return (
    <Link
      href={`/rare-chars/${encodeURIComponent(char)}`}
      className="block rounded-lg border border-ink/10 p-4 transition hover:border-seal hover:shadow"
    >
      <div className="text-4xl font-bold text-ink">{char}</div>
      <div className="mt-1 text-sm text-ink-soft">{pinyin}</div>
      <div className="mt-2 text-xs text-ink-faint">{truncate(meaning, 30)}</div>
    </Link>
  );
}
