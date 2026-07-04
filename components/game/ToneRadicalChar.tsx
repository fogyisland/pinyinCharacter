'use client';
import { useState, type ReactNode } from 'react';
import type { RevealConfig, RevealElement } from '@/lib/reveal';
import { PinyinToken } from './PinyinToken';
import { RadicalToken } from './RadicalToken';

type Kind = 'tone' | 'radical' | 'pinyin';

type Props = {
  char: string;
  pinyin?: string;
  radical?: string;
  meaning?: string;
  /** Which drop-slot to render under the char (drives drag-drop mechanics). */
  slotKind: Kind;
  /** Currently matched value for the slot (null = empty). */
  matched: string | null;
  /** Called with (slotKind, payload) when a token is dropped on the slot. */
  onDrop: (kind: Kind, payload: string) => void;
  /** HSK reveal config — controls whether pinyin/meaning/radical hints show. */
  revealConfig: RevealConfig;
  /** Bumps mismatches when the user clicks an on-demand reveal button. */
  onDemandReveal: (el: RevealElement) => void;
};

const HINT_LABEL: Record<RevealElement, string> = {
  pinyin: '显示拼音',
  radical: '显示部首',
  meaning: '显示含义',
};

function DropSlot({
  kind,
  label,
  matched,
  onDrop,
}: {
  kind: Kind;
  label: string;
  matched: string | null;
  onDrop: (kind: Kind, payload: string) => void;
}) {
  // For tone mode the slot is a small square; for pinyin/radical it's
  // wider to fit the string.
  const isTone = kind === 'tone';
  return (
    <div
      data-slot={kind}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(kind, e.dataTransfer.getData('text/plain'));
      }}
      className={`flex h-10 ${isTone ? 'w-14' : 'min-w-20 px-2'} items-center justify-center rounded border-2 border-dashed text-lg ${
        isTone ? 'font-kai' : 'font-mono'
      } ${matched ? 'border-seal bg-seal/10 text-seal' : 'border-ink/20 text-ink-faint'}`}
      aria-label={label}
    >
      {matched ?? '?'}
    </div>
  );
}

export function ToneRadicalChar({
  char,
  pinyin,
  radical,
  meaning,
  slotKind,
  matched,
  onDrop,
  revealConfig,
  onDemandReveal,
}: Props) {
  const [revealed, setRevealed] = useState<Set<RevealElement>>(new Set());

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
    <div className="tone-radical-char flex flex-col items-center gap-2">
      <span className="text-3xl">{char}</span>
      <div className="text-xs mt-1 flex flex-wrap justify-center gap-2">
        {renderToken('pinyin', <PinyinToken pinyin={pinyin ?? ''} matched={false} onDragStart={() => {}} />)}
        {renderToken('meaning', <span data-meaning>{meaning ?? ''}</span>)}
        {renderToken('radical', <RadicalToken radical={radical ?? ''} matched={false} onDragStart={() => {}} />)}
      </div>
      <DropSlot
        kind={slotKind}
        label={
          slotKind === 'tone' ? '声调槽' : slotKind === 'radical' ? '部首槽' : '拼音槽'
        }
        matched={matched}
        onDrop={onDrop}
      />
    </div>
  );
}