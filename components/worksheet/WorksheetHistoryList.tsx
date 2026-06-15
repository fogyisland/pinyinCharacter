import Link from 'next/link';
import type { Worksheet } from '@/lib/worksheet-types';
import { paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import { DeleteWorksheetButton } from './DeleteWorksheetButton';

interface Props {
  worksheets: Worksheet[];
}

export function WorksheetHistoryList({ worksheets }: Props) {
  if (worksheets.length === 0) {
    return (
      <div className="py-8 text-center text-ink-faint">还没有保存的字帖</div>
    );
  }
  return (
    <ul className="divide-y rounded border">
      {worksheets.map((w) => (
        <li key={w.id} className="flex items-center justify-between p-4">
          <div>
            <Link href={`/worksheet/${w.id}`} className="font-medium text-seal hover:underline">
              {w.title}
            </Link>
            <div className="text-sm text-ink-faint">
              {paperSizeLabel(w.paperSize)} · {fontFamilyLabel(w.fontFamily)} · {w.content.length} 字 ·{' '}
              {w.cellStyle === 'brush' ? '毛笔格' : w.cellStyle === 'square' ? '田字格' : '钢笔格'} ·{' '}
              {new Date(w.createdAt).toLocaleString()}
            </div>
          </div>
          <DeleteWorksheetButton id={w.id} />
        </li>
      ))}
    </ul>
  );
}
