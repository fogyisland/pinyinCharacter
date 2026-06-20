'use client';

import { useEffect, useState } from 'react';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

type Source = 'rare' | '1' | '2' | '3';

interface Props {
  selected: string[];
  onChange: (chars: string[]) => void;
}

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'rare', label: '生僻字' },
  { value: '1', label: '一级 (L1 常用字)' },
  { value: '2', label: '二级 (L2 次常用)' },
  { value: '3', label: '三级 (L3 扩展)' },
];

export function LibrarySelectTab({ selected, onChange }: Props) {
  const [source, setSource] = useState<Source>('rare');
  const [q, setQ] = useState('');
  const [chars, setChars] = useState<Char[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPage(1);
    setChars([]);
    setTotal(0);
  }, [source, q]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          source === 'rare'
            ? `/api/rare-chars?q=${encodeURIComponent(q)}&page=${page}`
            : `/api/chars?level=${source}&q=${encodeURIComponent(q)}&page=${page}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.ok) return;
        const newChars: Char[] =
          source === 'rare'
            ? data.data.chars
            : data.data.chars.map((c: any) => ({
                char: c.char,
                pinyin: c.pinyin,
                meaning: c.meaningZh ?? '',
              }));
        setChars((prev) => (page === 1 ? newChars : [...prev, ...newChars]));
        if (source !== 'rare') setTotal(data.data.total ?? 0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [source, q, page]);

  const toggle = (c: string) => {
    if (selected.includes(c)) onChange(selected.filter((x) => x !== c));
    else if (selected.length < 500) onChange([...selected, c]);
  };

  const hasMore = source !== 'rare' && chars.length < total;

  return (
    <div>
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          className="rounded-md border border-ink/20 px-3 py-2 text-sm"
          aria-label="字库来源"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索... (按字精确匹配)"
          className="flex-1 rounded-md border border-ink/20 px-3 py-2 text-sm"
        />
      </div>
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
      <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
        <span>
          {source !== 'rare' ? `共 ${total} 字 · 已加载 ${chars.length}` : ''}
        </span>
        <span>已选 {selected.length} / 500</span>
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={loading}
          className="mt-2 w-full rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-50"
        >
          {loading ? '加载中...' : `加载更多 (${chars.length} / ${total})`}
        </button>
      )}
    </div>
  );
}