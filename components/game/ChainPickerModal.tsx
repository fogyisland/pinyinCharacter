'use client';

import type { CharInfo } from '@/lib/chain-types';

export function ChainPickerModal({
  validChars,
  onSelect,
}: {
  validChars: CharInfo[];
  onSelect: (char: string) => void;
}) {
  if (validChars.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-4">
      <div className="mb-3 text-sm text-ink-soft">可选字 ({validChars.length})</div>
      <div className="grid max-h-96 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {validChars.map((c) => (
          <button
            key={c.char}
            type="button"
            onClick={() => onSelect(c.char)}
            className="flex flex-col items-center rounded border border-ink/10 bg-paper-deep p-2 hover:bg-seal/10"
          >
            <div className="text-2xl font-kai">{c.char}</div>
            <div className="text-xs text-ink-soft">{c.pinyin}</div>
            {c.radical && <div className="text-[10px] text-ink-faint">{c.radical}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}