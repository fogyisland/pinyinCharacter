// One-off: trim background and export 字韵 logo to public/logo.png
import sharp from 'sharp';
import path from 'node:path';

async function main() {
  const src = path.resolve('ziyun.png');
  const dst = path.resolve('public/logo.png');

  const meta = await sharp(src).metadata();
  console.log('[input]', meta.width, 'x', meta.height, meta.format);

  // Trim near-white border (threshold default ~10 against detected background)
  const trimmed = sharp(src).trim({ threshold: 30 });
  const trimmedMeta = await trimmed.clone().toBuffer({ resolveWithObject: true });
  console.log('[after trim]', trimmedMeta.info.width, 'x', trimmedMeta.info.height);

  // Make it square: pick max side, pad with transparent background
  const side = Math.max(trimmedMeta.info.width, trimmedMeta.info.height);
  await sharp(trimmedMeta.data)
    .resize({
      width: side,
      height: side,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(dst);

  const out = await sharp(dst).metadata();
  console.log('[output]', dst, out.width, 'x', out.height, out.format);
}

main().catch((e) => { console.error(e); process.exit(1); });
