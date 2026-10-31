import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  checkSampleShape,
  checkSampleIsDeeper,
} from '../../../scripts/fonts/verify-webfont-subsets.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs');
const MANIFEST_PATH = fileURLToPath(
  new URL('../../../public/font/fonts-manifest.json', import.meta.url),
);
const SAMPLE_PATH = fileURLToPath(
  new URL('../../../data/font-page-sample.json', import.meta.url),
);
const SEED_PATH = fileURLToPath(
  new URL('../../../data/font-page-profiles.json', import.meta.url),
);

/** The three typefaces of the site. */
const FAMILY_KEYS = ['sans', 'serif', 'wenkai'] as const;

/** The four pages the budget is measured on. */
const MEASURED_PATHS = ['/', '/dictionary', '/poetry', '/stories'] as const;

/** The pages whose content never changes from one request to the next. */
const DETERMINISTIC_PATHS = ['/dictionary', '/poetry'] as const;

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
    expect(LIMITS.latinBytes).toBe(12 * 1024);
    expect(LIMITS.maxFontFilesPerPage).toBe(153);
    expect(LIMITS.pageFontBytes['/']).toBe(560128);
    expect(LIMITS.pageFontBytes['/dictionary']).toBe(412672);
    expect(LIMITS.pageFontBytes['/poetry']).toBe(301056);
    expect(LIMITS.pageFontBytes['/stories']).toBe(925696);
    expect(LIMITS.unionSampleBytes['/']).toBe(839680);
    expect(LIMITS.unionSampleBytes['/dictionary']).toBe(330752);
    expect(LIMITS.unionSampleBytes['/poetry']).toBe(241664);
    expect(LIMITS.unionSampleBytes['/stories']).toBe(1214464);
    expect(LIMITS.maxUnionSampleFilesPerPage).toBe(255);
  });

  it('publishes the size limit of the Latin hot tier', () => {
    // The Latin hot tier is a file of its own, and its budget is its own:
    // the Latin TAIL reuses the Ext budget.
    expect(LIMITS.latinBytes).toBe(12 * 1024);
  });
});

/**
 * The page sample is the ruler of the page budget.
 *
 * ⚠️ The numbers below are NOT measured by this test — they are the
 * measurement of the controller (2026-10-31, eight rounds of the live
 * pages). They are pinned here so that a re-capture, a re-order of the
 * characters or a truncation of the file is caught by the suite instead of
 * by a reader of the budget.
 */
describe('the page sample', () => {
  /** The character count of every page and family, per the measurement. */
  const EXPECTED_COUNTS: Record<string, Record<string, number>> = {
    '/': { sans: 144, serif: 119, wenkai: 132 },
    '/dictionary': { sans: 147, serif: 80, wenkai: 9 },
    '/poetry': { sans: 115, serif: 0, wenkai: 77 },
    '/stories': { sans: 109, serif: 604, wenkai: 17 },
  };

  /** The sample, parsed. */
  function sample(): Record<string, any> {
    return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
  }

  /** The seed, parsed. */
  function seed(): Record<string, any> {
    return JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  }

  it('is the union of eight rounds of the live pages', () => {
    const value = sample();
    expect(value.rounds).toBe(8);
    expect(typeof value.capturedAt).toBe('string');
    expect(value.capturedAt).not.toBe('');
    expect(typeof value.source).toBe('string');
    expect(value.source).not.toBe('');
    for (const path of MEASURED_PATHS) {
      expect(value.pages).toHaveProperty([path]);
      for (const family of FAMILY_KEYS) {
        expect(typeof value.pages[path][family]).toBe('string');
      }
    }
  });

  it('holds exactly the characters of the measurement', () => {
    const value = sample();
    for (const path of MEASURED_PATHS) {
      for (const family of FAMILY_KEYS) {
        expect([path, family, [...value.pages[path][family]].length]).toEqual([
          path,
          family,
          EXPECTED_COUNTS[path][family],
        ]);
      }
    }
  });

  it('is shaped the way the gate expects it', () => {
    expect(checkSampleShape(sample())).toEqual([]);
  });

  it('paints the same characters as the seed on the deterministic pages', () => {
    // The dictionary index and the poetry index answer with the same body
    // on every request: if the capture saw something else, the sample is
    // not what it claims to be.
    const value = sample();
    const floor = seed();
    for (const path of DETERMINISTIC_PATHS) {
      for (const family of FAMILY_KEYS) {
        expect([path, family, value.pages[path][family] === floor.pages[path][family]]).toEqual([
          path,
          family,
          true,
        ]);
      }
    }
  });

  it('refuses a sample that declares no round', () => {
    const value = sample();
    delete value.rounds;
    const errors = checkSampleShape(value);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('round');
  });

  it('refuses a sample that misses a page', () => {
    const value = sample();
    delete value.pages['/stories'];
    const errors = checkSampleShape(value);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('/stories');
  });
});

