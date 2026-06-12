'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

export interface User { id: number; username: string; isAdmin?: boolean; }

interface AppState {
  safeMode: boolean;
  script: Script;
  user: User | null;
  authOpen: boolean;
  setSafeMode: (v: boolean) => void;
  setScript: (s: Script) => void;
  setUser: (u: User | null) => void;
  setAuthOpen: (b: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      script: 'simplified',
      user: null,
      authOpen: false,
      setSafeMode: (safeMode) => set({ safeMode }),
      setScript: (script) => set({ script }),
      setUser: (user) => set({ user }),
      setAuthOpen: (authOpen) => set({ authOpen }),
    }),
    { name: 'pinyin-app-state' }
  )
);
