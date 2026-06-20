'use client';

import type { ClassicChunk } from '@/lib/classics-types';

interface Props {
  slug: string;
  chunks: Pick<ClassicChunk, 'id' | 'label'>[];
  activeId: number;
}

export function ClassicChunkPicker({ slug, chunks, activeId }: Props) {
  if (chunks.length <= 1) return null;
  return (
    <>
      <aside className="hidden md:block sticky top-4 w-48 shrink-0">
        <div className="card-paper p-3">
          <div className="text-xs text-ink-faint mb-2 px-1">章</div>
          <ul className="space-y-1 max-h-[28rem] overflow-y-auto">
            {chunks.map((c) => (
              <li key={c.id}>
                <a
                  href={`/ancient/${slug}?chunk=${c.id - 1}`}
                  className={`block px-2 py-1.5 rounded text-sm transition-colors ${
                    activeId === c.id
                      ? 'bg-seal/10 text-seal border-l-2 border-seal'
                      : 'text-ink-soft hover:bg-paper-deep'
                  }`}
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="md:hidden mb-4">
        <label className="block text-xs text-ink-faint mb-1">章</label>
        <select
          value={activeId}
          onChange={(e) => { window.location.href = `/ancient/${slug}?chunk=${Number(e.target.value) - 1}`; }}
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