import { listUnifiedLogs } from '@/lib/admin-logs';
import { AdminLogsTable } from '@/components/admin/AdminLogsTable';
import { LogsFilterBar } from '@/components/admin/LogsFilterBar';
import { Pagination } from '@/components/admin/Pagination';
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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">日志</h1>

      <LogsFilterBar key={buildLogsHref(query)} query={query} />

      {error && <p className="text-sm text-seal">日志查询失败：{error}</p>}

      <AdminLogsTable rows={rows} />

      <Pagination
        page={query.page}
        totalPages={totalPages}
        total={total}
        pageSize={LOGS_PAGE_SIZE}
        buildHref={(target) => buildLogsHref(query, { page: target })}
      />
    </div>
  );
}
