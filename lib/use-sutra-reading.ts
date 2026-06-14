'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUTRA_READING, type SutraReading } from './sutra-reading';

const STORAGE_KEY = 'pinyin:sutra-reading';

function isValid(v: string | null): v is SutraReading {
  return v === 'horizontal' || v === 'vertical-rtl' || v === 'vertical-ltr';
}

function readInitial(): SutraReading {
  if (typeof window === 'undefined') return DEFAULT_SUTRA_READING;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (isValid(v)) return v;
  return DEFAULT_SUTRA_READING;
}

export function useSutraReading(): [SutraReading, (next: SutraReading) => void] {
  const [reading, setReading] = useState<SutraReading>(DEFAULT_SUTRA_READING);

  useEffect(() => {
    setReading(readInitial());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isValid(e.newValue)) {
        setReading(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (next: SutraReading) => {
    setReading(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [reading, update];
}