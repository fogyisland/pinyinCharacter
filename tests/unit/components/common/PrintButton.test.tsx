// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the zustand store so we can flip user per test.
const mockState: { user: { id: number; username: string; isAdmin?: boolean } | null } = { user: null };
vi.mock('@/lib/store', () => ({
  useAppStore: (selector: any) => selector(mockState),
}));

import { PrintButton } from '@/components/common/PrintButton';

describe('PrintButton', () => {
  beforeEach(() => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { id: 1 } }) });
    (global as any).window.print = vi.fn();
    mockState.user = null;
  });

  it('calls the endpoint and window.print on click', async () => {
    mockState.user = { id: 1, username: 'alice' };
    render(<PrintButton endpoint="/api/poetry/1/print" label="打印" />);
    fireEvent.click(screen.getByText('打印'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/poetry/1/print', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it('renders a login Link instead of the button when user is null', () => {
    render(<PrintButton endpoint="/api/poetry/1/print" label="打印" />);
    const link = screen.getByRole('link', { name: /登录后打印/ });
    expect(link).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: '打印' })).toBeNull();
  });

  it('appends ?redirect=<loginRedirect> when loginRedirect is provided', () => {
    render(
      <PrintButton endpoint="/api/poetry/7/print" label="打印" loginRedirect="/poetry/7" />,
    );
    const link = screen.getByRole('link', { name: /登录后打印/ });
    expect(link).toHaveAttribute('href', '/login?redirect=%2Fpoetry%2F7');
  });

  it('renders the real button when user is set', () => {
    mockState.user = { id: 2, username: 'bob' };
    render(<PrintButton endpoint="/api/poetry/1/print" label="打印" />);
    expect(screen.getByRole('button', { name: '打印' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /登录后打印/ })).toBeNull();
  });
});