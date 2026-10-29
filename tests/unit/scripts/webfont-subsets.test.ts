import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  FAMILIES,
  OUT_ROOT,
  renderFace,
  renderStylesheet,
  blockFileNames,
  manifestVersion,
  createVersionHasher,
  filterPlanByCoverage,
  buildAll,
} from '../../../scripts/fonts/build-webfont-subsets.mjs';
import { loadFamilyCharsets, planTiers } from '../../../scripts/fonts/webfont-charset.mjs';

const plan = {
  hot: ['一', '丁'],
  extBlocks: [{ index: 1, chars: ['万', '丈'] }],
};

// R18: every woff2 URL carries this version token.
const VERSION = 'abc123def456';

/** The directory the stylesheets live in. */
const FONT_DIR = resolve(OUT_ROOT, '..');

/** How many files are below a directory. */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    count += entry.isDirectory() ? countFiles(path) : 1;
  }
  return count;
}

/** The modification time of the three stylesheets. */
function stylesheetState(): Record<string, number> {
  const state: Record<string, number> = {};
  for (const file of ['fonts-sans.css', 'fonts-serif.css', 'fonts-wenkai.css']) {
    const path = join(FONT_DIR, file);
    state[file] = existsSync(path) ? statSync(path).mtimeMs : -1;
  }
  return state;
}

describe('blockFileNames', () => {
  it('uses one file per block for the variable families', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(blockFileNames(sans, { kind: 'hot' })).toEqual(['hot.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 3 })).toEqual(['ext-003.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 123 })).toEqual(['ext-123.woff2']);
  });

  it('uses one file per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    expect(blockFileNames(kai, { kind: 'ext', index: 3 })).toEqual([
      'ext-003-400.woff2',
      'ext-003-700.woff2',
    ]);
  });
});

describe('renderStylesheet', () => {
  it('declares one face per block for a variable family', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan, VERSION);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("font-family: 'Noto Sans SC'");
    expect(css).not.toContain('Noto Sans SC 1');
    expect(css).toContain('font-weight: 400 700');
  });

  it('declares one face per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    const css = renderStylesheet(kai, plan, VERSION);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
  });

  it('gives every face a unicode-range and font-display swap', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan, VERSION);
    const faces = css.split('@font-face').slice(1);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range: U\+/);
    }
  });

  it('points every face at /font/web/<family>/<file> with the version token', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan, VERSION);
    expect(css).toContain("src: url(/font/web/sans/hot.woff2?v=abc123def456) format('woff2')");
    expect(css).toContain("src: url(/font/web/sans/ext-001.woff2?v=abc123def456) format('woff2')");
  });

  it('stamps every face with the version token (R18)', () => {
    for (const family of FAMILIES) {
      const css = renderStylesheet(family, plan, VERSION);
      const urls = [...css.matchAll(/url\(\/font\/web\/[^)]+\)/g)].map((m) => m[0]);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain(`?v=${VERSION}`);
      }
    }
  });
});

describe('renderFace', () => {
  it('refuses a face that would claim no character at all', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(() =>
      renderFace({
        family: sans,
        weight: '400 700',
        file: 'hot.woff2',
        chars: [],
        version: VERSION,
      }),
    ).toThrow(/hot\.woff2/);
  });

  it('refuses a face without a version token', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(() =>
      renderFace({
        family: sans,
        weight: '400 700',
        file: 'hot.woff2',
        chars: ['一'],
        version: undefined as unknown as string,
      }),
    ).toThrow(/version token/);
  });

  it('refuses a version token that is not twelve lowercase hex characters', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(() =>
      renderFace({
        family: sans,
        weight: '400 700',
        file: 'hot.woff2',
        chars: ['一'],
        version: 'ABC123DEF456',
      }),
    ).toThrow(/version token/);
    expect(() =>
      renderFace({
        family: sans,
        weight: '400 700',
        file: 'hot.woff2',
        chars: ['一'],
        version: 'abc',
      }),
    ).toThrow(/version token/);
  });
});

describe('manifestVersion', () => {
  it('is twelve lowercase hex characters', () => {
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when the stylesheet changes and is stable otherwise', () => {
    const a = manifestVersion({ 'fonts-sans.css': 'a' });
    const b = manifestVersion({ 'fonts-sans.css': 'b' });
    expect(a).not.toBe(b);
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toBe(a);
  });
});

