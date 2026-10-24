import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import { SourceBadge } from '@/components/admin/SourceBadge';
import { LogDetailTrigger } from '@/components/admin/LogDetailTrigger';
import { formatLogMessage } from '@/lib/audit-format';
import { formatDateTime } from '@/lib/format';
import type { UnifiedLogEntry } from '@/lib/admin-logs-types';

/**
 * The log table.
 *
 * This is a server component: the rows arrive as props — the page queried
 * them on the server — and the table itself never reaches the browser as
 * React work. Only the per-row detail trigger is a client island, so React
 * hydrates one small button per row instead of the whole table.
 *
 * The types come from lib/admin-logs-types.ts, which has no mysql2 import,
 * so the browser bundle stays free of the database driver.
 */
export function AdminLogsTable({ rows }: { rows: UnifiedLogEntry[] }) {
  return (
    <ResponsiveTable
      rows={rows}
      rowKey={(r) => r.id}
      emptyMessage="无数据"
      columns={[
        { key: 'event', header: '事件', mobileTitle: true },
        { key: 'source', header: '来源' },
        { key: 'createdAt', header: '时间', mobileHide: true },
        { key: 'user', header: '用户', mobileHide: true },
        { key: 'summary', header: '元数据', mobileHide: true },
      ]}
    >
      {(r) => {
        const summary = r.source === 'audit' ? formatLogMessage(r.event, r.metadata) : r.event;
        return (
          <>
            <LogDetailTrigger entry={r} />
            <SourceBadge source={r.source} />
            <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span>
            {r.username ? (
              <a href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                {r.username}
              </a>
            ) : (
              <span className="text-ink-faint">—</span>
            )}
            <span
              className="text-sm text-ink max-w-md block truncate"
              title={JSON.stringify(r.metadata)}
            >
              {summary}
            </span>
          </>
        );
      }}
    </ResponsiveTable>
  );
}
