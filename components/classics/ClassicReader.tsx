'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClassicChunk, ClassicDetail } from '@/lib/classics-types';
import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';
import { TextGridPicker } from '@/components/common/TextGridPicker';
import { SUTRA_READING_LABELS, type SutraReading } from '@/lib/sutra-reading';
import { DEFAULT_TEXT_GRID, TEXT_GRID_STORAGE_KEY, type TextGridMode } from '@/lib/text-grid';
import { isPunct, stripPunct } from '@/lib/punctuation';

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

const VALID_GRIDS = new Set<TextGridMode>(['default', 'tian', 'mi']);
function isValidGrid(v: string | null): v is TextGridMode {
  return v !== null && VALID_GRIDS.has(v as TextGridMode);
}

function GridChar({ ch, mode }: { ch: string; mode: 'tian' | 'mi' }) {
  const size = 'w-10 h-10 sm:w-12 sm:h-12';
  if (mode === 'tian') {
    return (
      <span
        className={`inline-flex items-center justify-center ${size} border border-ink relative align-middle mx-0.5`}
      >
        <span className="absolute inset-x-0 top-1/2 h-px bg-ink/60 pointer-events-none" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink/60 pointer-events-none" />
        <span className="relative">{ch}</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center ${size} border border-ink relative align-middle mx-0.5`}
      style={{
        backgroundImage:
          'linear-gradient(to top right, transparent calc(50% - 0.5px), rgb(var(--ink-rgb, 0 0 0) / 0.6) 50%, transparent calc(50% + 0.5px)), linear-gradient(to top left, transparent calc(50% - 0.5px), rgb(var(--ink-rgb, 0 0 0) / 0.6) 50%, transparent calc(50% + 0.5px))',
      }}
    >
      <span className="relative">{ch}</span>
    </span>
  );
}

interface Props {
  chunk: ClassicChunk;
  book: Pick<ClassicDetail, 'slug' | 'title' | 'chunks'>;
}

export function ClassicReader({ chunk, book }: Props) {
  const [reading, setReading] = useSutraReading('pinyin:classic-reading');
  const [grid, setGrid] = useState<TextGridMode>(DEFAULT_TEXT_GRID);
  const isVertical = reading !== 'horizontal';
  const inGrid = grid === 'tian' || grid === 'mi';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(TEXT_GRID_STORAGE_KEY);
    if (isValidGrid(v)) setGrid(v);
  }, []);

  const updateGrid = (next: TextGridMode) => {
    setGrid(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TEXT_GRID_STORAGE_KEY, next);
    }
  };

  const charsAndPinyin: Array<{ ch: string; py: string }> = [];
  for (let lineIdx = 0; lineIdx < chunk.content.length; lineIdx++) {
    const line = chunk.content[lineIdx]!;
    const linePinyin = chunk.pinyin[lineIdx] ?? [];
    Array.from(line).forEach((ch, i) => {
      if (isPunct(ch)) return;
      charsAndPinyin.push({ ch, py: linePinyin[i] ?? '' });
    });
  }

  const prefill = encodeURIComponent(charsAndPinyin.map(c => c.ch).join(''));
  const worksheetHref = `/worksheet?source=ancient&book=${book.slug}&chapterIdx=${chunk.id - 1}&prefill=${prefill}`;

  const currentIdx = chunk.id - 1;
  const prevChunk = currentIdx > 0 ? book.chunks[currentIdx - 1] : null;
  const nextChunk = currentIdx < book.chunks.length - 1 ? book.chunks[currentIdx + 1] : null;

  return (
    <div className="space-y-4">
      <div className="worksheet-no-print flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <ReadingModePicker value={reading} onChange={setReading} />
          <TextGridPicker value={grid} onChange={updateGrid} />
        </div>
        <span className="text-xs text-ink-faint">{SUTRA_READING_LABELS[reading]}</span>
      </div>

      {inGrid ? (
        <div className={isVertical ? 'text-center' : 'text-center'}>
          {chunk.content.map((line, lineIdx) => (
            <div key={lineIdx} className="my-3 leading-relaxed">
              {Array.from(line).map((c, i) => {
                if (isPunct(c)) return null;
                return <GridChar key={i} ch={c} mode={grid as 'tian' | 'mi'} />;
              })}
            </div>
          ))}
        </div>
      ) : (
        <article
          className="font-serif text-lg sm:text-xl text-ink leading-loose"
          style={isVertical ? { writingMode: WRITING_MODE[reading] as 'vertical-rl' | 'vertical-lr' } : undefined}
        >
          {chunk.content.map((line, lineIdx) => (
            <p key={lineIdx} className={isVertical ? 'mx-3 inline-block' : 'my-1.5'}>
              {Array.from(line).map((ch, i) => {
                if (isPunct(ch)) return null;
                const py = chunk.pinyin[lineIdx]?.[i] ?? '';
                return (
                  <span key={i} className="classic-char inline-block px-1.5 py-0.5">
                    <span className="block">{ch}</span>
                    <span className="block text-[0.65em] text-ink-faint text-center">{py}</span>
                  </span>
                );
              })}
            </p>
          ))}
        </article>
      )}

      <div className="worksheet-no-print flex items-center justify-between gap-2 pt-4 border-t border-ink/10">
        <button
          type="button"
          disabled={!prevChunk}
          onClick={() => prevChunk && (window.location.href = `/ancient/${book.slug}?chunk=${prevChunk.id - 1}`)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← 上一章
        </button>
        <Link
          href={worksheetHref}
          className="rounded-md bg-seal px-4 py-2 text-white text-sm hover:bg-seal/80"
        >
          生成字帖
        </Link>
        <button
          type="button"
          disabled={!nextChunk}
          onClick={() => nextChunk && (window.location.href = `/ancient/${book.slug}?chunk=${nextChunk.id - 1}`)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下一章 →
        </button>
      </div>
    </div>
  );
}