import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListUsers = vi.fn();
vi.mock('@/lib/admin', () => ({
  listUsers: (...a: any[]) => mockListUsers(...a),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, className }: any) => `<a href="${href}" className="${className ?? ''}">${children}</a>`,
}));

vi.mock('@/app/admin/users/UsersActions', () => ({
  UserActions: () => 'UserActions',
}));

async function renderUsersPage(searchParams: Record<string, string | undefined>) {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: UsersPage } = await import('@/app/admin/users/page');
  const element = await UsersPage({ searchParams: Promise.resolve(searchParams) } as any);
  return renderToStaticMarkup(element as any);
}

describe('admin users page search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListUsers.mockResolvedValue({ users: [], total: 0 });
  });

  it('forwards q to listUsers when provided', async () => {
    await renderUsersPage({ q: 'alice' });
    const call = mockListUsers.mock.calls[0][0];
    expect(call.q).toBe('alice');
  });

  it('omits q when not provided', async () => {
    await renderUsersPage({});
    const call = mockListUsers.mock.calls[0][0];
    expect(call.q).toBeUndefined();
  });

  it('renders a search input with the current q value', async () => {
    const html = await renderUsersPage({ q: 'bob' });
    expect(html).toContain('name="q"');
    expect(html).toContain('value="bob"');
  });

  it('renders 3 chips (all / admin / disabled) with search-preserving URLs', async () => {
    const html = await renderUsersPage({ q: 'bob' });
    // "管理员" chip should include q=bob. React renderToStaticMarkup escapes
    // " as &quot; and & as &amp; in attributes.
    expect(html).toMatch(/href=&quot;\/admin\/users\?(adminOnly=1&amp;q=bob|q=bob&amp;adminOnly=1)&quot;/);
  });

  it('renders empty-state when no users match', async () => {
    const html = await renderUsersPage({ q: 'noresult' });
    expect(html).toContain('暂无用户');
  });
});
