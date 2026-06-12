'use client';

import { useEffect, useState } from 'react';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

interface Props {
  selected: string[];
  onChange: (chars: string[]) => void;
}

export function LibrarySelectTab({ selected, onChange }: Props) {
  const [q, setQ] = useState('');
  const [chars, setChars] = useState<Char[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = q
          ? `/api/rare-chars?q=${encodeURIComponent(q)}&page=1`
          : `/api/rare-chars?page=1`;
        const res = await fetch(url);
        const data = (await res.json()) as { ok: boolean; data: { chars: Char[] } };
        if (data.ok) setChars(data.data.chars);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  const toggle = (c: string) => {
    if (selected.includes(c)) onChange(selected.filter((x) => x !== c));
    else if (selected.length < 500) onChange([...selected, c]);
  };

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索生僻字..."
        className="w-full rounded-md border border-ink/20 px-3 py-2"
      />
      <div className="mt-3 grid max-h-96 grid-cols-6 gap-2 overflow-y-auto sm:grid-cols-8">
        {chars.map((c) => {
          const isSelected = selected.includes(c.char);
          return (
            <button
              key={c.char}
              type="button"
              onClick={() => toggle(c.char)}
              className={`flex flex-col items-center rounded border p-2 text-center transition ${
                isSelected
                  ? 'border-seal bg-seal/10'
                  : 'border-ink/10 hover:border-ink/30'
              }`}
              title={c.meaning}
            >
              <span className="text-2xl">{c.char}</span>
              <span className="mt-1 text-[10px] text-ink-faint">{c.pinyin}</span>
            </button>
          );
        })}
        {!loading && chars.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-ink-faint">无匹配</div>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-faint">已选 {selected.length} / 500</p>
    </div>
  );
}
