import Link from 'next/link';
import { parseRange, rangeToDays } from '@/lib/admin-range';
import { getTopPaths } from '@/lib/admin-pageviews';
import { LazyBarChartTop } from '@/components/admin/charts/LazyBarChartTop';
import { CopyPathCell } from '@/components/admin/analytics/CopyPathCell';
import { formatNumber } from '@/lib/format';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RANGE_TABS = [
  { range: '1d', label: '今日' },
  { range: '7d', label: '近7天' },
  { range: '30d', label: '近30天' },
  { range: '90d', label: '近90天' },
] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const current = parseRange(params.range);
  const days = rangeToDays(current);
  const topPages = await getTopPaths(days, 20);

  return (
    <div>
      <PageHeader
        title="访问分析"
        description={`近 ${days} 天 · 共 ${topPages.length} 条路径`}
      />

      <div className="space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="时间范围">
          {RANGE_TABS.map((tab) => {
            const active = tab.range === current;
            return (
              <Link
                key={tab.range}
                href={`/admin/analytics?range=${tab.range}`}
                aria-current={active ? 'page' : undefined}
                className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                  active
                    ? 'bg-ink text-paper border-ink font-medium'
                    : 'border-ink/20 text-ink-soft hover:bg-paper-deep'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel title="Top 20 路径" description="按浏览量排列。">
            <LazyBarChartTop data={topPages.map((p) => ({ label: p.path, value: p.views }))} />
          </Panel>

          <Panel title="详情表" description="路径的浏览量与独立访客数。点路径可复制。">
            <DataTable
              rows={topPages}
              rowKey={(p) => p.path}
              caption="访问路径详情"
              maxHeight="medium"
              framed={false}
              empty={
                <EmptyState
                  title="暂无数据"
                  description="这段时间还没有页面访问记录。换个时间范围再看看。"
                />
              }
              columns={[
                { key: 'path', header: '路径', mobileTitle: true, className: 'max-w-0' },
                { key: 'views', header: '浏览量', numeric: true },
                { key: 'unique', header: '独立访客', numeric: true },
              ]}
            >
              {(p) => (
                <>
                  <span className="block truncate">
                    <CopyPathCell path={p.path} />
                  </span>
                  <span>{formatNumber(p.views)}</span>
                  <span>{formatNumber(p.unique)}</span>
                </>
              )}
            </DataTable>
          </Panel>
        </div>
      </div>
    </div>
  );
}
