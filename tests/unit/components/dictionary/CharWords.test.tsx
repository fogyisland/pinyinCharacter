// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CharWords } from '@/components/dictionary/CharWords';
import type { WordEntry } from '@/lib/char-words';

/**
 * The 组词 section of the dictionary page.
 *
 * A learner studies WORDS, not characters: 「学」 matters because of 学生
 * and 学习. This section lists the words a character appears in, each with
 * its reading and a link to learn it — and it disappears entirely when the
 * character has no words, rather than printing an empty heading.
 */

function word(text: string, pinyin: string, freq = 1000): WordEntry {
  return { word: text, pinyin, freq };
}

afterEach(() => {
  cleanup();
});

describe('CharWords', () => {
  it('lists each word with its reading', () => {
    render(<CharWords char="学" words={[word('学习', 'xué xí')]} />);
    expect(screen.getByText('学习')).toBeTruthy();
    expect(screen.getByText('xué xí')).toBeTruthy();
  });

  it('links a word to the worksheet prefill, so it can be practised', () => {
    render(<CharWords char="学" words={[word('学习', 'xué xí')]} />);
    const link = screen.getByRole('link', { name: /练/ });
    expect(link.getAttribute('href')).toContain('/worksheet?prefill=');
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain('学习');
  });

  it('renders nothing when the character has no words', () => {
    // Printing an empty 「组词 ·」 heading would look broken.
    const { container } = render(<CharWords char="龘" words={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the word count so the learner knows how many there are', () => {
    render(
      <CharWords
        char="学"
        words={[word('学习', 'xué xí'), word('学生', 'xué shēng'), word('学校', 'xué xiào')]}
      />,
    );
    expect(screen.getByText(/组词 · 3/)).toBeTruthy();
  });

  it('keeps the reading of each word readable at a small size', () => {
    render(<CharWords char="学" words={[word('学习', 'xué xí')]} />);
    const reading = screen.getByText('xué xí');
    expect(reading.className).toContain('text-xs');
  });
});
