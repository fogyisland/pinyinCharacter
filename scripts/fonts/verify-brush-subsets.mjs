/**
 * verify-brush-subsets.mjs
 *
 * Proves that subsetting the brush fonts did not change which characters
 * they can render.
 *
 * For every character of the site charset (and of the practice-PDF charset)
 * we compare the ORIGINAL TTF against the generated subset: a regression is
 * any char the original could render but the subset cannot. A subset is only
 * safe to ship if the regression count is zero.
 *
 * Run: npm run fonts:verify-brush
 */
import * as fontkit from 'fontkit';
import { readFile } from 'node:fs/promises';
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

const TARGETS = [
  { src: 'liu-jian-mao-cao.ttf', out: 'liu-jian-mao-cao.woff2' },
  { src: 'zcool-xiaowei.ttf', out: 'zcool-xiaowei.woff2' },
  { src: 'zhi-mang-xing.ttf', out: 'zhi-mang-xing.woff2' },
];

/** Locate the source font: staging dir first, then the assets dir. */
function resolveSource(src) {
  const staged = join(STAGING, src);
  if (existsSync(staged)) return staged;
  const asset = join(SOURCES, src);
  if (existsSync(asset)) return asset;
  return null;
}

/**
 * Codepoints the font can render, restricted to the charset under test.
 *
 * fontkit v2 exposes `hasGlyphForCodePoint()` rather than an iterable glyph
 * list — the same probe scripts/build-era-coverage.ts uses.
 */
function renderableCodepoints(font, codepoints) {
  const set = new Set();
  for (const cp of codepoints) {
    if (font.hasGlyphForCodePoint(cp)) set.add(cp);
  }
  return set;
}

/**
 * Compare the original and the subset over one charset.
 *
 * Returns the regression list (chars the original could render and the subset
 * cannot) plus the coverage counts before and after.
 */
function compare(original, subset, codepoints) {
  const originalCps = renderableCodepoints(original, codepoints);
  const subsetCps = renderableCodepoints(subset, codepoints);
  const regressions = [];
  for (const cp of codepoints) {
    if (originalCps.has(cp) && !subsetCps.has(cp)) regressions.push(cp);
  }
  return {
    regressions,
    before: codepoints.filter((cp) => originalCps.has(cp)).length,
    after: codepoints.filter((cp) => subsetCps.has(cp)).length,
  };
}

async function main() {
  const charset = await buildCharset();
  const siteCodepoints = charset.map((ch) => ch.codePointAt(0));
  const pdfCharset = practicePdfFontCharset();
  const pdfCodepoints = [...new Set(pdfCharset)].map((ch) => ch.codePointAt(0));
  console.log(`[verify] charset: ${charset.length} BMP chars`);
  console.log(`[verify] PDF charset: ${pdfCodepoints.length} chars\n`);

  let failed = 0;
  let skipped = 0;
  let checked = 0;

  for (const t of TARGETS) {
    const srcPath = resolveSource(t.src);
    const outPath = join(OUT, t.out);
    if (!srcPath) {
      console.warn(`[verify] SKIP ${t.out}  (no source ${t.src})`);
      skipped++;
      continue;
    }
    if (!existsSync(outPath)) {
      console.error(`[verify] FAIL ${t.out}  (subset missing — run npm run fonts:subset-brush)`);
      failed++;
      continue;
    }

    const original = fontkit.openSync(srcPath);
    const subset = fontkit.openSync(outPath);
    const { regressions, before, after } = compare(original, subset, siteCodepoints);
    const originalSize = (await readFile(srcPath)).length;
    const subsetSize = (await readFile(outPath)).length;

    if (regressions.length === 0) {
      console.log(
        `[verify] OK   ${t.out.padEnd(30)} ${(originalSize / 1024 / 1024).toFixed(2)} MB -> ` +
          `${(subsetSize / 1024 / 1024).toFixed(2)} MB  charset coverage ${before} -> ${after} chars  ` +
          `(0 regressions)`,
      );
    } else {
      failed++;
      const sample = regressions.slice(0, 10).map((cp) => String.fromCodePoint(cp)).join('');
      console.error(
        `[verify] FAIL ${t.out.padEnd(30)} ${regressions.length} REGRESSIONS, e.g. "${sample}"`,
      );
    }
    checked++;
  }

  // The PDF font is a TTF subset of the same source, checked against the
  // characters the PDF actually draws.
  const pdfSrcPath = resolveSource('zcool-xiaowei.ttf');
  const pdfOutPath = join(OUT, PRACTICE_PDF_FONT_FILE);
  if (!pdfSrcPath) {
    console.warn(`[verify] SKIP ${PRACTICE_PDF_FONT_FILE}  (no source zcool-xiaowei.ttf)`);
    skipped++;
  } else if (!existsSync(pdfOutPath)) {
    console.error(
      `[verify] FAIL ${PRACTICE_PDF_FONT_FILE}  (subset missing — run npm run fonts:subset-brush)`,
    );
    failed++;
  } else {
    const original = fontkit.openSync(pdfSrcPath);
    const subset = fontkit.openSync(pdfOutPath);
    const { regressions, before, after } = compare(original, subset, pdfCodepoints);
    const originalSize = (await readFile(pdfSrcPath)).length;
    const subsetSize = (await readFile(pdfOutPath)).length;
    if (regressions.length === 0) {
      console.log(
        `[verify] OK   ${PRACTICE_PDF_FONT_FILE.padEnd(30)} ` +
          `${(originalSize / 1024 / 1024).toFixed(2)} MB -> ${(subsetSize / 1024 / 1024).toFixed(2)} MB  ` +
          `PDF charset coverage ${before} -> ${after} chars  (0 regressions)`,
      );
    } else {
      failed++;
      const sample = regressions.slice(0, 10).map((cp) => String.fromCodePoint(cp)).join('');
      console.error(
        `[verify] FAIL ${PRACTICE_PDF_FONT_FILE.padEnd(30)} ${regressions.length} REGRESSIONS, e.g. "${sample}"`,
      );
    }
    checked++;
  }

  console.log('');
  if (failed > 0) {
    console.error(`[verify] ${failed} font(s) failed verification`);
    process.exit(1);
  }
  if (skipped > 0) {
    console.warn(`[verify] ${skipped} font(s) could NOT be verified (source TTF missing)`);
  }
  console.log(`[verify] ${checked} subsets verified — no glyph regressions`);
}

main().catch((err) => {
  console.error('[verify] unexpected error:', err);
  process.exit(1);
});
