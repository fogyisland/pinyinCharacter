import { BookOpen, ChartPie, Library } from 'lucide-react';
import { getContentCoverage } from '@/lib/content';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatCard } from '@/components/admin/StatCard';
import { AdminLink } from '@/components/admin/AdminButton';

export const dynamic = 'force-dynamic';

export default async function AdminCharsPage() {
  const cov = await getContentCoverage();
  const pct = cov.totalChars > 0 ? Math.round((cov.withStory / cov.totalChars) * 1000) / 10 : 0;
  return (
    <div>
      <PageHeader
        title="字典 / 字源"
        description={
          <>
            字典 + 字源 数据覆盖(数据源:<code className="text-xs">data/content/</code> JSON 文件)
          </>
        }
        actions={
          <AdminLink href="/admin/chars/generate" variant="primary">
            手动触发字源生成 →
          </AdminLink>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="总字符 (chars 表)" value={cov.totalChars} icon={Library} />
        <StatCard label="已生成字源 (JSON)" value={cov.withStory} icon={BookOpen} />
        <StatCard label="覆盖率" value={`${pct}%`} icon={ChartPie} />
      </div>

      <Panel title="按级别" description="每个级别的字数与字源覆盖情况" flush>
        <DataTable
          rows={cov.byLevel}
          rowKey={(r) => r.level}
          framed={false}
          caption="按级别的内容覆盖率"
          empty={
            <EmptyState
              icon={ChartPie}
              title="暂无级别数据"
              description="字库里还没有分级字符,先导入字库再来看看覆盖率。"
            />
          }
          columns={[
            { key: 'level', header: '级别', mobileTitle: true },
            { key: 'total', header: '总数', numeric: true },
            { key: 'with_story', header: '有字源', numeric: true },
            { key: 'pct', header: '覆盖率', numeric: true },
          ]}
        >
          {(r) => (
            <>
              <span>{r.level} 级</span>
              <span>{r.total}</span>
              <span>{r.with_story}</span>
              <span>{`${r.total > 0 ? Math.round((r.with_story / r.total) * 1000) / 10 : 0}%`}</span>
            </>
          )}
        </DataTable>
      </Panel>
    </div>
  );
}
