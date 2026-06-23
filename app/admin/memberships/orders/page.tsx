import Link from 'next/link';
import { listPaymentOrders, type PaymentOrderStatus } from '@/lib/payment-orders';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const STATUSES: { key: PaymentOrderStatus; label: string }[] = [
  { key: 'created', label: '已创建' },
  { key: 'approved', label: '已批准' },
  { key: 'paid', label: '已支付' },
  { key: 'failed', label: '失败' },
  { key: 'expired', label: '已过期' },
];

const STATUS_BADGE: Record<PaymentOrderStatus, string> = {
  created: 'bg-paper-deep text-ink-soft',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-seal/15 text-seal',
  expired: 'bg-gray-200 text-gray-700',
};

interface PageProps { searchParams: Promise<{ status?: string; userId?: string; q?: string; page?: string }>; }

export default async function AdminOrdersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = (STATUSES.some(s => s.key === sp.status) ? sp.status : undefined) as PaymentOrderStatus | undefined;
  const userId = sp.userId && /^\d+$/.test(sp.userId) ? Number(sp.userId) : undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  const list = await listPaymentOrders({ status, userId, q, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">PayPal 订单</h1>
          <p className="text-sm text-ink-soft">查看支付订单状态、调试 webhook 失败、追踪卡在 created/approved 状态的订单。</p>
        </div>
        <Link href="/admin/memberships" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 返回会员列表</Link>
      </div>

      <form className="card-paper rounded p-3 flex flex-wrap gap-2 items-end text-sm" method="get">
        <FilterChip
          active={!status && !userId && !q}
          href="/admin/memberships/orders"
        >全部</FilterChip>
        {STATUSES.map(s => (
          <FilterChip
            key={s.key}
            active={status === s.key}
            href={buildHref({ status: s.key, userId, q, page: 1 })}
          >{s.label}</FilterChip>
        ))}
        {status && <FilterChip active={true} href={buildHref({ status: null, userId, q, page: 1 })}>×</FilterChip>}
      </form>

      <form className="card-paper rounded p-3 flex flex-wrap gap-2 items-end text-sm" method="get">
        <input type="number" name="userId" placeholder="用户 ID" defaultValue={userId ?? ''}
          className="border border-ink/20 rounded px-2 py-1 w-24 bg-paper-soft" />
        <input type="text" name="q" placeholder="PayPal 订单号" defaultValue={q ?? ''}
          className="border border-ink/20 rounded px-2 py-1 w-48 bg-paper-soft" />
        <button type="submit" className="btn-seal text-sm">筛选</button>
        <Link href="/admin/memberships/orders" className="px-3 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep">清空</Link>
      </form>

      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">创建时间</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">套餐</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">PayPal 订单号</th>
              <th className="px-3 py-2">支付时间</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">
                  {r.username
                    ? <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">{r.username}</Link>
                    : <span className="text-ink-faint">#{r.userId}</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div>{r.planDisplayName || '—'}</div>
                  <div className="text-ink-faint">{r.planKey}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-3 py-2 text-xs">{r.currency === 'USD' ? '$' : '¥'}{r.amount}</td>
                <td className="px-3 py-2 text-xs font-mono text-ink-soft max-w-xs truncate" title={r.paypalOrderId}>{r.paypalOrderId}</td>
                <td className="px-3 py-2 text-xs text-ink-soft">{r.paidAt ? new Date(r.paidAt).toLocaleString('zh-CN') : '—'}</td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-faint">暂无订单</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>共 {list.total} 条 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <Link href={buildHref({ status: status ?? null, userId, q, page: Math.max(1, page - 1) })}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}>上一页</Link>
          <Link href={buildHref({ status: status ?? null, userId, q, page: Math.min(totalPages, page + 1) })}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}>下一页</Link>
        </div>
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

function buildHref(opts: { status: PaymentOrderStatus | null; userId?: number; q?: string; page: number }) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.userId !== undefined) params.set('userId', String(opts.userId));
  if (opts.q) params.set('q', opts.q);
  if (opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `/admin/memberships/orders?${qs}` : '/admin/memberships/orders';
}
