'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function PinyinAnchor({ activeLetter }: { activeLetter?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const handleClick = (letter: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('view', 'pinyin');
    params.set('letter', letter);
    router.push(`/dictionary?${params.toString()}#${letter}`);
  };

  return (
    <nav className="flex flex-wrap gap-1 border-b border-ink/20 pb-3 mb-4" aria-label="拼音首字母">
      {LETTERS.map((l) => (
        <button
          key={l}
          onClick={() => handleClick(l)}
          className={`px-2 py-1 text-sm rounded ${
            activeLetter === l
              ? 'bg-ink text-paper font-semibold'
              : 'text-ink-soft hover:bg-paper-warm'
          }`}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}