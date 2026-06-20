'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUTRA_READING, type SutraReading } from './sutra-reading';

function isValid(v: string | null): v is SutraReading {
  return v === 'horizontal' || v === 'vertical-rtl' || v === 'vertical-ltr';
}

export function useSutraReading(storageKey = 'pinyin:sutra-reading'): [SutraReading, (next: SutraReading) => void] {
  const [reading, setReading] = useState<SutraReading>(DEFAULT_SUTRA_READING);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(storageKey);
    setReading(isValid(v) ? v : DEFAULT_SUTRA_READING);
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && isValid(e.newValue)) {
        setReading(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const update = (next: SutraReading) => {
    setReading(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, next);
    }
  };

  return [reading, update];
}