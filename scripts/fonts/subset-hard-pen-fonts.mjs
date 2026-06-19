/**
 * subset-hard-pen-fonts.mjs
 *
 * Plan G2 — Hard-pen font pipeline (subset phase).
 * Plan G3 — Adds 2 brush fonts (Ma Shan Zheng + Long Cang).
 * Reads source TTF/OTF from scripts/fonts/staging/, subsets to
 * scripts/fonts/gb2312-7000.txt, writes WOFF2 to public/fonts/.
 * Warns on > 800 KB output.
 *
 * Run: pnpm fonts:subset
 *
 * subset-font@2.5.0 API (verified against node_modules/subset-font/README.md):
 *   subsetFont(fontBuffer, text, options?) => Promise<Buffer>
 *   options.targetFormat: 'sfnt' | 'woff' | 'woff2' (default = input format)
 * The default export is the function itself (CJS module.exports = ...), so
 * ESM default import gives us the callable directly.
 */
import subsetFont from 'subset-font';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STAGING = resolve(__dirname, 'staging');
const OUT = resolve(ROOT, 'public', 'fonts');
const GLYPHS_FILE = resolve(__dirname, 'gb2312-7000.txt');

const TARGETS = [
  { in: 'LXGWWenKaiGB-Regular.ttf',   out: 'LXGWWenKaiGB-Regular.woff2' },
  { in: 'Yozai-Regular.ttf',          out: 'Yozai-Regular.woff2' },
  { in: 'Iansui-Regular.ttf',         out: 'Iansui-Regular.woff2' },
  { in: 'ZenKakuGothicNew-Thin.otf',  out: 'ZenKakuGothicNew-Thin.woff2' },
  { in: 'MaShanZheng-Regular.ttf',    out: 'ma-shan-zheng.woff2' },
  { in: 'LongCang-Regular.ttf',       out: 'long-cang.woff2' },
];

const SIZE_WARN_KB = 800;

async function main() {
  if (!existsSync(GLYPHS_FILE)) {
    console.error(`[subset] missing ${GLYPHS_FILE} — run pnpm tsx scripts/fonts/build-gb2312-7000.ts first`);
    process.exit(0);
  }
  const glyphs = await readFile(GLYPHS_FILE, 'utf8');
  const results = [];

  for (const t of TARGETS) {
    const src = resolve(STAGING, t.in);
    if (!existsSync(src)) {
      console.warn(`[subset] SKIP ${t.out}  (source ${t.in} not in staging/ — run pnpm fonts:download-hard-pen)`);
      results.push({ out: t.out, status: 'skip' });
      continue;
    }
    try {
      const buf = await readFile(src);
      const out = await subsetFont(buf, glyphs, { targetFormat: 'woff2' });
      const dest = resolve(OUT, t.out);
      await writeFile(dest, out);
      const kb = (out.length / 1024).toFixed(1);
      const warn = out.length > SIZE_WARN_KB * 1024 ? `  warn > ${SIZE_WARN_KB} KB` : '';
      console.log(`[subset] OK   ${t.out}  (${kb} KB)${warn}`);
      results.push({ out: t.out, status: 'ok', kb: parseFloat(kb) });
    } catch (err) {
      console.error(`[subset] FAIL ${t.out}:`, err);
      results.push({ out: t.out, status: 'fail' });
    }
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`[subset] done. ok=${ok} skip=${skipped} fail=${failed}`);
  process.exit(0);
}

main();
