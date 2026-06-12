// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

describe('AdminSidebar', () => {
  it('renders 4 areas', () => {
    render(<AdminSidebar currentPath="/admin" />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('highlights the active link', () => {
    render(<AdminSidebar currentPath="/admin/logs" />);
    const link = screen.getByText('日志').closest('a');
    expect(link).toHaveClass('bg-ink');
  });
});