/**
 * The four guards that prove the gate is not circular.
 *
 * ⚠️ The guard itself is proved end to end further down (a child process
 * that has to exit non-zero). These are the same rules, checked one by
 * one, so that a broken guard names itself instead of only making the run
 * red.
 */
describe('checkSampleIsDeeper', () => {
  /** A measurement of a profile: the depth and the files per page. */
  function measured(extChars: number, files: Record<string, number>) {
    return {
      extChars,
      costs: Object.keys(files).map((path) => ({ path, files: files[path] })),
    };
  }

  /** The characters of the deterministic pages, one string per family. */
  const DETERMINISTIC = {
    '/dictionary': { sans: 'a', serif: 'b', wenkai: 'c' },
    '/poetry': { sans: 'd', serif: '', wenkai: 'e' },
  };

  /** The seed: 196 characters outside the hot tier, eight files a page. */
  const seed = { pages: DETERMINISTIC };

  /** The sample: deeper than the seed, and it downloads more files. */
  const sample = { rounds: 8, pages: DETERMINISTIC };

  it('says nothing when the sample reaches deeper than the seed', () => {
    const errors = checkSampleIsDeeper(
      sample,
      seed,
      measured(739, { '/': 175 }),
      measured(196, { '/': 8 }),
    );
    expect(errors).toEqual([]);
  });

  it('names a sample that is no deeper than the seed', () => {
    const errors = checkSampleIsDeeper(
      sample,
      seed,
      measured(196, { '/': 175 }),
      measured(196, { '/': 8 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/circular|循环/);
  });

  it('names a sample that downloads no more files than the seed', () => {
    const errors = checkSampleIsDeeper(
      sample,
      seed,
      measured(739, { '/': 8 }),
      measured(196, { '/': 8 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/circular|循环/);
  });

  it('names a sample that declares no round', () => {
    const errors = checkSampleIsDeeper(
      { rounds: 1, pages: sample.pages },
      seed,
      measured(739, { '/': 175 }),
      measured(196, { '/': 8 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/circular|循环/);
  });

  it('names a deterministic page the capture got wrong', () => {
    const errors = checkSampleIsDeeper(
      { rounds: 8, pages: { '/dictionary': { sans: 'b' }, '/poetry': { sans: 'a' } } },
      seed,
      measured(739, { '/': 175 }),
      measured(196, { '/': 8 }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('/dictionary');
  });
});

/**
 * The anti-circularity guards, and the two proofs that they really bite.
 *
 * ⚠️ These two tests run the verifier AS A CHILD PROCESS with
 * `WEBFONT_SAMPLE_PATH` pointing at a temporary file. They are not unit
 * tests of a helper: the gate has to be shown RED, end to end, with the
 * exit code of the process — that is the only proof that a broken sample
 * can never be waved through by a green run.
 */
describe('the page budget gate is not circular', () => {
  /** The directories the temporary samples live in. */
  const temporaries: string[] = [];

  afterEach(() => {
    while (temporaries.length > 0) {
      const dir = temporaries.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Write a sample into a temporary file and return its path.
   *
   * @param {object} value the sample to write
   * @returns {string} the path of the file
   */
  function writeSample(value: object): string {
    const dir = mkdtempSync(join(tmpdir(), 'webfont-sample-'));
    temporaries.push(dir);
    const path = join(dir, 'font-page-sample.json');
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return path;
  }

  /**
   * Run the verifier against a sample file.
   *
   * @param {string} samplePath the sample to measure
   * @returns {{ status: number | null, output: string }}
   */
  function runVerifier(samplePath: string): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, WEBFONT_SAMPLE_PATH: samplePath },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  it(
    'goes red when the sample is the seed itself',
    () => {
      // The seed IS the hot tier's seed: its characters are in the hot tier
      // by construction, so it can never reach an Ext block. A gate that
      // measures the seed measures nothing — it must say so and fail.
      const path = writeSample(JSON.parse(readFileSync(SEED_PATH, 'utf8')));
      const run = runVerifier(path);
      expect(run.status).not.toBe(0);
      expect(run.output).toMatch(/circular|循环/);
    },
    300_000,
  );

  it(
    'goes red when the sample is over its budget',
    () => {
      // A sample that paints far more Ext blocks than it may: the byte
      // budget and the file count of the sample are the gate, so this has
      // to fail — and it has to fail AS A BUDGET, not as a circularity.
      //
      // The characters come from ANOTHER page of the same sample, so every
      // one of them is a character a real page really painted: it is
      // claimed by a subset and it pulls a real file into the page. A
      // character no face claims would add no bytes at all, and the test
      // would prove nothing.
      const value = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
      value.pages['/'].serif = value.pages['/'].serif + value.pages['/stories'].serif;
      const path = writeSample(value);
      const run = runVerifier(path);
      expect(run.status).not.toBe(0);
      expect(run.output).toContain('the budget is');
      expect(run.output).not.toMatch(/circular|循环/);
    },
    300_000,
  );
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
