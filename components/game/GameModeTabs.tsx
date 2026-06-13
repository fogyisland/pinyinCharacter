'use client';

import { useState } from 'react';
import { DragMatchGame } from './DragMatchGame';
import { ToneRadicalGame } from './ToneRadicalGame';

type Mode = 'tone-radical' | 'pinyin-char';

export function GameModeTabs() {
  const [mode, setMode] = useState<Mode>('tone-radical');
  return (
    <div>
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
      </div>
      {mode === 'tone-radical' ? <ToneRadicalGame /> : <DragMatchGame />}
    </div>
  );
}
