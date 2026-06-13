'use client';
import { useState, useEffect, useCallback } from 'react';
import { ERAS, type Era, type EraGlyph as EraGlyphType } from '@/lib/etymology-types';
import { EraGlyph } from './EraGlyph';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

interface Props {
  char: string;
  eraGlyphs: EraGlyphType[];
  story: string | null;
}

export function EtymologyTimeline({ char, eraGlyphs, story }: Props) {
  const [activeIdx, setActiveIdx] = useState(ERAS.length - 1);
  const activeEra = ERAS[activeIdx];
  const activeGlyph = eraGlyphs.find((g) => g.era === activeEra);
  const handlePrev = useCallback(
    () => setActiveIdx((i) => Math.max(0, i - 1)),
    []
  );
  const handleNext = useCallback(
    () => setActiveIdx((i) => Math.min(ERAS.length - 1, i + 1)),
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePrev, handleNext]);

  return (
    <div>
      <div className="text-center py-10 px-4 bg-gradient-to-b from-paper-warm to-paper rounded">
        {activeGlyph ? (
          <EraGlyph
            char={char}
            era={activeGlyph.era}
            font={activeGlyph.font}
            hasGlyph={activeGlyph.hasGlyph}
            size="lg"
          />
        ) : null}
      </div>
      <div className="flex items-center justify-center gap-3 my-6">
        {ERAS.map((era, idx) => {
          const glyph = eraGlyphs.find((g) => g.era === era);
          const isActive = idx === activeIdx;
          const hasGlyph = glyph?.hasGlyph ?? false;
          return (
            <button
              key={era}
              onClick={() => setActiveIdx(idx)}
              className="flex flex-col items-center gap-1 group"
              aria-label={ERA_LABELS[era]}
            >
              <span
                className={`w-3 h-3 rounded-full ${
                  isActive
                    ? 'bg-ink scale-125'
                    : hasGlyph
                      ? 'bg-ink-soft'
                      : 'bg-ink/20'
                } transition`}
              />
              <span
                className={`text-xs ${
                  isActive ? 'text-ink font-semibold' : 'text-ink-faint'
                }`}
              >
                {ERA_LABELS[era]}
              </span>
            </button>
          );
        })}
      </div>
      {story ? (
        <div className="text-base leading-loose text-ink p-4 bg-paper-warm rounded">
          <span className="text-ink-faint text-sm">演变 ·</span> {story}
        </div>
      ) : (
        <div className="text-sm text-ink-faint text-center py-6">
          字源故事即将生成
        </div>
      )}
      <div className="text-xs text-ink-faint text-center mt-4">
        ← / → 切换时代
      </div>
    </div>
  );
}
