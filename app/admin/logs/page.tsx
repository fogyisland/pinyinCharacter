import Link from 'next/link';
import { listUnifiedLogs } from '@/lib/admin-logs';
import { AdminLogsTable } from '@/components/admin/AdminLogsTable';
import { LogsFilterBar } from '@/components/admin/LogsFilterBar';
import { LOGS_PAGE_SIZE, buildLogsHref, parseLogsQuery } from '@/lib/admin-logs-url';
import { dateRangeToIso, parseUserId } from '@/lib/admin-url';
import type { UnifiedLogEntry } from '@/lib/admin-logs-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = parseLogsQuery(params);
  const range = dateRangeToIso(query.from, query.to);

  let rows: UnifiedLogEntry[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const result = await listUnifiedLogs({
      source: query.source || undefined,
      type: query.type || undefined,
      userId: parseUserId(query.userId),
      ip: query.ip || undefined,
      from: range.from,
      to: range.to,
      page: query.page,
      pageSize: LOGS_PAGE_SIZE,
    });
    rows = result.items;
    total = result.total;
  } catch (err) {
    console.error('[admin/logs] failed to list the unified logs:', err);
    error = (err as Error).message || '日志查询失败';
  }

  const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE));
  const navClass = (disabled: boolean) =>
    `text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep inline-flex items-center gap-1 ${
      disabled ? 'opacity-50 pointer-events-none' : ''
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">日志</h1>

      <LogsFilterBar key={buildLogsHref(query)} query={query} />

      {error && <p className="text-sm text-seal">日志查询失败：{error}</p>}

      <AdminLogsTable rows={rows} />

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-faint">
          共 {total} 条 · 第 {query.page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <Link
            href={buildLogsHref(query, { page: Math.max(1, query.page - 1) })}
            className={navClass(query.page <= 1)}
          >
            上一页
          </Link>
          <Link
            href={buildLogsHref(query, { page: Math.min(totalPages, query.page + 1) })}
            className={navClass(query.page >= totalPages)}
          >
            下一页
          </Link>
        </div>
      </div>
    </div>
  );
}
