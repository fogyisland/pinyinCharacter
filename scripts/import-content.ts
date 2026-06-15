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

      // meaning_zh: 不覆盖已有值
      if (parsed.meaning_zh !== undefined) {
        const [r] = await pool.query<any>(
          `UPDATE chars SET meaning_zh = ?
           WHERE \`char\` = ? AND (meaning_zh IS NULL OR meaning_zh = '')`,
          [parsed.meaning_zh, char]
        );
        if ((r as any).affectedRows > 0) result.imported.meaning_zh.push(char);
      }

      // etymology_story: 整行 upsert, era_*_has 默认 0
      if (parsed.etymology_story !== undefined) {
        await pool.query(
          `INSERT INTO char_etymology
             (\`char\`, story, era_jiaguwen_has, era_jinwen_has,
              era_xiaozhuan_has, era_lishu_has, era_kaishu_has, generated_by, generated_at)
           VALUES (?, ?, 0, 0, 0, 0, 1, 'claude-handwritten', NOW())
           ON DUPLICATE KEY UPDATE
             story = VALUES(story),
             generated_by = VALUES(generated_by),
             generated_at = VALUES(generated_at)`,
          [char, parsed.etymology_story]
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
