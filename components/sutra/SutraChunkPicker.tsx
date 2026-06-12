'use client';

import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  chunks: SutraChunk[];
  activeId: number;
  onChange: (id: number) => void;
}

export function SutraChunkPicker({ chunks, activeId, onChange }: Props) {
  if (chunks.length <= 1) return null;
  return (
    <>
      {/* Desktop: vertical list */}
      <aside className="hidden md:block sticky top-4 w-48 shrink-0">
        <div className="card-paper p-3">
          <div className="text-xs text-ink-faint mb-2 px-1">品块</div>
          <ul className="space-y-1">
            {chunks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c.id)}
                  className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                    activeId === c.id
                      ? 'bg-seal/10 text-seal border-l-2 border-seal'
                      : 'text-ink-soft hover:bg-paper-deep'
                  }`}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Mobile: dropdown */}
      <div className="md:hidden mb-4">
        <label className="block text-xs text-ink-faint mb-1">品块</label>
        <select
          value={activeId}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2"
        >
          {chunks.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}
