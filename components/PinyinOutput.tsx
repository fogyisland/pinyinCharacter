'use client';

import { useState } from 'react';
import type { PinyinToken } from '@/lib/pinyin-client';

interface Props {
  tokens: PinyinToken[];
}

export function PinyinOutput({ tokens }: Props) {
  const [withSpaces, setWithSpaces] = useState(true);
  const [readings, setReadings] = useState<Record<number, number>>({});  // index -> reading index

  if (tokens.length === 0) {
    return <div className="text-gray-400 text-sm">在上方输入汉字，拼音会显示在这里</div>;
  }

  const text = tokens.map((t, i) => {
    const idx = readings[i] ?? 0;
    return t.readings[idx] ?? '?';
  }).join(withSpaces ? ' ' : '');

  const cycleReading = (i: number) => {
    setReadings(prev => {
      const cur = prev[i] ?? 0;
      const next = (cur + 1) % tokens[i]!.readings.length;
      return { ...prev, [i]: next };
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={withSpaces}
            onChange={e => setWithSpaces(e.target.checked)}
          />
          带空格
        </label>
        <button
          type="button"
          onClick={copy}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
        >
          复制
        </button>
      </div>
      <div className="p-3 bg-gray-50 rounded border min-h-[3rem] text-lg leading-relaxed">
        {tokens.map((t, i) => {
          const idx = readings[i] ?? 0;
          const r = t.readings[idx] ?? '?';
          const isPoly = t.readings.length > 1;
          return (
            <span key={i} className="inline-block mr-2 mb-1">
              <span className="text-gray-700">{t.char}</span>
              {isPoly ? (
                <button
                  type="button"
                  onClick={() => cycleReading(i)}
                  className="ml-1 text-blue-600 hover:underline"
                  title="点击切换读音"
                >
                  ({r})
                </button>
              ) : (
                <span className="ml-1 text-gray-500">[{r}]</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
