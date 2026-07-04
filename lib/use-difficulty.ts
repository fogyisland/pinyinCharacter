'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_DIFFICULTY, type Difficulty } from './difficulty';
import type { HskLevel } from './difficulty';

const STORAGE_KEY = 'pinyin:difficulty';
const HSK_STORAGE_KEY = 'pinyin_hsk_level';

function readInitial(): Difficulty {
  if (typeof window === 'undefined') return DEFAULT_DIFFICULTY;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  return DEFAULT_DIFFICULTY;
}

export type UseDifficultyReturn = {
  difficulty: Difficulty;
  hskLevel: HskLevel;
  setDifficulty: (next: Difficulty) => void;
  setHskLevel: (next: HskLevel) => void;
};

export function useDifficulty(): UseDifficultyReturn {
  const [difficulty, setDifficultyState] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [hskLevel, setHskLevelState] = useState<HskLevel>(1);

  // Read from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    setDifficultyState(readInitial());
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(HSK_STORAGE_KEY);
      const parsed = raw ? Number(raw) : 1;
      if (parsed >= 1 && parsed <= 6) setHskLevelState(parsed as HskLevel);
    }
  }, []);

  // Cross-tab sync via storage event
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const v = e.newValue;
        if (v === 'easy' || v === 'medium' || v === 'hard') setDifficultyState(v);
      }
      if (e.key === HSK_STORAGE_KEY && e.newValue) {
        const parsed = Number(e.newValue);
        if (parsed >= 1 && parsed <= 6) setHskLevelState(parsed as HskLevel);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setDifficulty = (next: Difficulty) => {
    setDifficultyState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const setHskLevel = (next: HskLevel) => {
    setHskLevelState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HSK_STORAGE_KEY, String(next));
    }
  };

  return { difficulty, hskLevel, setDifficulty, setHskLevel };
}
