/**
 * build-webfont-subsets.mjs
 *
 * Cuts the three webfont families into the files the site ships.
 *
 * Why this exists:
 *   Google Fonts shards its CJK families by codepoint range. Noto Sans SC
 *   arrives as a hundred-odd woff2 files and a page that needs 37 scattered
 *   characters pulls 34 of them — 3.7 MB to 5.0 MB of font for one page.
 *
 *   This script turns the tier plan of scripts/fonts/webfont-charset.mjs
 *   into the files a browser can actually fetch:
 *     hot     the characters the MEASURED pages paint, in one file
 *     Ext     everything else, cut into blocks of 6 CHARACTERS
 *   A page downloads the hot file plus the one or two Ext blocks that hold
 *   the characters it needs, and the browser fetches an Ext block only when
 *   a character of that block is actually painted.
 *
 *   ONE family name per family (R15). The old mechanism gave every tier
 *   its own family name ('Noto Sans SC 1' / '2' / 'Ext') and relied on the
 *   fallback chain to pick the right one. Here every face of a family
 *   carries the SAME family name and they are told apart by their
 *   `unicode-range`: the ranges are DISJOINT, so exactly one face can
 *   paint a given character and the browser never has to guess.
 *
 *   A block is NOT a contiguous run of the code point space: its characters
 *   are scattered over the code points. Its `unicode-range` is therefore the
 *   EXACT union of the code points it carries (see `unicodeRange`). A
 *   min–max span would claim the code points the block does NOT have, and
 *   the browser would pick that face for a character it cannot draw —
 *   tofu instead of a fallback.
 *
 *   A face may only claim the characters the font can actually DRAW
 *   (F31-a). The corpus reaches the CJK extension planes, but the source
 *   fonts have no glyphs there, so the plan is filtered by the REAL glyph
 *   coverage of the source fonts BEFORE anything is cut. Without the
 *   filter the build produced 652 subsets with not a single glyph in them
 *   and 180 half empty ones: requests the browser makes for nothing, and
 *   faces that lie about what the font can render.
 *
 *   Every subset URL carries a VERSION TOKEN (R18). The file names are
 *   stable ('hot.woff2', 'ext-001.woff2') while /font/** is served
 *   `immutable` for a year, so a changed corpus would keep the OLD file
 *   in the browser cache — and the new `unicode-range` would claim
 *   characters the old file does not have: tofu boxes, hundreds of them
 *   at once. The token is the hash of the bytes of the family, so it
 *   changes exactly when the bytes change, and only for that family.
 *
 *   The two body faces are VARIABLE fonts: one file per block carries the
 *   whole 400–700 `wght` axis, so one face per block is enough. The brand
 *   face is NOT variable: its 400 and 700 faces are two different files,
 *   so every block of it is cut twice.
 *
 * This script writes the artefacts and nothing else:
 *   public/font/web/<family>/hot.woff2, ext-001.woff2, …   the subsets
 *   public/font/web/OFL-<family>.txt                        the licences
 *   public/font/fonts-<family>.css                          the stylesheets
 *   public/font/fonts-manifest.json                         the version hash
 * The OLD Google subset directories are NOT removed here — replacing them
 * is a separate step, so a half done migration can never reach production.
 *
 * Usage:
 *   node scripts/fonts/build-webfont-subsets.mjs
 *
 * The source fonts come from scripts/fonts/staging/web/ and are produced by
 *   npm run fonts:download-web && npm run fonts:instance-web
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';
import { loadFamilyCharsets, unicodeRange } from './webfont-charset.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/** Where the subset files are written. */
export const OUT_ROOT = resolve(ROOT, 'public', 'font', 'web');

/** Where the stylesheets and the manifest are written. */
const FONT_DIR = resolve(ROOT, 'public', 'font');

/** Where the instanced source fonts and their licences live. */
export const STAGING_DIR = resolve(ROOT, 'scripts', 'fonts', 'staging', 'web');

