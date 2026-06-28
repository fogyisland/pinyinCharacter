'use client';

import { useState } from 'react';
import type { CellStyle, PaperSize, Tool } from '@/lib/worksheet-types';
import { PAPER_SIZES, cellsPerPage, cellStyleLabel, getTool, isBrushSize } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';

const PRACTICE_CELL_STYLES: { value: CellStyle; label: string; tool: Tool }[] = [
  { value: 'brush-square', label: '毛笔 · 田字格', tool: 'brush' },
  { value: 'brush-cross', label: '毛笔 · 米字格', tool: 'brush' },
  { value: 'pen-square', label: '钢笔 · 田字格', tool: 'pen' },
  { value: 'pen-cross', label: '钢笔 · 米字格', tool: 'pen' },
];

// 毛笔 ↔ brush-12/24/28; 钢笔 ↔ A3/A4/B5. Selecting a cell style whose
// tool differs from the current paperSize auto-switches paperSize to the
// first valid option for the new tool (mirrors WorksheetGenerator's logic).
const PEN_PAPERS: PaperSize[] = ['A3', 'A4', 'B5'];
const BRUSH_PAPERS: PaperSize[] = ['brush-12', 'brush-24', 'brush-28'];

function availablePaperSizes(tool: Tool): readonly PaperSize[] {
  return tool === 'brush' ? BRUSH_PAPERS : PEN_PAPERS;
}

function cellSizeFor(p: PaperSize): number {
  switch (p) {
    case 'brush-12': return 140;
    case 'brush-24': return 100;
    case 'brush-28': return 85;
    default:         return 80;
  }
}

// Host-only display for the footer line: strip protocol + path so the
// printed page shows e.g. "fogyisland.github.io" instead of the full URL.
function hostOf(raw: string): string {
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

export function PracticeTemplate() {
  // Defaults: 钢笔·田字格 · A4 · 88 cells/page (auto-fitted by paper size).
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [cellStyle, setCellStyle] = useState<CellStyle>('pen-square');

  // Keep the paper dropdown in sync with the chosen cell style's tool.
  // Brush cells → brush-12/24/28 only; pen cells → A3/A4/B5 only.
  function handleCellStyleChange(next: CellStyle) {
    const nextTool = getTool(next);
    setCellStyle(next);
    if (nextTool === 'brush' && !isBrushSize(paperSize)) {
      setPaperSize('brush-12');
    } else if (nextTool === 'pen' && isBrushSize(paperSize)) {
      setPaperSize('A4');
    }
  }

  const sizeClass = `worksheet-grid--${paperSize.toLowerCase()}`;
  const cellSize = cellSizeFor(paperSize);
  // Auto-fit: cellsPerPage gives the count that fits one page at the
  // chosen paper size. No count selector — switching paper size reflows
  // the grid to fill exactly one sheet.
  const count = cellsPerPage(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);
  const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  const paperOptions = availablePaperSizes(getTool(cellStyle));

  return (
    <div>
      {/* Print: page size matches selection. Brush sizes are not valid @page
          values — the browser falls back to the printer default. */}
      <style>{`@page { size: ${paperSize}; margin: 1.5cm; }`}</style>

      {/* Form: hidden in print. */}
      <div className="worksheet-no-print card-paper rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">练字模板设置</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-soft mb-1">格子形式</label>
            <select
              value={cellStyle}
              onChange={(e) => handleCellStyleChange(e.target.value as CellStyle)}
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
              {paperOptions.map((p) => (
                <option key={p} value={p}>{PAPER_SIZES.find(x => x.value === p)?.label ?? p}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-ink-faint">
            {cellStyleLabel(cellStyle)} · {PAPER_SIZES.find(p => p.value === paperSize)?.label} · 自动适配 {count} 格 / 页
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded bg-seal px-4 py-1.5 text-white text-sm hover:bg-seal/80"
          >
            打印模板
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          提示：Chrome 打印对话框「更多设置」里取消「页眉和页脚」，可避免浏览器自动添加 URL 和日期。
        </p>
      </div>

      {/* Template grid: matches WorksheetPreview layout but with empty cells. */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className={`worksheet-grid mx-auto grid min-w-full sm:min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
          <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
              <span className="font-kai text-base text-ink">字·韵</span>
            </div>
            <div className="text-sm text-ink-soft">空白字帖</div>
          </div>
          {cells.map((i) => (
            <div key={i} className="worksheet-cell">
              <WorksheetCell char="" style={cellStyle} size={cellSize} />
            </div>
          ))}
          {siteHost && (
            <div className="col-span-full text-center text-xs text-ink-faint mt-3 pt-2 border-t border-ink/10">
              {siteHost}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
