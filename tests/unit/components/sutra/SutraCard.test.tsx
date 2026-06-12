// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SutraCard } from '@/components/sutra/SutraCard';

describe('SutraCard', () => {
  it('renders title and chunk count label', () => {
    const { container } = render(
      <SutraCard sutra={{ id: 1, title: '心经', slug: 'xinjing', chunkCount: 1, charCount: 260 }} />
    );
    expect(container.textContent).toContain('心经');
    expect(container.textContent).toContain('全文');
    expect(container.textContent).toContain('260 字');
  });

  it('shows "N 品" when chunkCount > 1', () => {
    const { container } = render(
      <SutraCard sutra={{ id: 1, title: '金刚经', slug: 'jingang', chunkCount: 32, charCount: 5000 }} />
    );
    expect(container.textContent).toContain('32 品');
  });
});
