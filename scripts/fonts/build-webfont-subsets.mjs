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
import { loadFamilyCharsets, unicodeRange } from './webfont-charset.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/** Where the subset files are written. */
export const OUT_ROOT = resolve(ROOT, 'public', 'font', 'web');

/** Where the stylesheets and the manifest are written. */
const FONT_DIR = resolve(ROOT, 'public', 'font');

/** Where the instanced source fonts and their licences live. */
const STAGING_DIR = resolve(ROOT, 'scripts', 'fonts', 'staging', 'web');

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
 * Render one @font-face rule.
 *
 * The field order is fixed, and the family name is ALWAYS the family name
 * of the family: the tiers are told apart by their `unicode-range`, not by
 * a suffix on the family name.
 */
export function renderFace(spec) {
  const { family, weight, file, chars } = spec;
  return (
    '@font-face {\n' +
    `  font-family: '${family.label}';\n` +
    '  font-style: normal;\n' +
    `  font-weight: ${weight};\n` +
    '  font-display: swap;\n' +
    `  src: url(/font/web/${family.dir}/${file}) format('woff2');\n` +
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
export function renderStylesheet(family, plan) {
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
async function readSourceFont(family, fileName) {
  const path = join(STAGING_DIR, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `[webfont] the source font ${fileName} of ${family.label} is missing from ${STAGING_DIR} — ` +
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
  return buffer;
}

/**
 * Copy the licence of a family next to the subsets.
 *
 * The licences have to travel with the fonts: a subset of an OFL font is
 * still an OFL font, and the licence has to be distributed with it.
 */
async function copyLicense(family) {
  const from = join(STAGING_DIR, family.license);
  const to = join(OUT_ROOT, `OFL-${family.key}.txt`);
  if (!existsSync(from)) {
    throw new Error(
      `[webfont] the licence ${family.license} of ${family.label} is missing from ${STAGING_DIR} — ` +
        'run "npm run fonts:download-web && npm run fonts:instance-web" to fetch it',
    );
  }
  try {
    await copyFile(from, to);
  } catch (err) {
    throw new Error(`[webfont] cannot copy the licence ${from} to ${to}: ${err.message}`);
  }
}

/**
 * Cut one family into its subset files and render its stylesheet.
 *
 * The blocks are cut one after the other: `subset-font` serialises its own
 * calls, so a pool of promises would not make it any faster.
 */
async function buildFamily(family, plan) {
  const outDir = join(OUT_ROOT, family.dir);
  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    throw new Error(`[webfont] cannot create the output directory ${outDir}: ${err.message}`);
  }

  const sources = [];
  for (const fileName of family.sources) {
    sources.push(await readSourceFont(family, fileName));
  }

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

    const text = block.chars.join('');
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const path = join(outDir, name);

      let subset;
      try {
        subset = await subsetFont(sources[index], text, { targetFormat: 'woff2' });
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

      files += 1;
      bytes += subset.length;

      if (files % 500 === 0) {
        console.log(`[webfont] ${family.key}: ${files} file(s), ${bytes} B`);
      }
    }
  }

  const css = renderStylesheet(family, plan);
  try {
    await writeFile(join(FONT_DIR, family.css), css, 'utf8');
  } catch (err) {
    throw new Error(
      `[webfont] cannot write the stylesheet ${join(FONT_DIR, family.css)}: ${err.message}`,
    );
  }
  await copyLicense(family);

  const chars = blocks.reduce((sum, block) => sum + block.chars.length, 0);
  const cssBytes = Buffer.byteLength(css, 'utf8');
  const cssGzipBytes = gzipSync(Buffer.from(css, 'utf8')).length;

  console.log(
    `[webfont] ${family.key}: ${chars} chars, ${blocks.length - 1} ext blocks, ` +
      `${files} files, ${bytes} B (${Math.round(bytes / 1024)} KB), ` +
      `css ${cssBytes} B (gzip ${cssGzipBytes} B)`,
  );

  return {
    key: family.key,
    chars,
    blocks: blocks.length,
    extBlocks: blocks.length - 1,
    files,
    bytes,
    cssBytes,
    cssGzipBytes,
    css,
  };
}

/**
 * Cut every family and write the stylesheets and the manifest.
 *
 * The old Google subset directories are left alone on purpose: they are
 * replaced in a separate step, so this script can never leave the site
 * half migrated.
 */
export async function buildAll() {
  const plans = loadFamilyCharsets();
  const cssByFile = {};
  const families = [];

  for (const family of FAMILIES) {
    const stats = await buildFamily(family, plans[family.key]);
    cssByFile[family.css] = stats.css;
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
      blocks: sum.blocks + stats.extBlocks,
      files: sum.files + stats.files,
      bytes: sum.bytes + stats.bytes,
      cssBytes: sum.cssBytes + stats.cssBytes,
      cssGzipBytes: sum.cssGzipBytes + stats.cssGzipBytes,
    }),
    { chars: 0, blocks: 0, files: 0, bytes: 0, cssBytes: 0, cssGzipBytes: 0 },
  );

  console.log(
    `[webfont] TOTAL: ${total.blocks} blocks, ${total.files} files, ` +
      `${total.bytes} B (${Math.round(total.bytes / 1024)} KB), ` +
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
