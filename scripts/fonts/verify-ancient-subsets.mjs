/**
 * verify-ancient-subsets.mjs
 *
 * Proves that subsetting the ancient fonts did not change which characters
 * they can render.
 *
 * For every character in the site charset we compare the ORIGINAL TTF against
 * the generated WOFF2 subset: a regression is any char the original could
 * render but the subset cannot. A subset is only safe to ship if the
 * regression count is zero.
 *
 * Run: npm run fonts:verify-ancient
 */
import * as fontkit from 'fontkit';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCharset } from './charset.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STAGING = resolve(__dirname, 'staging', 'ancient');
const OUT = resolve(ROOT, 'public', 'fonts');

const TARGETS = [
  { src: 'founder-jiaguwen.ttf', out: 'founder-jiaguwen.woff2' },
  { src: 'BabelStoneHanBasic.ttf', out: 'BabelStoneHanBasic.woff2' },
  { src: 'BabelStoneHanExtra.ttf', out: 'BabelStoneHanExtra.woff2' },
  { src: 'quanziku-shuowen.ttf', out: 'quanziku-shuowen.woff2' },
  { src: 'wang-hanzong-lishu.ttf', out: 'wang-hanzong-lishu.woff2' },
  { src: 'wang-hanzong-weibei.ttf', out: 'wang-hanzong-weibei.woff2' },
  { src: 'wang-hanzong-xingshu.ttf', out: 'wang-hanzong-xingshu.woff2' },
  { src: 'Oracular-Regular.ttf', out: 'Oracular-Regular.woff2' },
  { src: 'Oracular-Inverted.ttf', out: 'Oracular-Inverted.woff2' },
];

function resolveSource(src) {
  const staged = join(STAGING, src);
  if (existsSync(staged)) return staged;
  const published = join(OUT, src);
  if (existsSync(published)) return published;
  return null;
}

/**
 * Codepoints the font can render, restricted to the charset under test.
 *
 * fontkit v2 exposes `hasGlyphForCodePoint()` rather than an iterable glyph
 * list, and it is the same probe scripts/build-era-coverage.ts uses — so the
 * coverage numbers here match what the etymology pages will actually show.
 */
function renderableCodepoints(font, codepoints) {
  const set = new Set();
  for (const cp of codepoints) {
    if (font.hasGlyphForCodePoint(cp)) set.add(cp);
  }
  return set;
}

async function main() {
  const charset = await buildCharset();
  const codepoints = charset.map((ch) => ch.codePointAt(0));
  console.log(`[verify] charset: ${charset.length} BMP chars\n`);

  let failed = 0;
  let skipped = 0;

  for (const t of TARGETS) {
    const srcPath = resolveSource(t.src);
    const outPath = join(OUT, t.out);
    if (!srcPath) {
      // Without the original TTF there is nothing to compare against, so
      // this font is UNVERIFIED — not verified. Say so loudly.
      console.warn(
        `[verify] SKIP ${t.out}  (no source ${t.src} — run npm run fonts:download to verify it)`,
      );
      skipped++;
      continue;
    }
    if (!existsSync(outPath)) {
      console.error(`[verify] FAIL ${t.out}  (subset missing — run npm run fonts:subset-ancient)`);
      failed++;
      continue;
    }

    const original = fontkit.openSync(srcPath);
    const subset = fontkit.openSync(outPath);

    const originalCps = renderableCodepoints(original, codepoints);
    const subsetCps = renderableCodepoints(subset, codepoints);

    // Regression = original could render it, subset cannot.
    const regressions = [];
    for (const cp of codepoints) {
      if (originalCps.has(cp) && !subsetCps.has(cp)) regressions.push(cp);
    }

    // Coverage over the charset, before vs after.
    const before = codepoints.filter((cp) => originalCps.has(cp)).length;
    const after = codepoints.filter((cp) => subsetCps.has(cp)).length;

    const originalSize = (await readFile(srcPath)).length;
    const subsetSize = (await readFile(outPath)).length;
    const from = (originalSize / 1024 / 1024).toFixed(1);
    const to = (subsetSize / 1024 / 1024).toFixed(2);

    if (regressions.length === 0) {
      console.log(
        `[verify] OK   ${t.out.padEnd(30)} ${from.padStart(6)} MB -> ${to.padStart(6)} MB  ` +
          `charset coverage ${before} -> ${after} chars  (0 regressions)`,
      );
    } else {
      failed++;
      const sample = regressions.slice(0, 10).map((cp) => String.fromCodePoint(cp)).join('');
      console.error(
        `[verify] FAIL ${t.out.padEnd(30)} ${from.padStart(6)} MB -> ${to.padStart(6)} MB  ` +
          `${regressions.length} REGRESSIONS, e.g. "${sample}"`,
      );
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`[verify] ${failed} font(s) failed verification`);
    process.exit(1);
  }
  if (skipped > 0) {
    console.warn(
      `[verify] ${skipped} font(s) could NOT be verified (source TTF missing) — ` +
        `run npm run fonts:download for a full check`,
    );
  }
  console.log(
    `[verify] ${TARGETS.length - skipped - failed}/${TARGETS.length} subsets verified — no glyph regressions`,
  );
}

main().catch((err) => {
  console.error('[verify] unexpected error:', err);
  process.exit(1);
});
