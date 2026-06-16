import { getPool, closePool } from '../lib/db';
(async () => {
  const pool = getPool();
  const [total] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM rare_chars`);
  const [withMeaning] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM rare_chars WHERE meaning <> ''`);
  const [sample] = await pool.query<any[]>(`SELECT \`char\`, pinyin, meaning FROM rare_chars LIMIT 3`);
  console.log('total:', (total as any[])[0].n);
  console.log('withMeaning:', (withMeaning as any[])[0].n);
  console.log('sample:', sample);
  await closePool();
})();
