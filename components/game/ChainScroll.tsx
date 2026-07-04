'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { CharInfo } from '@/lib/chain-types';
import type { RevealConfig, RevealElement } from '@/lib/reveal';
import { PinyinToken } from './PinyinToken';

const HINT_LABEL: Record<RevealElement, string> = {
  pinyin: '显示拼音',
  radical: '显示部首',
  meaning: '显示含义',
};

export function ChainScroll({
  chain,
  charsList,
  revealConfig,
  onDemandReveal,
}: {
  chain: string[];
  charsList: CharInfo[];
  revealConfig: RevealConfig;
  onDemandReveal: (el: RevealElement) => void;
}) {
  const lookup = useMemo(() => new Map(charsList.map((c) => [c.char, c])), [charsList]);
  const [revealed, setRevealed] = useState<Set<RevealElement>>(new Set());

  const isVisible = (el: RevealElement) =>
    revealConfig.cellHints.includes(el) || revealed.has(el);

  const handleClick = (el: RevealElement) => {
    if (!revealConfig.allowOnDemandHints) return;
    setRevealed((s) => new Set(s).add(el));
    onDemandReveal(el);
  };

  // Chain game has no radical column — Task 2 filters it out via
  // getRevealConfig('chain', hskLevel), but defensively skip it here too.
  const ELEMENTS: RevealElement[] = ['pinyin', 'meaning'];

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
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-paper-deep/50 p-4">
      <div className="flex items-center gap-3 whitespace-nowrap">
        {chain.map((c, i) => {
          const info = lookup.get(c);
          const isLast = i === chain.length - 1;
          const opacity = isLast ? 1 : Math.max(0.5, 1 - (chain.length - 1 - i) * 0.05);
          return (
            <div key={`${i}-${c}`} className="flex flex-col items-center" style={{ opacity }}>
              <div className="text-3xl font-kai">{c}</div>
              <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                {ELEMENTS.map((el) => {
                  if (el === 'pinyin') {
                    return (
                      <span key={el}>
                        {renderToken(
                          'pinyin',
                          <PinyinToken pinyin={info?.pinyin ?? ''} matched={false} onDragStart={() => {}} />,
                        )}
                      </span>
                    );
                  }
                  if (el === 'meaning') {
                    return (
                      <span key={el}>
                        {renderToken('meaning', <span data-meaning>{info?.meaning ?? ''}</span>)}
                      </span>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}