'use client';

import { useAppStore } from '@/lib/store';

export function SafeModeToggle() {
  const safeMode = useAppStore(s => s.safeMode);
  const setSafeMode = useAppStore(s => s.setSafeMode);
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm">🔒 儿童模式</span>
      <button
        type="button"
        role="switch"
        aria-checked={safeMode}
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
