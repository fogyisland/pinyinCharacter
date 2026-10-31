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
  checkProfileHasLatin,
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
/**
 * The declaration face of the verifier.
 *
 * `tsconfig.json` sets `allowJs: false`, so the `.mjs` implementation is
 * NEVER type checked: this hand-written file is the only type face and it
 * can drift apart from the implementation SILENTLY. The check below is the
 * machine guard against that drift.
 */
const DECLARATION_PATH = fileURLToPath(
  new URL('../../../scripts/fonts/verify-webfont-subsets.d.mts', import.meta.url),
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

/* -------------------------------------------------------------------------
 * The scanner that reads the shape of the two faces of the report.
 *
 * The declaration face (`.d.mts`) and the implementation face (`.mjs`) are
 * written by hand and they do NOT agree on how they write a member:
 *
 *   the declaration writes `name: Type;` and may nest a type in a member
 *     (`sample: { path: string; … }`);
 *   the implementation writes `name: Type,` or the shorthand `name,`.
 *
 * So the reader below accepts all three shapes and cuts the block by DEPTH:
 * the fields of a nested type belong to THAT member, not to the report.
 * ---------------------------------------------------------------------- */

/** The words a regular expression may follow. */
const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
  'instanceof',
]);

/**
 * Does the slash at this place open a regular expression?
 *
 * The slash is a division when the code before it can end a value: an
 * identifier, a number, a parenthesis or a bracket.
 *
 * @param lastChar the last significant character before the slash
 * @param word the word that ends right before the slash, if any
 * @returns true when the slash opens a regular expression
 */
function startsRegularExpression(lastChar: string, word: string): boolean {
  if (word !== '') return KEYWORDS_BEFORE_REGEX.has(word);
  if (lastChar === '') return true;
  if (lastChar === ')' || lastChar === ']' || lastChar === '}') return false;
  if (/[A-Za-z0-9_$]/.test(lastChar)) return false;
  return true;
}

/**
 * The characters of a source that are CODE.
 *
 * A mask, not a parser: the strings, the comments and the regular
 * expressions are masked out, so a brace inside a string cannot unbalance
 * the counting and an apostrophe inside a comment cannot start a string.
 *
 * The scanner is a small stack machine, because the text of a template
 * literal is NOT code while the `${…}` of one IS.
 *
 * @param source the text to scan
 * @returns one flag per character: true when the character is code
 */
function codeMask(source: string): boolean[] {
  const mask: boolean[] = new Array<boolean>(source.length).fill(false);
  const stack: Array<'template' | 'interp'> = [];
  const interpDepth: number[] = [];
  let index = 0;
  let lastChar = '';
  let word = '';

  while (index < source.length) {
    const char = source[index];

    // --- the text of a template literal is not code ----------------------
    if (stack[stack.length - 1] === 'template') {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '`') {
        stack.pop();
        index += 1;
        lastChar = '`';
        word = '';
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        stack.push('interp');
        interpDepth.push(0);
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    // --- the code of a `${…}` of a template literal ----------------------
    if (stack[stack.length - 1] === 'interp') {
      const depth = interpDepth[interpDepth.length - 1];
      if (char === '{') {
        interpDepth[interpDepth.length - 1] = depth + 1;
        mask[index] = true;
        lastChar = '{';
        word = '';
        index += 1;
        continue;
      }
      if (char === '}') {
        if (depth === 0) {
          // the brace that closes the interpolation itself
          stack.pop();
          interpDepth.pop();
          index += 1;
          continue;
        }
        interpDepth[interpDepth.length - 1] = depth - 1;
        mask[index] = true;
        lastChar = '}';
        word = '';
        index += 1;
        continue;
      }
    }

    // --- a line comment runs to the end of the line ----------------------
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    // --- a block comment runs to its end marker --------------------------
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }

    // --- a quoted string runs to the matching quote ----------------------
    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      lastChar = quote;
      word = '';
      continue;
    }

    // --- the start of a template literal ---------------------------------
    if (char === '`') {
      stack.push('template');
      index += 1;
      continue;
    }

    // --- a regular expression --------------------------------------------
    if (char === '/' && startsRegularExpression(lastChar, word)) {
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const inner = source[index];
        if (inner === '\\') {
          index += 2;
          continue;
        }
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) {
          index += 1;
          break;
        } else if (inner === '\n') break;
        index += 1;
      }
      while (index < source.length && /[a-z]/.test(source[index])) index += 1;
      lastChar = '/';
      word = '';
      continue;
    }

    // --- ordinary code ---------------------------------------------------
    mask[index] = true;
    if (/[A-Za-z0-9_$]/.test(char)) word += char;
    else if (!/\s/.test(char)) word = '';
    if (!/\s/.test(char)) lastChar = char;
    index += 1;
  }

  return mask;
}

