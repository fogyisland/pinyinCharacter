'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SUTRA_READING, type SutraReading } from './sutra-reading';

function isValid(v: string | null): v is SutraReading {
  return v === 'horizontal' || v === 'vertical-rtl' || v === 'vertical-ltr';
}

export function useSutraReading(
  storageKey = 'pinyin:sutra-reading',
): [SutraReading, (next: SutraReading) => void] {
  const [reading, setReading] = useState<SutraReading>(DEFAULT_SUTRA_READING);

  // One effect for both jobs: read the persisted value and keep it in sync
  // with the other tabs. Two effects meant two effect passes and two
  // listener registrations for the same storage key.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(storageKey);
    setReading(isValid(stored) ? stored : DEFAULT_SUTRA_READING);

    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && isValid(e.newValue)) {
        setReading(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  // Stable identity: consumers can put `update` in a dependency array
  // without re-running their own effects on every render.
  const update = useCallback(
    (next: SutraReading) => {
      setReading(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next);
      }
    },
    [storageKey],
  );

  return [reading, update];
}
