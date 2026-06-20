'use client';

import { useEffect, useState } from 'react';
import { PoemTextView } from './PoemTextView';
import { PoemFontPicker } from './PoemFontPicker';
import { TextGridPicker } from '@/components/common/TextGridPicker';
import {
  DEFAULT_POEM_FONT,
  POEM_FONT_CSS,
  POEM_FONT_STORAGE_KEY,
  type PoemFont,
} from '@/lib/poetry-types';
import {
  DEFAULT_TEXT_GRID,
  TEXT_GRID_STORAGE_KEY,
  type TextGridMode,
} from '@/lib/text-grid';

const VALID_FONTS = new Set<PoemFont>(['kai', 'xiao-kai', 'li-shu', 'zhuan-shu', 'mao-bi']);
const VALID_GRIDS = new Set<TextGridMode>(['default', 'tian', 'mi']);

function isValidFont(v: string | null): v is PoemFont {
  return v !== null && VALID_FONTS.has(v as PoemFont);
}
function isValidGrid(v: string | null): v is TextGridMode {
  return v !== null && VALID_GRIDS.has(v as TextGridMode);
}

interface Props {
  content: string[];
}

export function PoemViewer({ content }: Props) {
  const [font, setFont] = useState<PoemFont>(DEFAULT_POEM_FONT);
  const [grid, setGrid] = useState<TextGridMode>(DEFAULT_TEXT_GRID);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const f = window.localStorage.getItem(POEM_FONT_STORAGE_KEY);
    if (isValidFont(f)) setFont(f);
    const g = window.localStorage.getItem(TEXT_GRID_STORAGE_KEY);
    if (isValidGrid(g)) setGrid(g);
  }, []);

  const updateFont = (next: PoemFont) => {
    setFont(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(POEM_FONT_STORAGE_KEY, next);
    }
  };
  const updateGrid = (next: TextGridMode) => {
    setGrid(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TEXT_GRID_STORAGE_KEY, next);
    }
  };

  return (
    <div className="space-y-4">
      <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3">
        <PoemFontPicker value={font} onChange={updateFont} />
        <TextGridPicker value={grid} onChange={updateGrid} />
      </div>
      <PoemTextView content={content} fontFamily={POEM_FONT_CSS[font]} gridMode={grid} />
    </div>
  );
}