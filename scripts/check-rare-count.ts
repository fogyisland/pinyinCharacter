import type { RowDataPacket } from 'mysql2';
import { getPool, closePool } from '../lib/db';

/** A single count, as `SELECT COUNT(*) AS n` returns it. */
interface CountRow extends RowDataPacket {
  n: number | string;
}

/** One sampled rare char. */
interface RareCharRow extends RowDataPacket {
  char: string;
  pinyin: string;
  meaning: string | null;
}

(async () => {
  const pool = getPool();
  const [total] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS n FROM rare_chars`);
  const [withMeaning] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM rare_chars WHERE meaning <> ''`,
  );
  const [sample] = await pool.query<RareCharRow[]>(
    `SELECT \`char\`, pinyin, meaning FROM rare_chars LIMIT 3`,
  );
  console.log('total:', total[0].n);
  console.log('withMeaning:', withMeaning[0].n);
  console.log('sample:', sample);
  await closePool();
})();
