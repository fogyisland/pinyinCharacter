'use client';

import { useEffect, useState } from 'react';
import { PoemTextView } from './PoemTextView';
import { PoemFontPicker } from './PoemFontPicker';
import {
  DEFAULT_POEM_FONT,
  POEM_FONT_CSS,
  POEM_FONT_STORAGE_KEY,
  type PoemFont,
} from '@/lib/poetry-types';

const VALID_FONTS = new Set<PoemFont>(['kai', 'xiao-kai', 'li-shu', 'zhuan-shu', 'mao-bi']);

function isValidFont(v: string | null): v is PoemFont {
  return v !== null && VALID_FONTS.has(v as PoemFont);
}

interface Props {
  content: string[];
}

export function PoemViewer({ content }: Props) {
  const [font, setFont] = useState<PoemFont>(DEFAULT_POEM_FONT);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(POEM_FONT_STORAGE_KEY);
    if (isValidFont(v)) setFont(v);
  }, []);

  const update = (next: PoemFont) => {
    setFont(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(POEM_FONT_STORAGE_KEY, next);
    }
  };

  return (
    <div className="space-y-4">
      <div className="worksheet-no-print flex items-center justify-center">
        <PoemFontPicker value={font} onChange={update} />
      </div>
      <PoemTextView content={content} fontFamily={POEM_FONT_CSS[font]} />
    </div>
  );
}