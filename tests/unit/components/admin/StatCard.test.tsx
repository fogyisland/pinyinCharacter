// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '@/components/admin/StatCard';
import { Download } from 'lucide-react';

describe('StatCard', () => {
  it('renders label, value, and icon', () => {
    render(<StatCard label="下载 (7d)" value={42} icon={Download} href="/admin/downloads" />);
    expect(screen.getByText('下载 (7d)')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
