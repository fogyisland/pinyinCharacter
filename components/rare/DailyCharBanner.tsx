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
      href={`/rare-chars/${encodeURIComponent(char)}`}
      className="block rounded-lg border-2 border-blue-200 bg-blue-50 p-6 transition hover:border-blue-400"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-blue-600">
        今日一字 · {date}
      </div>
      <div className="mt-3 flex items-baseline gap-4">
        <span className="text-6xl font-bold text-gray-900">{char}</span>
        <span className="text-2xl text-gray-600">{pinyin}</span>
      </div>
      <div className="mt-2 text-sm text-gray-700">{meaning}</div>
    </Link>
  );
}
