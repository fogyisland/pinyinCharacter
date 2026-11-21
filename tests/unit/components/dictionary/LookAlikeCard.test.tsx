// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LookAlikeCard } from '@/components/dictionary/LookAlikeCard';

/**
 * 形近字 — the look-alike section of the dictionary page.
 *
 * The card answers the question a learner actually has: 「这个字和那个字
 * 哪里不一样？」 — so it shows both characters, the numbers behind the
 * judgement, and the stroke that differs. It must also say plainly when a
 * pair is NOT a confusion pair, because "these look alike but are different
 * characters" is the more useful message.
 */

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/dictionary/StrokeOrderCard', () => ({
  StrokeOrderCard: ({ char }: { char: string }) => <div data-stroke-card={char} />,
}));

afterEach(() => {
  cleanup();
});

const comparison = {
  a: '未',
  b: '末',
  mean: 0.035,
  max: 0.082,
  diffStrokeA: 1,
  diffStrokeB: 1,
  isLookAlike: true,
};

describe('LookAlikeCard', () => {
  it('shows both characters with their stroke counts', () => {
    render(<LookAlikeCard comparison={comparison} strokeCountA={5} strokeCountB={6} />);
    expect(screen.getByTestId('look-alike-a').textContent).toBe('未');
    expect(screen.getByTestId('look-alike-b').textContent).toBe('末');
    // Different counts, so the test can tell them apart.
    expect(screen.getByText('5 画')).toBeTruthy();
    expect(screen.getByText('6 画')).toBeTruthy();
  });

  it('names the stroke that differs, in words a learner understands', () => {
    render(<LookAlikeCard comparison={comparison} strokeCountA={5} strokeCountB={5} />);
    // 1-based for the learner: 「第 2 笔」, not 「第 1 笔」.
    expect(screen.getByTestId('diff-stroke').textContent).toContain('第 2 笔');
  });

  it('says how similar the pair is, as a percentage', () => {
    render(<LookAlikeCard comparison={comparison} strokeCountA={5} strokeCountB={5} />);
    // 1 - 0.035 ≈ 97% of the strokes coincide.
    expect(screen.getByTestId('similarity').textContent).toContain('97');
  });

  it('warns when the pair is similar but NOT a confusion pair', () => {
    const notPair = { ...comparison, a: '日', b: '月', mean: 0.207, isLookAlike: false };
    render(<LookAlikeCard comparison={notPair} strokeCountA={4} strokeCountB={4} />);
    expect(screen.getByText(/不是形近字/)).toBeTruthy();
  });

  it('links to the other character, so the learner can keep going', () => {
    render(<LookAlikeCard comparison={comparison} strokeCountA={5} strokeCountB={5} />);
    const link = screen.getByRole('link', { name: /末/ });
    expect(link.getAttribute('href')).toBe('/dictionary/%E6%9C%AB');
  });

  it('links to a comparison worksheet for the pair', () => {
    render(<LookAlikeCard comparison={comparison} strokeCountA={5} strokeCountB={5} />);
    const link = screen.getByRole('link', { name: /对比练/ });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain('未末');
  });
});
