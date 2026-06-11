// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RareCharCard } from '@/components/rare/RareCharCard';

describe('RareCharCard', () => {
  it('renders char, pinyin, meaning', () => {
    render(<RareCharCard char="龘" pinyin="dá" meaning="古同'达'" />);
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(screen.getByText('dá')).toBeInTheDocument();
    expect(screen.getByText(/古同/)).toBeInTheDocument();
  });

  it('truncates long meaning', () => {
    const long = 'a'.repeat(200);
    render(<RareCharCard char="你" pinyin="ni" meaning={long} />);
    // The component truncates to ~30 chars + ellipsis
    const text = screen.getByText(/a+…$/).textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(31);
  });
});
