// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PinyinAnchor } from '@/components/dictionary/PinyinAnchor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

describe('PinyinAnchor', () => {
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
});