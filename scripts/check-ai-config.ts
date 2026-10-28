import type { RowDataPacket } from 'mysql2';
import { getPool, closePool } from '../lib/db';

/** One `ai.*` row of the app_config table. */
interface AiConfigRow extends RowDataPacket {
  key: string;
  value: string | null;
}

(async () => {
  const pool = getPool();
  const [rows] = await pool.query<AiConfigRow[]>(
    "SELECT `key`, value FROM app_config WHERE `key` LIKE 'ai.%' ORDER BY `key`",
  );
  for (const r of rows) console.log(r.key + ' = ' + (r.value ?? '<null>'));
  if (rows.length === 0) console.log('(no ai.* config keys)');
  await closePool();
})();
