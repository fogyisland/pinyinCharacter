/**
 * The local progress store of the quest mode.
 *
 * Everything the player earns - the level pointers, the collection book, the
 * wrong book and the daily rounds - lives in localStorage. The store is
 * deliberately split in two halves:
 *
 * - the **mutators** (`collectChar`, `recordMiss`, `markLevelPassed`,
 *   `recordDaily`) are pure: they return a brand new state and never touch
 *   localStorage. That keeps them unit-testable without a DOM and leaves the
 *   "one write per answer" rule in the caller's hands;
 * - the **accessors** (`loadProgress`, `saveProgress`) own the storage. A
 *   broken storage - a corrupt payload, a private-mode browser, an unknown
 *   schema version - must never break the page, so they degrade to the
 *   default state instead of throwing.
 */

/** The storage key. The `v1` suffix is the schema version of the payload. */
export const PROGRESS_KEY = 'pinyin-character:game-progress:v1';

/** The only schema version this build understands. */
const PROGRESS_VERSION = 1 as const;

/** The character fields a snapshot carries. */
export interface CharSnapshot {
  pinyin: string;
  plainPinyin: string;
  tone: 1 | 2 | 3 | 4;
  toneName: string;
  radical: string;
  meaningShort: string;
}

/** The collection book also carries the story flag (§8). */
export interface CollectedSnapshot extends CharSnapshot {
  hasStory: boolean;
}

/** One entry of the collection book. */
export interface CollectedChar extends CollectedSnapshot {
  hsk: number;
  level: number;
  at: number;
}

/** One entry of the wrong book - the same snapshot minus the story flag (§8). */
export interface WrongChar extends CharSnapshot {
  count: number;
  lastAt: number;
  hsk: number;
  level: number;
}

/** The whole stored state. */
export interface GameProgress {
  version: 1;
  /** Per-tier level pointer. */
  current: Record<string, { level: number }>;
  /** Per-tier list of the levels that were 通关. */
  passed: Record<string, number[]>;
  streak: number;
  bestStreak: number;
  collected: Record<string, CollectedChar>;
  wrong: Record<string, WrongChar>;
  /** date (YYYY-MM-DD) → daily key → result. */
  daily: Record<string, Record<string, { done: boolean; score: number }>>;
  updatedAt: number;
}

/** The state of a player who has not played yet. */
export function defaultProgress(): GameProgress {
  return {
    version: PROGRESS_VERSION,
    current: {},
    passed: {},
    streak: 0,
    bestStreak: 0,
    collected: {},
    wrong: {},
    daily: {},
    updatedAt: Date.now(),
  };
}

/**
 * The storage handle, or null when there is none.
 *
 * `window.localStorage` throws in some browsers when cookies are blocked, so
 * the access itself is guarded.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    console.warn('[game-progress] the localStorage is not accessible', error);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Rebuild a trusted state out of a parsed payload.
 *
 * The version has already been checked, but the rest of the payload can still
 * be half-written or hand-edited, so every field is coerced. A missing field
 * falls back to the default instead of exploding later in the UI.
 */
function normalizeProgress(raw: Record<string, unknown>): GameProgress {
  const base = defaultProgress();
  return {
    version: PROGRESS_VERSION,
    current: isRecord(raw.current) ? (raw.current as GameProgress['current']) : base.current,
    passed: normalizePassed(raw.passed),
    streak: toFiniteNumber(raw.streak),
    bestStreak: toFiniteNumber(raw.bestStreak),
    collected: isRecord(raw.collected)
      ? (raw.collected as GameProgress['collected'])
      : base.collected,
    wrong: isRecord(raw.wrong) ? (raw.wrong as GameProgress['wrong']) : base.wrong,
    daily: normalizeDaily(raw.daily),
    updatedAt: toFiniteNumber(raw.updatedAt),
  };
}

function normalizePassed(raw: unknown): GameProgress['passed'] {
  if (!isRecord(raw)) return {};
  const passed: GameProgress['passed'] = {};
  for (const [tier, levels] of Object.entries(raw)) {
    if (!Array.isArray(levels)) continue;
    passed[tier] = levels.filter((level): level is number => toFiniteNumber(level) > 0);
  }
  return passed;
}

function normalizeDaily(raw: unknown): GameProgress['daily'] {
  if (!isRecord(raw)) return {};
  const daily: GameProgress['daily'] = {};
  for (const [date, rounds] of Object.entries(raw)) {
    if (!isRecord(rounds)) continue;
    const day: Record<string, { done: boolean; score: number }> = {};
    for (const [key, result] of Object.entries(rounds)) {
      if (!isRecord(result)) continue;
      day[key] = { done: result.done === true, score: toFiniteNumber(result.score) };
    }
    daily[date] = day;
  }
  return daily;
}

/**
 * Read the stored state.
 *
 * A missing key, a corrupt payload and an unknown version all give the
 * default state back - a game must never break the page.
 */
