'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { JsonPanel } from '@/components/admin/JsonPanel';
import { AdminButton } from '@/components/admin/AdminButton';
import { formatLogMessage } from '@/lib/audit-format';
import { formatDateTime } from '@/lib/format';
import type { UnifiedLogEntry } from '@/lib/admin-logs-types';

/**
 * The button that opens a log row's detail modal.
 *
 * The table around it is rendered on the server, so only this small island —
 * one per row — is hydrated in the browser. The row's data rides along as a
 * prop, which is the same payload the old whole-table client component
 * received, but the 350-odd <td> elements are no longer reconciled by React.
 */
export function LogDetailTrigger({ entry }: { entry: UnifiedLogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-seal hover:underline text-left"
      >
        {entry.event}
      </button>
      {open && <LogDetail entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The row detail modal. */
function LogDetail({ entry, onClose }: { entry: UnifiedLogEntry; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`日志详情 ${entry.event}`}
        className="bg-paper-soft rounded-lg shadow-paper-lg border border-ink/10 w-full max-w-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="font-kai text-base text-ink inline-flex items-center gap-1">
            <Search className="h-4 w-4" />
            {entry.event}
          </h3>
          <AdminButton size="sm" variant="ghost" onClick={onClose}>
            关闭
          </AdminButton>
        </div>
        <div className="space-y-2 text-sm">
          <p className="rounded bg-paper-deep/60 border border-ink/10 px-3 py-2 text-ink">
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
