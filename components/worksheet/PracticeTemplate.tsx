'use client';

import { useState } from 'react';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES, cellStyleLabel } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';

const PRACTICE_CELL_STYLES: { value: CellStyle; label: string }[] = [
  { value: 'brush-square', label: '毛笔 · 田字格' },
  { value: 'brush-cross', label: '毛笔 · 米字格' },
  { value: 'pen-square', label: '钢笔 · 田字格' },
  { value: 'pen-cross', label: '钢笔 · 米字格' },
];

const PRACTICE_COUNTS = [50, 100, 200, 500] as const;

function cellSizeFor(p: PaperSize): number {
  switch (p) {
    case 'brush-12': return 140;
    case 'brush-24': return 100;
    case 'brush-28': return 85;
    default:         return 80;
  }
}

export function PracticeTemplate() {
  // Defaults: 钢笔·田字格 · A4 · 100 cells — the most common practice setup.
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [cellStyle, setCellStyle] = useState<CellStyle>('pen-square');
  const [count, setCount] = useState<number>(100);

  const sizeClass = `worksheet-grid--${paperSize.toLowerCase()}`;
  const cellSize = cellSizeFor(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);

  return (
    <div>
      {/* Print: page size matches selection. Brush sizes are not valid @page
          values — the browser falls back to the printer default. */}
      <style>{`@page { size: ${paperSize}; margin: 1.5cm; }`}</style>

      {/* Form: hidden in print. */}
      <div className="worksheet-no-print card-paper rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">练字模板设置</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-ink-soft mb-1">格子形式</label>
            <select
              value={cellStyle}
              onChange={(e) => setCellStyle(e.target.value as CellStyle)}
              className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            >
              {PRACTICE_CELL_STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-soft mb-1">纸张尺寸</label>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            >
              {PAPER_SIZES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-soft mb-1">格数</label>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            >
              {PRACTICE_COUNTS.map((n) => (
                <option key={n} value={n}>{n} 格</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-ink-faint">
            {cellStyleLabel(cellStyle)} · {PAPER_SIZES.find(p => p.value === paperSize)?.label} · {count} 格
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded bg-seal px-4 py-1.5 text-white text-sm hover:bg-seal/80"
          >
            打印模板
          </button>
        </div>
      </div>

      {/* Template grid: matches WorksheetPreview layout but with empty cells. */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className={`worksheet-grid mx-auto grid min-w-full sm:min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
          <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
              <span className="font-kai text-base text-ink">字·韵</span>
            </div>
            <div className="text-sm text-ink-soft">练字模板</div>
            <div className="text-xs text-ink-faint">公益网站，请多关注</div>
          </div>
          {cells.map((i) => (
            <div key={i} className="worksheet-cell">
              <WorksheetCell char="" style={cellStyle} size={cellSize} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}