import type { PaperSize } from './worksheet-types';

/**
 * The geometry of the four-line (English trace) sheet.
 *
 * ⚠️ WHY THIS FILE EXISTS
 *
 * The four-line sheet has THREE renderers that must agree on one number:
 * the letter count of a row.
 *
 *   - the printed page (app/globals.css .four-line-paper-row .text-content)
 *   - the PNG rasteriser (lib/png/worksheet-draw.ts)
 *   - the PDF template (components/worksheet/PracticePDF.tsx — ruled lines
 *     only, no letters, so it only cares about the ROW COUNT)
 *
 * `englishCharsPerRow` used to be a hard-coded number (A4 = 88) picked in
 * commit 9ca439d69 as a CONTENT-PACKING figure: "how many letters fit on a
 * ruled line at ~6pt". The renderers, however, draw the letters at 28px,
 * and neither of them scales them horizontally. 88 letters at 28px are
 * 1848px wide — 2.4x an A4 sheet's 680px printable area.
 *
 * The mismatch stayed latent for months because a row only reached 88
 * letters when the user typed 88 or more. Filling every row with the
 * content (the trace-fill feature) turned it into an unconditional
 * regression: every four-line sheet printed with its letters cut off at
 * the right margin.
 *
 * So the count is DERIVED here, from the paper's printable width and the
 * letter advance. The derivation lives in ONE place so the renderers and
 * the layout cannot drift apart again.
 */

/** The letter size the four-line sheet renders at, in CSS px. */
export const FOUR_LINE_LETTER_SIZE_PX = 28;

/**
 * The distance from the left edge of the printable area to the first
 * letter, in CSS px. The CSS gives the text `left: 8px`; the PNG
 * renderer insets the pen by the same amount.
 */
export const FOUR_LINE_TEXT_INSET_PX = 8;

/**
 * The advance of one ASCII letter in the CSS letter stack, in CSS px at
 * {@link FOUR_LINE_LETTER_SIZE_PX}.
 *
 * The stack is `'Courier New', Monaco, ... monospace` at
 * `font-size: 28px` with `letter-spacing: 0.15em`. A monospace face
 * advances 0.6em, so one letter takes 0.6em + 0.15em = 0.75em = 21px.
 */
export const FOUR_LINE_CSS_LETTER_ADVANCE_PX = (0.6 + 0.15) * FOUR_LINE_LETTER_SIZE_PX;

/**
 * The advance of one ASCII letter in the site's own fonts, in CSS px at
 * {@link FOUR_LINE_LETTER_SIZE_PX}.
 *
 * The PNG renderer draws the glyph OUTLINES of the site's font set (the
 * WenKai / Kaishu faces the site ships), not the CSS stack. Measured from
 * the shipped outlines: 1646px for 100 letters at 28px = 16.46px each.
 *
 * The CSS stack advances WIDER than the site's fonts, so this is the
 * tighter of the two constraints and the one that decides the count.
 */
export const FOUR_LINE_FONT_ADVANCE_PX = 16.46;

/** The width of each paper in mm (portrait). */
const PAPER_WIDTH_MM: Record<PaperSize, number> = {
  A3: 297,
  A4: 210,
  B5: 176,
  'brush-12': 210,
  'brush-24': 210,
  'brush-28': 210,
};

/** The print margin on each side — 1.5 cm, the site's PDF padding. */
const PRINT_MARGIN_MM = 15;

/** CSS px per mm at 96 DPI. */
const PX_PER_MM = 96 / 25.4;

/**
 * The width the four-line row may use: the paper's width minus the print
 * margin on each side, in CSS px.
 *
 * A brush paper has no four-line rows, so its width is 0.
 *
 * @param paperSize the paper the sheet prints on.
 * @returns the printable width in CSS px.
 */
export function fourLinePrintableWidthPx(paperSize: PaperSize): number {
  if (paperSize.startsWith('brush-')) return 0;
  const widthMm = PAPER_WIDTH_MM[paperSize];
  if (widthMm === undefined) return 0;
  return (widthMm - 2 * PRINT_MARGIN_MM) * PX_PER_MM;
}

/**
 * The number of letters that fit on one four-line row of that paper.
 *
 * The count is the SMALLER of what the two renderers can show:
 *
 *   - the CSS page: `floor(printableWidth / 21px)`
 *   - the PNG page: `floor((printableWidth - 8px) / 16.46px)`
 *
 * Both must fit, or the sheet is broken in one of them: letters cut off
 * at the paper edge in print, letters cut off in the MCP PNG.
 *
 * @param paperSize the paper the sheet prints on.
 * @returns the letters per row; 0 for a paper with no four-line rows.
 */
export function fourLineLettersPerRow(paperSize: PaperSize): number {
  const printable = fourLinePrintableWidthPx(paperSize);
  if (printable <= 0) return 0;
  const cssCapacity = Math.floor(printable / FOUR_LINE_CSS_LETTER_ADVANCE_PX);
  const pngCapacity = Math.floor(
    (printable - FOUR_LINE_TEXT_INSET_PX) / FOUR_LINE_FONT_ADVANCE_PX
  );
  return Math.max(0, Math.min(cssCapacity, pngCapacity));
}
