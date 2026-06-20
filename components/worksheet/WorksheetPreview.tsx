'use client';

import type { CellStyle, PaperSize, FontFamily } from '@/lib/worksheet-types';
import { generateLayout, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';
import { PrintButton } from '@/components/common/PrintButton';

function cellSizeFor(p: PaperSize): number {
  switch (p) {
    case 'brush-12': return 140;  // 4×140=560px, fits screen 768 + A4 print 680
    case 'brush-24': return 100;  // 6×100=600px, fits both
    case 'brush-28': return 85;   // 7×85=595px, fits both
    default:         return 80;   // A3/A4/B5 keep 80px (G2 default)
  }
}

interface BaseProps {
  title?: string;
  content: string[];
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  showHeader?: boolean;
}

interface FormProps extends BaseProps {
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  savedId?: number | null;
}

type Props = BaseProps | FormProps;

export function WorksheetPreview(props: Props) {
  const cells = generateLayout(props.content, props.cellStyle);
  const isFormView = 'onBack' in props;
  const sizeClass = `worksheet-grid--${props.paperSize.toLowerCase()}`;
  const cellSize = cellSizeFor(props.paperSize);

  return (
    <div>
      {/* Inline @page rule so the printed sheet actually uses the selected size. */}
      {/* Brush sizes (brush-12/24/28) are not valid CSS @page values; browser falls back to printer default — this matches the "free-form page" intent in plan G3 R4. */}
      <style>{`@page { size: ${props.paperSize}; margin: 1.5cm; }`}</style>

      {isFormView && props.showHeader !== false && (
        <div className="worksheet-no-print mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={props.onBack}
            className="rounded border px-3 py-1 hover:bg-paper-deep"
          >
            ← 返回修改
          </button>
          <div className="flex gap-2">
            {props.savedId ? (
              <PrintButton endpoint={`/api/worksheets/${props.savedId}/print`} label="打印" gate="multi_page" />
            ) : (
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded border px-3 py-1 hover:bg-paper-deep"
              >
                打印
              </button>
            )}
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="rounded bg-seal px-3 py-1 text-white hover:bg-seal/80 disabled:bg-ink/20"
            >
              {props.saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {props.title && (
        <h1 className="worksheet-no-print mb-4 text-center text-2xl font-bold">{props.title}</h1>
      )}

      <div className="overflow-x-auto">
        <div className={`worksheet-grid mx-auto grid min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
          <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
              <span className="font-kai text-base text-ink">字·韵</span>
            </div>
            <div className="text-sm text-ink-soft">
              字体: <span className="font-medium text-ink">{fontFamilyLabel(props.fontFamily)}</span>
            </div>
            <div className="text-xs text-ink-faint">公益网站，请多关注</div>
          </div>
          {cells.map((cell) => (
            <div key={cell.index} className="worksheet-cell">
              <WorksheetCell char={cell.char} style={cell.style} size={cellSize} fontFamily={props.fontFamily} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
