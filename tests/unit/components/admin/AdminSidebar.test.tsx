// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

describe('AdminSidebar', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('renders all admin areas', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('字典 / 字源')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('highlights the active link', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<AdminSidebar currentPath="/admin/logs" />);
    const link = screen.getByText('日志').closest('a');
    expect(link).toHaveClass('bg-ink');
  });

  it('shows ⚙ 初始化 link in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.getByText('⚙ 初始化')).toBeInTheDocument();
  });

  it('hides ⚙ 初始化 link in production (dev-only panel)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.queryByText('⚙ 初始化')).not.toBeInTheDocument();
  });
});
