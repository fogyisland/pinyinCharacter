import { getSystemStats } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const s = await getSystemStats();
  const cards = [
    { label: '总用户数', value: s.users },
    { label: '管理员', value: s.admins },
    { label: '历史记录', value: s.history },
    { label: '收藏', value: s.favorites },
    { label: '审计事件', value: s.audit },
  ];
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">系统统计</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card-paper rounded-lg p-4">
            <div className="text-sm text-ink-faint">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
