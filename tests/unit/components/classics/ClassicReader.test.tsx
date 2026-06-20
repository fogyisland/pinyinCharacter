// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalWindow } from 'happy-dom';
import '@testing-library/jest-dom/vitest';
import { ClassicReader } from '@/components/classics/ClassicReader';
import type { ClassicChunk } from '@/lib/classics-types';

beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

const SAMPLE_CHUNK: ClassicChunk = {
  id: 1,
  label: '学而第一',
  content: ['子曰：学而时习之。不亦说乎。'],
  // Index 2 is the full-width ：(U+FF1A), which is in PUNCT set and gets stripped
  pinyin: [['zǐ', 'yuē', '', 'xué', 'ér', 'shí', 'xí', 'zhī', '', 'bù', 'yì', 'yuè', 'hū', '']],
};

describe('ClassicReader', () => {
  it('renders non-punct chars as char spans', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    const charSpans = container.querySelectorAll('.classic-char');
    expect(charSpans.length).toBe(11); // 子曰学而时习之不亦说乎 = 11 chars after stripping 2 x 。 and 1 x ：
  });

  it('does not render punctuation as char spans', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    expect(container.textContent).not.toContain('。');
  });

  it('renders worksheet CTA link with prefill', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK] }} />,
    );
    const cta = container.querySelector('a[href*="/worksheet"]');
    expect(cta).not.toBeNull();
    // prefill should be the chars without punctuation
    expect(cta!.getAttribute('href')).toContain('source=ancient');
    expect(cta!.getAttribute('href')).toContain('book=lunyu');
    expect(cta!.getAttribute('href')).toContain('chapterIdx=0');
    expect(cta!.getAttribute('href')).toContain('prefill=');
    // The prefill should contain 子曰学而时习之不亦说乎
    const m = cta!.getAttribute('href')!.match(/prefill=([^&]+)/);
    expect(m).not.toBeNull();
    const decoded = decodeURIComponent(m![1]!);
    expect(decoded).toBe('子曰学而时习之不亦说乎');
  });

  it('disables 上一章 button on first chunk', () => {
    const { container } = render(
      <ClassicReader chunk={SAMPLE_CHUNK} book={{ slug: 'lunyu', title: '论语', chunks: [SAMPLE_CHUNK, { ...SAMPLE_CHUNK, id: 2, label: '为政' }] }} />,
    );
    const prevBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('上一章'));
    expect(prevBtn).toBeDisabled();
  });

  it('disables 下一章 button on last chunk', () => {
    const chunks = [{ ...SAMPLE_CHUNK, id: 1, label: '学而' }, { ...SAMPLE_CHUNK, id: 2, label: '为政' }];
    const last = chunks[chunks.length - 1]!;
    const { container } = render(<ClassicReader chunk={last} book={{ slug: 'lunyu', title: '论语', chunks }} />);
    const nextBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('下一章'));
    expect(nextBtn).toBeDisabled();
  });
});