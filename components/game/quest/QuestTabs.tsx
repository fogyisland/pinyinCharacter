'use client';

import { useEffect, useRef, useState } from 'react';
import { HskPicker } from '@/components/game/HskPicker';
import { DailyChallenge } from '@/components/game/daily/DailyChallenge';
import { CharCollection } from '@/components/game/quest/CharCollection';
import { QuestBoard } from '@/components/game/quest/QuestBoard';
import { QuestRunner } from '@/components/game/quest/QuestRunner';
import { WrongBook } from '@/components/game/quest/WrongBook';
import { useDifficulty } from '@/lib/use-difficulty';
import { isSoundMuted, setSoundMuted } from '@/lib/game-sound';
import {
  defaultProgress,
  loadProgress,
  removeWrong,
  saveProgress,
  type GameProgress,
} from '@/lib/game-progress';
import type { HskLevel } from '@/lib/difficulty';

/**
 * The four flat panels of the game page.
 *
 * The HSK picker sits **above** the tabs and is shared by 闯关 and 每日一局.
 * The quest keeps its **own** per-tier level pointer in the progress store,
 * so switching a tier never loses the position in the other five tiers.
 */
export type QuestTab = 'quest' | 'daily' | 'collection' | 'wrong';

interface TabSpec {
  id: QuestTab;
  label: string;
}

const TABS: TabSpec[] = [
  { id: 'quest', label: '闯关' },
  { id: 'daily', label: '每日一局' },
  { id: 'collection', label: '字卡册' },
  { id: 'wrong', label: '生字本' },
];

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id));

/** The part of the query string the page reads on mount (§7.5). */
interface UrlState {
  tab: QuestTab;
  hsk: HskLevel | null;
  level: number | null;
}

/** The level map's response - only the level count is needed. */
interface BoardResponse {
  ok: boolean;
  data?: { levelCount?: number };
  error?: { code?: string; message?: string };
}

function isQuestTab(value: string): value is QuestTab {
  return TAB_IDS.has(value);
}

/** Only 1-6 are real tiers. */
function toHskLevel(value: number): HskLevel | null {
  if (!Number.isInteger(value) || value < 1 || value > 6) return null;
  return value as HskLevel;
}

/** Only a positive integer can be a level. */
function toLevel(value: number): number | null {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Read the query string.
 *
 * `tab` names the panel, `hsk` the shared tier and `level` the quest level to
 * open. Anything malformed is ignored - a broken link must not break the
 * page, so an unknown tab falls back to 闯关.
 */
function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const tabParam = params.get('tab');
  const hskParam = params.get('hsk');
  const levelParam = params.get('level');
  return {
    tab: tabParam !== null && isQuestTab(tabParam) ? tabParam : 'quest',
    hsk: hskParam === null ? null : toHskLevel(Number(hskParam)),
    level: levelParam === null ? null : toLevel(Number(levelParam)),
  };
}

interface SoundToggleProps {
  muted: boolean;
  onToggle: () => void;
}

/**
 * The sound switch.
 *
 * One switch for every sound of the game: the four Web-Audio cues and the
 * character audio both read the same stored flag (§9), so there is no second
 * toggle.
 */
function SoundToggle({ muted, onToggle }: SoundToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={!muted}
      onClick={onToggle}
      className="rounded border border-ink/30 bg-paper-deep px-2 py-1 text-sm text-ink hover:bg-paper"
    >
      {muted ? '🔇 静音' : '🔊 声音'}
    </button>
  );
}

interface TabBarProps {
  active: QuestTab;
  onSelect: (tab: QuestTab) => void;
}

/** The four tabs - flat, one row, no nesting. */
function TabBar({ active, onSelect }: TabBarProps) {
  return (
    <div role="tablist" aria-label="游戏模式" className="mb-5 flex gap-2 border-b border-ink/10">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onSelect(tab.id)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab.id === active
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface QuestPanelProps {
  tier: number;
  currentLevel: number;
  passedLevels: number[];
  levelCount: number | null;
  boardError: string | null;
  openLevel: number | null;
  onOpenLevel: (level: number) => void;
  onCloseRunner: () => void;
  onPassed: (level: number) => void;
  onNextLevel: () => void;
  onRetry: () => void;
}

/**
 * The 闯关 panel - the level map, or the runner that replaces it.
 *
 * A failed level map shows a message and a 「重试」 button instead of the
 * board: a board with a guessed level count would offer tiles that do not
 * exist.
 */
function QuestPanel(props: QuestPanelProps) {
  const { tier, currentLevel, passedLevels, levelCount, boardError, openLevel } = props;
  if (openLevel !== null) {
    return (
      <QuestRunner
        tier={tier}
        level={openLevel}
        onExit={props.onCloseRunner}
        onPassed={props.onPassed}
        onNextLevel={props.onNextLevel}
      />
    );
  }
  if (boardError !== null) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-soft">{boardError}</p>
        <button
          type="button"
          onClick={props.onRetry}
          className="mt-3 rounded border border-seal bg-seal px-4 py-2 text-paper-soft hover:opacity-90"
        >
          重试
        </button>
      </div>
    );
  }
  if (levelCount === null) {
    return <p className="py-10 text-center text-ink-faint">正在打开关卡地图…</p>;
  }
  return (
    <QuestBoard
      tier={tier}
      levelCount={levelCount}
      currentLevel={currentLevel}
      passedLevels={passedLevels}
      onOpenLevel={props.onOpenLevel}
    />
  );
}

