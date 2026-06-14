// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { render } from '@testing-library/react';
import { SutraTextView } from './SutraTextView';
import type { SutraChunk } from '@/lib/sutra-types';

beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

const CHUNK: SutraChunk = {
  id: 1,
  label: '卷一',
  content: ['第一行', '第二行', '第三行'],
  pinyin: [[], [], []],
};

describe('SutraTextView', () => {
  it('renders all lines in horizontal mode (default)', () => {
    const { container } = render(<SutraTextView chunk={CHUNK} />);
    expect(container.textContent).toContain('第一行');
    expect(container.textContent).toContain('第二行');
    expect(container.textContent).toContain('第三行');
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.writingMode).toBe('');
  });

  it('uses vertical-rl writing mode for vertical-rtl', () => {
    const { container } = render(<SutraTextView chunk={CHUNK} reading="vertical-rtl" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.writingMode).toBe('vertical-rl');
  });

  it('uses vertical-lr writing mode for vertical-ltr', () => {
    const { container } = render(<SutraTextView chunk={CHUNK} reading="vertical-ltr" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.writingMode).toBe('vertical-lr');
  });
});