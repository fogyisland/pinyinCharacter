import { WorksheetPreview } from './WorksheetPreview';
import type { CellStyle, FontFamily, PaperSize } from '@/lib/worksheet-types';

export interface BatchPrintItem {
  id: number;
  title: string;
  content: string[];
  paperSize: PaperSize;
  cellStyle: CellStyle;
  fontFamily: FontFamily;
}

export function BatchPrintPreview({ items }: { items: BatchPrintItem[] }) {
  return (
    <div className="batch-print-area" aria-hidden>
      {items.map((it, i) => (
        <div key={it.id} className={i < items.length - 1 ? 'print-page-break' : ''}>
          <WorksheetPreview
            title={it.title}
            content={it.content}
            cellStyle={it.cellStyle}
            paperSize={it.paperSize}
            fontFamily={it.fontFamily}
            showHeader={true}
          />
        </div>
      ))}
    </div>
  );
}
