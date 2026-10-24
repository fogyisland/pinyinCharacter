// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { SutraSearch } from '@/components/sutra/SutraSearch';

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}));

beforeEach(() => {
  cleanup();
  routerMock.replace.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SutraSearch', () => {
  it('shows the current search term', () => {
    render(<SutraSearch query={{ q: '金刚经', page: 1 }} />);
    expect((screen.getByPlaceholderText('搜索经名...') as HTMLInputElement).value).toBe('金刚经');
  });

  it('navigates once the search term settled', () => {
    render(<SutraSearch query={{ q: '', page: 1 }} />);
    fireEvent.change(screen.getByPlaceholderText('搜索经名...'), {
      target: { value: '金刚经' },
    });
    expect(routerMock.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace.mock.calls[0][0]).toBe('/sutra?q=%E9%87%91%E5%88%9A%E7%BB%8F');
  });

  it('goes back to the first page when the term changes', () => {
    render(<SutraSearch query={{ q: '', page: 4 }} />);
    fireEvent.change(screen.getByPlaceholderText('搜索经名...'), {
      target: { value: '心经' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerMock.replace.mock.calls[0][0]).toBe('/sutra?q=%E5%BF%83%E7%BB%8F');
  });

  it('does not navigate while the term is unchanged', () => {
    const { rerender } = render(<SutraSearch query={{ q: '', page: 1 }} />);
    fireEvent.change(screen.getByPlaceholderText('搜索经名...'), {
      target: { value: '心经' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(routerMock.replace).toHaveBeenCalledTimes(1);

    // The server echoes the search term back as the `q` prop.
    rerender(<SutraSearch query={{ q: '心经', page: 1 }} />);
    routerMock.replace.mockClear();

    fireEvent.change(screen.getByPlaceholderText('搜索经名...'), {
      target: { value: '心经 ' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
