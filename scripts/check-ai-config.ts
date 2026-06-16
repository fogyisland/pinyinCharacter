import { getPool, closePool } from '../lib/db';

(async () => {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    "SELECT `key`, value FROM app_config WHERE `key` LIKE 'ai.%' ORDER BY `key`",
  );
  for (const r of rows) console.log(r.key + ' = ' + (r.value ?? '<null>'));
  if (rows.length === 0) console.log('(no ai.* config keys)');
  await closePool();
})();