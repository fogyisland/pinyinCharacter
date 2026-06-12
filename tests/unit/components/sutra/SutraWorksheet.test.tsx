// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SutraWorksheet } from '@/components/sutra/SutraWorksheet';

describe('SutraWorksheet', () => {
  it('renders a WorksheetCell for each char + pinyin beneath', () => {
    const chunk = {
      id: 0,
      label: '心经',
      content: ['观自在菩萨'],
      pinyin: [['guān', 'zì', 'zài', 'pú', 'sà']],
    };
    const { container } = render(<SutraWorksheet chunk={chunk} />);
    const cells = container.querySelectorAll('svg');
    expect(cells).toHaveLength(5);
    expect(container.textContent).toContain('guān');
  });
});
