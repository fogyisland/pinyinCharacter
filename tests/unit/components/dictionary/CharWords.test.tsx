// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CharWords } from '@/components/dictionary/CharWords';
import type { WordEntry } from '@/lib/char-words';

/**
 * 组词 + 例句。
 *
 * 「学生」 alone is a label; 「你是学生吗？」 shows how the word behaves. The
 * sentence is shown under the word it illustrates — not in a separate
 * section — because a learner reads the word and the sentence together.
 */

function word(text: string, pinyin: string, freq = 1000): WordEntry {
  return { word: text, pinyin, freq };
}

afterEach(() => {
  cleanup();
});

describe('CharWords with examples', () => {
  it('shows the sentence under the word it illustrates', () => {
    render(
      <CharWords
        char="学"
        words={[word('学生', 'xué sheng')]}
        examples={{ 学生: [{ zh: '你是学生吗？', en: 'Are you a student?' }] }}
      />,
    );
    expect(screen.getByText('学生')).toBeTruthy();
    expect(screen.getByText('你是学生吗？')).toBeTruthy();
    expect(screen.getByText('Are you a student?')).toBeTruthy();
  });

  it('shows no sentence area for a word without one', () => {
    // The build covers 61% of the words; the other 39% must not leave an
    // empty gap under the word.
    render(<CharWords char="学" words={[word('学科', 'xué kē')]} examples={{}} />);
    expect(screen.queryByText(/你是学生/)).toBeNull();
    expect(screen.getByText('学科')).toBeTruthy();
  });

  it('still renders every word when no examples are passed at all', () => {
    // The prop is optional: the dictionary page may not have loaded the
    // table yet, and the words must still appear.
    render(<CharWords char="学" words={[word('学生', 'xué sheng')]} />);
    expect(screen.getByText('学生')).toBeTruthy();
    expect(screen.getByText('xué sheng')).toBeTruthy();
  });

  it('marks the English as secondary so the Chinese stays readable', () => {
    render(
      <CharWords
        char="学"
        words={[word('学生', 'xué sheng')]}
        examples={{ 学生: [{ zh: '你是学生吗？', en: 'Are you a student?' }] }}
      />,
    );
    const english = screen.getByText('Are you a student?');
    expect(english.className).toContain('text-ink-faint');
  });
});
