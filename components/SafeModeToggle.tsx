'use client';

import { useAppStore } from '@/lib/store';

export function SafeModeToggle() {
  const safeMode = useAppStore((s) => s.safeMode);
  const setSafeMode = useAppStore((s) => s.setSafeMode);
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      {/* The label is what costs width in the header row: 「🔒 儿童模式」 is
          126px, and at 1024 it is the last 60px that pushes the nav onto a
          second line. The icon alone says the same thing to anyone who has
          used the switch, so the words appear only on wide screens. */}
      <span className="hidden xl:inline text-sm">🔒 儿童模式</span>
      <span className="xl:hidden text-sm" aria-hidden="true">
        🔒
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={safeMode}
        aria-label="儿童模式"
        onClick={() => setSafeMode(!safeMode)}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          safeMode ? 'bg-success' : 'bg-ink/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-paper transition-transform ${
            safeMode ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  );
}
