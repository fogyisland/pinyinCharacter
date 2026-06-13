import Link from 'next/link';
import type { Char } from '@/lib/chars-types';

export function DictionaryCharGrid({ chars }: { chars: Char[] }) {
  if (chars.length === 0) {
    return <p className="text-ink-faint text-sm py-8 text-center">没有匹配的字</p>;
  }
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
      {chars.map((c) => (
        <Link
          key={c.char}
          href={`/dictionary/${encodeURIComponent(c.char)}`}
          className="rounded border border-ink/10 p-2 text-center transition hover:border-seal hover:shadow-sm bg-paper"
        >
          <div className="text-2xl font-serif text-ink leading-none">{c.char}</div>
          <div className="text-xs text-ink-soft mt-1">{c.pinyin || '—'}</div>
        </Link>
      ))}
    </div>
  );
}