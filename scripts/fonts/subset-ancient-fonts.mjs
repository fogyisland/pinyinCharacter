/**
 * subset-ancient-fonts.mjs
 *
 * Subsets the ancient-script fonts (甲骨文 / 金文 / 小篆 / 隶书) down to the
 * characters this site can actually render, and writes WOFF2 files to
 * public/fonts/.
 *
 * Why this exists:
 *   The originals are 157 MB of TTF in public/fonts/. A visitor opening
 *   /etymology/<char> downloaded 25-33 MB (Oracular, BabelStone Han) just to
 *   see one glyph column — the single worst payload on the site. The subset
 *   keeps only the ~9.5k BMP characters the site can show, which cuts the
 *   download by roughly 10x.
 *
 * The charset itself lives in scripts/fonts/charset.mjs so that the
 * subsetter and the verifier (scripts/fonts/verify-ancient-subsets.mjs)
 * always agree on what "the characters this site can render" means.
 *
 * Run: npm run fonts:subset-ancient
 * Sources are read from scripts/fonts/staging/ancient/ (gitignored) and fall
 * back to public/fonts/<name>.ttf, so the first run works on the current
 * tree. npm run fonts:download writes the sources to the staging dir.
 */
import subsetFont from 'subset-font';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCharset } from './charset.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STAGING = resolve(__dirname, 'staging', 'ancient');
const OUT = resolve(ROOT, 'public', 'fonts');

/**
 * Ancient fonts to subset. `src` is the file name, `out` the WOFF2 name
 * written to public/fonts/. Every entry is referenced by an @font-face rule
 * in app/globals.css.
 */
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

/** Locate the source font: staging dir first, then the public dir. */
function resolveSource(src) {
  const staged = join(STAGING, src);
  if (existsSync(staged)) return staged;
  const published = join(OUT, src);
  if (existsSync(published)) return published;
  return null;
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
      console.warn(`[subset] SKIP ${t.out}  (no source ${t.src} — run npm run fonts:download)`);
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
      const from = (buf.length / 1024 / 1024).toFixed(1);
      const to = (out.length / 1024 / 1024).toFixed(2);
      console.log(
        `[subset] OK   ${t.out}  ${from} MB -> ${to} MB  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
      results.push({ out: t.out, status: 'ok', from, to });
    } catch (err) {
      console.error(`[subset] FAIL ${t.out}:`, err);
      results.push({ out: t.out, status: 'fail' });
    }
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const ok = results.filter((r) => r.status === 'ok').length;
  if (ok > 0) {
    console.log(
      `[subset] total: ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB`,
    );
  }
  console.log(`[subset] done. ok=${ok} skip=${skipped} fail=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[subset] unexpected error:', err);
  process.exit(1);
});
