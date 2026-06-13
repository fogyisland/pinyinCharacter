// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DictionaryClient } from '@/components/dictionary/DictionaryClient';
import type { Char } from '@/lib/chars-types';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams('view=pinyin');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

const sampleChars: Char[] = [
  { char: '一', level: 1, pinyin: 'yī', pinyinAlt: [], radical: '一', strokeCount: 1, meaningZh: null, meaningEn: null, unicodeCodepoint: 'U+4E00', variants: [] },
  { char: '丁', level: 1, pinyin: 'dīng', pinyinAlt: [], radical: '一', strokeCount: 2, meaningZh: null, meaningEn: null, unicodeCodepoint: 'U+4E01', variants: [] },
];

describe('DictionaryClient', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSearchParams.forEach((_, k) => mockSearchParams.delete(k));
    mockSearchParams.set('view', 'pinyin');
  });

  it('renders pinyin view by default with anchor + grid', () => {
    render(<DictionaryClient chars={sampleChars} total={2} page={1} pageSize={24} />);
    // 26 A-Z letter buttons inside the PinyinAnchor nav
    expect(screen.getByRole('navigation', { name: '拼音首字母' }).querySelectorAll('button')).toHaveLength(26);
    expect(screen.getByText('一')).toBeInTheDocument();
  });

  it('toggles to radical view when 按部首 clicked', () => {
    render(<DictionaryClient chars={sampleChars} total={2} page={1} pageSize={24} />);
    fireEvent.click(screen.getByRole('button', { name: /按部首/ }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('view=radical');
  });

  it('clears letter param when switching to radical view', () => {
    mockSearchParams.set('letter', 'M');
    render(<DictionaryClient chars={sampleChars} total={2} page={1} pageSize={24} />);
    fireEvent.click(screen.getByRole('button', { name: /按部首/ }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('view=radical');
    expect(url).not.toContain('letter=M');
  });
});
