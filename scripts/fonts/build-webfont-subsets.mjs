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
 *     latin   the LATIN characters the measured pages paint (the pinyin,
 *             the digits, the tone marks), in one file
 *     latin-ext
 *             the rest of the Latin characters of the repository, cut into
 *             blocks of 12 CHARACTERS
 *   A page downloads the hot file plus the one or two Ext blocks that hold
 *   the characters it needs, and the browser fetches an Ext block only when
 *   a character of that block is actually painted.
 *
 *   ⚠️ The Latin tier is the SECOND half of every family. Before it, a
 *   Latin character — a pinyin syllable, a digit, a tone mark — fell back
 *   to the system font of the operating system, so the site mixed a webfont
 *   and a system font on the same line. The Latin blocks are cut with
 *   `noLayoutClosure` and their plan is filtered by the real glyph coverage
 *   of the source fonts, so a Latin face never claims a code point the font
 *   cannot draw.
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
 *   public/font/web/<family>/OFL-<family>.txt               the licences of
 *                                                           the family, so
 *                                                           that a release
 *                                                           directory is
 *                                                           self-sufficient
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
import { copyFile, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import subsetFont from 'subset-font';
import { coverageOfSources, loadFamilyCharsets, unicodeRange } from './webfont-charset.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/**
 * The font root: where the stylesheets, the manifest and the subsets live.
 *
 * `WEBFONT_FONT_DIR` overrides it, so a build can write into a staging
 * tree instead of into the published one. A RELATIVE path is resolved
 * against the repository root and NOT against the working directory: the
 * pipeline of the admin page may run from anywhere, and the same command
 * has to cut the same tree every time.
 *
 * ⚠️ ONE environment variable names ONE thing: there is no second
 * variable for the output directory. Two names for one root are two roots
 * that drift apart, and the drift is found when a candidate is applied.
 *
 * @param {Record<string, string|undefined>} env the environment to read
 * @returns {string} the absolute path of the font root
 */
export function resolveFontDir(env = process.env) {
  const override = env.WEBFONT_FONT_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(ROOT, override.trim());
  }
  return join(ROOT, 'public', 'font');
}

/**
 * The default staging directory, computed WITHOUT the override.
 *
 * ⚠️ It is a separate constant on purpose: `resolveStagingDir()` reads
 * `process.env`, and a module-level constant that referenced itself
 * would be read before it is initialised.
 */
const DEFAULT_STAGING_DIR = resolve(ROOT, 'scripts', 'fonts', 'staging', 'web');

/**
 * The staging directory: where the instanced source fonts and their
 * licences live.
 *
 * `WEBFONT_STAGING_DIR` overrides it, so a pipeline can cut a candidate
 * from a source tree of its own instead of from the repository's. The
 * shape is the same as `resolveFontDir`: a RELATIVE path is resolved
 * against the repository root and not against the working directory.
 *
 * ⚠️ ONE environment variable names ONE thing: `WEBFONT_FONT_DIR` names
 * the OUTPUT root and this one names the INPUT root. They are two
 * different trees, and two different names are exactly right here.
 *
 * @param {Record<string, string|undefined>} env the environment to read
 * @returns {string} the absolute path of the staging directory
 */
export function resolveStagingDir(env = process.env) {
  const override = env.WEBFONT_STAGING_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(ROOT, override.trim());
  }
  return DEFAULT_STAGING_DIR;
}

/** Where the stylesheets and the manifest are written. */
export const FONT_DIR = resolveFontDir();

/** Where the subset files are written. */
export const OUT_ROOT = join(FONT_DIR, 'web');

/** Where the instanced source fonts and their licences live. */
export const STAGING_DIR = resolveStagingDir();

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
 *
 * `latinExtBlockChars` is the same thing for the LATIN tail. The Latin
 * blocks are wider than the Chinese ones (twelve characters against six):
 * a Latin character carries more of the table of the font than a Chinese
 * one does, and the whole tail is 155 characters at most — twelve
 * characters per block keeps it in nine files per family instead of
 * twenty-six.
 */
