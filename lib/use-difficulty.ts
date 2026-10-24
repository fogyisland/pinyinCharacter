'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_DIFFICULTY, type Difficulty } from './difficulty';
import type { HskLevel } from './difficulty';

const STORAGE_KEY = 'pinyin:difficulty';
const HSK_STORAGE_KEY = 'pinyin_hsk_level';

export interface DifficultyState {
  difficulty: Difficulty;
  hskLevel: HskLevel;
  /**
   * True once the stored settings have been read from localStorage. Until
   * then the hook reports the defaults, so a consumer that fetches data
   * based on the difficulty can wait for `ready` instead of firing a
   * request for the default difficulty and another one for the stored one.
   */
  ready: boolean;
}

const INITIAL_STATE: DifficultyState = {
  difficulty: DEFAULT_DIFFICULTY,
  hskLevel: 1,
  ready: false,
};

/**
 * The state lives outside React so that every consumer shares it.
 *
 * The hook used to keep the state per component instance, which meant the
 * HSK chips in `GameModeTabs` only updated the tab bar — the game below had
 * its own copy of the state and never saw the new level.
 */
let state: DifficultyState = INITIAL_STATE;
const listeners = new Set<() => void>();

function emit(next: DifficultyState): void {
  if (
    next.difficulty === state.difficulty &&
    next.hskLevel === state.hskLevel &&
    next.ready === state.ready
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

function readStoredDifficulty(): Difficulty {
  if (typeof window === 'undefined') return DEFAULT_DIFFICULTY;
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : DEFAULT_DIFFICULTY;
}

function readStoredHskLevel(): HskLevel {
  if (typeof window === 'undefined') return 1;
  const raw = window.localStorage.getItem(HSK_STORAGE_KEY);
  const parsed = raw ? Number(raw) : 1;
  return parsed >= 1 && parsed <= 6 ? (parsed as HskLevel) : 1;
}

/** Read the stored settings — once, after the first render on the client. */
function hydrate(): void {
  if (state.ready || typeof window === 'undefined') return;
  emit({ difficulty: readStoredDifficulty(), hskLevel: readStoredHskLevel(), ready: true });
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Private-mode browsers can refuse to write to localStorage; the setting
    // still applies for the current session.
    console.error(`Failed to persist ${key}`, error);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DifficultyState {
  return state;
}

function getServerSnapshot(): DifficultyState {
  return INITIAL_STATE;
}

// Cross-tab sync: another tab changed the stored settings.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      const value = event.newValue;
      if (value === 'easy' || value === 'medium' || value === 'hard') {
        emit({ ...state, difficulty: value });
      }
    }
    if (event.key === HSK_STORAGE_KEY && event.newValue) {
      const parsed = Number(event.newValue);
      if (parsed >= 1 && parsed <= 6) {
        emit({ ...state, hskLevel: parsed as HskLevel });
      }
    }
  });
}

export type UseDifficultyReturn = {
  difficulty: Difficulty;
  hskLevel: HskLevel;
  ready: boolean;
  setDifficulty: (next: Difficulty) => void;
  setHskLevel: (next: HskLevel) => void;
};

export function useDifficulty(): UseDifficultyReturn {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setDifficulty = (next: Difficulty) => {
    if (typeof window !== 'undefined') writeStored(STORAGE_KEY, next);
    emit({ ...state, difficulty: next, ready: true });
  };

  const setHskLevel = (next: HskLevel) => {
    if (typeof window !== 'undefined') writeStored(HSK_STORAGE_KEY, String(next));
    emit({ ...state, hskLevel: next, ready: true });
  };

  return { ...snapshot, setDifficulty, setHskLevel };
}
