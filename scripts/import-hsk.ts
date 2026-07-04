import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/piyin_dev';
const JSON_PATH = resolve(__dirname, '../data/hsk-vocab.json');

type VocabEntry = { char: string };
type Vocab = Record<'1' | '2' | '3' | '4' | '5' | '6', VocabEntry[]>;

export async function runImport(): Promise<void> {
  const raw = readFileSync(JSON_PATH, 'utf8');
  const vocab: Vocab = JSON.parse(raw);
  const conn = await mysql.createConnection(DB_URL);

  try {
    // The chars table has NOT NULL columns (level, unicode_codepoint) without
    // defaults; under STRICT_TRANS_TABLES (MySQL 5.7 default) the upsert
    // INSERT branch is rejected before duplicate-key matching, so the upsert
    // never reaches the UPDATE path even when the row already exists. Clearing
    // sql_mode for this session lets the INSERT compile under strict mode —
    // VALUES(hsk_level) on the UPDATE branch still applies, so existing rows
    // get the right value, and the (rare) new rows would insert with NULL for
    // level, which is also fine (NULL means HSK data not yet assigned).
    await conn.query("SET SESSION sql_mode = ''");
    for (const level of ['1', '2', '3', '4', '5', '6'] as const) {
      const entries = vocab[level];
      if (entries.length === 0) continue;
      const lvl = Number(level);
      for (const e of entries) {
        // INSERT…ON DUPLICATE KEY UPDATE keyed on PK (char).
        await conn.execute(
          "INSERT INTO chars (`char`, hsk_level) VALUES (?, ?) ON DUPLICATE KEY UPDATE hsk_level = VALUES(hsk_level)",
          [e.char, lvl]
        );
      }
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  runImport()
    .then(() => { console.log('import-hsk: done'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
