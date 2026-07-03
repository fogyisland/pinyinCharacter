'use client';

import { useEffect, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { DocumentProps } from '@react-pdf/renderer';
import type { CellStyle, PaperSize, Tool } from '@/lib/worksheet-types';
import { PAPER_SIZES, PRACTICE_LAYOUT, PRACTICE_GRID_CELL_SIZE, cellsPerPage, cellStyleLabel, fourLineRowsPerPage, getTool, getPresentation, isBrushSize, linedHeightPx, linesPerPage } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';
import { PracticePDF } from './PracticePDF';

// @react-pdf/renderer's main entry is the Node build, which throws when
// PDFDownloadLink is instantiated on the server. Dynamic import with
// ssr: false skips the server bundle entirely — only loads in the browser.
// Cast through `unknown` because next/dynamic's prop inference fights
// react-pdf's overloaded children (ReactNode | render-prop).
const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFDownloadLink),
  { ssr: false, loading: () => <span className="rounded border border-seal px-4 py-1.5 text-seal/60 text-sm">…</span> }
) as unknown as ComponentType<{
  document: ReactElement<DocumentProps>;
  fileName?: string;
  className?: string;
  children?: ReactNode | ((state: { loading: boolean }) => ReactNode);
}>;

const PRACTICE_CELL_STYLES: { value: CellStyle; label: string; tool: Tool }[] = [
  { value: 'brush-square', label: '毛笔 · 田字格', tool: 'brush' },
  { value: 'brush-cross', label: '毛笔 · 米字格', tool: 'brush' },
  { value: 'pen-square', label: '钢笔 · 田字格', tool: 'pen' },
  { value: 'pen-cross', label: '钢笔 · 米字格', tool: 'pen' },
  { value: 'pen-lined', label: '钢笔 · 横线', tool: 'pen' },
  { value: 'pen-english', label: '钢笔 · 英文描红', tool: 'pen' },
];

// 毛笔 ↔ brush-12/24/28; 钢笔 ↔ A3/A4/B5. Selecting a cell style whose
// tool differs from the current paperSize auto-switches paperSize to the
// first valid option for the new tool (mirrors WorksheetGenerator's logic).
const PEN_PAPERS: PaperSize[] = ['A3', 'A4', 'B5'];
const BRUSH_PAPERS: PaperSize[] = ['brush-12', 'brush-24', 'brush-28'];

