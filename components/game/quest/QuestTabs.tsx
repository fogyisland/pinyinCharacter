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
import type { Difficulty, HskLevel } from '@/lib/difficulty';

/**
 * The four flat panels of the game page.
 *
 * The HSK picker sits **above** the tabs and is shared by 闯关 and 每日一局.
 * The quest keeps its **own** per-tier level pointer in the progress store,
 * so switching a tier never loses the position in the other five tiers.
 *
 * The component itself is the render - the state lives in the three hooks
 * below: the URL contract, the state of the tab strip and the state of the
 * 闯关 panel.
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

/** The id of the panel the four tabs control - only one panel is rendered at a time. */
const PANEL_ID = 'game-panel';

/** The id of one tab - the panel points back at the tab that is active. */
function tabId(tab: QuestTab): string {
  return `game-tab-${tab}`;
}

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

/**
 * Load the level map of a tier.
 *
 * The response is the **envelope** - a status that is not 2xx, an `ok: false`
 * body and a payload without a numeric `levelCount` are all failures. The
 * count and the failure are reported through the two callbacks, so the
 * caller decides what to do with an answer that arrives too late.
 */
async function loadLevelMap(
  tier: number,
  onCount: (count: number) => void,
  onError: () => void,
): Promise<void> {
  try {
    const res = await fetch(`/api/game/quest?hsk=${tier}&level=1`);
    const body = (await res.json()) as BoardResponse;
    const count = body.data?.levelCount;
    if (!res.ok || !body.ok || typeof count !== 'number') {
      throw new Error(body.error?.code ?? `http_${res.status}`);
    }
    onCount(count);
  } catch (failure) {
    console.warn('[game] the level map could not be loaded', failure);
    onError();
  }
}

/**
 * The level that comes after the one that was just passed.
 *
 * The pointer is the unlock frontier, and it is clamped to the tier's level
 * count: passing the last level of a tier moves the pointer past the end of
 * the tier, and that level does not exist.
 */
function nextLevel(tier: number, levelCount: number | null): number {
  const pointer = loadProgress().current[String(tier)]?.level ?? 1;
  return levelCount === null ? pointer : Math.min(pointer, levelCount);
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
          id={tabId(tab.id)}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          aria-controls={PANEL_ID}
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

/**
 * The URL contract (§7.5).
 *
 * The panel, the shared tier and the level to open all arrive in one query
 * string. The tier and the tab are applied in the same effect, so React
 * batches them into one re-render, and the hydration gate keeps the panels
 * from rendering before the query string has been read.
 */
interface UrlContract {
  tab: QuestTab;
  setTab: (tab: QuestTab) => void;
  hydrated: boolean;
}

function useUrlContract(): UrlContract {
  const { setHskLevel } = useDifficulty();
  const [tab, setTab] = useState<QuestTab>('quest');
  const [hydrated, setHydrated] = useState(false);

  // `useDifficulty` hands out a fresh setter on every render, so the URL
  // effect would re-run on every render if it depended on it directly.
  const setHskLevelRef = useRef(setHskLevel);
  useEffect(() => {
    setHskLevelRef.current = setHskLevel;
  }, [setHskLevel]);

  useEffect(() => {
    const url = readUrlState(window.location.search);
    if (url.hsk !== null) setHskLevelRef.current(url.hsk);
    // A level belongs to the quest, so it opens the 闯关 panel.
    setTab(url.level !== null ? 'quest' : url.tab);
    setHydrated(true);
  }, []);

  return { tab, setTab, hydrated };
}

/** The state of the tab strip. */
interface QuestTabsState {
  tab: QuestTab;
  setTab: (tab: QuestTab) => void;
  hydrated: boolean;
  tier: number;
  difficulty: Difficulty;
  progress: GameProgress;
  mutate: (fn: (current: GameProgress) => GameProgress) => void;
  refreshProgress: () => void;
  collectionTier: number | null;
  setCollectionTier: (tier: number | null) => void;
  muted: boolean;
  toggleSound: () => void;
}

/**
 * The state of the tab strip.
 *
 * The shared tier and difficulty, the progress snapshot and its writer, the
 * 字卡册 filter tier and the mute flag. The tab, the hydration gate and the
 * URL contract come from `useUrlContract`.
 */
function useQuestTabsState(): QuestTabsState {
  const { hskLevel, difficulty } = useDifficulty();
  const url = useUrlContract();
  const [progress, setProgress] = useState<GameProgress>(defaultProgress);
  const [collectionTier, setCollectionTier] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);

  // The mute flag is a plain storage read, not a subscription - the switch
  // keeps its own copy of it.
  useEffect(() => {
    setMuted(isSoundMuted());
  }, []);

  // The progress is re-read whenever the panel changes: the runner and the
  // daily challenge write to the storage themselves, so a snapshot taken
  // before the switch can be stale.
  useEffect(() => {
    setProgress(loadProgress());
  }, [url.tab]);

  function toggleSound(): void {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  }

  return {
    tab: url.tab,
    setTab: url.setTab,
    hydrated: url.hydrated,
    tier: hskLevel,
    difficulty,
    progress,
    // Every write re-reads the stored progress first, so a stale snapshot
    // never overwrites a write that another component has already made.
    mutate: (fn) => {
      const fresh = loadProgress();
      const next = fn(fresh);
      saveProgress(next);
      setProgress(next);
    },
    refreshProgress: () => setProgress(loadProgress()),
    collectionTier,
    setCollectionTier,
    muted,
    toggleSound,
  };
}

