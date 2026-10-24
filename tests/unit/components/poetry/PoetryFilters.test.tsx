// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { PoetryFilters } from '@/components/poetry/PoetryFilters';
import type { PoetryQuery } from '@/lib/poetry-url';

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}));

const QUERY: PoetryQuery = { dynasty: 'tang', q: '', forms: [], page: 1 };
const FORMS = ['五律', '七律'];

function renderFilters(query: PoetryQuery = QUERY) {
  return render(<PoetryFilters query={query} availableForms={FORMS} />);
}

beforeEach(() => {
  cleanup();
  routerMock.replace.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PoetryFilters', () => {
  it('shows the current filter state', () => {
    renderFilters({ dynasty: 'song', q: '静夜思', forms: ['五律'], page: 1 });
    expect((screen.getByPlaceholderText('搜索标题或作者...') as HTMLInputElement).value).toBe(
      '静夜思',
    );
    expect(screen.getByText('宋词').className).toContain('text-seal');
    expect(screen.getByText('五律').className).toContain('bg-ink');
  });

  it('navigates once the search input settled', () => {
    renderFilters();
    fireEvent.change(screen.getByPlaceholderText('搜索标题或作者...'), {
      target: { value: '静夜思' },
    });
    expect(routerMock.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace.mock.calls[0][0]).toBe(
      '/poetry?dynasty=tang&q=%E9%9D%99%E5%A4%9C%E6%80%9D',
    );
  });

  it('does not navigate while the search term is unchanged', () => {
    const { rerender } = renderFilters();
    fireEvent.change(screen.getByPlaceholderText('搜索标题或作者...'), {
      target: { value: '静夜思' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(routerMock.replace).toHaveBeenCalledTimes(1);

    // The server echoes the search term back as the `q` prop.
    rerender(
      <PoetryFilters query={{ ...QUERY, q: '静夜思' }} availableForms={FORMS} />,
    );
    routerMock.replace.mockClear();

    fireEvent.change(screen.getByPlaceholderText('搜索标题或作者...'), {
      target: { value: '静夜思 ' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('switches the dynasty and drops the form filter', () => {
    renderFilters({ dynasty: 'tang', q: '', forms: ['五律'], page: 2 });
    fireEvent.click(screen.getByText('宋词'));

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace.mock.calls[0][0]).toBe('/poetry?dynasty=song');
  });

  it('adds a form to the query string', () => {
    renderFilters();
    fireEvent.click(screen.getByText('五律'));

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace.mock.calls[0][0]).toBe(
      '/poetry?dynasty=tang&form=%E4%BA%94%E5%BE%8B',
    );
  });
});
