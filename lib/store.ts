'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

interface AppState {
  safeMode: boolean;
  script: Script;
  setSafeMode: (v: boolean) => void;
  setScript: (s: Script) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      script: 'simplified',
      setSafeMode: (safeMode) => set({ safeMode }),
      setScript: (script) => set({ script }),
    }),
    { name: 'pinyin-app-state' }
  )
);
