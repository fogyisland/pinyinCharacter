'use client';

import { useState, type ReactNode, type DragEvent } from 'react';
import type { RevealConfig, RevealElement } from '@/lib/reveal';

interface Props {
  charId: string;
  char: string;
  pinyin: string;
  meaning: string;
  matchedPinyin: string | null;
  onDrop: (charId: string, pinyinId: string) => void;
  // 2026-07-04: T9 HSK reveal wiring — controls whether pinyin/meaning
  // hints show on the cell. The DropSlot below stays regardless of HSK
  // level (per the redesign: drop tokens are quiz answers, not hints).
  revealConfig: RevealConfig;
  // Bumps mismatches when the user clicks an on-demand reveal button.
  onDemandReveal: (el: RevealElement) => void;
}

const HINT_LABEL: Record<RevealElement, string> = {
  pinyin: '显示拼音',
  meaning: '显示含义',
  radical: '显示部首',
};

export function CharDropZone({
  charId,
  char,
  pinyin,
  meaning,
  matchedPinyin,
  onDrop,
  revealConfig,
  onDemandReveal,
}: Props) {
  const [revealed, setRevealed] = useState<Set<RevealElement>>(new Set());

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pinyinId = e.dataTransfer.getData('text/plain');
    if (pinyinId) onDrop(charId, pinyinId);
  };

  const isVisible = (el: RevealElement) =>
    revealConfig.cellHints.includes(el) || revealed.has(el);

  const handleClick = (el: RevealElement) => {
    if (!revealConfig.allowOnDemandHints) return;
    setRevealed((s) => new Set(s).add(el));
    onDemandReveal(el);
  };

  const renderToken = (el: RevealElement, content: ReactNode): ReactNode =>
    isVisible(el) ? (
      <span data-hint={el}>{content}</span>
    ) : revealConfig.allowOnDemandHints ? (
      <button
        type="button"
        aria-label={HINT_LABEL[el]}
        className="rounded border border-ink/30 px-1 text-xs text-ink-faint"
        onClick={() => handleClick(el)}
      >
        ?
      </button>
    ) : null;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="flex items-center gap-3 rounded border border-ink/20 bg-paper p-3"
    >
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold">{char}</span>
        <span className="mt-1 flex gap-2 text-xs">
          {renderToken('pinyin', <span data-pinyin>{pinyin}</span>)}
          {renderToken('meaning', <span data-meaning>{meaning}</span>)}
        </span>
      </div>
      <span className="text-sm text-ink-faint">→</span>
      <span className="flex-1 rounded border border-dashed border-ink/20 px-3 py-1 text-sm text-ink-faint">
        {matchedPinyin ?? '拖动拼音到这里'}
      </span>
    </div>
  );
}
