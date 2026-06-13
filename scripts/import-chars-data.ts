/**
 * One-time import: read data/general-standard-chinese-characters.json
 * and seed the chars table (level + char + unicode_codepoint).
 * Pinyin/meaning/radical/stroke are best-effort filled; admin can edit later.
 *
 * Run: pnpm tsx scripts/import-chars-data.ts
 */
import { getPool, closePool } from '../lib/db';
import chars from '../data/general-standard-chinese-characters.json';
import radicals from '../data/radicals.json';

async function main() {
  const pool = getPool();

  console.log(`Importing ${chars.length} chars...`);
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const level = i < 3500 ? 1 : i < 6500 ? 2 : 3;
    const unicodeCodepoint = `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    const radical = (radicals as Record<string, string>)[char] ?? '';

    await pool.execute(
      `INSERT IGNORE INTO chars (\`char\`, level, radical, unicode_codepoint) VALUES (?, ?, ?, ?)`,
      [char, level, radical, unicodeCodepoint]
    );
    imported++;

    if ((i + 1) % 1000 === 0) {
      console.log(`  ${i + 1}/${chars.length}`);
    }
  }

  console.log(`Done. Imported ${imported}, skipped ${skipped}.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});