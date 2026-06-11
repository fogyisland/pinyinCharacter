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
            className="rounded border px-3 py-1 hover:bg-gray-100"
          >
            ← 返回修改
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border px-3 py-1 hover:bg-gray-100"
            >
              打印
            </button>
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {props.saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {props.title && (
        <h1 className="worksheet-no-print mb-4 text-center text-2xl font-bold">{props.title}</h1>
      )}

      <div className="worksheet-grid mx-auto grid max-w-3xl grid-cols-8 gap-2 print:grid-cols-8">
        {cells.map((cell) => (
          <div key={cell.index} className="worksheet-cell">
            <WorksheetCell char={cell.char} style={cell.style} />
          </div>
        ))}
      </div>
    </div>
  );
}
