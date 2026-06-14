import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [stats]: any = await conn.query(`
    SELECT
      level,
      COUNT(*) AS total,
      SUM(CASE WHEN meaning_zh IS NOT NULL AND meaning_zh != '' THEN 1 ELSE 0 END) AS have_zh,
      SUM(CASE WHEN meaning_en IS NOT NULL AND meaning_en != '' THEN 1 ELSE 0 END) AS have_en
    FROM chars
    GROUP BY level
    ORDER BY level
  `);
  console.log('Coverage by level:');
  console.log(JSON.stringify(stats, null, 2));

  // first 10 missing meaning_zh at level 1 (most common)
  const [missing]: any = await conn.query(`
    SELECT char, pinyin, level FROM chars
    WHERE meaning_zh IS NULL OR meaning_zh = ''
    ORDER BY level ASC, char ASC
    LIMIT 20
  `);
  console.log('\nFirst 20 chars missing meaning_zh:');
  console.log(JSON.stringify(missing, null, 2));

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
