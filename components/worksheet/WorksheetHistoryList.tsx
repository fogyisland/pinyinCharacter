import Link from 'next/link';
import { Worksheet } from '@/lib/worksheet';

interface Props {
  worksheets: Worksheet[];
}

export function WorksheetHistoryList({ worksheets }: Props) {
  if (worksheets.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">还没有保存的字帖</div>
    );
  }
  return (
    <ul className="divide-y rounded border">
      {worksheets.map((w) => (
        <li key={w.id} className="flex items-center justify-between p-4">
          <div>
            <Link href={`/worksheet/${w.id}`} className="font-medium text-blue-600 hover:underline">
              {w.title}
            </Link>
            <div className="text-sm text-gray-500">
              {w.content.length} 字 · {w.cellStyle === 'brush' ? '毛笔格' : '田字格'} ·{' '}
              {new Date(w.createdAt).toLocaleString()}
            </div>
          </div>
          <form action={`/api/worksheets/${w.id}`} method="post">
            {/* DELETE via JS in parent; this is a placeholder */}
          </form>
        </li>
      ))}
    </ul>
  );
}
