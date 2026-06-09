'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

export interface User { id: number; username: string; }

interface AppState {
  safeMode: boolean;
  script: Script;
  user: User | null;
  setSafeMode: (v: boolean) => void;
  setScript: (s: Script) => void;
  setUser: (u: User | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      script: 'simplified',
      user: null,
      setSafeMode: (safeMode) => set({ safeMode }),
      setScript: (script) => set({ script }),
      setUser: (user) => set({ user }),
    }),
    { name: 'pinyin-app-state' }
  )
);
