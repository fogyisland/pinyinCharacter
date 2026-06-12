'use client';

import type { Dynasty } from '@/lib/poetry-types';

interface Props {
  dynasty: Dynasty;
  q: string;
  onDynastyChange: (d: Dynasty) => void;
  onQChange: (q: string) => void;
}

const TABS: Array<{ key: Dynasty; label: string }> = [
  { key: 'tang', label: '唐诗' },
  { key: 'song', label: '宋词' },
];

export function PoemSearch({ dynasty, q, onDynastyChange, onQChange }: Props) {
  return (
    <div className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="搜索标题或作者..."
        className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2 text-base focus:border-seal focus:outline-none"
      />
      <div className="flex items-center gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onDynastyChange(t.key)}
            className={`px-4 py-2 text-base transition-colors ${
              dynasty === t.key
                ? 'border-b-2 border-seal text-seal font-medium'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