/**
 * The index of the `}` that closes the block that opens at `openIndex`.
 *
 * @param source the text to scan
 * @param mask the code mask of the text
 * @param openIndex the index of the `{`
 * @returns the index of the matching `}`, or -1 when there is none
 */
function matchingBrace(source: string, mask: boolean[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (!mask[index]) continue;
    const char = source[index];
    if (char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * The names of the members at the TOP level of the block that opens at
 * `openIndex`.
 *
 * A member is written in one of three ways and all three are accepted:
 * `name: Type`, `name: Type,` and the shorthand `name,`. The block is cut
 * by DEPTH, so the fields of a type that is nested inside a member are the
 * fields of THAT member and not the fields of the block.
 *
 * @param source the text to scan
 * @param mask the code mask of the text
 * @param openIndex the index of the `{`
 * @returns the names of the top level members, in the order they are written
 */
function blockMembers(source: string, mask: boolean[], openIndex: number): string[] {
  const members: string[] = [];
  let depth = 0;
  let previous = '';
  let index = openIndex + 1;

  while (index < source.length) {
    if (!mask[index]) {
      index += 1;
      continue;
    }
    const char = source[index];

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      previous = char;
      index += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      if (depth < 0) break;
      previous = char;
      index += 1;
      continue;
    }
    if (depth !== 0) {
      if (!/\s/.test(char)) previous = char;
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '.' && source.startsWith('...', index)) {
      // A spread member at the top level of the block. The extractor cannot
      // see what it carries, so the two faces could compare EQUAL while the
      // implementation returns a member the declaration does not declare —
      // the very defect this guard exists to catch. Refuse to compare
      // instead of comparing blind: a loud red here is the point.
      throw new Error(
        'the block has a spread member (`...`) at its top level and the ' +
          'guard cannot see what it carries — the guard must be taught to ' +
          'read it before the two faces may be compared',
      );
    }

    if (!/[A-Za-z_$]/.test(char)) {
      previous = char;
      index += 1;
      continue;
    }

    // An identifier: is it the name of a member of this block?
    let name = '';
    while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
      name += source[index];
      index += 1;
    }
    let next = index;
    while (
      next < source.length &&
      (!mask[next] || /\s/.test(source[next]))
    ) {
      next += 1;
    }
    const nextChar = next < source.length ? source[next] : '';
    const isKeyed = nextChar === ':';
    const isShorthand =
      (nextChar === ',' || nextChar === ';' || nextChar === '}') &&
      (previous === '{' || previous === ',' || previous === ';');
    if (isKeyed || isShorthand) members.push(name);
    previous = name.length > 0 ? name[name.length - 1] : previous;
    index = next;
  }

  return members;
}

/**
 * The index of the `{` of the LAST `return {…}` of a region.
 *
 * @param source the text to scan
 * @param mask the code mask of the text
 * @param from the first index of the region
 * @param to the index behind the region
 * @returns the index of the `{`, or -1 when there is none
 */
function lastReturnObject(
  source: string,
  mask: boolean[],
  from: number,
  to: number,
): number {
  let found = -1;
  for (let index = from; index < to; index += 1) {
    if (!source.startsWith('return', index)) continue;
    let allCode = true;
    for (let offset = 0; offset < 6; offset += 1) {
      if (!mask[index + offset]) allCode = false;
    }
    if (!allCode) continue;
    const before = index > 0 && mask[index - 1] ? source[index - 1] : ' ';
    if (/[A-Za-z0-9_$]/.test(before)) continue;
    let next = index + 6;
    while (next < to && (!mask[next] || /\s/.test(source[next]))) next += 1;
    if (next < to && source[next] === '{') found = next;
  }
  return found;
}

/** The number of the braces of the code of a source. */
function braceCounts(source: string, mask: boolean[]): { open: number; close: number } {
  let open = 0;
  let close = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!mask[index]) continue;
    if (source[index] === '{') open += 1;
    else if (source[index] === '}') close += 1;
  }
  return { open, close };
}

