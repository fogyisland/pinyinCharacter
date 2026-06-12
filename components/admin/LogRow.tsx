import Link from 'next/link';
import { SourceBadge } from './SourceBadge';
import type { UnifiedLogEntry } from '@/lib/admin-logs';

export function LogRow({ entry, onClick }: {
  entry: UnifiedLogEntry;
  onClick?: (entry: UnifiedLogEntry) => void;
}) {
  return (
    <tr className="border-b border-paper-warm hover:bg-paper-warm/50 cursor-pointer" onClick={() => onClick?.(entry)}>
      <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(entry.createdAt).toLocaleString('zh-CN')}</td>
      <td className="px-3 py-2"><SourceBadge source={entry.source} /></td>
      <td className="px-3 py-2 text-sm">{entry.event}</td>
      <td className="px-3 py-2 text-sm">
        {entry.username ? <Link href={`/admin/users/${entry.userId}`} className="text-seal hover:underline">{entry.username}</Link> : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-ink-soft max-w-xs truncate">{JSON.stringify(entry.metadata)}</td>
    </tr>
  );
}