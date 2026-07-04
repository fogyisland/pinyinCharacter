// Regression: /worksheet/practice?style=pen-english (and ?style=pen-lined)
// printed blank pages because @media print in app/globals.css used a
// "hide-all + whitelist-visible" strategy, and the .four-line-paper /
// .lined-paper containers were NOT in the whitelist. This file pins the
// CSS contract so the regression cannot silently reappear.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(process.cwd(), 'app/globals.css');

function readPrintBlock(): string {
  const css = readFileSync(CSS_PATH, 'utf-8');
  const m = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/m);
  if (!m) throw new Error('@media print block not found in app/globals.css');
  return m[1];
}

describe('app/globals.css — @media print whitelist for worksheet templates', () => {
  it('hides the entire body (visibility: hidden on body *) so the page is blank by default', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/body\s*\*\s*\{\s*visibility:\s*hidden/);
  });

  it('whitelists .worksheet-grid so grid templates print', () => {
    const block = readPrintBlock();
    // Tight assertion: the class must appear in a visibility:visible rule
    // (not just somewhere in the block — a future refactor that moves the
    // class into a different selector would still pass a loose check).
    expect(block).toMatch(/\.worksheet-grid[^{]*\{[^}]*visibility:\s*visible/);
  });

  it('whitelists .four-line-paper so 英文描红 templates print (regression: 2026-07-03 blank-print bug)', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.four-line-paper[^{]*\{[^}]*visibility:\s*visible/);
  });

  it('whitelists .lined-paper so 钢笔·横线 templates print (same regression class as four-line)', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.lined-paper[^{]*\{[^}]*visibility:\s*visible/);
  });

  it('whitelists .batch-print-area so batch print areas print', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.batch-print-area[^{]*\{[^}]*visibility:\s*visible/);
  });

  it('whitelists .poem-print-area so /poetry/[id] prints (regression: 2026-07-04 blank-print bug)', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.poem-print-area[^{]*\{[^}]*visibility:\s*visible/);
    expect(block).toMatch(/\.poem-print-area[^{]*\{[^}]*position:\s*absolute/);
    expect(block).toMatch(/\.poem-print-area[^{]*\{[^}]*print-color-adjust:\s*exact/);
  });

  it('whitelists .sutra-print-area so /sutra/[id] prints (same root cause as poem, 2026-07-04)', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.sutra-print-area[^{]*\{[^}]*visibility:\s*visible/);
    expect(block).toMatch(/\.sutra-print-area[^{]*\{[^}]*position:\s*absolute/);
    expect(block).toMatch(/\.sutra-print-area[^{]*\{[^}]*print-color-adjust:\s*exact/);
  });

  it('sets print-color-adjust: exact on printable containers so background-color rules print without user toggling "Background graphics"', () => {
    const block = readPrintBlock();
    // The 4-line CSS uses background-color for its 4 rules; Chrome silently
    // drops background colors in print unless the element opts in via
    // print-color-adjust: exact. Whitelisting visibility alone is necessary
    // but not sufficient — without color-adjust, the user would still see a
    // blank sheet.
    expect(block).toMatch(/print-color-adjust:\s*exact/);
  });

  it('still hides .worksheet-no-print (the form section above the template)', () => {
    const block = readPrintBlock();
    expect(block).toMatch(/\.worksheet-no-print\s*\{[^}]*display:\s*none/);
  });
});
