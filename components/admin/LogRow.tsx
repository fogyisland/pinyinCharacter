import Link from 'next/link';
import { SourceBadge } from './SourceBadge';
import { formatLogMessage } from '@/lib/audit-format';
import type { UnifiedLogEntry } from '@/lib/admin-logs';

export function LogRow({ entry, onClick }: {
  entry: UnifiedLogEntry;
  onClick?: (entry: UnifiedLogEntry) => void;
}) {
  // Human-readable summary in Chinese. Falls back to event name + raw JSON
  // for sources we don't know how to format (download / ai_call).
  const summary = entry.source === 'audit'
    ? formatLogMessage(entry.event, entry.metadata)
    : entry.event;
  const rawJson = JSON.stringify(entry.metadata);
  return (
    <tr className="border-b border-paper-warm hover:bg-paper-warm/50 cursor-pointer" onClick={() => onClick?.(entry)}>
      <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(entry.createdAt).toLocaleString('zh-CN')}</td>
      <td className="px-3 py-2"><SourceBadge source={entry.source} /></td>
      <td className="px-3 py-2 text-sm">{entry.event}</td>
      <td className="px-3 py-2 text-sm">
        {entry.username ? <Link href={`/admin/users/${entry.userId}`} className="text-seal hover:underline">{entry.username}</Link> : '—'}
      </td>
      <td className="px-3 py-2 text-sm text-ink max-w-md" title={rawJson}>
        {summary}
      </td>
    </tr>
  );
}