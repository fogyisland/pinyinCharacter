/**
 * The classic (古籍) detail page must offer the same actions as the other
 * reading pages.
 *
 * /poetry/[id] and /sutra/[id] both offer: 朗读 (read aloud), 打印 (print,
 * with the download audit) and 保存到字帖 (save as a worksheet). The classic
 * page offered NONE of them - only a chapter picker, the text, and the
 * audio playlist at the bottom.
 *
 * That matters because the classics are the largest body of text on the
 * site (190 books, 3021 chapters) and are the most likely material for
 * copying practice - which is exactly what the worksheet and the print
 * button are for.
 *
 * The print part has a hard contract: @media print in app/globals.css uses
 * a "hide everything, whitelist the printable containers" strategy. A
 * printable container that is not in that whitelist prints a BLANK page.
 * That regression already happened twice (2026-07-03 four-line, 2026-07-04
 * poem and sutra), so the class has to be in all three lists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

const PAGE = 'app/ancient/[slug]/page.tsx';
const CSS = 'app/globals.css';

describe('the classic detail page', () => {
  it('offers a print button', () => {
    const source = readSource(PAGE);
    expect(source, 'the classic page must offer a print button').toContain(
      'PrintButton',
    );
    expect(
      source,
      'the print button must point at the classic print endpoint',
    ).toMatch(/endpoint=\{`\/api\/classics\/\$\{[^}]+\}\/print`\}/);
  });

  it('offers a read-aloud button', () => {
    const source = readSource(PAGE);
    expect(source, 'the classic page must offer a read-aloud button').toContain(
      'ReadAloudButton',
    );
  });

  it('offers to save the chapter as a worksheet', () => {
    const source = readSource(PAGE);
    expect(
      source,
      'the classic page must offer to save the chapter as a worksheet',
    ).toContain('SaveAsWorksheetButton');
  });

  it('marks the reading area as printable', () => {
    const source = readSource(PAGE);
    expect(
      source,
      'the classic reading area must carry the printable container class',
    ).toContain('classic-print-area');
  });
});

describe('the classic print endpoint', () => {
  it('exists', () => {
    const source = readSource('app/api/classics/[slug]/print/route.ts');
    expect(source, 'the route must export a POST handler').toContain(
      'export async function POST',
    );
  });

  it('requires a logged-in user', () => {
    const source = readSource('app/api/classics/[slug]/print/route.ts');
    expect(source, 'the route must require a user').toContain('requireUser');
  });

  it('records the download so the admin can see what was printed', () => {
    const source = readSource('app/api/classics/[slug]/print/route.ts');
    expect(source, 'the route must log the download').toContain('logDownload');
    expect(
      source,
      "the download must be attributed to the classic source type",
    ).toContain("sourceType: 'classic'");
  });

  it('writes an audit entry', () => {
    const source = readSource('app/api/classics/[slug]/print/route.ts');
    expect(source, 'the route must write an audit entry').toContain(
      'logUserAction',
    );
  });

  it('checks that the book exists before answering', () => {
    const source = readSource('app/api/classics/[slug]/print/route.ts');
    expect(source, 'the route must verify the book exists').toContain(
      'getClassicMetaBySlug',
    );
  });
});

describe('the download source type', () => {
  it('accepts "classic"', () => {
    const source = readSource('lib/downloads.ts');
    expect(
      source,
      'the downloads table records a classic print',
    ).toContain("'classic'");
  });
});

describe('the print CSS whitelist', () => {
  it('whitelists .classic-print-area so the classic page does not print blank', () => {
    const css = readSource(CSS);
    const block = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/m);
    expect(block, '@media print block not found in app/globals.css').toBeTruthy();
    const printBlock = block![1];

    // The class has to be in all three lists: visibility, position and
    // print-color-adjust. Missing any one of them produces a blank or
    // badly laid out page.
    //
    // ⚠️ The check is that the class appears as a SELECTOR of the rule —
    // not merely somewhere inside it. `.classic-print-area *` (the
    // descendant selector) also matches a loose search, and whitelisting
    // only the descendants leaves the container itself hidden, which
    // prints a blank page just the same.
    const rules = [...printBlock.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    // The selectors of every rule that sets the given property, split into
    // individual class names.
    const selectorsFor = (property: string): string[] =>
      rules
        .filter((rule) => new RegExp(`${property}\\s*:`).test(rule[2]))
        .flatMap((rule) =>
          rule[1]
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
        );

    const visibilitySelectors = selectorsFor('visibility');
    expect(
      visibilitySelectors,
      'the printable container itself must be made visible',
    ).toContain('.classic-print-area');

    const positionSelectors = selectorsFor('position');
    expect(
      positionSelectors,
      'the printable container must be positioned for the page',
    ).toContain('.classic-print-area');

    const colorAdjustSelectors = selectorsFor('print-color-adjust');
    expect(
      colorAdjustSelectors,
      'the printable container must keep its backgrounds',
    ).toContain('.classic-print-area');
  });
});

describe('the audit event', () => {
  it('records a classic print', () => {
    const source = readSource('lib/audit-format.ts');
    expect(source, 'the audit format must know the classic event').toContain(
      'classic_saved',
    );
  });
});
