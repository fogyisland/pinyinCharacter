import Link from 'next/link';
import { listMemberships } from '@/lib/membership';
import { getMembershipStats } from '@/lib/membership-stats';
import { ManualGrantDrawer } from '@/components/admin/memberships/ManualGrantDrawer';
import { RevokeButton } from '@/components/admin/memberships/RevokeButton';
import { DataTable } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatCard } from '@/components/admin/StatCard';
import { FilterChip } from '@/components/admin/FilterChip';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { AdminLink } from '@/components/admin/AdminButton';
import { Crown, Users, TrendingUp, DollarSign } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ userId?: string; planKey?: string; page?: string }>;
}

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
    <div>
      <PageHeader
        title="会员"
        description="已开通的会员记录。开通来源、金额与到期时间都在这里,异常开通可手动撤销。"
        actions={
          <>
            <ManualGrantDrawer />
            <AdminLink href="/admin/memberships/orders" variant="secondary" size="sm">
              PayPal 订单
            </AdminLink>
            <AdminLink href="/admin/memberships/plans" variant="secondary" size="sm">
              套餐设置
            </AdminLink>
            <AdminLink href="/admin/memberships/config" variant="secondary" size="sm">
              支付配置
            </AdminLink>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="总开通" value={stats.total} icon={Crown} />
        <StatCard label="当前活跃" value={stats.active} icon={Users} />
        <StatCard label="本月新增" value={stats.newThisMonth} icon={TrendingUp} />
        <StatCard
          label="本月收入 (USD)"
          value={`$${stats.revenueThisMonth.toFixed(2)}`}
          icon={DollarSign}
        />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <FilterChip active={!userId && !planKey} href={buildHref({ userId, planKey })}>
          全部
        </FilterChip>
        {userId && (
          <FilterChip active={true} href={buildHref({ userId, planKey }, { userId: null })}>
            {`用户 #${userId} ×`}
          </FilterChip>
        )}
        {planKey && (
          <FilterChip active={true} href={buildHref({ userId, planKey }, { planKey: null })}>
            {`套餐 ${planKey} ×`}
          </FilterChip>
        )}
      </div>

      <Panel title="会员记录" description="按开通时间倒序排列的最新会员。" flush>
        <DataTable
          rows={list.items}
          rowKey={(r) => r.id}
          caption="会员开通记录"
          framed={false}
          empty={
            <EmptyState
              icon={Crown}
              title="暂无会员"
              description="还没有人开通会员。可以用右上角的「手动开通」为某个用户加会员。"
            />
          }
          columns={[
            { key: 'user', header: '用户', mobileTitle: true },
            { key: 'planKey', header: '套餐' },
            { key: 'source', header: '来源' },
            { key: 'amount', header: '金额', numeric: true },
            { key: 'grantedAt', header: '开通时间', numeric: true, mobileHide: true },
            { key: 'expiresAt', header: '到期', numeric: true, mobileHide: true },
            { key: 'status', header: '状态' },
            { key: 'actions', header: '操作', mobileHide: true },
          ]}
        >
          {(r) => (
            <>
              {r.username ? (
                <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                  {r.username}
                </Link>
              ) : (
                <span className="text-ink-faint">#{r.userId}</span>
              )}
              <span className="text-xs">{r.planKey}</span>
              <StatusBadge tone={r.source === 'paypal' ? 'success' : 'neutral'}>{r.source}</StatusBadge>
              <span className="text-xs">
                {r.amount != null ? `${r.currency === 'USD' ? '$' : '¥'}${r.amount}` : '—'}
              </span>
              <span className="text-xs text-ink-soft">{formatDateTime(r.grantedAt)}</span>
              <span className="text-xs">{formatDate(r.expiresAt)}</span>
              {r.revokedAt ? (
                <StatusBadge tone="danger">已撤销</StatusBadge>
              ) : (
                <StatusBadge tone="success">活跃</StatusBadge>
              )}
              {!r.revokedAt ? <RevokeButton membershipId={r.id} /> : null}
            </>
          )}
        </DataTable>
      </Panel>

      <div className="mt-4">
        <Pagination
          page={page}
          totalPages={totalPages}
          total={list.total}
          pageSize={PAGE_SIZE}
          buildHref={(target) => buildHref({ userId, planKey }, { page: String(target) })}
        />
      </div>
    </div>
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
  const u =
    override.userId !== undefined
      ? override.userId
      : base.userId !== undefined
        ? String(base.userId)
        : null;
  const p = override.planKey !== undefined ? override.planKey : (base.planKey ?? null);
  if (u) params.set('userId', u);
  if (p) params.set('planKey', p);
  if (override.page) params.set('page', override.page);
  const qs = params.toString();
  return qs ? `/admin/memberships?${qs}` : '/admin/memberships';
}
