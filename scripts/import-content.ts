/**
 * 扫 data/content/*.json → upsert 到 chars / char_etymology / char_story
 * 幂等; 不覆盖 chars.meaning_zh 已有值 (DB 列有 6498 个手写值, 是历史产物)
 *
 * Run: pnpm tsx scripts/import-content.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { CharContentSchema } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

export interface ImportResult {
  scanned: number;
  imported: {
    meaning_zh: string[];
    etymology_story: string[];
    hanzi_story: string[];
  };
  errors: Array<{ char: string; error: string }>;
}

export async function importContent(): Promise<ImportResult> {
  const pool = getPool();
  const result: ImportResult = {
    scanned: 0,
    imported: { meaning_zh: [], etymology_story: [], hanzi_story: [] },
    errors: [],
  };

  if (!existsSync(CONTENT_DIR)) {
    console.error(`[import] ${CONTENT_DIR} does not exist, nothing to do`);
    return result;
  }

  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));

  for (const f of files) {
    result.scanned++;
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      const char = parsed.char;

      // meaning_zh: 不覆盖已有值 (legacy top-level + full-shape dict.meaning_zh)
      const meaningZh = parsed.meaning_zh ?? parsed.dict?.meaning_zh;
      if (meaningZh !== undefined) {
        const [r] = await pool.query<any>(
          `UPDATE chars SET meaning_zh = ?
           WHERE \`char\` = ? AND (meaning_zh IS NULL OR meaning_zh = '')`,
          [meaningZh, char]
        );
        if ((r as any).affectedRows > 0) result.imported.meaning_zh.push(char);
      }

      // post-2026-06-17 slim-DB: story data lives in data/content/<char>.json,
      // not in char_etymology. Just ensure a row exists so /etymology/[char] has
      // a target; era_*_has defaults from DDL handle the rest (kaishu=1, others=0).
      const etymologyStory = parsed.etymology_story ?? parsed.etymology?.story;
      if (etymologyStory !== undefined) {
        await pool.query(
          `INSERT INTO char_etymology (\`char\`, era_kaishu_has)
           VALUES (?, 1)
           ON DUPLICATE KEY UPDATE era_kaishu_has = 1`,
          [char]
        );
        result.imported.etymology_story.push(char);
      }

      // hanzi_story: 整行 upsert
      if (parsed.hanzi_story !== undefined) {
        await pool.query(
          `INSERT INTO char_story (\`char\`, story, generated_by, generated_at)
           VALUES (?, ?, 'claude-handwritten', NOW())
           ON DUPLICATE KEY UPDATE
             story = VALUES(story),
             generated_by = VALUES(generated_by),
             generated_at = VALUES(generated_at)`,
          [char, parsed.hanzi_story]
        );
        result.imported.hanzi_story.push(char);
      }
    } catch (err) {
      const msg = (err as Error).message;
      const charMatch = f.match(/^(.+)\.json$/);
      result.errors.push({ char: charMatch?.[1] ?? f, error: msg });
      console.error(`[import] skip ${f}: ${msg}`);
    }
  }

  console.error(`[import] scanned=${result.scanned} ` +
    `meaning_zh=${result.imported.meaning_zh.length} ` +
    `etymology_story=${result.imported.etymology_story.length} ` +
    `hanzi_story=${result.imported.hanzi_story.length} ` +
    `errors=${result.errors.length}`);

  return result;
}

async function main() {
  await importContent();
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
