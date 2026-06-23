import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListPaymentOrders = vi.fn();
vi.mock('@/lib/payment-orders', () => ({
  listPaymentOrders: (...a: any[]) => mockListPaymentOrders(...a),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, className }: any) => `<a href="${href}" className="${className ?? ''}">${children}</a>`,
}));

async function renderOrdersPage(searchParams: Record<string, string | undefined>) {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: OrdersPage } = await import('@/app/admin/memberships/orders/page');
  const element = await OrdersPage({
    searchParams: Promise.resolve(searchParams),
  } as any);
  return renderToStaticMarkup(element as any);
}

describe('admin payment orders page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPaymentOrders.mockResolvedValue({
      items: [], total: 0, page: 1, pageSize: 50,
    });
  });

  it('passes search filters to listPaymentOrders', async () => {
    await renderOrdersPage({ status: 'paid', userId: '7', q: '9K12' });
    expect(mockListPaymentOrders).toHaveBeenCalledWith(expect.objectContaining({
      status: 'paid', userId: 7, q: '9K12',
    }));
  });

  it('omits userId when not a valid number', async () => {
    await renderOrdersPage({ userId: 'abc' });
    const call = mockListPaymentOrders.mock.calls[0][0];
    expect(call.userId).toBeUndefined();
  });

  it('renders an empty-state row when total=0', async () => {
    const html = await renderOrdersPage({});
    expect(html).toContain('暂无订单');
  });

  it('renders one row per order with status badge + amount + plan', async () => {
    mockListPaymentOrders.mockResolvedValue({
      items: [{
        id: 1, userId: 7, planId: 1, paypalOrderId: '9K12XYZ',
        status: 'paid', amount: '15.00', currency: 'USD',
        approvalUrl: 'https://paypal.com/x',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
        paidAt: '2026-06-20T00:01:00.000Z',
        username: 'alice', planKey: 'yearly_usd', planDisplayName: '年度会员',
      }],
      total: 1, page: 1, pageSize: 50,
    });
    const html = await renderOrdersPage({});
    expect(html).toContain('alice');
    expect(html).toContain('9K12XYZ');
    expect(html).toContain('paid');
    expect(html).toContain('年度会员');
    expect(html).toContain('$15.00');
  });

  it('renders a status filter chip for each of the 5 statuses', async () => {
    const html = await renderOrdersPage({});
    // All 5 statuses get a chip — chips are label-keyed, not value-keyed.
    for (const s of ['已创建', '已批准', '已支付', '失败', '已过期']) {
      expect(html).toContain(s);
    }
  });

  it('active status chip is marked active when query matches', async () => {
    mockListPaymentOrders.mockResolvedValue({
      items: [{
        id: 1, userId: 7, planId: 1, paypalOrderId: '9K12XYZ',
        status: 'paid', amount: '15.00', currency: 'USD', approvalUrl: null,
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
        paidAt: '2026-06-20T00:01:00.000Z',
        username: 'alice', planKey: 'yearly_usd', planDisplayName: '年度会员',
      }],
      total: 1, page: 1, pageSize: 50,
    });
    const html = await renderOrdersPage({ status: 'paid' });
    // Active chip uses bg-ink class
    expect(html).toContain('bg-ink');
    // The clear chip (×) appears because a status is set
    expect(html).toContain('×');
  });
});
