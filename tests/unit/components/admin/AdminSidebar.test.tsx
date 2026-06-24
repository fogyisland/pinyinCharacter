// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

describe('AdminSidebar', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('renders all admin areas', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('初始化检查')).toBeInTheDocument();
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('字典 / 字源')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('highlights the active link', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<AdminSidebar currentPath="/admin/logs" />);
    const link = screen.getByText('日志').closest('a');
    expect(link).toHaveClass('bg-ink');
  });

  it('exact match only highlights /admin (not /admin/init)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<AdminSidebar currentPath="/admin/init" />);
    const dash = screen.getByText('仪表盘').closest('a');
    const init = screen.getByText('初始化检查').closest('a');
    expect(dash).not.toHaveClass('bg-ink');
    expect(init).toHaveClass('bg-ink');
  });
});
