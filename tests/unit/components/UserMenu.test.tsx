// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the zustand store so we can flip user.isAdmin per test.
const mockState: { user: { id: number; username: string; isAdmin?: boolean } | null } = { user: null };
vi.mock('@/lib/store', () => ({
  useAppStore: (selector: any) => selector(mockState),
}));

// Mock api-auth so logout doesn't make a network call.
vi.mock('@/lib/api-auth', () => ({
  logoutRequest: vi.fn(async () => undefined),
}));

import { UserMenu } from '@/components/UserMenu';

describe('UserMenu', () => {
  beforeEach(() => {
    mockState.user = null;
  });

  it('renders nothing when there is no user', () => {
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the 后台管理 entry when user.isAdmin is true', () => {
    mockState.user = { id: 1, username: 'admin', isAdmin: true };
    render(<UserMenu />);
    // Open the dropdown
    fireEvent.click(screen.getByRole('button', { name: /admin/ }));
    const link = screen.getByText('后台管理').closest('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/admin');
  });

  it('does NOT show the 后台管理 entry when user.isAdmin is false', () => {
    mockState.user = { id: 2, username: 'alice', isAdmin: false };
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    expect(screen.queryByText('后台管理')).toBeNull();
  });

  it('does NOT show the 后台管理 entry when user.isAdmin is undefined', () => {
    mockState.user = { id: 3, username: 'bob' };
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /bob/ }));
    expect(screen.queryByText('后台管理')).toBeNull();
  });
});
