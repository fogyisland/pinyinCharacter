import Link from 'next/link';
import { getPool } from '@/lib/db';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';

export const dynamic = 'force-dynamic';

async function fetchCoverage() {
  const pool = getPool();
  const [totals] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM chars`);
  const [withStory] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NOT NULL AND story <> ''`
  );
  const [byLevel] = await pool.query<any[]>(
    `SELECT level, COUNT(*) AS total,
            SUM(CASE WHEN ce.story IS NOT NULL AND ce.story <> '' THEN 1 ELSE 0 END) AS with_story
     FROM chars c
     LEFT JOIN char_etymology ce ON c.\`char\` = ce.\`char\`
     GROUP BY level ORDER BY level`
  );
  return {
    total: Number(totals[0].n),
    withStory: Number(withStory[0].n),
    byLevel: byLevel.map((r) => ({
      level: r.level,
      total: Number(r.total),
      with_story: Number(r.with_story ?? 0),
    })),
  };
}

export default async function AdminCharsPage() {
  const cov = await fetchCoverage();
  const pct = cov.total > 0 ? Math.round((cov.withStory / cov.total) * 1000) / 10 : 0;
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">字典 / 字源</h1>
      <p className="text-sm text-ink-soft mb-4">字典 + 字源 数据覆盖</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Stat label="总字符" value={cov.total} />
        <Stat label="已生成字源" value={cov.withStory} />
        <Stat label="覆盖率" value={`${pct}%`} />
      </div>

      <div className="card-paper rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold mb-3 text-ink-soft">按级别</h3>
        <ResponsiveTable
          rows={cov.byLevel}
          rowKey={(r) => r.level}
          emptyMessage="暂无数据"
          columns={[
            { key: 'level', header: '级别', mobileTitle: true },
            { key: 'total', header: '总数' },
            { key: 'with_story', header: '有字源' },
            { key: 'pct', header: '覆盖率' },
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
        </ResponsiveTable>
      </div>

      <Link
        href="/admin/chars/generate"
        className="inline-block text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80"
      >
        手动触发字源生成 →
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-paper rounded-lg p-4">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="text-2xl font-serif text-ink mt-1">{value}</div>
    </div>
  );
}
