'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { JsonPanel } from '@/components/admin/JsonPanel';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import { SourceBadge } from '@/components/admin/SourceBadge';
import { formatLogMessage } from '@/lib/audit-format';
import { formatDateTime } from '@/lib/format';
import type { UnifiedLogEntry } from '@/lib/admin-logs-types';

/**
 * The log table with its row-detail modal.
 *
 * The rows arrive as props — the page queried them on the server — so the
 * island only owns the "which row is open" state. The types come from
 * lib/admin-logs-types.ts, which has no mysql2 import, so the browser bundle
 * stays free of the database driver.
 */
export function AdminLogsTable({ rows }: { rows: UnifiedLogEntry[] }) {
  const [selected, setSelected] = useState<UnifiedLogEntry | null>(null);

  return (
    <>
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
              <button
                type="button"
                onClick={() => setSelected(r)}
                className="text-sm text-seal hover:underline text-left"
              >
                {r.event}
              </button>
              <button type="button" onClick={() => setSelected(r)} className="cursor-pointer">
                <SourceBadge source={r.source} />
              </button>
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

      {selected && <LogDetail entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/** The row detail modal. */
function LogDetail({ entry, onClose }: { entry: UnifiedLogEntry; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-paper rounded-lg shadow-lg w-full max-w-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-semibold inline-flex items-center gap-1">
            <Search className="h-4 w-4" />
            {entry.event}
          </h3>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink text-sm">
            关闭
          </button>
        </div>
        <div className="space-y-2 text-sm">
          <p className="rounded bg-paper-deep px-3 py-2 text-ink">
            {entry.source === 'audit' ? formatLogMessage(entry.event, entry.metadata) : entry.event}
          </p>
          <p>
            <span className="text-ink-soft">来源:</span> {entry.source}
          </p>
          <p>
            <span className="text-ink-soft">时间:</span> {formatDateTime(entry.createdAt)}
          </p>
          {entry.username && (
            <p>
              <span className="text-ink-soft">用户:</span> {entry.username}
            </p>
          )}
          {entry.ip && (
            <p>
              <span className="text-ink-soft">IP:</span> {entry.ip}
            </p>
          )}
          <div>
            <span className="text-ink-soft">元数据 (原始):</span>
            <JsonPanel data={entry.metadata} />
          </div>
        </div>
      </div>
    </div>
  );
}
