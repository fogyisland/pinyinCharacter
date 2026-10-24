import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { listPaymentOrders, type PaymentOrderStatus } from '@/lib/payment-orders';
import { Pagination } from '@/components/admin/Pagination';
import { DataTable } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { Toolbar } from '@/components/admin/Toolbar';
import { FilterChip } from '@/components/admin/FilterChip';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { AdminButton, AdminLink } from '@/components/admin/AdminButton';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const STATUSES: { key: PaymentOrderStatus; label: string }[] = [
  { key: 'created', label: '已创建' },
  { key: 'approved', label: '已批准' },
  { key: 'paid', label: '已支付' },
  { key: 'failed', label: '失败' },
  { key: 'expired', label: '已过期' },
];

const STATUS_TONE: Record<PaymentOrderStatus, BadgeTone> = {
  created: 'neutral',
  approved: 'info',
  paid: 'success',
  failed: 'danger',
  expired: 'warning',
};

interface PageProps {
  searchParams: Promise<{ status?: string; userId?: string; q?: string; page?: string }>;
}

export default async function AdminOrdersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = (STATUSES.some((s) => s.key === sp.status) ? sp.status : undefined) as
    PaymentOrderStatus | undefined;
  const userId = sp.userId && /^\d+$/.test(sp.userId) ? Number(sp.userId) : undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  const list = await listPaymentOrders({ status, userId, q, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="PayPal 订单"
        description="查看支付订单状态、调试 webhook 失败、追踪卡在 created/approved 状态的订单。"
        actions={
          <AdminLink href="/admin/memberships" variant="secondary" size="sm">
            ← 返回会员列表
          </AdminLink>
        }
      />

      <form className="flex gap-2 mb-4 flex-wrap" method="get">
        <FilterChip active={!status && !userId && !q} href="/admin/memberships/orders">
          全部
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip
            key={s.key}
            active={status === s.key}
            href={buildHref({ status: s.key, userId, q, page: 1 })}
          >
            {s.label}
          </FilterChip>
        ))}
        {status && (
          <FilterChip active={true} href={buildHref({ status: null, userId, q, page: 1 })}>
            ×
          </FilterChip>
        )}
      </form>

      <Toolbar className="mb-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <div className="w-28">
            <input
              type="number"
              name="userId"
              placeholder="用户 ID"
              defaultValue={userId ?? ''}
              aria-label="用户 ID"
              className="adm-input"
            />
          </div>
          <div className="w-56">
            <input
              type="text"
              name="q"
              placeholder="PayPal 订单号"
              defaultValue={q ?? ''}
              aria-label="PayPal 订单号"
              className="adm-input"
            />
          </div>
          <AdminButton type="submit" variant="primary">
            筛选
          </AdminButton>
          <AdminLink href="/admin/memberships/orders" variant="ghost" size="md">
            清空
          </AdminLink>
        </form>
      </Toolbar>

      <Panel title="订单" description="按创建时间倒序排列的支付订单。" flush>
        <DataTable
          rows={list.items}
          rowKey={(r) => r.id}
          caption="PayPal 订单列表"
          framed={false}
          empty={
            <EmptyState
              icon={Receipt}
              title="暂无订单"
              description="还没有 PayPal 订单。换一个状态或订单号再试。"
            />
          }
          columns={[
            { key: 'createdAt', header: '创建时间', numeric: true },
            { key: 'user', header: '用户', mobileTitle: true },
            { key: 'plan', header: '套餐' },
            { key: 'status', header: '状态' },
            { key: 'amount', header: '金额', numeric: true },
            { key: 'paypalOrderId', header: 'PayPal 订单号', mobileHide: true },
            { key: 'paidAt', header: '支付时间', numeric: true, mobileHide: true },
          ]}
        >
          {(r) => (
            <>
              <span className="text-xs text-ink-soft whitespace-nowrap">
                {formatDateTime(r.createdAt)}
              </span>
              {r.username ? (
                <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                  {r.username}
                </Link>
              ) : (
                <span className="text-ink-faint">#{r.userId}</span>
              )}
              <span className="text-xs">
                <span className="block">{r.planDisplayName || '—'}</span>
                <span className="block text-ink-faint">{r.planKey}</span>
              </span>
              <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
              <span className="text-xs">
                {r.currency === 'USD' ? '$' : '¥'}
                {r.amount}
              </span>
              <span
                className="text-xs font-mono text-ink-soft max-w-xs truncate"
                title={r.paypalOrderId}
              >
                {r.paypalOrderId}
              </span>
              <span className="text-xs text-ink-soft">
                {r.paidAt ? formatDateTime(r.paidAt) : '—'}
              </span>
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
          buildHref={(target) =>
            buildHref({ status: status ?? null, userId, q, page: target })
          }
        />
      </div>
    </div>
  );
}

function buildHref(opts: {
  status: PaymentOrderStatus | null;
  userId?: number;
  q?: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.userId !== undefined) params.set('userId', String(opts.userId));
  if (opts.q) params.set('q', opts.q);
  if (opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `/admin/memberships/orders?${qs}` : '/admin/memberships/orders';
}
