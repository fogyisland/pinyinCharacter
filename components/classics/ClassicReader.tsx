'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClassicChunk, ClassicDetail } from '@/lib/classics-types';
import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';
import { SUTRA_READING_LABELS, type SutraReading } from '@/lib/sutra-reading';
import { isPunct, stripPunct } from '@/lib/punctuation';

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

interface Props {
  chunk: ClassicChunk;
  book: Pick<ClassicDetail, 'slug' | 'title' | 'chunks'>;
}

export function ClassicReader({ chunk, book }: Props) {
  const [reading, setReading] = useSutraReading('pinyin:classic-reading');
  const isVertical = reading !== 'horizontal';

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
        <ReadingModePicker value={reading} onChange={setReading} />
        <span className="text-xs text-ink-faint">{SUTRA_READING_LABELS[reading]}</span>
      </div>

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