import Link from 'next/link';
import { listMemberships } from '@/lib/membership';
import { getMembershipStats } from '@/lib/membership-stats';
import { ManualGrantDrawer } from '@/components/admin/memberships/ManualGrantDrawer';
import { RevokeButton } from '@/components/admin/memberships/RevokeButton';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import { Crown, Users, TrendingUp, DollarSign } from 'lucide-react';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface PageProps { searchParams: Promise<{ userId?: string; planKey?: string; page?: string }>; }

export default async function AdminMembershipsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const userId = sp.userId ? Number(sp.userId) : undefined;
  const planKey = sp.planKey ?? undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  const [stats, list] = await Promise.all([
    getMembershipStats(),
    listMemberships({ userId, planKey, page, pageSize: PAGE_SIZE }),
  ]);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">会员</h1>
        <div className="flex gap-2">
          <ManualGrantDrawer />
          <Link href="/admin/memberships/orders" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">PayPal 订单</Link>
          <Link href="/admin/memberships/plans" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">套餐设置</Link>
          <Link href="/admin/memberships/config" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">支付配置</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="总开通" value={stats.total} icon={Crown} />
        <Stat label="当前活跃" value={stats.active} icon={Users} />
        <Stat label="本月新增" value={stats.newThisMonth} icon={TrendingUp} />
        <Stat label="本月收入 (USD)" value={`$${stats.revenueThisMonth.toFixed(2)}`} icon={DollarSign} />
      </div>

      <div className="card-paper rounded-lg p-3 flex flex-wrap gap-2 items-end text-sm">
        <FilterChip active={!userId && !planKey} href={buildHref({ userId, planKey })}>全部</FilterChip>
        {userId && <FilterChip active={true} href={buildHref({ userId, planKey }, { userId: null })}>{`用户 #${userId} ×`}</FilterChip>}
        {planKey && <FilterChip active={true} href={buildHref({ userId, planKey }, { planKey: null })}>{`套餐 ${planKey} ×`}</FilterChip>}
      </div>

      <ResponsiveTable
        rows={list.items}
        rowKey={(r) => r.id}
        emptyMessage="暂无会员"
        columns={[
          { key: 'user', header: '用户', mobileTitle: true },
          { key: 'planKey', header: '套餐' },
          { key: 'source', header: '来源' },
          { key: 'amount', header: '金额' },
          { key: 'grantedAt', header: '开通时间', mobileHide: true },
          { key: 'expiresAt', header: '到期', mobileHide: true },
          { key: 'status', header: '状态' },
          { key: 'actions', header: '操作', mobileHide: true },
        ]}
      >
        {(r) => (
          <>
            {r.username
              ? <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">{r.username}</Link>
              : <span className="text-ink-faint">#{r.userId}</span>}
            <span className="text-xs">{r.planKey}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${r.source === 'paypal' ? 'bg-green-100 text-green-800' : 'bg-paper-deep text-ink-soft'}`}>{r.source}</span>
            <span className="text-xs">{r.amount != null ? `${r.currency === 'USD' ? '$' : '¥'}${r.amount}` : '—'}</span>
            <span className="text-xs text-ink-soft">{new Date(r.grantedAt).toLocaleString('zh-CN')}</span>
            <span className="text-xs">{new Date(r.expiresAt).toLocaleDateString('zh-CN')}</span>
            {r.revokedAt
              ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">已撤销</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">活跃</span>}
            {!r.revokedAt ? <RevokeButton membershipId={r.id} /> : null}
          </>
        )}
      </ResponsiveTable>

      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>共 {list.total} 条 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <Link href={buildHref({ userId, planKey }, { page: String(Math.max(1, page - 1)) })}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}>上一页</Link>
          <Link href={buildHref({ userId, planKey }, { page: String(Math.min(totalPages, page + 1)) })}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}>下一页</Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-lg border border-paper-warm bg-paper p-4 flex items-center gap-3">
      <Icon className="h-6 w-6 text-seal shrink-0" />
      <div>
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-2xl font-serif text-ink">{value}</div>
      </div>
    </div>
  );
}

function FilterChip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`text-xs px-3 py-1.5 rounded border transition-colors ${
      active ? 'bg-ink text-paper border-ink' : 'border-paper-warm text-ink hover:bg-paper-warm'
    }`}>{children}</Link>
  );
}

function buildHref(
  base: { userId?: number; planKey?: string },
  override: { userId?: string | null; planKey?: string | null; page?: string } = {},
) {
  // Active filters flow into every nav link. `override` only changes fields
  // explicitly passed; null means "remove this field", undefined means
  // "inherit from base".
  const params = new URLSearchParams();
  const u = override.userId !== undefined ? override.userId : base.userId !== undefined ? String(base.userId) : null;
  const p = override.planKey !== undefined ? override.planKey : base.planKey ?? null;
  if (u) params.set('userId', u);
  if (p) params.set('planKey', p);
  if (override.page) params.set('page', override.page);
  const qs = params.toString();
  return qs ? `/admin/memberships?${qs}` : '/admin/memberships';
}