/** The manifest of the stylesheets. */
const MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json');

/**
 * The three families the site ships.
 *
 * `label` is the font-family name and it NEVER changes: app/globals.css and
 * lib/font-css.ts depend on 'Noto Sans SC', 'Noto Serif SC' and
 * 'LXGW WenKai TC' exactly.
 *
 * `sources` are the instanced source fonts, in WEIGHT ORDER: the first one
 * carries the first weight of `weights`. The two body faces are variable
 * (one source file, one face per block, `font-weight: 400 700`); the brand
 * face is static (one source file per weight, one face per block AND
 * weight).
 *
 * `hotSize` is the number of characters the hot tier is planned to hold.
 * All THREE families have one — the brand face included: the poetry page
 * paints its titles in the brand face and needed 120 font files without a
 * hot tier. It documents the plan; the plan itself decides how long the
 * hot tier really is, because a seeded tier may be longer.
 *
 * `extBlockChars` is how many characters one Ext block holds. It MUST
 * match the per family default of scripts/fonts/webfont-charset.mjs: the
 * plan is filtered by the glyph coverage and the tail is cut into NEW
 * blocks, so the width has to be this script's own number — not one
 * inherited by accident. A test pins the two together.
 */
export const FAMILIES = [
  {
    key: 'sans',
    label: 'Noto Sans SC',
    css: 'fonts-sans.css',
    dir: 'sans',
    purpose: 'body typeface — --font-han-sans',
    sources: ['NotoSansSC-wght-400-700.ttf'],
    weights: ['400 700'],
    variable: true,
    hotSize: 300,
    extBlockChars: 6,
    license: 'NotoSansSC-OFL.txt',
  },
  {
    key: 'serif',
    label: 'Noto Serif SC',
    css: 'fonts-serif.css',
    dir: 'serif',
    purpose: 'serif accent typeface — --font-han-serif',
    sources: ['NotoSerifSC-wght-400-700.ttf'],
    weights: ['400 700'],
    variable: true,
    hotSize: 300,
    extBlockChars: 6,
    license: 'NotoSerifSC-OFL.txt',
  },
  {
    key: 'wenkai',
    label: 'LXGW WenKai TC',
    css: 'fonts-wenkai.css',
    dir: 'wenkai',
    purpose: 'brand typeface — --font-kai',
    sources: ['LXGWWenKaiTC-Regular.ttf', 'LXGWWenKaiTC-Bold.ttf'],
    weights: ['400', '700'],
    variable: false,
    hotSize: 300,
    extBlockChars: 6,
    license: 'LXGWWenKaiTC-OFL.txt',
  },
];

/**
 * The base name of a block, without the weight suffix.
 *
 * The hot tier is `hot`; an Ext block is `ext-` and its number, padded to
 * three digits so the files sort in the order of the plan.
 */
function blockBaseName(block) {
  if (block.kind === 'hot') return 'hot';
  if (block.kind === 'ext') return `ext-${String(block.index).padStart(3, '0')}`;
  throw new TypeError(
    `unknown block kind ${JSON.stringify(block.kind)} — expected "hot" or "ext"`,
  );
}

/**
 * The file names one block is cut into.
 *
 * A variable family carries the whole 400–700 axis in one file, so a block
 * is ONE file. A static family has one file per weight, so a block is one
 * file per weight, in weight order.
 */
export function blockFileNames(family, block) {
  const base = blockBaseName(block);
  if (family.variable) return [`${base}.woff2`];
  return family.weights.map((weight) => `${base}-${weight}.woff2`);
}

/**
 * The shape of a version token: twelve lowercase hex characters.
 *
 * The token travels in the query string of every URL of the family, so it
 * has to be safe there — and the validator of the next task looks for
 * exactly this shape, so a token of another shape would be rejected
 * downstream instead of being caught here.
 */
const VERSION_TOKEN_PATTERN = /^[0-9a-f]{12}$/;

