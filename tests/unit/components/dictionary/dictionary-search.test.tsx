// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DictionarySearch } from '@/components/dictionary/DictionarySearch';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

describe('DictionarySearch', () => {
  beforeEach(() => {
    mockPush.mockClear();
    // Reset mock params between tests
    mockSearchParams.forEach((_, k) => mockSearchParams.delete(k));
  });

  it('renders input with placeholder', () => {
    render(<DictionarySearch />);
    expect(screen.getByPlaceholderText(/拼音|汉字/)).toBeInTheDocument();
  });

  it('navigates to /dictionary?q=... on form submit', () => {
    render(<DictionarySearch />);
    const input = screen.getByPlaceholderText(/拼音|汉字/);
    fireEvent.change(input, { target: { value: 'ni' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('/dictionary');
    expect(url).toContain('q=ni');
  });

  it('preserves other params but clears letter/radical on submit', () => {
    mockSearchParams.set('view', 'pinyin');
    mockSearchParams.set('letter', 'M');
    mockSearchParams.set('radical', '一');
    render(<DictionarySearch />);
    const input = screen.getByPlaceholderText(/拼音|汉字/);
    fireEvent.change(input, { target: { value: 'ma' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('q=ma');
    expect(url).toContain('view=pinyin');
    expect(url).not.toContain('letter=M');
    expect(url).not.toContain('radical=');
  });
});