import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMemberships = vi.fn();
const mockGetMembershipStats = vi.fn();
vi.mock('@/lib/membership', () => ({
  listMemberships: (...a: any[]) => mockListMemberships(...a),
}));
vi.mock('@/lib/membership-stats', () => ({
  getMembershipStats: (...a: any[]) => mockGetMembershipStats(...a),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => `<a href="${href}">${children}</a>`,
}));

vi.mock('@/components/admin/memberships/ManualGrantDrawer', () => ({
  ManualGrantDrawer: () => 'ManualGrantDrawer',
}));
vi.mock('@/components/admin/memberships/RevokeButton', () => ({
  RevokeButton: () => 'RevokeButton',
}));

async function renderMembershipsPage(searchParams: Record<string, string | undefined>) {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: AdminMembershipsPage } = await import('@/app/admin/memberships/page');
  const element = await AdminMembershipsPage({
    searchParams: Promise.resolve(searchParams),
  } as any);
  return renderToStaticMarkup(element as any);
}

describe('admin memberships page chip + pagination URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembershipStats.mockResolvedValue({
      total: 0, active: 0, newThisMonth: 0, revenueThisMonth: 0,
    });
    mockListMemberships.mockResolvedValue({ items: [], total: 0 });
  });

  it('no per-user chip rendered when no userId selected', async () => {
    const html = await renderMembershipsPage({});
    expect(html).not.toContain('用户 #');
    expect(html).not.toContain('套餐 ');
    expect(html).not.toContain('?userId=');
    expect(html).not.toContain('?planKey=');
  });

  it('"用户 #N ×" remove chip clears userId while keeping planKey', async () => {
    const html = await renderMembershipsPage({ userId: '42', planKey: 'yearly_usd' });
    expect(html).toContain('用户 #42 ×');
    // The remove chip should drop userId and keep planKey so the other
    // filter survives the click.
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?planKey=yearly_usd&quot;/);
  });

  it('"套餐 K ×" remove chip clears planKey while keeping userId', async () => {
    const html = await renderMembershipsPage({ userId: '42', planKey: 'yearly_usd' });
    expect(html).toContain('套餐 yearly_usd ×');
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?userId=42&quot;/);
  });

  it('pagination preserves userId filter', async () => {
    mockListMemberships.mockResolvedValue({
      items: [], total: 150,
    });
    const html = await renderMembershipsPage({ userId: '7', page: '2' });
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?[^&]*userId=7/);
  });

  it('pagination preserves planKey filter', async () => {
    mockListMemberships.mockResolvedValue({
      items: [], total: 150,
    });
    const html = await renderMembershipsPage({ planKey: 'monthly_usd', page: '2' });
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?[^&]*planKey=monthly_usd/);
  });

  it('pagination preserves both filters when present', async () => {
    mockListMemberships.mockResolvedValue({
      items: [], total: 200,
    });
    const html = await renderMembershipsPage({ userId: '7', planKey: 'yearly_usd', page: '2' });
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?[^&]*userId=7/);
    expect(html).toMatch(/href=&quot;\/admin\/memberships\?[^&]*planKey=yearly_usd/);
  });
});
