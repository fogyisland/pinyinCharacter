'use client';

import { useMemo } from 'react';
import type { CharInfo } from '@/lib/chain-types';

export function ChainScroll({
  chain,
  charsList,
}: {
  chain: string[];
  charsList: CharInfo[];
}) {
  const lookup = useMemo(() => new Map(charsList.map((c) => [c.char, c])), [charsList]);
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-paper-deep/50 p-4">
      <div className="flex items-center gap-3 whitespace-nowrap">
        {chain.map((c, i) => {
          const info = lookup.get(c);
          const isLast = i === chain.length - 1;
          const opacity = isLast ? 1 : Math.max(0.5, 1 - (chain.length - 1 - i) * 0.05);
          return (
            <div key={`${i}-${c}`} className="flex flex-col items-center" style={{ opacity }}>
              <div className="text-3xl font-kai">{c}</div>
              {info && <div className="text-xs text-ink-soft">{info.pinyin}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
