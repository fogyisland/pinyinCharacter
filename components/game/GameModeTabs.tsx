'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useDifficulty } from '@/lib/use-difficulty';
import type { HskLevel } from '@/lib/difficulty';

type Mode = 'tone-radical' | 'pinyin-char' | 'pinyin-chain';

const HSKS: HskLevel[] = [1, 2, 3, 4, 5, 6];

// The three games are self-contained and each one is only needed when its
// tab is open. They used to sit in the bundle of /game, so the visitor
// downloaded all three games before playing the first one.
const ToneRadicalGame = dynamic(
  () => import('./ToneRadicalGame').then((mod) => mod.ToneRadicalGame),
  { ssr: false, loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div> },
);
const DragMatchGame = dynamic(() => import('./DragMatchGame').then((mod) => mod.DragMatchGame), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div>,
});
const ChainGame = dynamic(() => import('./ChainGame').then((mod) => mod.ChainGame), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div>,
});

export function GameModeTabs() {
  const [mode, setMode] = useState<Mode>('tone-radical');
  const { hskLevel, setHskLevel } = useDifficulty();
  return (
    <div>
      <div role="group" aria-label="HSK level" className="flex gap-2 mb-3">
        {HSKS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setHskLevel(lvl)}
            aria-pressed={lvl === hskLevel}
            className={`rounded border px-2 py-1 text-sm ${
              lvl === hskLevel
                ? 'bg-seal text-white border-seal'
                : 'bg-paper-deep border-ink/30 hover:bg-paper'
            }`}
          >
            HSK {lvl}
          </button>
        ))}
      </div>
      <div className="mb-5 flex gap-2 border-b border-ink/10">
        <button
          type="button"
          onClick={() => setMode('tone-radical')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'tone-radical'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          声调·部首
        </button>
        <button
          type="button"
          onClick={() => setMode('pinyin-char')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'pinyin-char'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          拼音·字
        </button>
        <button
          type="button"
          onClick={() => setMode('pinyin-chain')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'pinyin-chain'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          拼音接龙
        </button>
      </div>
      {mode === 'tone-radical' && <ToneRadicalGame />}
      {mode === 'pinyin-char' && <DragMatchGame />}
      {mode === 'pinyin-chain' && <ChainGame />}
    </div>
  );
}
