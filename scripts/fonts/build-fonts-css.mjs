/**
 * build-fonts-css.mjs
 *
 * Rebuilds public/font/fonts.css — the merged source of truth for the
 * typeface stylesheets — and the per-family files the app actually loads.
 *
 * Why this exists:
 *   The file was a verbatim copy of Google Fonts' css2 output. Google emits
 *   one @font-face per (weight × unicode-range subset), so Noto Sans SC came
 *   with 4 weight declarations per subset and Noto Serif SC with 3 — 937
 *   blocks totalling 1.03 MB for what is really only 432 font files.
 *
 *   Noto Sans SC and Noto Serif SC are VARIABLE fonts: a single file per
 *   subset already carries the whole `wght` axis, and all of its weight
 *   declarations point at that same file. So those declarations can be
 *   collapsed into one face per subset with a weight RANGE
 *   (`font-weight: 400 700`), which is exactly what Google itself serves
 *   to modern browsers. 937 blocks become 432.
 *
 *   LXGW WenKai TC is NOT variable — its 400 and 700 faces are two
 *   different files — so those blocks are left exactly as they are.
 *
 * The result is byte-identical in rendering: the merged range covers the
 * same declared weights, and a request for a weight outside the range
 * clamps to the same face the discrete declarations would have picked.
 *
 * On top of that it writes the SAME rules split per family:
 *   fonts-wenkai.css — the brand typeface (--font-kai), used by the header mark
 *   fonts-sans.css   — the body typeface (--font-han-sans), used by every page
 *   fonts-serif.css  — the serif accent typeface (--font-han-serif), used by
 *                      the dictionary / etymology / story pages
 * app/layout.tsx loads fonts-sans.css synchronously and the other two without
 * blocking the first paint, which keeps ~104 KB of CSS off the critical path.
 *
 * Usage:
 *   node scripts/fonts/build-fonts-css.mjs           merge the current CSS in place
 *   node scripts/fonts/build-fonts-css.mjs --fetch   re-download from Google first
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FONT_DIR = resolve(ROOT, 'public', 'font');
const CSS_PATH = join(FONT_DIR, 'fonts.css');
const MANIFEST_PATH = join(FONT_DIR, 'fonts-manifest.json');

/** The families the site uses, and the weights Google serves for them. */
const FAMILIES = [
  { name: 'LXGW WenKai TC', slug: 'lxgw-wenkai-tc', weights: '400;700' },
  { name: 'Noto Sans SC', slug: 'noto-sans-sc', weights: '100..900' },
  { name: 'Noto Serif SC', slug: 'noto-serif-sc', weights: '200..900' },
];

/**
 * The per-family stylesheets that get written next to fonts.css.
 *
 * `blocking` marks the one file that must stay on the critical path: the
 * body typeface, because every character of every page is drawn with it.
 * The other two are loaded asynchronously by app/layout.tsx — their fallbacks
 * (Kaiti SC / SimSun) are close enough that the swap is invisible.
 */
const SPLITS = [
  {
    file: 'fonts-wenkai.css',
    family: 'LXGW WenKai TC',
    purpose: 'brand typeface — --font-kai',
  },
  {
    file: 'fonts-sans.css',
    family: 'Noto Sans SC',
    purpose: 'body typeface — --font-han-sans',
  },
  {
    file: 'fonts-serif.css',
    family: 'Noto Serif SC',
    purpose: 'serif accent typeface — --font-han-serif',
  },
];

/** A browser UA is required for Google to serve woff2 + variable ranges. */
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Parse a Google Fonts stylesheet into @font-face items.
 *
 * Each item keeps the subset comment that preceded it (Google labels the
 * blocks with e.g. `/* latin *\/`) so the rebuilt file stays readable.
 */
export function parseCss(css) {
  const items = [];
  const re = /(\/\*[^]*?\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    const body = match[2];
    const read = (property) => {
      const found = body.match(new RegExp(`${property}:\\s*([^;]+);`));
      return found ? found[1].trim() : '';
    };
    const urlMatch = body.match(/url\(([^)]+)\)/);
    items.push({
      comment: (match[1] || '').replace(/\s+/g, ' ').trim(),
      // The family is quoted in CSS; strip the quotes so the parsed value
      // is the bare name and comparisons stay readable.
      family: read('font-family').replace(/^['"]|['"]$/g, ''),
      style: read('font-style'),
      weight: read('font-weight'),
      display: read('font-display'),
      src: urlMatch ? urlMatch[1] : '',
      unicodeRange: read('unicode-range'),
    });
  }
  return items;
}

/** Serialise one @font-face block in Google's own layout. */
export function serialize(item) {
  const head = item.comment ? `${item.comment}\n` : '';
  return (
    `${head}@font-face {\n` +
    `  font-family: '${item.family}';\n` +
    `  font-style: ${item.style};\n` +
    `  font-weight: ${item.weight};\n` +
    `  font-display: ${item.display};\n` +
    `  src: url(${item.src}) format('woff2');\n` +
    `  unicode-range: ${item.unicodeRange};\n` +
    `}`
  );
}

/**
 * Collapse the weight declarations that share one font file.
 *
 * Two blocks belong together when they declare the same family, style,
 * unicode-range AND point at the same file — that is a variable font, and
 * the weights can be expressed as a range. Blocks with different files
 * (LXGW WenKai TC's static Regular/Bold) are never merged.
 */
export function mergeWeights(items) {
  const groups = new Map();
  for (const item of items) {
    const key = [item.family, item.style, item.unicodeRange, item.src].join('|');
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { items: [item] });
    }
  }

  const merged = [];
  for (const group of groups.values()) {
    const first = group.items[0];
    const weights = group.items.map((i) => Number.parseInt(i.weight, 10));
    const numeric = weights.every((w) => Number.isFinite(w));

    if (group.items.length === 1 || !numeric) {
      // Nothing to collapse — keep every block as it was.
      merged.push(...group.items);
      continue;
    }

    const min = Math.min(...weights);
    const max = Math.max(...weights);
    // The subset comment may live on any of the collapsed blocks.
    const comment = group.items.find((i) => i.comment)?.comment ?? '';

    merged.push({
      ...first,
      comment,
      weight: min === max ? String(min) : `${min} ${max}`,
    });
  }
  return merged;
}