export function QuestTabs() {
  const { hskLevel, setHskLevel, difficulty } = useDifficulty();
  const [tab, setTab] = useState<QuestTab>('quest');
  const [hydrated, setHydrated] = useState(false);
  const [progress, setProgress] = useState<GameProgress>(defaultProgress);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [levelCount, setLevelCount] = useState<number | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [collectionTier, setCollectionTier] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);

  // `useDifficulty` hands out a fresh setter on every render, so the URL
  // effect would re-run on every render if it depended on it directly. The
  // ref keeps that effect mount-only.
  const setHskLevelRef = useRef(setHskLevel);
  useEffect(() => {
    setHskLevelRef.current = setHskLevel;
  }, [setHskLevel]);

  // The mute flag is a plain storage read, not a subscription - the switch
  // keeps its own copy of it.
  useEffect(() => {
    setMuted(isSoundMuted());
  }, []);

  // The URL contract (§7.5): the panel, the shared tier and the level to
  // open all arrive in one query string. The tier and the level are applied
  // in the same effect, so React batches them into one re-render.
  useEffect(() => {
    const url = readUrlState(window.location.search);
    if (url.hsk !== null) setHskLevelRef.current(url.hsk);
    if (url.level !== null) {
      // A level belongs to the quest, so it opens the 闯关 panel.
      setOpenLevel(url.level);
      setTab('quest');
    } else {
      setTab(url.tab);
    }
    setHydrated(true);
  }, []);

  // The progress is re-read whenever the panel changes: the runner and the
  // daily challenge write to the storage themselves, so a snapshot taken
  // before the switch can be stale.
  useEffect(() => {
    setProgress(loadProgress());
  }, [tab]);

  // The level map needs the tier's level count. The gate keeps the request
  // from firing before the URL effect has applied the tier.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/game/quest?hsk=${hskLevel}&level=1`);
        const body = (await res.json()) as BoardResponse;
        const count = body.data?.levelCount;
        if (!res.ok || !body.ok || typeof count !== 'number') {
          throw new Error(body.error?.code ?? `http_${res.status}`);
        }
        if (cancelled) return;
        setLevelCount(count);
        setBoardError(null);
      } catch (failure) {
        if (cancelled) return;
        console.warn('[game] the level map could not be loaded', failure);
        setLevelCount(null);
        setBoardError('关卡地图暂时打不开');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hskLevel, hydrated, retryToken]);

  /**
   * Write the progress.
   *
   * Every write re-reads the stored progress first, mutates that fresh copy
   * and writes it back: a stale snapshot must never overwrite a write that
   * another component has already made.
   */
  function mutate(fn: (current: GameProgress) => GameProgress): void {
    const fresh = loadProgress();
    const next = fn(fresh);
    saveProgress(next);
    setProgress(next);
  }

  function handlePassed(_level: number): void {
    // The runner wrote the pass itself - the parent only re-reads.
    setProgress(loadProgress());
  }

  /** The summary's 「下一关」 - the pointer decides which level comes next. */
  function openNextLevel(): void {
    const pointer = loadProgress().current[String(hskLevel)]?.level ?? 1;
    setOpenLevel(levelCount === null ? pointer : Math.min(pointer, levelCount));
  }

  function toggleSound(): void {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  }

  const tier = hskLevel;
  const currentLevel = progress.current[String(tier)]?.level ?? 1;
  const passedLevels = progress.passed[String(tier)] ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <HskPicker />
        <SoundToggle muted={muted} onToggle={toggleSound} />
      </div>
      {hydrated ? (
        <>
          <TabBar active={tab} onSelect={setTab} />
          <div className="mt-4">
            {tab === 'quest' ? (
              <QuestPanel
                tier={tier}
                currentLevel={currentLevel}
                passedLevels={passedLevels}
                levelCount={levelCount}
                boardError={boardError}
                openLevel={openLevel}
                onOpenLevel={(level) => setOpenLevel(level)}
                onCloseRunner={() => setOpenLevel(null)}
                onPassed={handlePassed}
                onNextLevel={openNextLevel}
                onRetry={() => setRetryToken((token) => token + 1)}
              />
            ) : tab === 'daily' ? (
              <DailyChallenge tier={tier} difficulty={difficulty} />
            ) : tab === 'collection' ? (
              <div>
                <h3 className="mb-3 text-sm text-ink-soft">
                  字卡册{collectionTier === null ? '' : ` · HSK ${collectionTier}`}
                </h3>
                <CharCollection
                  collected={progress.collected}
                  onFilterTierChange={setCollectionTier}
                />
              </div>
            ) : (
              <WrongBook
                wrong={progress.wrong}
                onRemove={(char) => mutate((current) => removeWrong(current, char))}
              />
            )}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-ink-faint">正在打开…</p>
      )}
    </div>
  );
}
