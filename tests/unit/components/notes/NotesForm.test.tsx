// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/dom';
import { NotesForm } from '@/components/notes/NotesForm';

describe('NotesForm', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders name + email + content fields + submit button', () => {
    render(<NotesForm onPosted={() => {}} />);
    expect(screen.getByLabelText(/姓名/)).toBeTruthy();
    expect(screen.getByLabelText(/邮箱/)).toBeTruthy();
    expect(screen.getByLabelText(/内容/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /发布/ })).toBeTruthy();
  });

  it('posts via fetch on submit and calls onPosted with id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { id: 99 } }),
    }));
    global.fetch = fetchMock as any;
    const cb = vi.fn();
    render(<NotesForm onPosted={cb} />);
    fireEvent.input(screen.getByLabelText(/姓名/), { target: { value: '测试者' } });
    fireEvent.input(screen.getByLabelText(/内容/), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /发布/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(cb).toHaveBeenCalledWith(99));
    const url = (fetchMock.mock.calls[0] as any)[0];
    expect(url).toBe('/api/notes');
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(JSON.parse(init.body)).toMatchObject({ name: '测试者', content: 'hello' });
  });

  it('disables button + shows error text when API returns rate_limited', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 429, json: async () => ({
        ok: false, error: { code: 'rate_limited', message: '请稍后再试' },
      }),
    })) as any;
    render(<NotesForm onPosted={() => {}} />);
    fireEvent.input(screen.getByLabelText(/姓名/), { target: { value: 'X' } });
    fireEvent.input(screen.getByLabelText(/内容/), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: /发布/ }));
    await waitFor(() => expect(screen.getByText(/请稍后再试/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /发布/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});