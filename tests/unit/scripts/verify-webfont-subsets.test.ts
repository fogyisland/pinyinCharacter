import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../../../scripts/fonts/build-webfont-subsets.mjs';
import {
  verifyAll,
  LIMITS,
  parseFaces,
  checkFaceFamily,
  checkFaceWeight,
  checkManifestFiles,
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
});
