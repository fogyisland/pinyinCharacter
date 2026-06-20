// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ClassicCard } from '@/components/classics/ClassicCard';

describe('ClassicCard', () => {
  it('renders title wrapped in 《》', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋', chunkCount: 20, charCount: 5000 }} />);
    expect(container.querySelector('h3')).toHaveTextContent('《论语》');
  });

  it('shows chunk and char counts', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: null, era: null, chunkCount: 20, charCount: 5000 }} />);
    expect(container.textContent).toMatch(/20 章/);
    expect(container.textContent).toMatch(/5000 字/);
  });

  it('links to /ancient/[slug]', () => {
    const { container } = render(<ClassicCard item={{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: null, era: null, chunkCount: 1, charCount: 100 }} />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/ancient/lunyu');
  });
});