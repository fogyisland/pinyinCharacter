/**
 * 把 data/radicals.json 写回 DB chars.radical 列。
 *
 * 触发: 重新生成 radicals.json 后 (scripts/build-radicals.ts 用 Unihan 6.3 替换
 *       cnchar-radical 源, 1163 个缺部首字被补齐, 3143 个部首变体被纠正成 Kangxi 标准)。
 *
 * 幂等: WHERE clause 用 (radical IS NULL OR radical != ?) 跳过未变字符。
 *
 * 运行: pnpm tsx --env-file=.env scripts/import-radicals.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

const RADICALS_FILE = join(process.cwd(), 'data', 'radicals.json');

async function main() {
  const radicals: Record<string, string> = JSON.parse(readFileSync(RADICALS_FILE, 'utf8'));
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT `char`, radical FROM chars',
  );
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const corrections: Array<{ char: string; from: string; to: string }> = [];
  for (const row of rows as any[]) {
    const newRad = radicals[row.char];
    if (!newRad) {
      skipped++;
      continue;
    }
    if (row.radical === newRad) {
      unchanged++;
      continue;
    }
    await pool.execute('UPDATE chars SET radical = ? WHERE `char` = ?', [
      newRad,
      row.char,
    ]);
    if (row.radical) {
      corrections.push({ char: row.char, from: row.radical, to: newRad });
    }
    updated++;
  }
  console.log(`[import-radicals] updated=${updated} unchanged=${unchanged} skipped=${skipped}`);
  console.log(`[import-radicals] corrections (old → new):`);
  corrections.slice(0, 20).forEach((c) =>
    console.log(`  ${c.char}: ${c.from} → ${c.to}`),
  );
  if (corrections.length > 20) {
    console.log(`  ... and ${corrections.length - 20} more`);
  }
  await closePool();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[import-radicals] failed:', err);
    process.exit(1);
  });
}
