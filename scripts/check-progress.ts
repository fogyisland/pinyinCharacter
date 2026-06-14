import mysql from 'mysql2/promise';
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<any[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN meaning IS NOT NULL AND meaning != '' THEN 1 ELSE 0 END) as done,
       SUM(CASE WHEN meaning IS NULL OR meaning = '' THEN 1 ELSE 0 END) as pending
     FROM rare_chars`
  );
  console.log(JSON.stringify(rows[0]));
  await conn.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
