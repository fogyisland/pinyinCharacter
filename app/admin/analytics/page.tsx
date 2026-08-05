import Link from 'next/link';
import { parseRange, rangeToDays } from '@/lib/admin-range';
import { getTopPaths } from '@/lib/admin-pageviews';
import { BarChartTop } from '@/components/admin/charts';
import { CopyPathCell } from '@/components/admin/analytics/CopyPathCell';

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
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-2xl font-serif text-ink">访问分析</h1>
        <p className="text-sm text-ink-soft mt-1">
          近 {days} 天 · 共 {topPages.length} 条路径
        </p>
      </header>

      <nav className="flex gap-2" aria-label="时间范围">
        {RANGE_TABS.map((tab) => {
          const active = tab.range === current;
          return (
            <Link
              key={tab.range}
              href={`/admin/analytics?range=${tab.range}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'px-4 py-2 rounded bg-paper border border-line text-ink font-medium'
                  : 'px-4 py-2 rounded bg-muted/30 border border-line/50 text-ink-soft hover:bg-muted/50'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-paper rounded border border-line p-4">
          <h2 className="text-base font-serif text-ink mb-3">Top 20 路径</h2>
          <BarChartTop data={topPages.map((p) => ({ label: p.path, value: p.views }))} />
        </section>

        <section className="bg-paper rounded border border-line p-4">
          <h2 className="text-base font-serif text-ink mb-3">详情表</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft text-left">
                <th className="py-2 pr-4">路径</th>
                <th className="py-2 pr-4 text-right">浏览量</th>
                <th className="py-2 pr-4 text-right">独立访客</th>
              </tr>
            </thead>
            <tbody>
              {topPages.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-ink-soft text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                topPages.map((p) => (
                  <tr key={p.path} className="border-b border-line/50">
                    <td className="py-2 pr-4 max-w-0">
                      <div className="truncate">
                        <CopyPathCell path={p.path} />
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.views.toLocaleString('zh-CN')}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.unique.toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
