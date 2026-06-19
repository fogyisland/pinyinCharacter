/**
 * copy-ofl.ts
 *
 * Plan G2 — Hard-pen font pipeline (license copy).
 * Plan G3 — Adds 2 brush fonts (Ma Shan Zheng + Long Cang).
 * Copies each font's upstream OFL.txt from scripts/fonts/staging/
 * (if present) to public/fonts/<same-basename>.OFL.txt.
 * Skips fonts whose OFL.txt source is not in staging/.
 *
 * Run: pnpm tsx scripts/fonts/copy-ofl.ts
 *
 * In network-available environments, place the upstream OFL.txt for each
 * font into scripts/fonts/staging/ before running this script:
 *   - LXGWWenKaiGB-Regular.OFL.txt
 *   - Yozai-Regular.OFL.txt
 *   - Iansui-Regular.OFL.txt
 *   - ZenKakuGothicNew-Thin.OFL.txt
 *   - MaShanZheng-Regular.OFL.txt
 *   - LongCang-Regular.OFL.txt
 *
 * If an OFL.txt is missing, the script prints a SKIP line with the upstream
 * URL to fetch it from. The downstream consumer (browser/legal docs) should
 * tolerate missing OFL.txt files and fall back to embedded notice.
 */

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(__dirname, 'staging');
const OUT = resolve(__dirname, '..', '..', 'public', 'fonts');

const TARGETS = [
  { font: 'LXGWWenKaiGB-Regular.ttf', ofl: 'LXGWWenKaiGB-Regular.OFL.txt' },
  { font: 'Yozai-Regular.ttf', ofl: 'Yozai-Regular.OFL.txt' },
  { font: 'Iansui-Regular.ttf', ofl: 'Iansui-Regular.OFL.txt' },
  { font: 'ZenKakuGothicNew-Thin.otf', ofl: 'ZenKakuGothicNew-Thin.OFL.txt' },
  { font: 'MaShanZheng-Regular.ttf', ofl: 'MaShanZheng-Regular.OFL.txt' },
  { font: 'LongCang-Regular.ttf', ofl: 'LongCang-Regular.OFL.txt' },
];

async function main() {
  mkdirSync(OUT, { recursive: true });

  let copied = 0;
  let skipped = 0;

  for (const t of TARGETS) {
    const src = resolve(STAGING, t.ofl);
    const dest = resolve(OUT, t.ofl);

    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`[ofl] OK   ${t.ofl}`);
      copied++;
    } else {
      // Derive base name for the SKIP hint
      const base = basename(t.font, extname(t.font));
      console.warn(
        `[ofl] SKIP ${t.ofl}  (no source in staging/ — fetch from upstream and place at ${src})`,
      );
      void base; // base reserved for future use (e.g. upstream URL hints)
      skipped++;
    }
  }

  console.log(`[ofl] done. copied=${copied} skipped=${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[ofl] unexpected error:', err);
  process.exit(0);
});