/**
 * The hasher of the version token of ONE family (R18).
 *
 * The token is the hash of the bytes the family shipped, so it changes
 * exactly when the bytes change: a corpus that moves a character from one
 * Ext block to another changes the files, so the token changes, so the URL
 * changes, so the browser fetches the new file instead of keeping the old
 * one for the rest of the `immutable` year.
 *
 * The bytes are fed in as they are written — the file name and then the
 * bytes — so nothing has to be read back from the disk afterwards.
 */
export function createVersionHasher() {
  const hash = createHash('sha256');
  let sealed = null;
  return {
    update(fileName, bytes) {
      if (sealed !== null) {
        throw new Error(
          `the version hasher is sealed: ${fileName} was added after the digest was taken`,
        );
      }
      hash.update(fileName, 'utf8');
      hash.update(bytes);
    },
    digest() {
      if (sealed === null) sealed = hash.digest('hex').slice(0, 12);
      return sealed;
    },
  };
}

/**
 * Drop the characters the font cannot draw, and cut the tail into NEW
 * blocks (F31-a).
 *
 * A face may only claim what the font can render. The corpus reaches the
 * CJK extension planes and the source fonts have no glyphs there, so the
 * plan is cut down to the real coverage of the source fonts.
 *
 * The hot tier keeps its order and is neither padded nor truncated. The
 * tail is flattened, filtered and cut into blocks of `extBlockChars`
 * characters again: a block that lost five of its six characters would
 * otherwise keep a file of its own for a single character.
 */
export function filterPlanByCoverage(plan, covered, extBlockChars) {
  if (!Number.isInteger(extBlockChars) || extBlockChars <= 0) {
    throw new TypeError(
      `extBlockChars must be a positive integer number of characters, got ${extBlockChars}`,
    );
  }
  if (!(covered instanceof Set)) {
    throw new TypeError(`covered must be a Set of code points, got ${typeof covered}`);
  }

  const isCovered = (ch) => covered.has(ch.codePointAt(0));
  const hot = plan.hot.filter(isCovered);
  const tail = plan.extBlocks.flatMap((block) => block.chars).filter(isCovered);

  const extBlocks = [];
  for (let start = 0; start < tail.length; start += extBlockChars) {
    extBlocks.push({
      index: extBlocks.length + 1,
      chars: tail.slice(start, start + extBlockChars),
    });
  }

  return { hot, extBlocks };
}

/**
 * Render one @font-face rule.
 *
 * The field order is fixed, and the family name is ALWAYS the family name
 * of the family: the tiers are told apart by their `unicode-range`, not by
 * a suffix on the family name.
 *
 * The version token is REQUIRED. Without it the URL of the subset file
 * never changes while the file behind it does, and the browser would keep
 * the old file for the whole `immutable` year.
 */
export function renderFace(spec) {
  const { family, weight, file, chars, version } = spec;

  if (typeof version !== 'string' || !VERSION_TOKEN_PATTERN.test(version)) {
    throw new Error(
      `[webfont] the face of ${family.label} / ${file} has no usable version token — ` +
        `it got ${JSON.stringify(version)}, but the token has to be twelve lowercase ` +
        'hex characters: it is what tells the browser that the file behind the URL ' +
        'is a new one',
    );
  }

  if (!Array.isArray(chars) || chars.length === 0) {
    throw new Error(
      `[webfont] the face of ${family.label} / ${file} would claim no character at all — ` +
        'a face with an empty unicode-range is dropped by the browser without a word, ' +
        'and the character it was meant to draw silently falls back',
    );
  }

  return (
    '@font-face {\n' +
    `  font-family: '${family.label}';\n` +
    '  font-style: normal;\n' +
    `  font-weight: ${weight};\n` +
    '  font-display: swap;\n' +
    `  src: url(/font/web/${family.dir}/${file}?v=${version}) format('woff2');\n` +
    `  unicode-range: ${unicodeRange(chars)};\n` +
    '}'
  );
}

