// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/dom';
import { NotesAdminClient } from '@/components/notes/NotesAdminClient';

const SAMPLE = [
  { id: 1, authorName: 'Alice', authorEmail: 'a@b.com', content: 'hi', createdAt: '2026-07-05T08:00:00Z', deletedAt: null },
  { id: 2, authorName: 'Bob',   authorEmail: null,     content: 'hey', createdAt: '2026-07-04T08:00:00Z', deletedAt: '2026-07-04T10:00:00Z' },
];

describe('NotesAdminClient', () => {
  beforeEach(() => {
    cleanup();
    // happy-dom doesn't stub window.confirm; NotesAdminClient uses native confirm().
    vi.stubGlobal('confirm', () => true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders table of all notes incl. deleted', () => {
    render(<NotesAdminClient initial={SAMPLE as any} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    // Bob is already deleted in SAMPLE, so only Alice has a delete button.
    expect(screen.getAllByRole('button', { name: /删除/ }).length).toBe(1);
  });

  it('sends DELETE on click + marks deleted note as deleted (button hidden)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: true, data: { id: 1 } }),
    }));
    global.fetch = fetchMock as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    // Alice row (id=1): Bob is already deleted in SAMPLE so only Alice has a delete button.
    const buttons = screen.getAllByRole('button', { name: /删除/ });
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/notes/1', expect.objectContaining({ method: 'DELETE' })));
    // After delete: Alice's row should be marked 已删除 and her delete button should be gone.
    await waitFor(() => {
      // Bob (initial deleted) + Alice (after delete) both show 已删除; text is split across
      // nodes ("已删除 " + formatted time), so use a regex to be flexible.
      expect(screen.getAllByText(/已删除/).length).toBeGreaterThanOrEqual(2);
      expect(screen.queryAllByRole('button', { name: /删除/ }).length).toBe(0);
    });
  });

  it('shows error when DELETE fails with 404', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'not found' } }),
    })) as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]);
    await waitFor(() => expect(screen.getByText(/not found/)).toBeTruthy());
  });

  it('shows "请重新登录" when DELETE returns 401', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ ok: false, error: { code: 'unauthenticated', message: 'login required' } }),
    })) as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]);
    await waitFor(() => expect(screen.getByText(/请重新登录/)).toBeTruthy());
  });

  it('shows "服务器错误" when DELETE returns 5xx', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 503, json: async () => ({}),
    })) as any;
    render(<NotesAdminClient initial={SAMPLE as any} />);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]);
    await waitFor(() => expect(screen.getByText(/服务器错误,请稍后重试/)).toBeTruthy());
  });
});