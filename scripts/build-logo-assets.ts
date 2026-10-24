/**
 * build-logo-assets.ts
 *
 * Derives the small brand images the UI actually needs from the 370×370
 * source /public/logo.png.
 *
 * Why:
 *   public/logo.png is a 267 KB painted seal. The header, the footer and
 *   the printable worksheet all render it at 28-40 CSS pixels, but
 *   `images.unoptimized` is on (see next.config.ts — sharp is unreliable
 *   on the deploy host), so the browser downloaded the full 267 KB on every
 *   page. The printable PDF embedded the same 267 KB into every worksheet.
 *
 * Outputs:
 *   public/logo-sm.webp — 96×96, the UI logo (header / footer)
 *   public/logo-sm.png  — 96×96, the printable logo (react-pdf cannot
 *                          decode WebP)
 *
 * public/logo.png itself is left untouched: it is still the canonical
 * asset referenced by the schema.org JSON-LD and by social previews.
 *
 * Run: npm run logo:build
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public', 'logo.png');

/** 2× the largest UI usage (40 CSS px) so the logo stays crisp on retina. */
const UI_SIZE = 96;

interface Output {
  path: string;
  data: Buffer;
}

async function main() {
  const source = readFileSync(SOURCE);
  const image = sharp(source);

  const outputs: Output[] = [
    {
      path: 'public/logo-sm.webp',
      data: await image.clone().resize(UI_SIZE, UI_SIZE).webp({ quality: 82 }).toBuffer(),
    },
    {
      path: 'public/logo-sm.png',
      data: await image.clone().resize(UI_SIZE, UI_SIZE).png({ compressionLevel: 9 }).toBuffer(),
    },
  ];

  for (const output of outputs) {
    const dest = resolve(ROOT, output.path);
    writeFileSync(dest, output.data);
    const kb = (statSync(dest).size / 1024).toFixed(1);
    console.info(`[logo] OK   ${output.path}  (${UI_SIZE}×${UI_SIZE}, ${kb} KB)`);
  }

  const originalKb = (statSync(SOURCE).size / 1024).toFixed(1);
  console.info(`[logo] done. source public/logo.png is ${originalKb} KB.`);
}

main().catch((err) => {
  console.error('[logo] FAIL', err);
  process.exit(1);
});
