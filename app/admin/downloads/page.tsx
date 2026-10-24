import Link from 'next/link';
import { Download } from 'lucide-react';
import { getDownloadStats, listDownloads } from '@/lib/admin-downloads';
import { StatCard } from '@/components/admin/StatCard';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import { DownloadsFilterBar } from '@/components/admin/DownloadsFilterBar';
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

function statusBadge(status: string) {
  const color = status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${color}`}>{status}</span>;
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
  const navClass = (disabled: boolean) =>
    `text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep inline-flex items-center gap-1 ${
      disabled ? 'opacity-50 pointer-events-none' : ''
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">下载</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      <DownloadsFilterBar key={buildDownloadsHref(query)} query={query} />

      {error && <p className="text-sm text-seal">下载记录查询失败：{error}</p>}

      <ResponsiveTable
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="无数据"
        columns={[
          { key: 'source', header: '资源', mobileTitle: true },
          { key: 'user', header: '用户', mobileHide: true },
          { key: 'format', header: '格式', mobileHide: true },
          { key: 'status', header: '状态' },
          { key: 'duration', header: '耗时', mobileHide: true },
          { key: 'createdAt', header: '时间', mobileHide: true },
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
              <span className="text-xs px-2 py-0.5 rounded bg-paper-deep">{r.format}</span>
              {statusBadge(r.status)}
              <span className="text-xs">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</span>
              <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span>
            </>
          );
        }}
      </ResponsiveTable>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-faint">
          共 {total} 条 · 第 {query.page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <Link
            href={buildDownloadsHref(query, { page: Math.max(1, query.page - 1) })}
            className={navClass(query.page <= 1)}
          >
            上一页
          </Link>
          <Link
            href={buildDownloadsHref(query, { page: Math.min(totalPages, query.page + 1) })}
            className={navClass(query.page >= totalPages)}
          >
            下一页
          </Link>
        </div>
      </div>
    </div>
  );
}