function availablePaperSizes(tool: Tool): readonly PaperSize[] {
  return tool === 'brush' ? BRUSH_PAPERS : PEN_PAPERS;
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
  // Defaults: 钢笔·田字格 · A4 · 80 cells/page (auto-fitted by paper size).
  // `useSearchParams` is wrapped in a try/catch because happy-dom tests
  // sometimes render outside a Next router context where the hook returns null.
  const sp = (() => { try { return useSearchParams(); } catch { return null; } })();
  const initialStyle = (sp?.get('style') as CellStyle | null) ?? 'pen-square';
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [cellStyle, setCellStyle] = useState<CellStyle>(initialStyle);

  // Keep cellStyle in sync if the URL param changes (e.g. headless screenshot).
  useEffect(() => {
    if (initialStyle && initialStyle !== cellStyle) {
      setCellStyle(initialStyle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStyle]);

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

  const presentation = getPresentation(cellStyle);
  // Lined and four-line (English trace) share the same vertical-stack layout:
  // N rows stacked, lines stretch across the full inner width. Visual styling
  // differs (1 rule vs 4 rules per row) but the layout shape is identical.
  const isLined = presentation === 'lined' || presentation === 'four-line';
  const sizeClass = isLined ? `worksheet-grid--${paperSize.toLowerCase()}-lined` : `worksheet-grid--${paperSize.toLowerCase()}`;
  // Lined mode: cellSize = row height in CSS px (e.g. A4 = 38px ≈ 1.0cm).
  // Grid mode: cellSize = cell side in CSS px (e.g. A4 = 75px — slightly smaller
  // than PRACTICE_LAYOUT so the 8px grid gap fits A4's printable width).
  // Brush papers fall back to PRACTICE_LAYOUT (they have their own sizing).
  const cellSize = isLined
    ? linedHeightPx(paperSize)
    : (PRACTICE_GRID_CELL_SIZE[paperSize] ?? PRACTICE_LAYOUT[paperSize].cellSize);
  // Lined mode: count = lines per page (A4=24). Grid mode: count = cells per page.
  // Four-line uses fourLineRowsPerPage() (A4=16, A3=21, B5=13 — tuned 2026-07-03
  // to fill more of the A4 sheet; 16×54=864px ≈ 4.7cm bottom margin, down from
  // ~8cm with the old 14-row default).
  const count = presentation === 'four-line'
    ? fourLineRowsPerPage(paperSize)
    : isLined
      ? linesPerPage(paperSize)
      : cellsPerPage(paperSize);
  const cells = Array.from({ length: count }, (_, i) => i);
  // siteHost shows the canonical site URL (e.g. "fogyisland.github.io") so
  // printed pages can be traced back to the source. NEXT_PUBLIC_SITE_URL is
  // set by the admin backend in production; in dev it is empty by design
  // (per memory next-public-site-url-from-admin). Fall back to the brand
  // name "字·韵" so the footer line is never empty — gives users something
  // to see while making it obvious this is local dev.
  const siteHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? '') || '字·韵';
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
            <label htmlFor="practice-cell-style" className="block text-xs text-ink-soft mb-1">格子形式</label>
            <select
              id="practice-cell-style"
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
            <label htmlFor="practice-paper-size" className="block text-xs text-ink-soft mb-1">纸张尺寸</label>
            <select
              id="practice-paper-size"
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint">
            {cellStyleLabel(cellStyle)} · {PAPER_SIZES.find(p => p.value === paperSize)?.label} · 自动适配 {count} {isLined ? '行' : '格'} / 页
          </p>
          <div className="flex gap-2 shrink-0">
            <PDFDownloadLink
              document={<PracticePDF paperSize={paperSize} cellStyle={cellStyle} siteHost={siteHost} />}
              fileName={`练字模板-${paperSize}.pdf`}
              className="rounded border border-seal px-4 py-1.5 text-seal text-sm hover:bg-seal/10"
            >
              {({ loading }) => (loading ? '生成中…' : '下载 PDF')}
            </PDFDownloadLink>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded bg-seal px-4 py-1.5 text-white text-sm hover:bg-seal/80"
            >
              打印模板
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          点「下载 PDF」直接获得自定义排版的 PDF；点「打印模板」走浏览器打印（对话框里取消「页眉和页脚」）。
        </p>
      </div>

      {/* Template body: grid for 田字格/米字格, flex stack for 横线, CSS background for 英文描红. */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {presentation === 'four-line' ? (
          // DOM-per-row: each row has 4 absolutely-positioned lines (top,
          // upper-mid, baseline, bottom) and a text slot. Visual grouping
          // is clear — a rule group belongs to one row, with a visible gap
          // (--row-gap) to the next. CSS variables in globals.css control
          // the spacing; tweak --grid-gap / --row-gap to scale uniformly.
          <div className="mx-auto max-w-3xl min-w-full sm:min-w-[640px] print:min-w-0 p-10">
            <div className="four-line-paper">
              {/* Header lives INSIDE .four-line-paper so the @media print
                  position:absolute reset moves header + rows + footer
                  together. Putting it outside (as a sibling of
                  .four-line-paper) caused the header to be left behind
                  and hidden by `body * { visibility: hidden }` (regression
                  2026-07-03: blank header in print). */}
              <div className="flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
                  <span className="font-kai text-base text-ink">字·韵 · {cellStyleLabel(cellStyle)}</span>
                </div>
                <div className="text-sm text-ink-soft">空白字帖 · 公益网站，多多支持</div>
              </div>
              {cells.map((i) => (
                <div key={i} className="four-line-paper-row">
                  <div className="line line-1" />
                  <div className="line line-2" />
                  <div className="line line-3" />
                  <div className="line line-4" />
                </div>
              ))}
              {siteHost && (
                <div className="text-center text-xs text-ink-faint mt-3 pt-2 border-t border-ink/10">
                  {siteHost}
                </div>
              )}
            </div>
          </div>
        ) : isLined ? (
          <div className="lined-paper mx-auto max-w-3xl min-w-full sm:min-w-[640px] print:min-w-0" style={{ minHeight: `${count * cellSize}px` }}>
            <div className="flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
                <span className="font-kai text-base text-ink">字·韵 · {cellStyleLabel(cellStyle)}</span>
              </div>
              <div className="text-sm text-ink-soft">空白字帖 · 公益网站，多多支持</div>
            </div>
            {cells.map((i) => (
              <div key={i} className="lined-paper-row" style={{ height: `${cellSize}px` }}>
                <WorksheetCell char="" style={cellStyle} size={cellSize} />
              </div>
            ))}
            {siteHost && (
              <div className="text-center text-xs text-ink-faint mt-3 pt-2 border-t border-ink/10">
                {siteHost}
              </div>
            )}
          </div>
        ) : (
          <div className={`worksheet-grid mx-auto grid min-w-full sm:min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
            <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
                <span className="font-kai text-base text-ink">字·韵 · {cellStyleLabel(cellStyle)}</span>
              </div>
              <div className="text-sm text-ink-soft">空白字帖 · 公益网站，多多支持</div>
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
        )}
      </div>
    </div>
  );
}
