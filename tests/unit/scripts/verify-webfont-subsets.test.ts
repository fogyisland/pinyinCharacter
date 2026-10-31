import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../../../scripts/fonts/build-webfont-subsets.mjs';
import {
  verifyAll,
  LIMITS,
  parseFaces,
  parseFaceUrl,
  checkFaceFamily,
  checkFaceWeight,
  checkFaceDirectory,
  checkManifestFiles,
  classifyUnpaintedLatin,
  checkLatinToneVowels,
} from '../../../scripts/fonts/verify-webfont-subsets.mjs';

const MANIFEST_PATH = fileURLToPath(
  new URL('../../../public/font/fonts-manifest.json', import.meta.url),
);

/** One family of the site. */
function familyOf(key: string) {
  const family = FAMILIES.find((entry) => entry.key === key);
  if (!family) throw new Error(`the family ${key} is missing`);
  return family;
}

/** A face of the sans family, as the stylesheet declares it. */
const SANS_FACE = `@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url(/font/web/sans/hot.woff2?v=f31ca9b32566) format('woff2');
  unicode-range: U+4E00-4E01;
}`;

/** A face of the brand family — the static one, one file per weight. */
function wenkaiFace(weight: string, file: string) {
  return `@font-face {
  font-family: 'LXGW WenKai TC';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(/font/web/wenkai/${file}?v=b7529ec33fa7) format('woff2');
  unicode-range: U+4E00;
}`;
}

describe('verify-webfont-subsets', () => {
  it(
    'passes on the committed font artifacts',
    async () => {
      const result = await verifyAll();
      if (!result.ok) {
        console.error(result.errors.join('\n'));
      }
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    },
    300_000,
  );

  it('publishes the size limits from the design', () => {
    expect(LIMITS.hotBytes).toBe(96 * 1024);
    expect(LIMITS.extBlockBytes).toBe(7 * 1024);
    expect(LIMITS.cssBytes).toBe(175 * 1024);
    expect(LIMITS.sansCssBytes).toBe(65 * 1024);
    expect(LIMITS.maxFontFilesPerPage).toBe(12);
    expect(LIMITS.pageFontBytes['/dictionary']).toBe(330 * 1024);
  });

  it('publishes the size limit of the Latin hot tier', () => {
    // The Latin hot tier is a file of its own, and its budget is its own:
    // the Latin TAIL reuses the Ext budget.
    expect(LIMITS.latinBytes).toBe(12 * 1024);
  });
});

