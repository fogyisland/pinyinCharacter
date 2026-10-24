/**
 * subset-brush-fonts.mjs
 *
 * Subsets the brush fonts (柳健毛草 / 站酷小薇 / 志莽星) and writes the
 * font files the site serves:
 *
 *   - public/fonts/<name>.woff2        — the @font-face files (browser)
 *   - public/fonts/zcool-xiaowei-pdf.ttf — the practice-PDF font (react-pdf)
 *
 * Why this exists:
 *   These three fonts were the last ones still served as full TTF. A visitor
 *   who picked a brush style in the worksheet preview downloaded 4.9 MB
 *   (Liu Jian Mao Cao), 6.3 MB (ZCOOL XiaoWei) or 4.1 MB (Zhi Mang Xing) —
 *   a single font file for a handful of characters on screen.
 *
 *   The CSS subset keeps the characters the site can actually render, which
 *   is the same charset the ancient-script fonts use (scripts/fonts/charset.mjs):
 *   the 7k common characters, every character in the dictionary and the poem
 *   lines (the poem viewer renders its lines in a brush face).
 *
 *   The PDF font is a separate, tiny TTF. react-pdf embeds a *subset* of the
 *   registered font, and its subsetter only works on TrueType sources: with a
 *   WOFF2 source it writes the composite glyphs out of bounds ("RangeError:
 *   Offset is outside the bounds of the DataView"). The PDF only draws a
 *   handful of characters, so we ship a TTF that holds exactly those instead
 *   of the full 6.3 MB original.
 *
 * The sources are read from scripts/fonts/staging/ancient/ (gitignored) and
 * fall back to assets/fonts/<name>.ttf, so the pipeline is reproducible
 * from the repository alone.
 *
 * Run: npm run fonts:subset-brush
 */
import subsetFont from 'subset-font';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCharset } from './charset.mjs';
import {
  PRACTICE_PDF_FONT_FILE,
  practicePdfFontCharset,
} from '../../lib/practice-pdf-font.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STAGING = resolve(__dirname, 'staging', 'ancient');
const SOURCES = resolve(ROOT, 'assets', 'fonts');
const OUT = resolve(ROOT, 'public', 'fonts');

/**
 * Brush fonts to subset for the browser. `src` is the file name, `out` the
 * WOFF2 name written to public/fonts/. Every entry is referenced by an
 * @font-face rule in app/globals.css.
 */
const TARGETS = [
  { src: 'liu-jian-mao-cao.ttf', out: 'liu-jian-mao-cao.woff2' },
  { src: 'zcool-xiaowei.ttf', out: 'zcool-xiaowei.woff2' },
  { src: 'zhi-mang-xing.ttf', out: 'zhi-mang-xing.woff2' },
];

/** Source of the TrueType file the practice PDF embeds. */
const PDF_FONT_SOURCE = 'zcool-xiaowei.ttf';

/** Locate the source font: staging dir first, then the assets dir. */
function resolveSource(src) {
  const staged = join(STAGING, src);
  if (existsSync(staged)) return staged;
  const asset = join(SOURCES, src);
  if (existsSync(asset)) return asset;
  return null;
}

/** Format a byte count as MB with two decimals. */
function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

/**
 * Write the TrueType subset the practice PDF embeds.
 *
 * The charset comes from lib/practice-pdf-font.ts, which is also imported by
 * the PDF component — the two cannot drift apart.
 */
async function writePdfFont() {
  const srcPath = resolveSource(PDF_FONT_SOURCE);
  if (!srcPath) {
    console.warn(`[subset] SKIP ${PRACTICE_PDF_FONT_FILE}  (no source ${PDF_FONT_SOURCE})`);
    return { status: 'skip' };
  }
  const charset = practicePdfFontCharset();
  const started = Date.now();
  try {
    const buf = await readFile(srcPath);
    const out = await subsetFont(buf, charset, { targetFormat: 'sfnt' });
    await writeFile(resolve(OUT, PRACTICE_PDF_FONT_FILE), out);
    console.log(
      `[subset] OK   ${PRACTICE_PDF_FONT_FILE}  ${mb(buf.length)} MB -> ${mb(out.length)} MB  ` +
        `(${charset.length} chars, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
    return { status: 'ok', from: mb(buf.length), to: mb(out.length) };
  } catch (err) {
    console.error(`[subset] FAIL ${PRACTICE_PDF_FONT_FILE}:`, err);
    return { status: 'fail' };
  }
}

async function main() {
  const charsetChars = await buildCharset();
  const charset = charsetChars.join('');
  console.log(`[subset] charset: ${charsetChars.length} BMP chars`);

  const results = [];
  let before = 0;
  let after = 0;

  for (const t of TARGETS) {
    const srcPath = resolveSource(t.src);
    if (!srcPath) {
      console.warn(`[subset] SKIP ${t.out}  (no source ${t.src})`);
      results.push({ out: t.out, status: 'skip' });
      continue;
    }
    const started = Date.now();
    try {
      const buf = await readFile(srcPath);
      const out = await subsetFont(buf, charset, { targetFormat: 'woff2' });
      await writeFile(resolve(OUT, t.out), out);
      before += buf.length;
      after += out.length;
      console.log(
        `[subset] OK   ${t.out}  ${mb(buf.length)} MB -> ${mb(out.length)} MB  ` +
          `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
      results.push({ out: t.out, status: 'ok' });
    } catch (err) {
      console.error(`[subset] FAIL ${t.out}:`, err);
      results.push({ out: t.out, status: 'fail' });
    }
  }

  const pdfResult = await writePdfFont();

  const failed = results.filter((r) => r.status === 'fail').length + (pdfResult.status === 'fail' ? 1 : 0);
  const skipped = results.filter((r) => r.status === 'skip').length;
  const ok = results.filter((r) => r.status === 'ok').length;
  if (ok > 0) {
    console.log(`[subset] total: ${mb(before)} MB -> ${mb(after)} MB`);
  }
  console.log(`[subset] done. ok=${ok} skip=${skipped} fail=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[subset] unexpected error:', err);
  process.exit(1);
});
