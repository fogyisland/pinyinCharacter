'use client';

import { CellStyle } from '@/lib/worksheet';

interface Props {
  title: string;
  content: string[];
  cellStyle: CellStyle;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}

// Placeholder stub — will be replaced by Task 20's full implementation.
// This stub exists so that WorksheetGenerator (Task 19) can typecheck.
export function WorksheetPreview({ title, content, cellStyle, onBack, onSave, saving }: Props) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">预览(占位)</h2>
      <p>标题: {title || '(无)'}</p>
      <p>字数: {content.length}</p>
      <p>样式: {cellStyle}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          返回
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
