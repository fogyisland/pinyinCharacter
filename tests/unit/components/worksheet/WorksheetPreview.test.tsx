// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';

describe('WorksheetPreview print header', () => {
  it('renders Logo + site name + font name + tagline in the worksheet grid', () => {
    const { container } = render(
      <WorksheetPreview
        content={['一', '二', '三']}
        cellStyle="pen-square"
        paperSize="A4"
        fontFamily="wenkai-gb"
      />,
    );
    // The header lives inside .worksheet-grid
    const grid = container.querySelector('.worksheet-grid');
    expect(grid).toBeInTheDocument();
    // Logo <img> with /logo.svg src
    const logo = grid?.querySelector('img[src="/logo.svg"]');
    expect(logo).toBeInTheDocument();
    expect(logo?.getAttribute('alt')).toBe('字·韵');
    // Site name text
    expect(grid?.textContent).toContain('字·韵');
    // Font name (from fontFamilyLabel for 'wenkai-gb' = '霞鹜文楷 GB')
    expect(grid?.textContent).toContain('霞鹜文楷 GB');
    // Tagline
    expect(grid?.textContent).toContain('公益网站，请多关注');
  });

  it('updates font name in header when fontFamily changes', () => {
    const { container: c1 } = render(
      <WorksheetPreview content={['中']} cellStyle="pen-square" paperSize="A4" fontFamily="yozai" />,
    );
    expect(c1.querySelector('.worksheet-grid')?.textContent).toContain('悠哉');
    const { container: c2 } = render(
      <WorksheetPreview content={['中']} cellStyle="pen-square" paperSize="A4" fontFamily="hei" />,
    );
    expect(c2.querySelector('.worksheet-grid')?.textContent).toContain('黑体');
  });

  it('header sits inside .worksheet-grid (not outside, so @media print visibility-visible picks it up)', () => {
    const { container } = render(
      <WorksheetPreview content={['一']} cellStyle="pen-square" paperSize="A4" fontFamily="song" />,
    );
    // Find the header element by its text. It should be a descendant of .worksheet-grid.
    const grid = container.querySelector('.worksheet-grid');
    expect(grid).toBeInTheDocument();
    const taglineEls = Array.from(grid?.querySelectorAll('*') ?? []).filter(
      (el) => el.textContent === '公益网站，请多关注',
    );
    expect(taglineEls.length).toBeGreaterThan(0);
  });
});