describe('the declaration face and the implementation face agree', () => {
  const declaration = readFileSync(DECLARATION_PATH, 'utf8');
  const declarationMask = codeMask(declaration);
  const implementation = readFileSync(SCRIPT, 'utf8');
  const implementationMask = codeMask(implementation);

  it('the braces of the two files balance', () => {
    // The scanner above masks the strings, the comments and the regular
    // expressions. If the masking failed anywhere, the braces of the code
    // would NOT balance — so this assertion is the proof that the scanner
    // did not fall over on a `{` inside a string, a `${` inside a template
    // or a `{` inside a regular expression.
    const declared = braceCounts(declaration, declarationMask);
    expect(declared.open).toBe(declared.close);
    const coded = braceCounts(implementation, implementationMask);
    expect(coded.open).toBe(coded.close);
  });

  it('the report of the declaration and the report of the implementation have the same members', () => {
    // The declaration: the body of `interface WebfontVerificationReport`.
    const interfaceIndex = declaration.indexOf('interface WebfontVerificationReport');
    expect(interfaceIndex).toBeGreaterThan(-1);
    const declaredOpen = declaration.indexOf('{', interfaceIndex);
    expect(declaredOpen).toBeGreaterThan(-1);
    const declaredMembers = blockMembers(declaration, declarationMask, declaredOpen);

    // The implementation: the last `return {…}` of `verifyAll()`.
    const functionIndex = implementation.indexOf('export async function verifyAll()');
    expect(functionIndex).toBeGreaterThan(-1);
    const bodyOpen = implementation.indexOf('{', functionIndex);
    expect(bodyOpen).toBeGreaterThan(-1);
    const bodyClose = matchingBrace(implementation, implementationMask, bodyOpen);
    expect(bodyClose).toBeGreaterThan(bodyOpen);
    const returnedOpen = lastReturnObject(
      implementation,
      implementationMask,
      bodyOpen,
      bodyClose,
    );
    expect(returnedOpen).toBeGreaterThan(-1);
    const returnedMembers = blockMembers(
      implementation,
      implementationMask,
      returnedOpen,
    );

    // ⚠️ The guard against a VACUOUS PASS: an extractor that reads nothing
    // out of both faces would make the equality below true for ever. Two
    // floors keep that impossible: both faces must carry a real number of
    // members, and the members the C-1 root cause depends on must be in
    // BOTH of them.
    expect(declaredMembers.length).toBeGreaterThanOrEqual(5);
    expect(returnedMembers.length).toBeGreaterThanOrEqual(5);
    for (const member of [
      'ok',
      'errors',
      'stats',
      'costs',
      'floorCosts',
      'floorNotes',
      'sample',
      'fixtureErrors',
    ]) {
      expect(declaredMembers).toContain(member);
      expect(returnedMembers).toContain(member);
    }

    // The comparison itself: the order is not compared, the SETS are.
    expect([...declaredMembers].sort()).toEqual([...returnedMembers].sort());
  });

  it('refuses to compare a block that hides a member behind a spread', () => {
    // A spread at the top level carries a member the extractor cannot see,
    // so the two faces could compare EQUAL while the implementation returns
    // something the declaration does not declare — the very defect this
    // guard exists to catch. It must say so instead of comparing blind.
    const source = 'const report = { ok: true, ...rest };';
    expect(() =>
      blockMembers(source, codeMask(source), source.indexOf('{')),
    ).toThrow(/spread member/);
  });
});

