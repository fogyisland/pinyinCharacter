// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PinyinTabs } from '@/components/PinyinTabs';

/**
 * The /pinyin page's panels.
 *
 * The page is titled 「字 ⇄ 拼音 互转」 and only converted one way: the two
 * 拼音 → 汉字 components (the candidate picker and the sentence converter)
 * existed but nothing mounted them. These tests pin that both directions
 * are reachable and that the tab lives in the URL, like the game page.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/pinyin',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/components/TextToPinyin', () => ({
  TextToPinyin: () => <div data-text-to-pinyin>字转拼音</div>,
}));

vi.mock('@/components/PinyinInputMethod', () => ({
  PinyinInputMethod: () => <div data-pinyin-input>拼音选字</div>,
}));

vi.mock('@/components/PinyinFullSentence', () => ({
  PinyinFullSentence: () => <div data-pinyin-sentence>整句转换</div>,
}));

afterEach(() => {
  cleanup();
});

describe('PinyinTabs', () => {
  it('offers all three panels as tabs', () => {
    render(<PinyinTabs />);
    expect(screen.getByRole('tab', { name: '字 → 拼音' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '拼音 → 字' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '整句转汉字' })).toBeTruthy();
  });

  it('opens on the 字 → 拼音 panel', () => {
    render(<PinyinTabs />);
    expect(document.querySelector('[data-text-to-pinyin]')).not.toBeNull();
    expect(document.querySelector('[data-pinyin-input]')).toBeNull();
  });

  it('swaps to the candidate picker', async () => {
    render(<PinyinTabs />);
    fireEvent.click(screen.getByRole('tab', { name: '拼音 → 字' }));
    await waitFor(() => {
      expect(document.querySelector('[data-pinyin-input]')).not.toBeNull();
    });
    expect(document.querySelector('[data-text-to-pinyin]')).toBeNull();
  });

  it('swaps to the sentence converter', async () => {
    render(<PinyinTabs />);
    fireEvent.click(screen.getByRole('tab', { name: '整句转汉字' }));
    await waitFor(() => {
      expect(document.querySelector('[data-pinyin-sentence]')).not.toBeNull();
    });
  });

  it('marks the selected tab for assistive tech', async () => {
    render(<PinyinTabs />);
    expect(screen.getByRole('tab', { name: '字 → 拼音' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: '拼音 → 字' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '拼音 → 字' }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    expect(screen.getByRole('tab', { name: '字 → 拼音' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });
});
