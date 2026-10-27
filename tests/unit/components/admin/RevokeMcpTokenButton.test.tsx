// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * The revoke button of the admin's MCP page.
 *
 * The button is the page's only primary action, and it sits in front of a
 * two-step confirmation: the operator presses 吊销, then 确认. What matters
 * here is what happens when the request fails — the operator has to be
 * told, and the button has to come back to life. A failure that leaves
 * the button disabled forever says nothing about whether the token was
 * revoked.
 */

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/api-admin', () => ({
  revokeAdminMcpTokenRequest: vi.fn(),
}));

import { RevokeMcpTokenButton } from '@/components/admin/mcp/RevokeMcpTokenButton';
import { revokeAdminMcpTokenRequest } from '@/lib/api-admin';

const revokeMock = vi.mocked(revokeAdminMcpTokenRequest);

beforeEach(() => {
  cleanup();
  refresh.mockReset();
  revokeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

/** Press 吊销 and then 确认 — the two steps of the confirmation. */
async function confirmRevoke(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '吊销' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
}

describe('RevokeMcpTokenButton', () => {
  it('asks before it revokes', () => {
    render(<RevokeMcpTokenButton userId={7} username="tester" />);
    expect(screen.getByRole('button', { name: '吊销' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '吊销' }));
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('revokes the token and refreshes the page', async () => {
    revokeMock.mockResolvedValue({
      ok: true,
      data: { userId: 7, username: 'tester', revokedAt: '2026-10-27T09:00:00.000Z' },
    });
    render(<RevokeMcpTokenButton userId={7} username="tester" />);

    await confirmRevoke();

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(7));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('shows the message of a failed request and comes back to life', async () => {
    revokeMock.mockResolvedValue({
      ok: false,
      error: { code: 'user_not_found', message: '没有这个用户' },
    });
    render(<RevokeMcpTokenButton userId={7} username="tester" />);

    await confirmRevoke();

    await waitFor(() => expect(screen.getByText('没有这个用户')).toBeInTheDocument());
    // The button must not stay disabled — the operator has to be able to
    // try again.
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports a request that never reached the server', async () => {
    revokeMock.mockRejectedValue(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<RevokeMcpTokenButton userId={7} username="tester" />);

      await confirmRevoke();

      await waitFor(() => expect(screen.getByText('吊销请求失败，请重试')).toBeInTheDocument());
      expect(consoleError).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '确认' })).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