/**
 * The blocks of a family, in the order the stylesheet lists them: the hot
 * tier first, then the Ext blocks by their number.
 */
function blocksOf(plan) {
  const ext = [...plan.extBlocks].sort((a, b) => a.index - b.index);
  return [
    { kind: 'hot', chars: plan.hot },
    ...ext.map((block) => ({ kind: 'ext', index: block.index, chars: block.chars })),
  ];
}

/**
 * Render the stylesheet of one family.
 *
 * Every face carries its own `unicode-range` and its own file, so the
 * browser fetches a file only when it paints a character of it.
 */
export function renderStylesheet(family, plan, version) {
  if (typeof version !== 'string' || !VERSION_TOKEN_PATTERN.test(version)) {
    throw new Error(
      `[webfont] the stylesheet of ${family.label} has no usable version token — ` +
        `it got ${JSON.stringify(version)}, but the URL of every subset file needs ` +
        'twelve lowercase hex characters, or the browser keeps the old file for a year',
    );
  }

  const header =
    `/* ${family.css} — ${family.purpose}\n` +
    ' * Generated by scripts/fonts/build-webfont-subsets.mjs. Do not edit by hand. */\n';

  const faces = [];
  for (const block of blocksOf(plan)) {
    const files = blockFileNames(family, block);
    if (files.length !== family.weights.length) {
      throw new Error(
        `family ${family.key}: ${files.length} file(s) per block but ` +
          `${family.weights.length} weight(s) — the weights and the sources disagree`,
      );
    }
    for (let index = 0; index < files.length; index += 1) {
      faces.push(
        renderFace({
          family,
          weight: family.weights[index],
          file: files[index],
          chars: block.chars,
          version,
        }),
      );
    }
  }
  return header + faces.join('\n') + '\n';
}

/**
 * The content hash of the stylesheets, twelve lowercase hex characters.
 *
 * The manifest carries it and the app appends it to the stylesheet URLs as
 * `?v=<hash>`, which lets the whole /font/ tree be served with
 * `Cache-Control: immutable` without ever going stale.
 *
 * The contents are fed into the hash in the order of their file names, so
 * the hash does not depend on the order the families were built in.
 */
export function manifestVersion(cssByFile) {
  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Read one instanced source font.
 *
 * A missing source font is a hard error with the two commands that produce
 * it: the pipeline is only as good as its input, and a build that quietly
 * skips a family ships a site with a missing typeface.
 */
async function readSourceFont(family, fileName, stagingDir) {
  const path = join(stagingDir, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `[webfont] the source font ${fileName} of ${family.label} is missing from ${stagingDir} — ` +
        'run "npm run fonts:download-web && npm run fonts:instance-web" to fetch and instance it',
    );
  }

  let buffer;
  try {
    buffer = await readFile(path);
  } catch (err) {
    throw new Error(`[webfont] cannot read the source font ${path}: ${err.message}`);
  }

  if (buffer.length === 0) {
    throw new Error(`[webfont] the source font ${path} is empty — the instance step failed`);
  }

  // An sfnt file starts with one of four signatures. A file that carries
  // none of them is not a font, and saying so is more useful than the
  // "unrecognized font signature" the subsetter would throw.
  const signature = buffer.toString('ascii', 0, 4);
  const isFont =
    signature === 'true' ||
    signature === 'OTTO' ||
    signature === 'ttcf' ||
    (signature.charCodeAt(0) === 0x00 && signature.charCodeAt(1) === 0x01);
  if (!isFont) {
    throw new Error(
      `[webfont] the source font ${path} is not a font — its first four bytes are ` +
        `${JSON.stringify(signature)}, not a sfnt signature`,
    );
  }

  return { fileName, path, buffer };
}

/**
 * The path of the licence of a family, checked before anything is written.
 *
 * The licences have to travel with the fonts: a subset of an OFL font is
 * still an OFL font, and the licence has to be distributed with it.
 */