/** The state of the 闯关 panel. */
interface QuestPanelState {
  levelCount: number | null;
  boardError: string | null;
  openLevel: number | null;
  openLevelAt: (level: number) => void;
  closeRunner: () => void;
  handlePassed: (level: number) => void;
  openNextLevel: () => void;
  retry: () => void;
}

/**
 * The state of the 闯关 panel.
 *
 * The level count and its error, the retry token, the open level, the
 * level-map request and the 「下一关」 handler.
 */
function useQuestPanelState(tabs: QuestTabsState): QuestPanelState {
  const { tier, tab, hydrated, refreshProgress } = tabs;
  const [levelCount, setLevelCount] = useState<number | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [openLevel, setOpenLevel] = useState<number | null>(null);

  // The level the URL asks for - the same query string as the tab and the tier.
  useEffect(() => {
    const url = readUrlState(window.location.search);
    if (url.level !== null) setOpenLevel(url.level);
  }, []);

  // The level map of the tier. It is fetched only while the 闯关 panel is on
  // screen, and the count of the previous tier never survives the switch.
  useEffect(() => {
    if (!hydrated || tab !== 'quest') return;
    setLevelCount(null);
    setBoardError(null);
    let cancelled = false;
    void loadLevelMap(
      tier,
      (count) => {
        if (!cancelled) setLevelCount(count);
      },
      () => {
        if (!cancelled) setBoardError('关卡地图暂时打不开');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tier, hydrated, retryToken, tab]);

  /** The summary's 「下一关」 - the pointer decides which level comes next. */
  function openNextLevel(): void {
    setOpenLevel(nextLevel(tier, levelCount));
  }

  return {
    levelCount,
    boardError,
    openLevel,
    openLevelAt: setOpenLevel,
    closeRunner: () => setOpenLevel(null),
    handlePassed: () => refreshProgress(),
    openNextLevel,
    retry: () => setRetryToken((token) => token + 1),
  };
}

interface QuestPanelProps {
  tier: number;
  currentLevel: number;
  passedLevels: number[];
  panel: QuestPanelState;
  /** The mute flag of the page - the runner's ② audio button reads it. */
  muted: boolean;
}

/**
 * The 闯关 panel - the level map, or the runner that replaces it.
 *
 * A failed level map shows a message and a 「重试」 button instead of the
 * board: a board with a guessed level count would offer tiles that do not
 * exist.
 */
function QuestPanel({ tier, currentLevel, passedLevels, panel, muted }: QuestPanelProps) {
  if (panel.openLevel !== null) {
    return (
      <QuestRunner
        tier={tier}
        level={panel.openLevel}
        onExit={panel.closeRunner}
        onPassed={panel.handlePassed}
        onNextLevel={panel.openNextLevel}
        muted={muted}
      />
    );
  }
  if (panel.boardError !== null) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-soft">{panel.boardError}</p>
        <button
          type="button"
          onClick={panel.retry}
          className="mt-3 rounded border border-seal bg-seal px-4 py-2 text-paper-soft hover:opacity-90"
        >
          重试
        </button>
      </div>
    );
  }
  if (panel.levelCount === null) {
    return <p className="py-10 text-center text-ink-faint">正在打开关卡地图…</p>;
  }
  return (
    <QuestBoard
      tier={tier}
      levelCount={panel.levelCount}
      currentLevel={currentLevel}
      passedLevels={passedLevels}
      onOpenLevel={panel.openLevelAt}
    />
  );
}

/**
 * The game page - four flat panels under one shared tier picker.
 *
 * The component reads the three hooks and wires their handlers; every piece
 * of state lives in one of them.
 */
export function QuestTabs() {
  const tabs = useQuestTabsState();
  const panel = useQuestPanelState(tabs);
  const currentLevel = tabs.progress.current[String(tabs.tier)]?.level ?? 1;
  const passedLevels = tabs.progress.passed[String(tabs.tier)] ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <HskPicker />
        <SoundToggle muted={tabs.muted} onToggle={tabs.toggleSound} />
      </div>
      {tabs.hydrated ? (
        <>
          <TabBar active={tabs.tab} onSelect={tabs.setTab} />
          <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tabs.tab)} className="mt-4">
            {tabs.tab === 'quest' ? (
              <QuestPanel
                tier={tabs.tier}
                currentLevel={currentLevel}
                passedLevels={passedLevels}
                panel={panel}
                muted={tabs.muted}
              />
            ) : tabs.tab === 'daily' ? (
              <DailyChallenge tier={tabs.tier} difficulty={tabs.difficulty} />
            ) : tabs.tab === 'collection' ? (
              <div>
                <h3 className="mb-3 text-sm text-ink-soft">
                  字卡册{tabs.collectionTier === null ? '' : ` · HSK ${tabs.collectionTier}`}
                </h3>
                <CharCollection
                  collected={tabs.progress.collected}
                  onFilterTierChange={tabs.setCollectionTier}
                />
              </div>
            ) : (
              <WrongBook
                wrong={tabs.progress.wrong}
                onRemove={(char) => tabs.mutate((current) => removeWrong(current, char))}
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
