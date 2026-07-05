// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/settings/notes',
}));

import { NotesEmailForm } from '@/components/admin/NotesEmailForm';

describe('NotesEmailForm', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders label + input + save button (empty value)', () => {
    render(<NotesEmailForm initial={{ adminEmails: '' }} />);
    // Form uses a plain <label> + <input> without `for`/`id` pairing,
    // so query the input by placeholder instead.
    expect(screen.getByPlaceholderText(/admin@example.com/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // No warning text in empty state.
    expect(screen.queryByText(/请检查邮箱格式/)).toBeNull();
    expect(screen.queryByText(/将通知 \d+ 个邮箱/)).toBeNull();
  });

  it('shows count hint + enables submit when value has valid emails', () => {
    render(<NotesEmailForm initial={{ adminEmails: 'admin@example.com, dev@example.com' }} />);
    expect(screen.getByText(/将通知 2 个邮箱/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // No yellow warning when at least one email is valid.
    expect(screen.queryByText(/请检查邮箱格式/)).toBeNull();
  });

  it('shows yellow warning + disables submit when value is all-invalid (",,")', () => {
    render(<NotesEmailForm initial={{ adminEmails: 'a, b, c' }} />);
    // 'a', 'b', 'c' are not valid emails (no @).
    expect(screen.getByText(/请检查邮箱格式,当前 0 个有效地址/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('warns on a single bare value with no @', () => {
    render(<NotesEmailForm initial={{ adminEmails: 'not-an-email' }} />);
    expect(screen.getByText(/请检查邮箱格式,当前 0 个有效地址/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('reflects validCount when value contains mix of valid + invalid', () => {
    // 'foo, admin@example.com' → 1 invalid ('foo'), 1 valid → validCount=1, not 0.
    render(<NotesEmailForm initial={{ adminEmails: 'foo, admin@example.com' }} />);
    // Because validCount > 0, no warning is shown.
    expect(screen.queryByText(/请检查邮箱格式/)).toBeNull();
    expect(screen.getByText(/将通知 1 个邮箱/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('sends POST on save with the configured value', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { adminEmails: 'admin@example.com', count: 1 } }),
    }));
    global.fetch = fetchMock as any;
    render(<NotesEmailForm initial={{ adminEmails: 'admin@example.com' }} />);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = (fetchMock.mock.calls[0] as any)[0];
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(url).toBe('/api/admin/settings/notes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ adminEmails: 'admin@example.com' });
  });
});