function assertLicense(family, stagingDir) {
  const path = join(stagingDir, family.license);
  if (!existsSync(path)) {
    throw new Error(
      `[webfont] the licence ${family.license} of ${family.label} is missing from ${stagingDir} — ` +
        'run "npm run fonts:download-web && npm run fonts:instance-web" to fetch it',
    );
  }
  return path;
}

/**
 * Copy the licence of a family next to the subsets.
 */
async function copyLicense(family, stagingDir) {
  const from = assertLicense(family, stagingDir);
  const to = join(OUT_ROOT, `OFL-${family.key}.txt`);
  try {
    await copyFile(from, to);
  } catch (err) {
    throw new Error(`[webfont] cannot copy the licence ${from} to ${to}: ${err.message}`);
  }
}

/**
 * The code points the family can actually draw.
 *
 * The coverage of a family is the INTERSECTION of the coverage of its source
 * fonts, never the union: the static brand face has two files (400 and
 * 700) and both faces declare the SAME `unicode-range`, so a character
 * that only the regular file can draw would be claimed by the bold face
 * as well — and rendered as a tofu box in bold.
 */
function coverageOf(family, sources) {
  let covered = null;
  for (const source of sources) {
    let font;
    try {
      font = fontkit.create(source.buffer);
    } catch (err) {
      throw new Error(
        `[webfont] cannot read the glyph coverage of ${family.label} from ${source.path}: ` +
          err.message,
      );
    }
    const set = new Set(font.characterSet);
    covered =
      covered === null ? set : new Set([...covered].filter((codePoint) => set.has(codePoint)));
  }
  return covered ?? new Set();
}

/**
 * Cut one family into its subset files and render its stylesheet.
 *
 * The blocks are cut one after the other: `subset-font` serialises its own
 * calls, so a pool of promises would not make it any faster.
 */
async function buildFamily(family, plan, sources, stagingDir) {
  const outDir = join(OUT_ROOT, family.dir);
  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    throw new Error(`[webfont] cannot create the output directory ${outDir}: ${err.message}`);
  }

  const hasher = createVersionHasher();
  const blocks = blocksOf(plan);
  let files = 0;
  let bytes = 0;

  for (const block of blocks) {
    const names = blockFileNames(family, block);
    if (names.length !== sources.length) {
      throw new Error(
        `family ${family.key}: ${names.length} file(s) per block but ` +
          `${sources.length} source font(s) — the weights and the sources disagree`,
      );
    }
    if (block.chars.length === 0) {
      throw new Error(
        `[webfont] the block ${names[0]} of ${family.label} would hold no character — ` +
          'an empty subset is a request the browser makes for nothing',
      );
    }

    const text = block.chars.join('');
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const path = join(outDir, name);

      let subset;
      try {
        subset = await subsetFont(sources[index].buffer, text, { targetFormat: 'woff2' });
      } catch (err) {
        throw new Error(
          `[webfont] cannot subset ${family.label} into ${name} ` +
            `(${block.chars.length} characters): ${err.message}`,
        );
      }

      try {
        await writeFile(path, subset);
      } catch (err) {
        throw new Error(`[webfont] cannot write ${path}: ${err.message}`);
      }

      // The token is built while the files are written: the name and the
      // bytes of every file, in the order they are written.
      hasher.update(name, subset);

      files += 1;
      bytes += subset.length;

      if (files % 500 === 0) {
        console.log(`[webfont] ${family.key}: ${files} file(s), ${bytes} B`);
      }
    }
  }

  const version = hasher.digest();
  const css = renderStylesheet(family, plan, version);
  try {
    await writeFile(join(FONT_DIR, family.css), css, 'utf8');
  } catch (err) {
    throw new Error(
      `[webfont] cannot write the stylesheet ${join(FONT_DIR, family.css)}: ${err.message}`,
    );
  }
  await copyLicense(family, stagingDir);

  const chars = blocks.reduce((sum, block) => sum + block.chars.length, 0);
  const cssBytes = Buffer.byteLength(css, 'utf8');
  const cssGzipBytes = gzipSync(Buffer.from(css, 'utf8')).length;

  console.log(
    `[webfont] ${family.key}: ${chars} chars, ${blocks.length - 1} ext blocks, ` +
      `${files} files, ${bytes} B (${Math.round(bytes / 1024)} KB), ` +
      `css ${cssBytes} B (gzip ${cssGzipBytes} B), version ${version}`,
  );

  return {
    key: family.key,
    chars,
    blocks: blocks.length,
    extBlocks: blocks.length - 1,
    files,
    bytes,
    version,
    cssBytes,
    cssGzipBytes,
    css,
  };
}

