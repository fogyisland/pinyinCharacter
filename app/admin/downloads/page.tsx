import { Download } from 'lucide-react';
import { getDownloadStats, listDownloads } from '@/lib/admin-downloads';
import { StatCard } from '@/components/admin/StatCard';
import { DataTable } from '@/components/admin/DataTable';
import { DownloadsFilterBar } from '@/components/admin/DownloadsFilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { Toolbar } from '@/components/admin/Toolbar';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import {
  DOWNLOADS_PAGE_SIZE,
  buildDownloadsHref,
  parseDownloadsQuery,
} from '@/lib/admin-downloads-url';
import { dateRangeToIso, parseUserId, todayDate } from '@/lib/admin-url';
import { formatDateTime } from '@/lib/format';
import type { DownloadRow, DownloadStats } from '@/lib/admin-downloads';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The page of a downloaded resource — null when the type has no page. */
function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (sourceType === 'worksheet') return `/worksheet/${encodeURIComponent(sourceId)}`;
  if (sourceType === 'poem') return `/poetry/${encodeURIComponent(sourceId)}`;
  if (sourceType === 'sutra') {
    const slug = sourceId.split('#')[0];
    return `/sutra/${encodeURIComponent(slug)}`;
  }
  if (sourceType === 'rare-char-card') {
    try {
      return `/rare-chars/${encodeURIComponent(decodeURIComponent(sourceId))}`;
    } catch {
      return `/rare-chars/${encodeURIComponent(sourceId)}`;
    }
  }
  return null;
}

export default async function AdminDownloadsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = parseDownloadsQuery(params);
  const range = dateRangeToIso(query.from, query.to);

  let rows: DownloadRow[] = [];
  let total = 0;
  let stats: DownloadStats | null = null;
  let todayCount = 0;
  let error: string | null = null;
  try {
    const [list, statRows, todayRows] = await Promise.all([
      listDownloads({
        userId: parseUserId(query.userId),
        sourceType: query.sourceType || undefined,
        from: range.from,
        to: range.to,
        page: query.page,
        pageSize: DOWNLOADS_PAGE_SIZE,
      }),
      getDownloadStats(7),
      listDownloads({ from: new Date(todayDate()).toISOString(), pageSize: 1 }),
    ]);
    rows = list.items;
    total = list.total;
    stats = statRows;
    todayCount = todayRows.total;
  } catch (err) {
    console.error('[admin/downloads] failed to list the downloads:', err);
    error = (err as Error).message || '下载记录查询失败';
  }

  const totalPages = Math.max(1, Math.ceil(total / DOWNLOADS_PAGE_SIZE));
  const topSrc = stats
    ? Object.entries(stats.bySourceType).sort((a, b) => b[1] - a[1])[0]
    : null;
  const topUser = stats?.topUsers?.[0];

  return (
    <div>
      <PageHeader
        title="下载"
        description="站点各类资源的下载流水。可按来源类型、用户和日期范围筛选。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="总下载 (7d)" value={stats?.total ?? '—'} icon={Download} />
        <StatCard label="今日下载" value={todayCount} icon={Download} />
        <StatCard
          label="最多用户 (7d)"
          value={topUser ? `${topUser.username ?? `#${topUser.userId}`} (${topUser.count})` : '—'}
          icon={Download}
        />
        <StatCard
          label="最常用源 (7d)"
          value={topSrc ? `${topSrc[0]} (${topSrc[1]})` : '—'}
          icon={Download}
        />
      </div>

      <Toolbar className="mb-3">
        <DownloadsFilterBar key={buildDownloadsHref(query)} query={query} />
      </Toolbar>

      {error ? (
        <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2 mb-3">
          下载记录查询失败：{error}
        </p>
      ) : null}

      <Panel title="下载记录" description="按当前筛选条件列出的每一笔下载。" flush>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          caption="下载记录列表"
          framed={false}
          empty={
            <EmptyState
              icon={Download}
              title="暂无下载记录"
              description="当前筛选条件下没有下载记录，换个时间范围或来源类型再试。"
            />
          }
          columns={[
            { key: 'source', header: '资源', mobileTitle: true },
            { key: 'user', header: '用户', mobileHide: true },
            { key: 'format', header: '格式', mobileHide: true },
            { key: 'status', header: '状态' },
            { key: 'duration', header: '耗时', numeric: true, mobileHide: true },
            { key: 'createdAt', header: '时间', numeric: true, mobileHide: true },
          ]}
        >
          {(r) => {
            const href = sourceHref(r.sourceType, r.sourceId);
            const sourceCell = r.sourceId ? (
              href ? (
                <a href={href} className="text-seal hover:underline text-sm">
                  {r.sourceType}#{r.sourceId}
                </a>
              ) : (
                <span className="text-sm">
                  {r.sourceType}#{r.sourceId}
                </span>
              )
            ) : (
              <span className="text-ink-faint">—</span>
            );
            return (
              <>
                {sourceCell}
                {r.username ? (
                  <a href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                    {r.username}
                  </a>
                ) : (
                  <span className="text-ink-faint">#{r.userId}</span>
                )}
                <StatusBadge>{r.format}</StatusBadge>
                <StatusBadge tone={r.status === 'ok' ? 'success' : 'danger'}>{r.status}</StatusBadge>
                <span className="text-xs">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</span>
                <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span>
              </>
            );
          }}
        </DataTable>
      </Panel>

      <div className="mt-4">
        <Pagination
          page={query.page}
          totalPages={totalPages}
          total={total}
          pageSize={DOWNLOADS_PAGE_SIZE}
          buildHref={(target) => buildDownloadsHref(query, { page: target })}
        />
      </div>
    </div>
  );
}