describe('classifyUnpaintedLatin', () => {
  /** A built stylesheet that claims one Latin code point and nothing else. */
  const cpToBlock = new Map<number, string>([[0x0041, 'latin']]);

  it('reports a Latin character the font can draw but no subset claims', () => {
    // This is the blind spot: the Latin tier was never built, and the page
    // budget used to report that as an INFO and exit green.
    const covered = new Set([0x0041, 0x0042]);
    const result = classifyUnpaintedLatin('AB', cpToBlock, covered);
    expect(result.missing).toEqual([0x0042]);
    expect(result.unsupported).toEqual([]);
  });

  it('reports a Latin character the font cannot draw as a limit of the font', () => {
    // The browser falls back to the system font for it — that is the FONT's
    // limit, not a bug of the pipeline, so it must not be an error.
    const covered = new Set([0x0041]);
    const result = classifyUnpaintedLatin('AB', cpToBlock, covered);
    expect(result.missing).toEqual([]);
    expect(result.unsupported).toEqual([0x0042]);
  });

  it('says nothing about a character a subset does claim', () => {
    const result = classifyUnpaintedLatin('A', cpToBlock, new Set([0x0041]));
    expect(result.missing).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it('ignores the Chinese characters of the page', () => {
    // The Chinese part keeps the behaviour it always had: reported, not
    // failed. This rule is about the Latin tier.
    const result = classifyUnpaintedLatin('一A', cpToBlock, new Set([0x0041, 0x4e00]));
    expect(result.missing).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it('errs towards the error when the coverage cannot be read', () => {
    // Without the coverage the check cannot scope the characters, and a
    // green that cannot be trusted is worse than a red that can be
    // explained.
    const result = classifyUnpaintedLatin('B', cpToBlock, null);
    expect(result.missing).toEqual([0x0042]);
  });
});

describe('checkLatinToneVowels', () => {
  const vowels = ['ā', 'á', 'ǎ', 'à'];

  it('says nothing when the Latin hot block holds every tone vowel', () => {
    const block = { points: new Set(vowels.map((vowel) => vowel.codePointAt(0)!)) };
    expect(checkLatinToneVowels(familyOf('sans'), block, vowels)).toEqual([]);
  });

  it('names the tone vowels the Latin hot block is missing', () => {
    const block = { points: new Set([vowels[0].codePointAt(0)!]) };
    const errors = checkLatinToneVowels(familyOf('sans'), block, vowels);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('á');
    expect(errors[0]).toContain('sans');
  });

  it('reports a family whose stylesheet has no Latin hot block at all', () => {
    const errors = checkLatinToneVowels(familyOf('sans'), undefined, vowels);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Latin');
  });
});

describe('parseFaces', () => {
  it('reads every declaration of a face', () => {
    const faces = parseFaces(SANS_FACE);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toEqual({
      fontFamily: 'Noto Sans SC',
      weight: '400 700',
      fontStyle: 'normal',
      display: 'swap',
      src: '/font/web/sans/hot.woff2?v=f31ca9b32566',
      range: 'U+4E00-4E01',
    });
  });

  it('takes the quotes off the family and the style', () => {
    const faces = parseFaces(
      `@font-face { font-family: "Noto Serif SC"; font-style: normal; }`,
    );
    expect(faces[0].fontFamily).toBe('Noto Serif SC');
    expect(faces[0].fontStyle).toBe('normal');
  });
});

describe('parseFaceUrl', () => {
  it('reads the directory, the file and the token of a URL', () => {
    expect(parseFaceUrl('/font/web/sans/hot.woff2?v=f31ca9b32566')).toEqual({
      dir: 'sans',
      file: 'hot.woff2',
      token: 'f31ca9b32566',
    });
  });

  it('returns null for a URL that is not under /font/web/', () => {
    expect(parseFaceUrl('/font/fonts-sans.css')).toBe(null);
  });
});

describe('checkFaceFamily', () => {
  it('reports a face that declares another family', () => {
    // The face points at a real file with real glyphs, so every other
    // check is green — but the page is painted in another typeface.
    const [face] = parseFaces(SANS_FACE);
    const errors = checkFaceFamily(familyOf('sans'), {
      ...face,
      fontFamily: 'Noto Sans SC 2',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Noto Sans SC 2');
  });

  it('reports a face that is not normal', () => {
    const [face] = parseFaces(SANS_FACE);
    const errors = checkFaceFamily(familyOf('sans'), { ...face, fontStyle: 'italic' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('italic');
  });

  it('says nothing when the family and the style are right', () => {
    const [face] = parseFaces(SANS_FACE);
    expect(checkFaceFamily(familyOf('sans'), face)).toEqual([]);
  });
});

describe('checkFaceWeight', () => {
  it('reports a static face that points at the file of the other weight', () => {
    // The 700 face points at the 400 file: the file really holds the
    // glyphs, so the tofu gate stays green, and the page is painted in the
    // wrong weight.
    const [face] = parseFaces(wenkaiFace('700', 'ext-001-400.woff2'));
    const errors = checkFaceWeight(familyOf('wenkai'), face);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ext-001-400.woff2');
  });

  it('says nothing when the static face points at the file of its weight', () => {
    const [face] = parseFaces(wenkaiFace('700', 'ext-001-700.woff2'));
    expect(checkFaceWeight(familyOf('wenkai'), face)).toEqual([]);
  });

  it('does not check a variable family', () => {
    // One file per block, one face that declares `400 700`: there is no
    // file of a weight to point at.
    const [face] = parseFaces(
      `@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url(/font/web/sans/hot-400.woff2?v=f31ca9b32566) format('woff2');
  unicode-range: U+4E00;
}`,
    );
    expect(checkFaceWeight(familyOf('sans'), face)).toEqual([]);
  });
});

describe('checkFaceDirectory', () => {
  it('says nothing when the face points at the directory of its family', () => {
    const errors = checkFaceDirectory(familyOf('sans'), {
      src: '/font/web/sans/hot.woff2?v=f31ca9b32566',
    });
    expect(errors).toEqual([]);
  });

  it('reports a face that points at the directory of another family', () => {
    // The browser would download the serif file for the sans face: the page
    // is painted in another typeface, and the token of sans no longer
    // describes the bytes that are served under it.
    const errors = checkFaceDirectory(familyOf('sans'), {
      src: '/font/web/serif/hot.woff2?v=f31ca9b32566',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('sans');
    expect(errors[0]).toContain('/font/web/serif/hot.woff2');
  });

  it('says nothing when the URL cannot be parsed', () => {
    // The main loop reports a broken URL already; nothing is said twice.
    const errors = checkFaceDirectory(familyOf('sans'), {
      src: '/font/web/sans/hot.woff2?x=1',
    });
    expect(errors).toEqual([]);
  });
});

describe('checkManifestFiles', () => {
  it('reports a family that points at the stylesheet of another family', () => {
    // lib/font-css.ts builds the URL of the stylesheet of a family out of
    // manifest.files.<family>: a wrong value drops the stylesheet from the
    // page, and nothing else notices.
    const errors = checkManifestFiles(
      {
        files: {
          sans: '/font/fonts-sans.css',
          serif: '/font/fonts-sans.css',
          wenkai: '/font/fonts-wenkai.css',
        },
      },
      FAMILIES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('serif');
  });

  it('reports a family the manifest does not list', () => {
    const errors = checkManifestFiles(
      { files: { sans: '/font/fonts-sans.css', wenkai: '/font/fonts-wenkai.css' } },
      FAMILIES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('serif');
  });

  it('says nothing about the committed manifest', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(checkManifestFiles(manifest, FAMILIES)).toEqual([]);
  });

  it('reports a path that only ends with the name of the stylesheet', () => {
    // `/font/xfonts-sans.css` ends with `fonts-sans.css`, but the file does
    // not exist: the page would link a 404 and the whole sans family would
    // fall back to the system font.
    const errors = checkManifestFiles(
      {
        files: {
          sans: '/font/xfonts-sans.css',
          serif: '/font/fonts-serif.css',
          wenkai: '/font/fonts-wenkai.css',
        },
      },
      FAMILIES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/font/xfonts-sans.css');
  });

  it('says nothing about the exact path of a stylesheet', () => {
    expect(
      checkManifestFiles(
        {
          files: {
            sans: '/font/fonts-sans.css',
            serif: '/font/fonts-serif.css',
            wenkai: '/font/fonts-wenkai.css',
          },
        },
        FAMILIES,
      ),
    ).toEqual([]);
  });
});