/**
 * Cut every family and write the stylesheets and the manifest.
 *
 * The build is ATOMIC in what it can be: every source font of every
 * family is read and checked, and every licence is checked, BEFORE a
 * single product is written. A broken second family must not leave the
 * new stylesheet of the first family on disk with the old manifest next
 * to it — the token of the stylesheet and the version of the manifest
 * would disagree, and the browser would keep the old immutable stylesheet.
 *
 * The old Google subset directories are left alone on purpose: they are
 * replaced in a separate step, so this script can never leave the site
 * half migrated.
 */
export async function buildAll(options = {}) {
  const stagingDir = options.stagingDir ?? STAGING_DIR;
  const plans = loadFamilyCharsets();

  // Phase one: check everything. Nothing is written before this passes.
  const prepared = [];
  for (const family of FAMILIES) {
    const sources = [];
    for (const fileName of family.sources) {
      sources.push(await readSourceFont(family, fileName, stagingDir));
    }
    assertLicense(family, stagingDir);
    const covered = coverageOf(family, sources);
    const plan = filterPlanByCoverage(plans[family.key], covered, family.extBlockChars);
    prepared.push({ family, plan, sources });
  }

  // Phase two: write.
  const cssByFile = {};
  const families = [];

  for (const item of prepared) {
    const stats = await buildFamily(item.family, item.plan, item.sources, stagingDir);
    cssByFile[item.family.css] = stats.css;
    families.push(stats);
  }

  const version = manifestVersion(cssByFile);
  const manifest = {
    version,
    files: {
      wenkai: '/font/fonts-wenkai.css',
      sans: '/font/fonts-sans.css',
      serif: '/font/fonts-serif.css',
    },
  };
  try {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch (err) {
    throw new Error(`[webfont] cannot write the manifest ${MANIFEST_PATH}: ${err.message}`);
  }
  console.log(`[webfont] fonts-manifest.json: version ${version}`);

  const total = families.reduce(
    (sum, stats) => ({
      chars: sum.chars + stats.chars,
      extBlocks: sum.extBlocks + stats.extBlocks,
      totalBlocks: sum.totalBlocks + stats.blocks,
      files: sum.files + stats.files,
      bytes: sum.bytes + stats.bytes,
      cssBytes: sum.cssBytes + stats.cssBytes,
      cssGzipBytes: sum.cssGzipBytes + stats.cssGzipBytes,
    }),
    {
      chars: 0,
      extBlocks: 0,
      totalBlocks: 0,
      files: 0,
      bytes: 0,
      cssBytes: 0,
      cssGzipBytes: 0,
    },
  );

  console.log(
    `[webfont] TOTAL: ${total.extBlocks} ext blocks + ${families.length} hot, ` +
      `${total.files} files, ${total.bytes} B (${Math.round(total.bytes / 1024)} KB), ` +
      `css gzip ${total.cssGzipBytes} B (${Math.round(total.cssGzipBytes / 1024)} KB)`,
  );

  return { version, families, total };
}

// Only run the build when this file is the entry point — the unit test
// imports the pure helpers above and must not cut 8 683 files.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  buildAll().catch((err) => {
    console.error('[webfont] webfont subset build failed:', err);
    process.exit(1);
  });
}
