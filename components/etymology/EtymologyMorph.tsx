'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Era, EraGlyph as EraGlyphType } from '@/lib/etymology-types';
import { ERA_DATES, LEVEL_LABEL, coverageHint, type CharLevel } from './era-dates';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

const ERA_FONT_FAMILY: Record<Era, string> = {
  jiaguwen: 'YinQiJiaGuWen',
  jinwen: 'HanDianJinWen',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'QuanZiKuLiDing',
  kaishu: 'KaiTi',
};

const ERA_FONT_CLASS: Record<Era, string> = {
  jiaguwen: 'font-jiaguwen',
  jinwen: 'font-jinwen',
  xiaozhuan: 'font-xiaozhuan',
  lishu: 'font-lishu',
  kaishu: 'font-kai',
};

interface Props {
  char: string;
  eraGlyphs: EraGlyphType[];
  story: string | null;
  level: CharLevel;
}

const AUTOPLAY_INTERVAL_MS = 1200;
const FADE_DURATION_MS = 500;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function EtymologyMorph({ char, eraGlyphs, story, level }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => !prefersReducedMotion());

  // Filter to eras that have glyph data (skip missing per spec).
  const eras = eraGlyphs.filter((g) => g.hasGlyph);

  const goTo = useCallback((i: number) => {
    setCurrentIndex(((i % eras.length) + eras.length) % eras.length);
  }, [eras.length]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % Math.max(1, eras.length));
  }, [eras.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + eras.length) % Math.max(1, eras.length));
  }, [eras.length]);

  // Autoplay
  useEffect(() => {
    if (!isPlaying || eras.length < 2) return;
    const id = setInterval(goNext, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, eras.length, goNext]);

  // Keyboard
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === ' ') {
      e.preventDefault();
      setIsPlaying((p) => !p);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(eras.length - 1);
    }
  }, [goNext, goPrev, goTo, eras.length]);

  // Empty state
  if (eras.length === 0) {
    return (
      <div className="text-center py-12 text-ink-faint">
        暂无字源数据
      </div>
    );
  }

  const currentEra = eras[currentIndex];
  const eraId = currentEra.era;

  return (
    <section
      aria-label="字形演变"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="focus:outline-none"
    >
      {/* Header row: char + level badge + coverage hint */}
      <div className="flex items-baseline gap-3 mb-4 flex-wrap">
        <h2 className="text-3xl font-kai text-ink">{char}</h2>
        <span className="text-xs px-2 py-0.5 rounded bg-paper-warm
                         border border-ink-faint/30 text-ink-soft">
          {LEVEL_LABEL[level]}
        </span>
        <span className="text-xs text-ink-faint">
          {coverageHint(eras.length, level)}
        </span>
      </div>

      {/* Big glyph stage — all eras stacked absolutely */}
      <div className="relative h-48 sm:h-64 bg-gradient-to-b from-paper-warm to-paper rounded mb-4">
        {eras.map((era, i) => (
          <span
            key={era.era}
            aria-hidden={i !== currentIndex}
            className={`absolute inset-0 flex items-center justify-center
                        text-9xl transition-opacity duration-500
                        motion-reduce:transition-none
                        ${ERA_FONT_CLASS[era.era]}
                        ${i === currentIndex ? 'opacity-100' : 'opacity-0'}`}
            style={{ fontFamily: ERA_FONT_FAMILY[era.era] }}
          >
            {char}
          </span>
        ))}
      </div>

      {/* Play/pause + current era label */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          aria-label={isPlaying ? '暂停' : '播放'}
          className="w-10 h-10 rounded-full bg-paper-warm border border-ink/20
                     hover:bg-seal hover:text-paper-warm transition text-lg
                     flex items-center justify-center"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="text-sm text-ink-soft">
          {ERA_LABELS[eraId]} · {ERA_DATES[eraId].range}
        </span>
      </div>

      {/* Scrubber */}
      <div
        role="slider"
        aria-valuemin={0}
        aria-valuemax={eras.length - 1}
        aria-valuenow={currentIndex}
        aria-label="字形演变时间轴"
        className="flex flex-wrap gap-2 mb-6"
      >
        {eras.map((era, i) => {
          const isActive = i === currentIndex;
          return (
            <button
              key={era.era}
              type="button"
              onClick={() => {
                setIsPlaying(false);
                goTo(i);
              }}
              aria-current={isActive ? 'true' : 'false'}
              aria-label={ERA_LABELS[era.era]}
              className={`px-3 py-1.5 rounded text-xs flex flex-col items-center
                          transition ${
                            isActive
                              ? 'bg-seal text-paper-warm'
                              : 'bg-paper-warm text-ink-soft hover:bg-paper'
                          }`}
            >
              <span className="font-semibold">{ERA_LABELS[era.era]}</span>
              <span className="text-[10px] opacity-80">{ERA_DATES[era.era].range}</span>
            </button>
          );
        })}
      </div>

      {/* Story */}
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
        ← / → 切换时代 · Space 播放/暂停
      </div>
    </section>
  );
}