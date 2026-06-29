'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

export interface User { id: number; username: string; isAdmin?: boolean; }

interface AppState {
  safeMode: boolean;
  showPinyin: boolean;
  script: Script;
  user: User | null;
  authOpen: boolean;
  setSafeMode: (v: boolean) => void;
  setShowPinyin: (v: boolean) => void;
  setScript: (s: Script) => void;
  setUser: (u: User | null) => void;
  setAuthOpen: (b: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      showPinyin: true,                // 默认显示拼音 (poetry + sutra worksheets)
      script: 'simplified',
      user: null,
      authOpen: false,
      setSafeMode: (safeMode) => set({ safeMode }),
      setShowPinyin: (showPinyin) => set({ showPinyin }),
      setScript: (script) => set({ script }),
      setUser: (user) => set({ user }),
      setAuthOpen: (authOpen) => set({ authOpen }),
    }),
    { name: 'pinyin-app-state' }
  )
);
