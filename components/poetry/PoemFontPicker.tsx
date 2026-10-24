'use client';

import type { PoemFont } from '@/lib/poetry-types';

interface Props {
  value: PoemFont;
  onChange: (v: PoemFont) => void;
}

/**
 * Labels are intentionally NOT rendered in their own typeface.
 *
 * Setting `font-family` on each button made the browser download every
 * candidate font as soon as the picker was visible — ~22 MB of 楷体/隶书/篆书/
 * 毛笔 faces just to show five buttons. The selected font is applied to the
 * poem preview next to the picker, which is where the actual preview belongs.
 */
const OPTIONS: { value: PoemFont; label: string }[] = [
  { value: 'kai', label: '楷书' },
  { value: 'xiao-kai', label: '小楷' },
  { value: 'li-shu', label: '隶书' },
  { value: 'zhuan-shu', label: '篆书' },
  { value: 'mao-bi', label: '毛笔' },
];

export function PoemFontPicker({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded border border-ink/20 overflow-hidden text-sm bg-paper">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={
              'px-3 py-1 transition-colors border-r border-ink/10 last:border-r-0 ' +
              (active ? 'bg-seal text-paper' : 'text-ink-soft hover:bg-paper-deep')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
