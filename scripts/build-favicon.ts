/**
 * build-favicon.ts
 *
 * Plan F1 — generates favicon files from the source /public/logo.png.
 * Outputs:
 *   app/icon.png         (32x32)
 *   app/apple-icon.png   (180x180)
 *   app/favicon.ico      (16+32+48 multi-size, via `to-ico`)
 *   public/favicon.ico   (same bytes as app/favicon.ico)
 *
 * Run: pnpm favicon:build
 */
import sharp from 'sharp';
import toIco from 'to-ico';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/logo.png');

async function main() {
  const buf = readFileSync(SOURCE);
  const img = sharp(buf);

  // PNG outputs (sharp handles these directly)
  const icon32 = await img.clone().resize(32, 32).png().toBuffer();
  const apple180 = await img.clone().resize(180, 180).png().toBuffer();

  // Multi-size ICO via to-ico: generate 16, 32, 48 px PNGs and combine.
  // to-ico API: toIco(Buffer[]) => Promise<Buffer>
  const ico16 = await img.clone().resize(16, 16).png().toBuffer();
  const ico32 = await img.clone().resize(32, 32).png().toBuffer();
  const ico48 = await img.clone().resize(48, 48).png().toBuffer();
  const ico = await toIco([ico16, ico32, ico48]);

  const dests = [
    { path: 'app/icon.png', data: icon32 },
    { path: 'app/apple-icon.png', data: apple180 },
    { path: 'app/favicon.ico', data: ico },
    { path: 'public/favicon.ico', data: ico },
  ];

  for (const d of dests) {
    const p = resolve(ROOT, d.path);
    writeFileSync(p, d.data);
    const kb = (statSync(p).size / 1024).toFixed(1);
    console.log(`[favicon] OK   ${d.path}  (${kb} KB)`);
  }
  console.log(`[favicon] done. ${dests.length} files written.`);
}

main().catch((err) => {
  console.error('[favicon] FAIL', err);
  process.exit(1);
});
