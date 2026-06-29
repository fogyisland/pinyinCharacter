'use client';

import { useAppStore } from '@/lib/store';

/** Toggle for showing pinyin on poetry and sutra worksheet views.
 *  Reads/writes the persisted `showPinyin` flag in the app store. */
export function PinyinToggle() {
  const showPinyin = useAppStore((s) => s.showPinyin);
  const setShowPinyin = useAppStore((s) => s.setShowPinyin);
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm">显示拼音</span>
      <button
        type="button"
        role="switch"
        aria-checked={showPinyin}
        onClick={() => setShowPinyin(!showPinyin)}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          showPinyin ? 'bg-success' : 'bg-ink/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-paper transition-transform ${
            showPinyin ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  );
}
