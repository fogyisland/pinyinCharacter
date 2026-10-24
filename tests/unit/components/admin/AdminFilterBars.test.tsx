// @vitest-environment happy-dom
/**
 * Tests for the admin filter bars.
 *
 * The filter bars are the only client code left on the /admin/logs,
 * /admin/downloads and /admin/ai pages: they turn the form into a query
 * string and navigate to it. A wrong href would silently drop a filter, so
 * the built URL is pinned here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

import { LogsFilterBar } from '@/components/admin/LogsFilterBar';
import { DownloadsFilterBar } from '@/components/admin/DownloadsFilterBar';
import { AiCallsFilterBar } from '@/components/admin/AiCallsFilterBar';
import { parseLogsQuery } from '@/lib/admin-logs-url';
import { parseDownloadsQuery } from '@/lib/admin-downloads-url';
import { parseAiCallsQuery } from '@/lib/admin-ai-url';

describe('the admin filter bars', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('the logs bar shows the current filter state', () => {
    const query = parseLogsQuery({ source: 'audit', type: 'login', userId: '7' });
    render(<LogsFilterBar query={query} />);
    expect((screen.getByLabelText('来源') as HTMLSelectElement).value).toBe('audit');
    expect((screen.getByLabelText('事件') as HTMLSelectElement).value).toBe('login');
    expect((screen.getByLabelText('用户 ID') as HTMLInputElement).value).toBe('7');
  });

  it('the logs bar navigates to the filtered URL', () => {
    const query = parseLogsQuery({});
    render(<LogsFilterBar query={query} />);
    fireEvent.change(screen.getByLabelText('来源'), { target: { value: 'download' } });
    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '10.0.0.1' } });
    fireEvent.submit(screen.getByRole('button', { name: '筛选' }).closest('form')!);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const href = pushMock.mock.calls[0][0] as string;
    const params = new URLSearchParams(href.slice('/admin/logs?'.length));
    expect(params.get('source')).toBe('download');
    expect(params.get('ip')).toBe('10.0.0.1');
    // The page number is reset by a new filter.
    expect(params.get('page')).toBeNull();
  });

  it('the logs bar resets to the default URL', () => {
    const query = parseLogsQuery({ source: 'audit' });
    render(<LogsFilterBar query={query} />);
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(pushMock).toHaveBeenCalledWith('/admin/logs');
  });

  it('the downloads bar navigates to the filtered URL', () => {
    const query = parseDownloadsQuery({});
    render(<DownloadsFilterBar query={query} />);
    fireEvent.change(screen.getByLabelText('来源类型'), { target: { value: 'poem' } });
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: '12' } });
    fireEvent.submit(screen.getByRole('button', { name: '筛选' }).closest('form')!);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const href = pushMock.mock.calls[0][0] as string;
    const params = new URLSearchParams(href.slice('/admin/downloads?'.length));
    expect(params.get('sourceType')).toBe('poem');
    expect(params.get('userId')).toBe('12');
  });

  it('the AI call bar navigates to the filtered URL', () => {
    const query = parseAiCallsQuery({});
    render(<AiCallsFilterBar query={query} />);
    fireEvent.change(screen.getByLabelText('功能'), { target: { value: 'char-recognize' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'error' } });
    fireEvent.submit(screen.getByRole('button', { name: '筛选' }).closest('form')!);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const href = pushMock.mock.calls[0][0] as string;
    const params = new URLSearchParams(href.slice('/admin/ai?'.length));
    expect(params.get('feature')).toBe('char-recognize');
    expect(params.get('status')).toBe('error');
  });
});