export const FAMILIES = [
  {
    key: 'sans',
    label: 'Noto Sans SC',
    css: 'fonts-sans.css',
    cssHot: 'fonts-sans-hot.css',
    cssExt: 'fonts-sans-ext.css',
    dir: 'sans',
    purpose: 'body typeface — --font-han-sans',
    sources: ['NotoSansSC-wght-400-700.ttf'],
    weights: ['400 700'],
    variable: true,
    hotSize: 300,
    extBlockChars: 6,
    latinExtBlockChars: 12,
    license: 'NotoSansSC-OFL.txt',
  },
  {
    key: 'serif',
    label: 'Noto Serif SC',
    css: 'fonts-serif.css',
    cssHot: 'fonts-serif-hot.css',
    cssExt: 'fonts-serif-ext.css',
    dir: 'serif',
    purpose: 'serif accent typeface — --font-han-serif',
    sources: ['NotoSerifSC-wght-400-700.ttf'],
    weights: ['400 700'],
    variable: true,
    hotSize: 300,
    extBlockChars: 6,
    latinExtBlockChars: 12,
    license: 'NotoSerifSC-OFL.txt',
  },
  {
    key: 'wenkai',
    label: 'LXGW WenKai TC',
    css: 'fonts-wenkai.css',
    cssHot: 'fonts-wenkai-hot.css',
    cssExt: 'fonts-wenkai-ext.css',
    dir: 'wenkai',
    purpose: 'brand typeface — --font-kai',
    sources: ['LXGWWenKaiTC-Regular.ttf', 'LXGWWenKaiTC-Bold.ttf'],
    weights: ['400', '700'],
    variable: false,
    hotSize: 300,
    extBlockChars: 6,
    latinExtBlockChars: 12,
    license: 'LXGWWenKaiTC-OFL.txt',
  },
];

/**
 * The base name of a block, without the weight suffix.
 *
 * The hot tier is `hot`; an Ext block is `ext-` and its number, padded to
 * three digits so the files sort in the order of the plan. The Latin tier
 * has two kinds of its own: `latin` (the hot tier of the Latin characters)
 * and `latin-ext` (the tail of the Latin characters).
 *
 * ⚠️ The Latin base names carry their own prefix: a file called `latin.woff2`
 * and a file called `hot.woff2` live in the same directory, and the number
 * of the Latin tail blocks starts at one again — `latin-ext-001.woff2` is
 * the first Latin tail block, `ext-001.woff2` the first Chinese one.
 */