describe('createVersionHasher', () => {
  it('is twelve lowercase hex characters', () => {
    const hasher = createVersionHasher();
    hasher.update('hot.woff2', Buffer.from('hello'));
    expect(hasher.digest()).toMatch(/^[0-9a-f]{12}$/);
  });

  it('gives the same token for the same files in the same order', () => {
    const first = createVersionHasher();
    first.update('hot.woff2', Buffer.from('hello'));
    first.update('ext-001.woff2', Buffer.from('world'));

    const second = createVersionHasher();
    second.update('hot.woff2', Buffer.from('hello'));
    second.update('ext-001.woff2', Buffer.from('world'));

    expect(first.digest()).toBe(second.digest());
  });

  it('changes the token when a file name or a byte changes', () => {
    const base = createVersionHasher();
    base.update('hot.woff2', Buffer.from('hello'));
    base.update('ext-001.woff2', Buffer.from('world'));

    const renamed = createVersionHasher();
    renamed.update('hot.woff2', Buffer.from('hello'));
    renamed.update('ext-002.woff2', Buffer.from('world'));

    const rebited = createVersionHasher();
    rebited.update('hot.woff2', Buffer.from('hello'));
    rebited.update('ext-001.woff2', Buffer.from('world!'));

    expect(renamed.digest()).not.toBe(base.digest());
    expect(rebited.digest()).not.toBe(base.digest());
  });
});

describe('filterPlanByCoverage', () => {
  it('drops the characters the font cannot draw and re-cuts the tail', () => {
    const covered = new Set(['一', '三', '四', '六'].map((c) => c.codePointAt(0)!));
    const filtered = filterPlanByCoverage(
      {
        hot: ['一', '二', '三'],
        extBlocks: [
          { index: 1, chars: ['四', '五'] },
          { index: 2, chars: ['六', '七'] },
        ],
      },
      covered,
      6,
    );
    expect(filtered.hot).toEqual(['一', '三']);
    // '五' 与 '七' 没有覆盖，被滤掉后剩下的 '四' 与 '六' 合到同一块
    expect(filtered.extBlocks).toEqual([{ index: 1, chars: ['四', '六'] }]);
  });

  it('never produces an empty block', () => {
    const covered = new Set(['四'].map((c) => c.codePointAt(0)!));
    const filtered = filterPlanByCoverage(
      { hot: ['一'], extBlocks: [{ index: 1, chars: ['四', '五'] }] },
      covered,
      6,
    );
    expect(filtered.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('uses the same block width as the charset planner', () => {
    const chars = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    // tier1Size 0 keeps the twenty characters in the tail, so there is an
    // Ext block to measure; the default tier size would swallow all of them.
    const planner = planTiers({ ordered: chars, score: new Map() }, { tier1Size: 0 });
    for (const family of FAMILIES) {
      expect(family.extBlockChars).toBe(planner.extBlocks[0].chars.length);
    }
  });
});

describe('the planned charsets fit the design budget', () => {
  it('produces a hot tier and ext blocks for every family', () => {
    const plans = loadFamilyCharsets();
    for (const family of FAMILIES) {
      const p = plans[family.key];
      expect(p.extBlocks.length).toBeGreaterThan(0);
      expect(p.hot.length).toBe(300);
      // The block width of the table has to be the one the planner used.
      expect(p.extBlocks[0].chars.length).toBe(family.extBlockChars);
    }
  }, 180_000);
});

describe('buildAll', () => {
  it('fails with an actionable message when a source font is missing (G12)', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'webfont-staging-'));
    const filesBefore = countFiles(OUT_ROOT);
    const stylesheetsBefore = stylesheetState();
    try {
      const error = await buildAll({ stagingDir: emptyDir }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/NotoSansSC-wght-400-700\.ttf/);
      // The message has to name the commands that fix it.
      expect((error as Error).message).toMatch(
        /npm run fonts:download-web && npm run fonts:instance-web/,
      );
      // Nothing may be written when the build fails (C2).
      expect(countFiles(OUT_ROOT)).toBe(filesBefore);
      expect(stylesheetState()).toEqual(stylesheetsBefore);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  }, 180_000);
});
