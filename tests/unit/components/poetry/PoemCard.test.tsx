// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoemCard } from '@/components/poetry/PoemCard';

describe('PoemCard', () => {
  it('renders title, author, and dynasty tag', () => {
    render(<PoemCard poem={{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }} />);
    expect(screen.getByText('《静夜思》')).toBeInTheDocument();
    expect(screen.getByText('李白')).toBeInTheDocument();
    expect(screen.getByText('唐')).toBeInTheDocument();
    expect(screen.getByText(/五言绝句/)).toBeInTheDocument();
  });

  it('renders 宋 tag for song dynasty', () => {
    render(<PoemCard poem={{ id: 2, title: '如梦令', author: '李清照', dynasty: 'song', form: null }} />);
    expect(screen.getByText('宋')).toBeInTheDocument();
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('links to /poetry/[id]', () => {
    render(<PoemCard poem={{ id: 7, title: '春晓', author: '孟浩然', dynasty: 'tang', form: null }} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/poetry/7');
  });
});
