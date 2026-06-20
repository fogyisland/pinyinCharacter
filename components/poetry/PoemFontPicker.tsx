'use client';

import type { PoemFont } from '@/lib/poetry-types';

interface Props {
  value: PoemFont;
  onChange: (v: PoemFont) => void;
}

const OPTIONS: { value: PoemFont; label: string; cssVar: string }[] = [
  { value: 'kai', label: '楷书', cssVar: 'var(--font-kai)' },
  { value: 'xiao-kai', label: '小楷', cssVar: 'var(--font-iansui)' },
  { value: 'li-shu', label: '隶书', cssVar: 'var(--font-lishu)' },
  { value: 'zhuan-shu', label: '篆书', cssVar: 'var(--font-xiaozhuan)' },
  { value: 'mao-bi', label: '毛笔', cssVar: 'var(--font-ma-shan-zheng)' },
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
              (active
                ? 'bg-seal text-paper'
                : 'text-ink-soft hover:bg-paper-deep')
            }
            style={{ fontFamily: opt.cssVar }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}