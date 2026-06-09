'use client';

import { SafeModeToggle } from './SafeModeToggle';
import { useAppStore } from '@/lib/store';

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
        </div>
      </div>
    </header>
  );
}
