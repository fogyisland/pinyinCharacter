'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Difficulty } from '@/lib/difficulty';
import type { LegacyGameResult } from '@/components/game/LegacyGameResult';
import {
  dailyKey,
  defaultProgress,
  loadProgress,
  localDateKey,
  recordDaily,
  saveProgress,
  type GameProgress,
} from '@/lib/game-progress';

/**
 * The 每日一局 - the three legacy games, demoted to four daily cards.
 *
 * Each card owns one slot of the day. The slot is keyed by **three**
 * independent axes - the mode, the difficulty and the HSK tier - so a hard
 * round of HSK 1 never marks the easy round of HSK 2 as played.
 *
 * The three games are loaded lazily: the visitor downloads a game only when
 * its card is opened, so nothing is fetched before the first one is played.
 */
const ToneRadicalGame = dynamic(
  () => import('@/components/game/ToneRadicalGame').then((m) => m.ToneRadicalGame),
  { ssr: false, loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div> },
);
const DragMatchGame = dynamic(
  () => import('@/components/game/DragMatchGame').then((m) => m.DragMatchGame),
  { ssr: false, loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div> },
);
const ChainGame = dynamic(() => import('@/components/game/ChainGame').then((m) => m.ChainGame), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-ink-faint">加载中...</div>,
});

/**
 * The mode part of a daily key.
 *
 * These strings are stable identifiers inside localStorage - they are not UI
 * copy, and they must never change without a migration.
 */
const MODE_TONE = 'tone';
const MODE_RADICAL = 'radical';
const MODE_PINYIN_CHAR = 'pinyin-char';
const MODE_PINYIN_CHAIN = 'pinyin-chain';

/** Which game a card opens. */
type DailyGame = 'tone' | 'radical' | 'pinyin-char' | 'pinyin-chain';

interface DailyCardSpec {
  /** The mode part of the daily key. */
  mode: string;
  /** The Chinese title of the card. */
  title: string;
  /** One line that says what the round is about. */
  hint: string;
  /** The game the card opens. */
  game: DailyGame;
  /** The `mode` prop of the tone/radical game - the other games have none. */
  toneMode?: 'tone' | 'radical';
}

const CARDS: DailyCardSpec[] = [
  {
    mode: MODE_TONE,
    title: '声调',
    hint: '把声调拖到对应的字上',
    game: 'tone',
    toneMode: 'tone',
  },
  {
    mode: MODE_RADICAL,
    title: '部首',
    hint: '把部首拖到对应的字上',
    game: 'radical',
    toneMode: 'radical',
  },
  {
    mode: MODE_PINYIN_CHAR,
    title: '拼音·字',
    hint: '把拼音拖到对应的字上',
    game: 'pinyin-char',
  },
  {
    mode: MODE_PINYIN_CHAIN,
    title: '拼音接龙',
    hint: '用上一个字的尾音接下一个字',
    game: 'pinyin-chain',
  },
];

export interface DailyChallengeProps {
  tier: number;
  difficulty: Difficulty;
}

export function DailyChallenge({ tier, difficulty }: DailyChallengeProps) {
  const [progress, setProgress] = useState<GameProgress>(defaultProgress);
  /** The mode of the open card - only one card is open at a time. */
  const [openMode, setOpenMode] = useState<string | null>(null);
  /** The daily key of the open round - captured when the card is opened. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  /** Today's slots - the date is the local one, not the UTC one. */
  const slots = progress.daily[localDateKey()] ?? {};

  function openCard(card: DailyCardSpec): void {
    // The key is captured when the card opens: the learner may switch the
    // difficulty or the tier while the round is running, and the result
    // belongs to the slot the round was **started** in.
    setOpenKey(dailyKey(card.mode, difficulty, tier));
    setOpenMode(card.mode);
  }

  function closeCard(): void {
    setOpenMode(null);
    setOpenKey(null);
  }

  /**
   * Record the finished round.
   *
   * The first result wins - `recordDaily` overwrites the slot, so a finished
   * slot is never written again. The progress is re-read from the storage
   * first: the parent holds a snapshot that may already be stale.
   */
  function handleComplete(result: LegacyGameResult): void {
    const key = openKey;
    if (key === null) return;
    const fresh = loadProgress();
    const today = localDateKey();
    if (fresh.daily[today]?.[key]?.done === true) {
      setProgress(fresh);
    } else {
      const next = recordDaily(fresh, key, result.correct);
      saveProgress(next);
      setProgress(next);
    }
    // The round is over - the card falls back to its state, which now shows
    // the score and the 「再玩一次」 button.
    closeCard();
  }

  const renderGame = (card: DailyCardSpec) => {
    if (card.game === 'pinyin-char') {
      return <DragMatchGame onComplete={handleComplete} />;
    }
    if (card.game === 'pinyin-chain') {
      return <ChainGame onComplete={handleComplete} />;
    }
    return <ToneRadicalGame mode={card.toneMode} onComplete={handleComplete} />;
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {CARDS.map((card) => {
        const slot = slots[dailyKey(card.mode, difficulty, tier)];
        const done = slot?.done === true;
        const isOpen = openMode === card.mode;
        return (
          <div
            key={card.mode}
            data-daily-card={card.mode}
            className="rounded border border-ink/15 bg-paper px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">{card.title}</p>
                <p className="text-xs text-ink-faint">{card.hint}</p>
              </div>
              <span
                data-daily-status={card.mode}
                className="shrink-0 text-xs text-ink-soft"
              >
                {done ? `已完成 · ${slot?.score ?? 0} 分` : '未玩'}
              </span>
            </div>
            <div className="mt-3">
              {isOpen ? (
                <button
                  type="button"
                  onClick={closeCard}
                  className="rounded border border-ink/30 bg-paper-deep px-3 py-1.5 text-sm text-ink hover:bg-paper"
                >
                  结束
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openCard(card)}
                  className="rounded border border-seal bg-seal px-3 py-1.5 text-sm text-paper-soft hover:opacity-90"
                >
                  {done ? '再玩一次' : '开始'}
                </button>
              )}
            </div>
            {isOpen ? <div className="mt-3">{renderGame(card)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