function blockBaseName(block) {
  if (block.kind === 'hot') return 'hot';
  if (block.kind === 'ext') return `ext-${String(block.index).padStart(3, '0')}`;
  if (block.kind === 'latin') return 'latin';
  if (block.kind === 'latin-ext') return `latin-ext-${String(block.index).padStart(3, '0')}`;
  throw new TypeError(
    `unknown block kind ${JSON.stringify(block.kind)} — expected "hot", "ext", ` +
      '"latin" or "latin-ext"',
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
 * tier first, then the Ext blocks by their number, and the Latin tier LAST.
 *
 * ⚠️ The Latin blocks come AFTER the Chinese ones on purpose: the stylesheet
 * lists the blocks in the order the files are written, and the version token
 * of the family is the hash of the file names and their bytes IN THAT ORDER.
 * Moving the Latin blocks in front would change the token of every family —
 * and the token is what tells the browser that the file behind a URL is a
 * new one.
 *
 * A plan without a Latin tier (the shape the unit tests use) yields the
 * Chinese blocks only — the Latin tier is optional, not required.
 */
function blocksOf(plan) {
  const ext = [...plan.extBlocks].sort((a, b) => a.index - b.index);
  const blocks = [
    { kind: 'hot', chars: plan.hot },
    ...ext.map((block) => ({ kind: 'ext', index: block.index, chars: block.chars })),
  ];

  const latin = plan.latin;
  if (latin) {
    const latinExt = [...latin.extBlocks].sort((a, b) => a.index - b.index);
    blocks.push({ kind: 'latin', chars: latin.hot });
    blocks.push(
      ...latinExt.map((block) => ({ kind: 'latin-ext', index: block.index, chars: block.chars })),
    );
  }

  return blocks;
}
/**
 * Render the two stylesheets of one family.
 *
 * The hot tier and the ext tier are TWO stylesheets, not one:
 *
 *   fonts-<family>-hot.css   the hot tier — the characters every page
 *                             paints. It is RENDER-BLOCKING, because the
 *                             body typeface draws every character of every
 *                             page: making it asynchronous would show a
 *                             flash of the system font on every page.
 *   fonts-<family>-ext.css   the ext tier — one `@font-face` per six
 *                             characters. It is loaded with
 *                             `media="print"` and promoted by the inline
 *                             script in app/layout.tsx, so it never
 *                             blocks the first paint.
 *
 * WHY THIS IS A WIN: the browser has to parse a stylesheet before it can
 * know which subset file a character needs — the `unicode-range` of every
 * face is what tells it. A single stylesheet with 2458 ext faces cost
 * 608 KB of parsing on every first paint, to learn about faces the page
 * almost never paints. Splitting the two tiers means the blocking part
 * is ~5 KB.
 *
 * ⚠️ THE COST, STATED PLAINLY: until the ext stylesheet arrives, the
 * browser does not know that a character lives in an ext block, so the
 * first paint of such a character waits for the stylesheet and then for
 * the woff2. That is one extra round trip for the characters outside the
 * hot tier. The alternative — one 608 KB blocking stylesheet — costs the
 * same round trip on EVERY page load instead, for the characters the page
 * actually paints. This trade is deliberate.
 *
 * A weight pair (400 and 700) of ONE block shares a unicode-range, so the
 * two faces are never split across the two stylesheets — a split would let
 * the browser pick the wrong weight for the characters in the other file.
 */
export function renderStylesheets(family, plan, version) {
  if (typeof version !== 'string' || !VERSION_TOKEN_PATTERN.test(version)) {
    throw new Error(
      `[webfont] the stylesheet of ${family.label} has no usable version token — ` +
        `it got ${JSON.stringify(version)}, but the URL of every subset file needs ` +
        'twelve lowercase hex characters, or the browser keeps the old file for a year',
    );
  }

  const hotFaces = [];
  const extFaces = [];
  for (const block of blocksOf(plan)) {
    const files = blockFileNames(family, block);
    if (files.length !== family.weights.length) {
      throw new Error(
        `family ${family.key}: ${files.length} file(s) per block but ` +
          `${family.weights.length} weight(s) — the weights and the sources disagree`,
      );
    }
    for (let index = 0; index < files.length; index += 1) {
      const face = renderFace({
        family,
        weight: family.weights[index],
        file: files[index],
        chars: block.chars,
        version,
      });
      // `blocksOf()` yields four kinds: 'hot', 'ext', 'latin', 'latin-ext'.
      //
      // The hot sheet takes the hot Chinese tier AND the latin hot tier:
      // the latin hot block is the handful of latin faces every page
      // paints, and it is small. Everything else — the Chinese ext blocks
      // and the latin ext blocks alike — is the ext tier.
      const isHot = block.kind === 'hot' || block.kind === 'latin';
      (isHot ? hotFaces : extFaces).push(face);
    }
  }

  const header = (which) =>
    `/* ${family.css} (${which} tier) — ${family.purpose}\n` +
    ' * Generated by scripts/fonts/build-webfont-subsets.mjs. Do not edit by hand. */\n';

  return {
    hot: header('hot') + hotFaces.join('\n') + '\n',
    ext: header('ext') + extFaces.join('\n') + '\n',
  };
}

/**
 * The one-stylesheet form. Kept for the release importer and for the
 * callers that want the whole family in one string. Prefer
 * renderStylesheets() in the builder.
 */
export function renderStylesheet(family, plan, version) {
  const { hot, ext } = renderStylesheets(family, plan, version);
  return hot + ext;
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
 * Copy the licence of a family into the output tree.
 *
 * The licence is written TWICE, and the second copy is ADDITIVE:
 *   - on the root of the output tree (`<root>/web/OFL-<族>.txt`) — where
 *     it has always been, and where it stays;
 *   - inside the directory of the family (`<root>/web/<族>/OFL-<族>.txt`) —
 *     so that every release directory is SELF-SUFFICIENT. A subset of an
 *     OFL font is still an OFL font, and the licence has to be
 *     distributed with it: a release that is taken away as a whole
 *     directory has to carry the licence of its family.
 *
 * @param {object} family the family the licence belongs to
 * @param {string} stagingDir the directory the licence is read from
 * @param {string} outRoot the root of the output tree
 * @returns {Promise<void>} resolves when both copies are on the disk
 */
export async function copyFamilyLicences(
  family,
  stagingDir = STAGING_DIR,
  outRoot = OUT_ROOT,
) {
  const from = assertLicense(family, stagingDir);
  const familyDir = join(outRoot, family.dir);
  try {
    await mkdir(familyDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `[webfont] cannot create the output directory ${familyDir}: ${err.message}`,
    );
  }
  const targets = [
    join(outRoot, `OFL-${family.key}.txt`),
    join(familyDir, `OFL-${family.key}.txt`),
  ];
  for (const to of targets) {
    try {
      await copyFile(from, to);
    } catch (err) {
      throw new Error(`[webfont] cannot copy the licence ${from} to ${to}: ${err.message}`);
    }
  }
}

/**
 * Remove the subset files that this build did not write.
 *
 * The output directory of a family belongs to the build: a corpus that
 * shrinks leaves `ext-NNNN.woff2` files behind that no stylesheet
 * references any more. They are dead weight in the repository, so they
 * are swept once the family has been written.
 *
 * Only `.woff2` files are candidates, and only the ones that are not in
 * `keep` are removed. Anything else in the directory is left alone.
 *
 * The sweep happens AFTER the family is written, never before: clearing
 * the directory first would, when the build fails half way through, leave
 * the old stylesheet pointing at files that are already gone — the whole
 * family would fall back to the system font, which is worse than a tofu
 * box. Sweeping at the end keeps that failure mode exactly as it is
 * today: the old stylesheet, a mixture of old and new files, and a
 * non-zero exit.
 *
 * @param {string} dir      the output directory of one family
 * @param {Set<string>} keep the file names this build wrote
 * @returns {Promise<string[]>} the names that were removed, sorted
 */
export async function sweepStaleFiles(dir, keep) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // A directory that is not there has nothing to sweep.
    if (typeof err?.code === 'string' && err.code === 'ENOENT') return [];
    throw new Error(`[webfont] cannot read the output directory ${dir}: ${err.message}`);
  }

  const removed = [];
  for (const entry of entries) {
    // A subdirectory is not a product of the build, and a file that is not
    // a subset file is not ours to touch either.
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.woff2')) continue;
    if (keep.has(entry.name)) continue;

    const path = join(dir, entry.name);
    try {
      await unlink(path);
    } catch (err) {
      throw new Error(`[webfont] cannot remove the stale subset ${path}: ${err.message}`);
    }
    removed.push(entry.name);
  }

  removed.sort();
  return removed;
}

/**
 * The Latin tail blocks of a plan must not be wider than the family says.
 *
 * The width of the Latin blocks is a contract between the plan builder and
 * this script: the plan cuts the tail, this script cuts the files. A plan
 * that was cut at another width would produce files nobody expects — and
 * the file budget of the Latin tail would be wrong.
 */
function assertLatinBlockWidth(family, plan) {
  const latin = plan.latin;
  if (!latin) return;
  const limit = family.latinExtBlockChars;
  for (const block of latin.extBlocks) {
    if (block.chars.length > limit) {
      throw new Error(
        `[webfont] the Latin block ${block.index} of ${family.label} holds ` +
          `${block.chars.length} characters — the plan says a Latin block holds at ` +
          `most ${limit}. The plan and this script disagree about the width of a ` +
          'Latin block, and the file budget would be wrong',
      );
    }
  }
}

/**
 * The subset options of a block.
 *
 * The Chinese blocks are cut exactly as they always were: one option, one
 * format. NOT ONE BYTE of the 7 936 Chinese subsets may change.
 *
 * The Latin blocks add `noLayoutClosure: true`: harfbuzz' layout closure
 * keeps the CLOSURE of the layout in a pure Latin subset, and the closure of
 * a Latin subset carries the five ligature glyphs the site paints NEVER. The
 * controller measured it: 434 glyphs with the closure against 119 without, a
 * factor of 3.2 for glyphs nobody sees.
 *
 * The `wght` axis is NOT pinned. Pinning it would build a static instance
 * and throw the real bold away (G9: the look of the font does not change),
 * and it FAILS outright on the static brand face: the axis does not exist
 * there, and harfbuzz answers "returned zero when pinning".
 */
function subsetOptionsFor(block) {
  if (block.kind === 'latin' || block.kind === 'latin-ext') {
    return { targetFormat: 'woff2', noLayoutClosure: true };
  }
  return { targetFormat: 'woff2' };
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
  const written = new Set();
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
        subset = await subsetFont(sources[index].buffer, text, subsetOptionsFor(block));
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
      written.add(name);

      files += 1;
      bytes += subset.length;

      if (files % 500 === 0) {
        console.log(`[webfont] ${family.key}: ${files} file(s), ${bytes} B`);
      }
    }
  }

  const version = hasher.digest();
  const sheets = renderStylesheets(family, plan, version);
  const hotPath = join(FONT_DIR, `fonts-${family.key}-hot.css`);
  const extPath = join(FONT_DIR, `fonts-${family.key}-ext.css`);
  try {
    await writeFile(hotPath, sheets.hot, 'utf8');
    await writeFile(extPath, sheets.ext, 'utf8');
  } catch (err) {
    throw new Error(
      `[webfont] cannot write the stylesheet ${hotPath}: ${err.message}`,
    );
  }
  // The one-stylesheet layout is gone: the old file has to go, or the
  // 30-day cache rule on /font/:path* can still serve it.
  await rm(join(FONT_DIR, family.css), { force: true });
  await copyFamilyLicences(family, stagingDir);

  // The family is complete now: the stylesheet points at the files that
  // were just written, so the files of an older corpus that this build
  // did not write are dead weight and are swept away. The sweep happens
  // after the write on purpose — see sweepStaleFiles.
  const swept = await sweepStaleFiles(outDir, written);
  if (swept.length > 0) {
    console.log(`[webfont] ${family.key}: swept ${swept.length} stale file(s)`);
  }

  const chars = blocks.reduce((sum, block) => sum + block.chars.length, 0);
  const cjkBlocks = blocks.filter(
    (block) => block.kind === 'hot' || block.kind === 'ext',
  ).length;
  const latinBlocks = blocks.length - cjkBlocks;
  const latinChars = blocks
    .filter((block) => block.kind === 'latin' || block.kind === 'latin-ext')
    .reduce((sum, block) => sum + block.chars.length, 0);
  const cssBytes = Buffer.byteLength(sheets.hot, 'utf8') + Buffer.byteLength(sheets.ext, 'utf8');
  const cssGzipBytes =
    gzipSync(Buffer.from(sheets.hot, 'utf8')).length +
    gzipSync(Buffer.from(sheets.ext, 'utf8')).length;

  console.log(
    `[webfont] ${family.key}: ${chars} chars (${chars - latinChars} cjk + ${latinChars} latin), ` +
      `${cjkBlocks - 1} ext blocks + ${latinBlocks} latin blocks, ` +
      `${files} files, ${bytes} B (${Math.round(bytes / 1024)} KB), ` +
      `css ${cssBytes} B (gzip ${cssGzipBytes} B), version ${version}`,
  );

  return {
    key: family.key,
    chars,
    blocks: blocks.length,
    extBlocks: cjkBlocks - 1,
    latinBlocks,
    latinChars,
    files,
    bytes,
    version,
    cssBytes,
    cssGzipBytes,
    cssHot: sheets.hot,
    cssExt: sheets.ext,
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

  // Phase one: check everything. Nothing is written before this passes.
  //
  // The coverage of the source fonts is read HERE, from the buffers the
  // build has read anyway, and it is handed to the plan builder: the Latin
  // tier is filtered by the real glyph coverage in the PLAN, so the
  // `unicode-range` of a Latin face never claims a code point the font
  // cannot draw (the subsetter drops such a code point SILENTLY, and a face
  // that claims a code point it cannot draw is a tofu box in the browser).
  const prepared = [];
  const coverage = {};
  const sourcesByFamily = new Map();
  for (const family of FAMILIES) {
    const sources = [];
    for (const fileName of family.sources) {
      sources.push(await readSourceFont(family, fileName, stagingDir));
    }
    assertLicense(family, stagingDir);
    sourcesByFamily.set(family.key, sources);
    coverage[family.key] = coverageOfSources(sources);
  }

  const plans = loadFamilyCharsets({ coverage });

  for (const family of FAMILIES) {
    const covered = coverage[family.key];
    const chinese = filterPlanByCoverage(plans[family.key], covered, family.extBlockChars);
    // The Latin tier is already filtered by the same coverage, in the plan
    // layer, and its tail is already cut into blocks of twelve characters.
    // It passes through untouched — filtering it again here would cut its
    // tail into blocks of six, and the block width is part of the contract
    // of the plan.
    const plan = { ...chinese, latin: plans[family.key].latin };
    assertLatinBlockWidth(family, plan);
    prepared.push({ family, plan, sources: sourcesByFamily.get(family.key) });
  }

  // Phase two: write.
  const cssByFile = {};
  const families = [];

  for (const item of prepared) {
    const stats = await buildFamily(item.family, item.plan, item.sources, stagingDir);
    cssByFile[`fonts-${item.family.key}-hot.css`] = stats.cssHot;
    cssByFile[`fonts-${item.family.key}-ext.css`] = stats.cssExt;
    families.push(stats);
  }

  const version = manifestVersion(cssByFile);
  const manifest = {
    version,
    files: {
      wenkai: '/font/fonts-wenkai-hot.css',
      wenkaiExt: '/font/fonts-wenkai-ext.css',
      sans: '/font/fonts-sans-hot.css',
      sansExt: '/font/fonts-sans-ext.css',
      serif: '/font/fonts-serif-hot.css',
      serifExt: '/font/fonts-serif-ext.css',
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
