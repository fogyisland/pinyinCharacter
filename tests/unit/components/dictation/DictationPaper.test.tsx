// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DictationPaper } from '@/components/dictation/DictationPaper';
import type { DictationItem } from '@/lib/dictation';

/**
 * The dictation paper.
 *
 * Two modes render the SAME item list: `blank` is the sheet the student
 * writes on, `answer` is the sheet the teacher keeps. The two must agree
 * on numbering, on the order and on the count — a mismatched answer key
 * is worse than no answer key, because the teacher corrects against it.
 */

function item(word: string, pinyin = ''): DictationItem {
  return { word, pinyin, chars: Array.from(word) };
}

const ITEMS: DictationItem[] = [item('你好', 'nǐ hǎo'), item('世界'), item('长大'), item('昂首挺胸')];

afterEach(() => {
  cleanup();
});

describe('DictationPaper', () => {
  it('renders one numbered row per item', () => {
    render(<DictationPaper items={ITEMS} mode="blank" />);
    const rows = document.querySelectorAll('[data-dictation-row]');
    expect(rows).toHaveLength(4);
    for (let i = 0; i < 4; i += 1) {
      const row = rows[i] as HTMLElement;
      expect(row.querySelector('[data-dictation-number]')?.textContent).toBe(`${i + 1}.`);
    }
  });

  it('blank mode draws one empty cell per character', () => {
    render(<DictationPaper items={[item('长大')]} mode="blank" />);
    const row = document.querySelector('[data-dictation-row]') as HTMLElement;
    const cells = row.querySelectorAll('[data-dictation-cell]');
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      // No model character on the sheet the student writes on: the
      // character is the answer, and printing it would give it away.
      expect(cell.textContent?.trim()).toBe('');
    }
  });

  it('answer mode fills the model character into every cell', () => {
    render(<DictationPaper items={[item('长大')]} mode="answer" />);
    const row = document.querySelector('[data-dictation-row]') as HTMLElement;
    const cells = row.querySelectorAll('[data-dictation-cell]');
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toContain('长');
    expect(cells[1].textContent).toContain('大');
  });

  it('prints the pinyin row on the answer page even when hints are off', () => {
    // The answer page without the reading is not an answer page.
    render(<DictationPaper items={[item('你好', 'nǐ hǎo')]} mode="answer" showPinyin={false} />);
    expect(screen.getByText('nǐ hǎo')).toBeTruthy();
  });

  it('shows the pinyin row on the blank sheet when hints are asked for', () => {
    render(<DictationPaper items={[item('你好', 'nǐ hǎo')]} mode="blank" showPinyin />);
    expect(screen.getByText('nǐ hǎo')).toBeTruthy();
  });

  it('hides the pinyin row on the blank sheet by default', () => {
    render(<DictationPaper items={[item('你好', 'nǐ hǎo')]} mode="blank" />);
    expect(screen.queryByText('nǐ hǎo')).toBeNull();
  });

  it('skips the pinyin row for an item with no reading', () => {
    render(<DictationPaper items={[item('世界')]} mode="blank" showPinyin />);
    expect(document.querySelector('[data-dictation-pinyin]')).toBeNull();
  });

  it('marks the print controls as no-print so they stay off the paper', () => {
    // The controls live in DictationPrep above the paper; the paper
    // itself belongs entirely on the printed sheet. Here we pin the two
    // kinds of chrome the paper owns: the name line is ON the paper, and
    // nothing inside the paper carries the no-print class.
    render(<DictationPaper items={ITEMS} mode="blank" />);
    const paper = document.querySelector('[data-dictation-paper]') as HTMLElement;
    expect(paper).not.toBeNull();
    expect(paper.className).not.toContain('worksheet-no-print');
    // The name/date line is the paper — the student writes their name on
    // it, so it must not carry the no-print class.
    const nameLine = document.querySelector('[data-dictation-name-line]');
    expect(nameLine).not.toBeNull();
    expect(nameLine?.className).not.toContain('worksheet-no-print');
  });

  it('renders a four-character item on one row without wrapping', () => {
    render(<DictationPaper items={[item('昂首挺胸')]} mode="blank" />);
    const row = document.querySelector('[data-dictation-row]') as HTMLElement;
    expect(row.querySelectorAll('[data-dictation-cell]')).toHaveLength(4);
  });

  it('shows the empty state when there are no items', () => {
    render(<DictationPaper items={[]} mode="blank" />);
    expect(screen.getByText(/还没有词条/)).toBeTruthy();
    expect(document.querySelector('[data-dictation-row]')).toBeNull();
  });

  it('numbers two pages continuously instead of restarting at 1', () => {
    // paginate() cuts 12 items into 10 + 2; the paper takes pages and
    // must keep counting into the second one.
    const many: DictationItem[] = Array.from({ length: 12 }, (_, i) =>
      item(String.fromCharCode(0x4e00 + i)),
    );
    render(<DictationPaper items={many} mode="blank" />);
    const numbers = [...document.querySelectorAll('[data-dictation-number]')].map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}.`));
  });

  it('splits 12 items across two pages and breaks the page between them', () => {
    const many: DictationItem[] = Array.from({ length: 12 }, (_, i) =>
      item(String.fromCharCode(0x4e00 + i)),
    );
    render(<DictationPaper items={many} mode="blank" />);
    const pages = document.querySelectorAll('[data-dictation-page]');
    expect(pages).toHaveLength(2);
    // The break must be a real print page break, not a screen-only gap:
    // two sheets on one paper is not a dictation sheet.
    expect(pages[0].className).toContain('print-page-break');
    expect(pages[1].className).not.toContain('print-page-break');
    expect(pages[0].querySelectorAll('[data-dictation-row]')).toHaveLength(10);
    expect(pages[1].querySelectorAll('[data-dictation-row]')).toHaveLength(2);
  });

  it('repeats the name line on every page', () => {
    // A second sheet without the name line belongs to nobody once the
    // class hands them in.
    const many: DictationItem[] = Array.from({ length: 12 }, (_, i) =>
      item(String.fromCharCode(0x4e00 + i)),
    );
    render(<DictationPaper items={many} mode="blank" />);
    expect(document.querySelectorAll('[data-dictation-name-line]')).toHaveLength(2);
  });
});
