'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_DIFFICULTY, type Difficulty } from './difficulty';

const STORAGE_KEY = 'pinyin:difficulty';

function readInitial(): Difficulty {
  if (typeof window === 'undefined') return DEFAULT_DIFFICULTY;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  return DEFAULT_DIFFICULTY;
}

export function useDifficulty(): [Difficulty, (next: Difficulty) => void] {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);

  // Read from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    setDifficulty(readInitial());
  }, []);

  // Cross-tab sync via storage event
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const v = e.newValue;
        if (v === 'easy' || v === 'medium' || v === 'hard') setDifficulty(v);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (next: Difficulty) => {
    setDifficulty(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [difficulty, update];
}
