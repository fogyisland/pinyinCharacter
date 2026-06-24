/**
 * Read counts of data NOT touched by scripts/seed-mini.ts.
 *
 * The seed script only DELETEs from 4 places:
 *   - chars (20 seed BMP chars)
 *   - char_etymology (20 seed chars)
 *   - rare_chars (5 L3 seed chars)
 *   - users (the 'admin' user)
 *
 * Everything else is preserved by exclusion. This function surfaces a
 * count summary so the /admin/chars/init panel can show the admin that
 * real production data is safe across:
 *   - data/content/*.json (LLM-generated per-char content)
 *   - data/poems/*.json   (poem corpus)
 *   - data/classics/*.json (classic literature)
 *   - chars / char_etymology / rare_chars rows in the DB
 *
 * Pure read-only: no mutations. Safe to call inside a server component.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from '@/lib/db';

export interface PreservedStats {
  contentFiles: number;
  poemFiles: number;
  classicFiles: number;
  charRows: number;
  charEtymologyRows: number;
  rareCharRows: number;
}

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const POEMS_DIR = join(process.cwd(), 'data', 'poems');
const CLASSICS_DIR = join(process.cwd(), 'data', 'classics');

function countJsonFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
}

export async function readPreservedStats(): Promise<PreservedStats> {
  const pool = getPool();
  const [c] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM chars`);
  const [e] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM char_etymology`);
  const [r] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM rare_chars`);

  return {
    contentFiles: countJsonFiles(CONTENT_DIR),
    poemFiles: countJsonFiles(POEMS_DIR),
    classicFiles: countJsonFiles(CLASSICS_DIR),
    charRows: Number(c[0].total),
    charEtymologyRows: Number(e[0].total),
    rareCharRows: Number(r[0].total),
  };
}
