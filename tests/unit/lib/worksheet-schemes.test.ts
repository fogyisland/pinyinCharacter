import { describe, expect, it } from 'vitest';
import {
  FONT_FAMILIES,
  PAPER_SIZES,
  validateWorksheetInput,
} from '@/lib/worksheet-types';
import { findScheme, WORKSHEET_SCHEMES } from '@/lib/worksheet-schemes';

/**
 * The worksheet scheme catalogue.
 *
 * A scheme names a standard worksheet format: a cell style + a paper size +
 * a font. The catalogue is data, so the site's own practice-template page can
 * adopt it later without a rewrite — but every value in it must be one the
 * site already knows, or the renderer would look up a paper size that does
 * not exist.
 */

/** The paper sizes the site offers. */
const SITE_PAPER_SIZES = new Set<string>(PAPER_SIZES.map((paper) => paper.value));

/** The fonts the site offers. */
const SITE_FONTS = new Set<string>(FONT_FAMILIES.map((font) => font.value));

/**
 * The paper sizes a scheme id may end with.
 *
 * Only these three suffixes name a paper; `brush-large-12`, `brush-medium-24`
 * and `brush-small-28` end with a cell count instead, so they are excluded.
 */
const PAPER_SUFFIXES = ['a3', 'a4', 'b5'] as const;

/**
 * Does the site's own worksheet validator accept this cell style?
 *
 * `validateWorksheetInput` is the gate every saved worksheet passes, so it
 * is the site's own answer to "is this a cell style we know?". The English
 * four-line sheet takes letters, every other sheet takes a Han character.
 */
function siteAcceptsCellStyle(cellStyle: string): boolean {
  const content = cellStyle === 'pen-english' ? ['A'] : ['字'];
  return validateWorksheetInput({
    title: 'scheme check',
    content,
    cellStyle,
    paperSize: 'A4',
  }).ok;
}

describe('the worksheet scheme catalogue', () => {
  it('has 16 schemes with unique ids', () => {
    expect(WORKSHEET_SCHEMES).toHaveLength(16);
    expect(new Set(WORKSHEET_SCHEMES.map((scheme) => scheme.id)).size).toBe(16);
  });

  it('only uses cell styles and paper sizes the site knows', () => {
    // The two axes are checked separately: the site has no rule that pairs a
    // cell style with a paper size — validateWorksheetInput accepts any
    // combination of the two — so there is no pairing to check here.
    for (const scheme of WORKSHEET_SCHEMES) {
      expect(siteAcceptsCellStyle(scheme.cellStyle), `${scheme.id} cell style`).toBe(true);
      expect(SITE_PAPER_SIZES.has(scheme.paperSize), `${scheme.id} paper size`).toBe(true);
    }
  });

  it('only uses fonts the site knows', () => {
    for (const scheme of WORKSHEET_SCHEMES) {
      expect(SITE_FONTS.has(scheme.fontFamily), `${scheme.id} font`).toBe(true);
    }
  });

  it('names every scheme in English and in Chinese', () => {
    for (const scheme of WORKSHEET_SCHEMES) {
      expect(scheme.name.length, `${scheme.id} name`).toBeGreaterThan(0);
      expect(scheme.nameZh.length, `${scheme.id} nameZh`).toBeGreaterThan(0);
      expect(scheme.note.length, `${scheme.id} note`).toBeGreaterThan(0);
    }
  });

  it('finds a scheme by id', () => {
    expect(findScheme('pen-grid-a4')?.cellStyle).toBe('pen-square');
    expect(findScheme('nope')).toBeUndefined();
  });

  it('never lets a scheme id contradict the paper size it names', () => {
    const paperTagged = WORKSHEET_SCHEMES.filter((scheme) =>
      PAPER_SUFFIXES.some((suffix) => scheme.id.endsWith(`-${suffix}`)),
    );
    expect(paperTagged.length).toBeGreaterThan(0);
    for (const scheme of paperTagged) {
      const suffix = scheme.id.slice(scheme.id.lastIndexOf('-') + 1).toUpperCase();
      expect(suffix, `${scheme.id} names a paper it does not use`).toBe(scheme.paperSize);
    }
  });
});
