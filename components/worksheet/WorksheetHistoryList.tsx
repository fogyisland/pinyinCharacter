'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Worksheet } from '@/lib/worksheet-types';
import { paperSizeLabel, fontFamilyLabel, cellStyleLabel } from '@/lib/worksheet-types';
import { DeleteWorksheetButton } from './DeleteWorksheetButton';
import { RenameWorksheetButton } from './RenameWorksheetButton';
import { BatchPrintButton } from './BatchPrintButton';

interface Props {
  worksheets: Worksheet[];
  hasMulti: boolean;
}

export function WorksheetHistoryList({ worksheets, hasMulti }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === worksheets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(worksheets.map((w) => w.id)));
    }
  };

  if (worksheets.length === 0) {
    return (
      <div className="py-8 text-center text-ink-faint">还没有保存的字帖</div>
    );
  }

  const allChecked = selected.size === worksheets.length;
  return (
    <div>
      <div className="worksheet-no-print sticky top-0 z-10 -mx-5 mb-3 flex items-center justify-between gap-3 border-b border-ink/10 bg-paper-soft/95 px-5 py-2 backdrop-blur">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            aria-label="全选"
            className="h-4 w-4 cursor-pointer accent-seal"
          />
          <span>
            已选 <span className="font-medium text-ink">{selected.size}</span> / {worksheets.length}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <BatchPrintButton
            selectedIds={Array.from(selected)}
            hasFeature={hasMulti}
          />
          <span className="text-xs text-ink-faint">最多 50 张/批</span>
        </div>
      </div>
      <ul className="divide-y rounded border">
        {worksheets.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(w.id)}
                onChange={() => toggle(w.id)}
                aria-label={`选择 ${w.title}`}
                className="worksheet-no-print mt-1 h-4 w-4 cursor-pointer accent-seal"
              />
              <div>
                <Link href={`/worksheet/${w.id}`} className="font-medium text-seal hover:underline">
                  {w.title}
                </Link>
                <div className="text-sm text-ink-faint">
                  {paperSizeLabel(w.paperSize)} · {fontFamilyLabel(w.fontFamily)} · {w.content.length} 字 ·{' '}
                  {cellStyleLabel(w.cellStyle)} ·{' '}
                  {new Date(w.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <RenameWorksheetButton id={w.id} currentTitle={w.title} />
              <DeleteWorksheetButton id={w.id} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
