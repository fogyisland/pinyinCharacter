/**
 * build-fonts-css.mjs
 *
 * Rebuilds public/font/fonts.css — the stylesheet app/layout.tsx loads
 * synchronously in <head>, so it blocks the first paint of EVERY page.
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
 * Usage:
 *   node scripts/fonts/build-fonts-css.mjs           merge the current CSS in place
 *   node scripts/fonts/build-fonts-css.mjs --fetch   re-download from Google first
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FONT_DIR = resolve(ROOT, 'public', 'font');
const CSS_PATH = join(FONT_DIR, 'fonts.css');

/** The families the site uses, and the weights Google serves for them. */
const FAMILIES = [
  { name: 'LXGW WenKai TC', slug: 'lxgw-wenkai-tc', weights: '400;700' },
  { name: 'Noto Sans SC', slug: 'noto-sans-sc', weights: '100..900' },
  { name: 'Noto Serif SC', slug: 'noto-serif-sc', weights: '200..900' },
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