/**
 * Group the @font-face items by family and render one stylesheet per family.
 *
 * Every rule keeps its `unicode-range`, so the browser still picks the same
 * subset file for the same characters — the split only changes WHICH
 * stylesheet a page has to download.
 */
export function splitByFamily(items) {
  const out = new Map();
  for (const split of SPLITS) {
    const subset = items.filter((item) => item.family === split.family);
    if (subset.length === 0) {
      throw new Error(
        `No @font-face rules for family "${split.family}" — refusing to write an empty ${split.file}`,
      );
    }
    const header =
      `/* ${split.file} — ${split.purpose}\n` +
      ` * Generated by scripts/fonts/build-fonts-css.mjs. Do not edit by hand. */\n`;
    out.set(split.file, header + `${subset.map(serialize).join('\n')}\n`);
  }
  return out;
}

/** Download the Google stylesheet and every font file it references. */
async function fetchFromGoogle() {
  const query = FAMILIES.map(
    (f) => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.weights}`,
  ).join('&');
  const url = `https://fonts.googleapis.com/css2?${query}&display=swap`;

  console.log(`[fonts] fetching ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': MODERN_UA } });
  if (!res.ok) {
    throw new Error(`Google Fonts responded ${res.status} ${res.statusText}`);
  }
  const css = await res.text();

  const items = parseCss(css);
  if (items.length === 0) {
    throw new Error('Google Fonts returned no @font-face rules — aborting');
  }

  const byFamily = new Map(FAMILIES.map((f) => [f.name, f]));
  let downloaded = 0;
  for (const item of items) {
    const family = byFamily.get(item.family);
    if (!family) {
      throw new Error(`Unexpected family in Google response: ${item.family}`);
    }
    const dest = join(FONT_DIR, family.slug, item.src.split('/').pop());
    if (existsSync(dest)) continue;
    await mkdir(dirname(dest), { recursive: true });
    const fontRes = await fetch(`https://fonts.gstatic.com${item.src}`);
    if (!fontRes.ok) {
      throw new Error(`Failed to download ${item.src}: ${fontRes.status}`);
    }
    await writeFile(dest, Buffer.from(await fontRes.arrayBuffer()));
    downloaded++;
  }
  console.log(`[fonts] downloaded ${downloaded} new font file(s)`);

  return items;
}

async function main() {
  const shouldFetch = process.argv.includes('--fetch');

  const items = shouldFetch
    ? await fetchFromGoogle()
    : parseCss(await readFile(CSS_PATH, 'utf8'));

  if (items.length === 0) {
    throw new Error(`No @font-face rules found in ${CSS_PATH}`);
  }

  const merged = mergeWeights(items);
  const output = `${merged.map(serialize).join('\n')}\n`;

  const before = items.length;
  const after = merged.length;
  const beforeBytes = Buffer.byteLength(
    items.map(serialize).join('\n'),
    'utf8',
  );
  const afterBytes = Buffer.byteLength(output, 'utf8');

  await writeFile(CSS_PATH, output, 'utf8');

  console.log(
    `[fonts] fonts.css: ${before} blocks -> ${after} blocks, ` +
      `${(beforeBytes / 1024).toFixed(0)} KB -> ${(afterBytes / 1024).toFixed(0)} KB`,
  );

  for (const [file, css] of splitByFamily(merged)) {
    const path = join(FONT_DIR, file);
    await writeFile(path, css, 'utf8');
    console.log(`[fonts] ${file}: ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(0)} KB`);
  }

  await writeManifest(merged);
}

/**
 * Write public/font/fonts-manifest.json.
 *
 * The manifest carries a content hash of the generated stylesheets. The app
 * appends it to the stylesheet URLs as `?v=<hash>`, which lets the whole
 * /font/ tree be served with `Cache-Control: immutable` — the font files
 * themselves are already content-hashed by Google, and the hash in the
 * manifest keeps the stylesheets from going stale when they are rebuilt.
 */
async function writeManifest(items) {
  const hash = createHash('sha256');
  for (const split of SPLITS) {
    const css = items
      .filter((item) => item.family === split.family)
      .map(serialize)
      .join('\n');
    hash.update(css);
  }
  const version = hash.digest('hex').slice(0, 12);
  const manifest = {
    version,
    files: Object.fromEntries(SPLITS.map((s) => [s.file.replace(/^fonts-|\.css$/g, ''), `/font/${s.file}`])),
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[fonts] fonts-manifest.json: version ${version}`);
}

// Only run the build when this file is the entry point — the unit test
// imports the pure helpers above and must not trigger a rebuild.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[fonts] build-fonts-css failed:', err);
    process.exit(1);
  });
}