export function loadProgress(): GameProgress {
  if (typeof window === 'undefined') return defaultProgress();

  const storage = getStorage();
  if (!storage) return defaultProgress();

  let raw: string | null;
  try {
    raw = storage.getItem(PROGRESS_KEY);
  } catch (error) {
    console.warn('[game-progress] the stored progress could not be read', error);
    return defaultProgress();
  }
  if (raw === null) return defaultProgress();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('[game-progress] the stored progress is not valid JSON, it was reset', error);
    return defaultProgress();
  }

  if (!isRecord(parsed)) {
    console.warn('[game-progress] the stored progress is not an object, it was reset');
    return defaultProgress();
  }
  if (parsed.version !== PROGRESS_VERSION) {
    console.warn(
      `[game-progress] the stored progress has the unknown version ${String(parsed.version)}, it was reset`,
    );
    return defaultProgress();
  }

  return normalizeProgress(parsed);
}

/** Write the state back. A storage that refuses the write is not fatal. */
export function saveProgress(progress: GameProgress): void {
  try {
    const storage = getStorage();
    if (!storage) {
      console.warn('[game-progress] there is no localStorage, the progress was not persisted');
      return;
    }
    storage.setItem(PROGRESS_KEY, JSON.stringify({ ...progress, updatedAt: Date.now() }));
  } catch (error) {
    console.warn('[game-progress] the progress could not be persisted', error);
  }
}

/** A deep-enough copy: the containers are copied so a mutator cannot touch the input. */
function cloneProgress(progress: GameProgress): GameProgress {
  const passed: GameProgress['passed'] = {};
  for (const [tier, levels] of Object.entries(progress.passed)) {
    passed[tier] = [...levels];
  }
  const daily: GameProgress['daily'] = {};
  for (const [date, rounds] of Object.entries(progress.daily)) {
    daily[date] = { ...rounds };
  }
  return {
    version: PROGRESS_VERSION,
    current: { ...progress.current },
    passed,
    streak: progress.streak,
    bestStreak: progress.bestStreak,
    collected: { ...progress.collected },
    wrong: { ...progress.wrong },
    daily,
    updatedAt: progress.updatedAt,
  };
}

/**
 * Add a character to the collection book and extend the streak.
 *
 * The snapshot is copied field by field, so the collection book keeps the
 * story flag and the wrong book can never inherit it by accident.
 */
export function collectChar(
  progress: GameProgress,
  char: string,
  snapshot: CollectedSnapshot,
  hsk: number,
  level: number,
): GameProgress {
  const next = cloneProgress(progress);
  const streak = progress.streak + 1;
  next.streak = streak;
  next.bestStreak = Math.max(progress.bestStreak, streak);
  next.collected[char] = {
    pinyin: snapshot.pinyin,
    plainPinyin: snapshot.plainPinyin,
    tone: snapshot.tone,
    toneName: snapshot.toneName,
    radical: snapshot.radical,
    meaningShort: snapshot.meaningShort,
    hasStory: snapshot.hasStory,
    hsk,
    level,
    at: Date.now(),
  };
  return next;
}

/** Count a miss in the wrong book and break the streak. */
export function recordMiss(
  progress: GameProgress,
  char: string,
  snapshot: CharSnapshot,
  hsk: number,
  level: number,
): GameProgress {
  const next = cloneProgress(progress);
  const previous = progress.wrong[char];
  const count = (previous?.count ?? 0) + 1;
  // The timestamp has to move forward even when two misses land in the same
  // millisecond, otherwise the order of the misses cannot be reconstructed.
  const lastAt = Math.max(Date.now(), (previous?.lastAt ?? 0) + 1);
  next.wrong[char] = {
    pinyin: snapshot.pinyin,
    plainPinyin: snapshot.plainPinyin,
    tone: snapshot.tone,
    toneName: snapshot.toneName,
    radical: snapshot.radical,
    meaningShort: snapshot.meaningShort,
    count,
    lastAt,
    hsk,
    level,
  };
  next.streak = 0;
  return next;
}

/** Move the level pointer of a tier forward and remember the passed level. */
export function markLevelPassed(progress: GameProgress, hsk: number, level: number): GameProgress {
  const next = cloneProgress(progress);
  const tier = String(hsk);
  next.current[tier] = { level: level + 1 };
  const passed = next.passed[tier] ?? [];
  next.passed[tier] = passed.includes(level) ? passed : [...passed, level];
  return next;
}

/** Record the result of one daily round. */
export function recordDaily(progress: GameProgress, key: string, score: number): GameProgress {
  const next = cloneProgress(progress);
  const date = localDateKey();
  const day = next.daily[date] ?? {};
  day[key] = { done: true, score };
  next.daily[date] = day;
  return next;
}

/**
 * The key of one round.
 *
 * The mode, the difficulty and the HSK tier are three independent axes - a
 * round of HSK 2 does not complete the round of HSK 1.
 */
export function dailyKey(mode: string, difficulty: string, hsk: number): string {
  return `${mode}:${difficulty}:hsk${hsk}`;
}

/** The local date as YYYY-MM-DD. */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
