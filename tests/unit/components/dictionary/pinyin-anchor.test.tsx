// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PinyinAnchor } from '@/components/dictionary/PinyinAnchor';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(''),
}));

describe('PinyinAnchor', () => {
  beforeEach(() => mockPush.mockClear());

  it('renders 26 letter buttons A-Z', () => {
    render(<PinyinAnchor activeLetter="A" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(26);
  });

  it('highlights active letter', () => {
    render(<PinyinAnchor activeLetter="M" />);
    const m = screen.getByRole('button', { name: 'M' });
    expect(m.className).toContain('bg-ink');
  });

  it('pushes URL with view=pinyin&letter=M#M when M clicked', () => {
    render(<PinyinAnchor />);
    const m = screen.getByRole('button', { name: 'M' });
    fireEvent.click(m);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('/dictionary');
    expect(url).toContain('view=pinyin');
    expect(url).toContain('letter=M');
    expect(url).toContain('#M');
  });
});