import { getPool, closePool } from '../lib/db';

(async () => {
  const pool = getPool();
  const [byLevel] = await pool.query<any[]>(
    'SELECT level, COUNT(*) AS n FROM chars GROUP BY level ORDER BY level',
  );
  console.log('=== chars by level ===');
  for (const r of byLevel) console.log('  level', r.level, '→', r.n, 'chars');
  const [total] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM chars');
  console.log('chars total:', total[0].n);
  const [rare] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM rare_chars');
  console.log('rare_chars total:', rare[0].n);
  const [etym] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM char_etymology');
  console.log('char_etymology total:', etym[0].n);
  console.log();
  console.log('=== empty per level per field ===');
  for (const col of ['pinyin_alt', 'meaning_en', 'variants']) {
    const [r] = await pool.query<any[]>(
      `SELECT level, SUM(${col} IS NULL OR ${col}='' OR ${col}='[]') AS empty, COUNT(*) AS total FROM chars GROUP BY level ORDER BY level`,
    );
    console.log(`  ${col}:`);
    for (const x of r) console.log(`     L${x.level}: ${x.empty}/${x.total} empty`);
  }
  const [etymEmpty] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NULL OR story=''`,
  );
  console.log('  char_etymology.story empty:', etymEmpty[0].n);
  await closePool();
})();
