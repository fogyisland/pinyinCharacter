'use client';

import type { CellStyle } from '@/lib/worksheet-types';
import { generateLayout } from '@/lib/worksheet-types';
import { WorksheetCell } from './WorksheetCell';

interface BaseProps {
  title?: string;
  content: string[];
  cellStyle: CellStyle;
  showHeader?: boolean;
}

interface FormProps extends BaseProps {
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}

type Props = BaseProps | FormProps;

export function WorksheetPreview(props: Props) {
  const cells = generateLayout(props.content, props.cellStyle);
  const isFormView = 'onBack' in props;

  return (
    <div>
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
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border px-3 py-1 hover:bg-paper-deep"
            >
              打印
            </button>
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
        <div className="worksheet-grid mx-auto grid min-w-[640px] max-w-3xl grid-cols-8 gap-2 print:min-w-0 print:grid-cols-8">
          {cells.map((cell) => (
            <div key={cell.index} className="worksheet-cell">
              <WorksheetCell char={cell.char} style={cell.style} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