describe('checkProfileHasLatin', () => {
  it('says that a profile without a single Latin character is a broken fixture', () => {
    const messages = checkProfileHasLatin(
      { pages: { '/': { sans: '汉字', serif: '', wenkai: '' } } },
      'seed',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('the seed holds no Latin character at all');
    expect(messages[0]).toContain('the page budget check of the Latin tier');
  });

  it('names the profile it was given', () => {
    const messages = checkProfileHasLatin(
      { pages: { '/': { sans: '汉字', serif: '', wenkai: '' } } },
      'sample',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('the sample holds no Latin character at all');
    expect(messages[0]).not.toContain('seed');
  });

  it('is quiet about a profile that holds Latin characters', () => {
    expect(
      checkProfileHasLatin(
        { pages: { '/': { sans: 'a汉', serif: 'é', wenkai: '' } } },
        'sample',
      ),
    ).toEqual([]);
  });

  it('calls an empty profile a broken fixture as well', () => {
    const messages = checkProfileHasLatin({ pages: {} }, 'seed');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('the seed holds no Latin character at all');
  });
});

describe('the shipped font files', () => {
  /** The three stylesheets of the site. */
  const STYLESHEETS = [
    { family: 'sans', path: join(REPO_ROOT, 'public', 'font', 'fonts-sans.css') },
    { family: 'serif', path: join(REPO_ROOT, 'public', 'font', 'fonts-serif.css') },
    { family: 'wenkai', path: join(REPO_ROOT, 'public', 'font', 'fonts-wenkai.css') },
  ];

  /**
   * The files a stylesheet points at.
   *
   * The STYLESHEET is the source of truth and NOT the disk: the admin
   * pipeline writes the next version into `public/font/web/r<token>/…` and
   * keeps the old versions on the disk, so a count of the files on the disk
   * would go red as soon as the next version is built. The version token is
   * stripped, so the same file under two tokens is one file.
   *
   * @param path the path of the stylesheet
   * @returns the paths of the files the stylesheet points at, without a token
   */
  function stylesheetFiles(path: string): string[] {
    const css = readFileSync(path, 'utf8');
    const files = new Set<string>();
    for (const match of css.matchAll(/url\(([^)]*)\)/g)) {
      const raw = match[1].trim().replace(/^['"]|['"]$/g, '');
      files.add(raw.split('?')[0]);
    }
    return [...files];
  }

  /** The name of a file without its directory. */
  function basename(file: string): string {
    return file.split('/').pop() ?? file;
  }

  /** A number with a thin space between the groups of three digits. */
  function grouped(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /**
   * The text of a file with every kind of space normalised to one space.
   *
   * The prose of the repository was written by hand: it may hold a no-break
   * space or a narrow space between the digits, and the check must not turn
   * a different space into a red run.
   */
  function normalizeSpace(text: string): string {
    return text
      .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Whether a line carries the number as a number of its own.
   *
   * A plain substring test would accept "17 981" and "7 9810": a number
   * that drifted into a neighbouring digit still CONTAINS the old one, so
   * the check would stay green while the prose says something else. The
   * digits on either side of the match are what tells the two apart.
   *
   * @param line the normalised line
   * @param number the number as it is written in the prose
   * @returns true when the line carries the number and not only a part of it
   */
  function carriesNumber(line: string, number: string): boolean {
    let from = 0;
    for (;;) {
      const at = line.indexOf(number, from);
      if (at < 0) return false;
      const before = at > 0 ? line.charAt(at - 1) : '';
      const after = line.charAt(at + number.length);
      if (!/\d/.test(before) && !/\d/.test(after)) return true;
      from = at + 1;
    }
  }

  /**
   * The one line of a file that holds the needle.
   *
   * The needle is used instead of a line number: a line number drifts the
   * moment a paragraph is added above it, and a drifted check that still
   * passes is worse than no check at all.
   */
  function lineWithNeedle(file: string, needle: string): string {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const hits = lines.filter((line) => line.includes(needle));
    expect(
      hits.length,
      `the needle ${needle} is in ${hits.length} lines of ${file}, not in exactly one`,
    ).toBe(1);
    return hits[0];
  }

  /**
   * Everything the three stylesheets point at, measured ONCE.
   *
   * The prose checks below compare the prose against THIS measurement and
   * not against a number written into the test. When the corpus changes,
   * the expectation moves with it, so a prose that was not updated goes
   * RED — which is the whole point of the check: a number written into the
   * test would let the two halves drift apart, and the prose would go
   * stale while the test stayed green.
   */
  const SHIPPED = (() => {
    const counts: Record<string, number> = {};
    const all = new Set<string>();
    for (const sheet of STYLESHEETS) {
      const files = stylesheetFiles(sheet.path);
      counts[sheet.family] = files.length;
      for (const file of files) all.add(file);
    }
    let latin = 0;
    for (const file of all) {
      if (basename(file).startsWith('latin')) latin += 1;
    }
    return { counts, total: all.size, latin, chinese: all.size - latin };
  })();

  it('does not accept a number that is only a part of a bigger one', () => {
    // "17 981" and "7 9810" both CONTAIN "7 981" — a plain substring test
    // would let a drifted prose pass while the check stays green.
    expect(carriesNumber('17 981 files', '7 981')).toBe(false);
    expect(carriesNumber('7 9810 files', '7 981')).toBe(false);
    expect(carriesNumber('the site ships 7 981 woff2 files', '7 981')).toBe(true);
    expect(carriesNumber('29MB:7 981 个 woff2', '7 981')).toBe(true);
  });

  it('counts the files the three stylesheets point at', () => {
    expect(SHIPPED.counts.sans).toBe(2468);
    expect(SHIPPED.counts.serif).toBe(2855);
    expect(SHIPPED.counts.wenkai).toBe(2658);
    expect(SHIPPED.total).toBe(7981);
    expect(
      SHIPPED.counts.sans + SHIPPED.counts.serif + SHIPPED.counts.wenkai,
      'the three families must not share a file',
    ).toBe(SHIPPED.total);
  });

  it('splits the shipped files into the Latin tier and the Chinese blocks', () => {
    expect(SHIPPED.latin).toBe(45);
    expect(SHIPPED.chinese).toBe(7936);
    expect(SHIPPED.chinese + SHIPPED.latin).toBe(SHIPPED.total);
  });

  it('the prose that names the whole set carries the measured number', () => {
    const total = grouped(SHIPPED.total);
    const places = [
      { file: SCRIPT, needle: 'the site ships ' },
      { file: join(REPO_ROOT, 'deploy', 'OPTIMIZATION.md'), needle: '本波次刚做出来的' },
      {
        file: join(
          REPO_ROOT,
          'docs',
          'superpowers',
          'specs',
          '2026-10-29-site-optimization-wave2-design.md',
        ),
        needle: '本波次刚做出来的',
      },
      {
        file: join(REPO_ROOT, 'deploy', 'nginx.ziyun.pudafo.com.conf'),
        needle: 'woff2',
      },
    ];
    for (const place of places) {
      const line = normalizeSpace(lineWithNeedle(place.file, place.needle));
      expect(
        carriesNumber(line, total),
        `${place.file} does not carry ${total} as a number of its own`,
      ).toBe(true);
    }
  });

  it('the prose that names the Chinese blocks carries the measured number', () => {
    const chinese = grouped(SHIPPED.chinese);
    const places = [
      {
        file: join(REPO_ROOT, 'scripts', 'fonts', 'build-webfont-subsets.mjs'),
        needle: 'Chinese subsets',
      },
      {
        file: join(REPO_ROOT, 'scripts', 'fonts', 'capture-page-font-profiles.mjs'),
        needle: 'Latin capture can never rewrite',
      },
      {
        file: join(REPO_ROOT, 'scripts', 'fonts', 'capture-page-font-profiles.mjs'),
        needle: 'would rewrite the',
      },
      {
        file: join(REPO_ROOT, 'scripts', 'fonts', 'webfont-charset.mjs'),
        needle: 'byte for byte the table',
      },
      {
        file: join(REPO_ROOT, 'deploy', 'OPTIMIZATION.md'),
        needle: '个中文字块',
      },
    ];
    for (const place of places) {
      const line = normalizeSpace(lineWithNeedle(place.file, place.needle));
      expect(
        carriesNumber(line, chinese),
        `${place.file} does not carry ${chinese} as a number of its own`,
      ).toBe(true);
    }
  });
});
