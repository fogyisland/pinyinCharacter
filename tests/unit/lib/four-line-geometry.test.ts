import { describe, it, expect } from 'vitest';
import {
  generateLayout,
  englishCharsPerRow,
  FOUR_LINE_LETTER_SIZE_PX,
  FOUR_LINE_TEXT_INSET_PX,
  fourLinePrintableWidthPx,
} from '@/lib/worksheet-types';

/**
 * The four-line sheet is a WRITING paper: the letters are the pale guide
 * the student traces over. A row whose letters run past the edge of the
 * paper is not a usable sheet — the tail of every row is cut off.
 *
 * The bug this file guards against: `englishCharsPerRow` used to be a
 * hard-coded content-packing number (A4 = 88) that had been calibrated
 * for a ~6pt letter, while both renderers draw the letters at 28px. The
 * two calibrations never agreed, but the defect stayed latent because a
 * row only reached 88 letters when the user typed 88+. Filling every row
 * with the content made the overflow unconditional.
 *
 * So the count is now DERIVED from the paper's printable width and the
 * rendered letter size. These tests pin that derivation, and pin the
 * property it exists to guarantee: the row fits.
 */

/** The advance of one ASCII letter in the site's font, in CSS px at 28px. */
const SITE_FONT_ADVANCE_PX = 16.46;
/** The advance of one ASCII letter in the CSS stack (Courier New 0.6em + 0.15em). */
const CSS_LETTER_ADVANCE_PX = (0.6 + 0.15) * 28;

describe('fourLinePrintableWidthPx — the width the four-line row may use', () => {
  it('gives the paper width minus the 1.5cm margin on each side', () => {
    // 210mm - 30mm = 180mm at 96dpi = 680px (A4)
    expect(fourLinePrintableWidthPx('A4')).toBeCloseTo(680, 0);
    // 297mm - 30mm = 267mm = 1009px (A3)
    expect(fourLinePrintableWidthPx('A3')).toBeCloseTo(1009, 0);
    // 176mm - 30mm = 146mm = 552px (B5)
    expect(fourLinePrintableWidthPx('B5')).toBeCloseTo(552, 0);
  });

  it('gives a brush paper no width (it has no four-line rows)', () => {
    expect(fourLinePrintableWidthPx('brush-12')).toBe(0);
    expect(fourLinePrintableWidthPx('brush-24')).toBe(0);
    expect(fourLinePrintableWidthPx('brush-28')).toBe(0);
  });
});

describe('englishCharsPerRow — the count is derived, not guessed', () => {
  it('fits the CSS renderer: the letters must not pass the paper edge', () => {
    for (const paper of ['A4', 'A3', 'B5'] as const) {
      const perRow = englishCharsPerRow(paper);
      const width = perRow * CSS_LETTER_ADVANCE_PX;
      expect(width, `${paper}: ${perRow} letters x ${CSS_LETTER_ADVANCE_PX}px`).toBeLessThanOrEqual(
        fourLinePrintableWidthPx(paper)
      );
    }
  });

  it('fits the PNG renderer: the letters must not pass the paper edge', () => {
    for (const paper of ['A4', 'A3', 'B5'] as const) {
      const perRow = englishCharsPerRow(paper);
      const width = perRow * SITE_FONT_ADVANCE_PX;
      expect(width, `${paper}: ${perRow} letters x ${SITE_FONT_ADVANCE_PX}px`).toBeLessThanOrEqual(
        fourLinePrintableWidthPx(paper) - FOUR_LINE_TEXT_INSET_PX
      );
    }
  });

  it('still fills the row: the letters reach the paper edge', () => {
    // The point of the sheet is that the row is full. A count that leaves
    // a third of the row empty would be "safe" but useless.
    for (const paper of ['A4', 'A3', 'B5'] as const) {
      const perRow = englishCharsPerRow(paper);
      const width = perRow * CSS_LETTER_ADVANCE_PX;
      expect(width, `${paper} should use at least 90% of the paper`).toBeGreaterThan(
        fourLinePrintableWidthPx(paper) * 0.9
      );
    }
  });

  it('is bigger on the bigger paper (A3 holds more letters than A4)', () => {
    expect(englishCharsPerRow('A3')).toBeGreaterThan(englishCharsPerRow('A4'));
  });

  it('has no count for a brush paper (it has no four-line rows)', () => {
    expect(englishCharsPerRow('brush-12')).toBe(0);
  });
});

describe('generateLayout — the four-line row fits the paper', () => {
  it('never puts more letters on a row than the row can show', () => {
    for (const paper of ['A4', 'A3', 'B5'] as const) {
      const cells = generateLayout(['a', 'b', 'c'], 'pen-english', paper);
      for (const cell of cells) {
        expect(cell.char.length, `${paper} row ${cell.index}`).toBeLessThanOrEqual(
          englishCharsPerRow(paper)
        );
      }
    }
  });

  it('fills every row to the count (no half-empty rows)', () => {
    for (const paper of ['A4', 'A3', 'B5'] as const) {
      const cells = generateLayout(['a', 'b', 'c'], 'pen-english', paper);
      expect(cells[0].char).toHaveLength(englishCharsPerRow(paper));
      expect(cells[cells.length - 1].char).toHaveLength(englishCharsPerRow(paper));
    }
  });

  it('renders the letters at the size the geometry assumes', () => {
    // The row height and the letter size are one calibration: a 28px
    // letter in a 38px row is what the four rules are spaced for.
    expect(FOUR_LINE_LETTER_SIZE_PX).toBe(28);
  });
});
