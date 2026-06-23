import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedQuery = vi.fn();
const mockedExecute = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: mockedQuery, execute: mockedExecute }),
}));

import { listPaymentOrders } from '@/lib/payment-orders';

describe('listPaymentOrders', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedExecute.mockReset();
  });

  it('returns mapped rows + total, default ordering by created_at desc', async () => {
    const rows = [[
      { id: 1, user_id: 7, plan_id: 1, paypal_order_id: 'PAY-1', status: 'paid',
        amount: '15.00', currency: 'USD', approval_url: 'https://paypal.com/x',
        created_at: new Date('2026-06-20T00:00:00Z'), updated_at: new Date('2026-06-20T00:00:00Z'),
        paid_at: new Date('2026-06-20T00:01:00Z'),
        username: 'alice', plan_key: 'yearly_usd', plan_display_name: '年度会员' },
    ]];
    const totalRows = [[{ n: 1 }]];
    mockedQuery.mockResolvedValueOnce(rows).mockResolvedValueOnce(totalRows);

    const result = await listPaymentOrders({});
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 1, userId: 7, planId: 1, paypalOrderId: 'PAY-1', status: 'paid',
      amount: '15.00', currency: 'USD', paidAt: '2026-06-20T00:01:00.000Z',
      username: 'alice', planKey: 'yearly_usd', planDisplayName: '年度会员',
    });
    // Default ordering
    expect(mockedQuery.mock.calls[0][0]).toContain('ORDER BY po.created_at DESC');
    expect(mockedQuery.mock.calls[0][0]).toContain('LIMIT ? OFFSET ?');
    // Joins
    expect(mockedQuery.mock.calls[0][0]).toContain('LEFT JOIN users u');
    expect(mockedQuery.mock.calls[0][0]).toContain('LEFT JOIN membership_plans mp');
  });

  it('filters by status when supplied', async () => {
    mockedQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listPaymentOrders({ status: 'failed' });
    expect(mockedQuery.mock.calls[0][0]).toContain('po.status = ?');
    expect(mockedQuery.mock.calls[0][1][0]).toBe('failed');
  });

  it('filters by userId when supplied', async () => {
    mockedQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listPaymentOrders({ userId: 42 });
    expect(mockedQuery.mock.calls[0][0]).toContain('po.user_id = ?');
    expect(mockedQuery.mock.calls[0][1][0]).toBe(42);
  });

  it('partial-match search on paypal_order_id', async () => {
    mockedQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listPaymentOrders({ q: '9K12' });
    expect(mockedQuery.mock.calls[0][0]).toContain('po.paypal_order_id LIKE ?');
    expect(mockedQuery.mock.calls[0][1][0]).toBe('%9K12%');
  });

  it('applies page + pageSize via LIMIT/OFFSET', async () => {
    mockedQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listPaymentOrders({ page: 3, pageSize: 20 });
    // params: [limit, offset]
    expect(mockedQuery.mock.calls[0][1]).toEqual([20, 40]);
  });

  it('returns 0 total when no rows', async () => {
    mockedQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    const result = await listPaymentOrders({});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
