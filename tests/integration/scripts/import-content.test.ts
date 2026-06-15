import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

const testFiles: string[] = [];

afterEach(() => {
  for (const f of testFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  testFiles.length = 0;
});

integrationDescribe('importContent', () => {
  it('upserts meaning_zh / etymology_story / hanzi_story for given chars', async () => {
    const pool = getPool();

    // Seed chars rows (FK target)
    await pool.execute(`INSERT IGNORE INTO chars (\`char\`, level, unicode_codepoint) VALUES
      ('一', 1, 'U+4E00'), ('丁', 1, 'U+4E01'), ('㐀', 3, 'U+3400')`);

    // Write 3 test JSONs
    if (!existsSync(CONTENT_DIR)) mkdirSync(CONTENT_DIR, { recursive: true });
    const file1 = join(CONTENT_DIR, '一.json');
    const file2 = join(CONTENT_DIR, '丁.json');
    const file3 = join(CONTENT_DIR, '㐀.json');
    writeFileSync(file1, JSON.stringify({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始。',
    }));
    writeFileSync(file2, JSON.stringify({
      char: '丁', pinyin: 'dīng', etymology_story: '甲骨文作丁,象形。'.repeat(20),
    }));
    writeFileSync(file3, JSON.stringify({
      char: '㐀', pinyin: 'x', hanzi_story: '《说文》载㐀,罕用字。本义为始,后世多用于人名,字形从厶从八。',
    }));
    testFiles.push(file1, file2, file3);

    const { importContent } = await import('@/scripts/import-content');
    const result = await importContent();

    expect(result.scanned).toBe(3);
    expect(result.imported.meaning_zh).toContain('一');
    expect(result.imported.etymology_story).toContain('丁');
    expect(result.imported.hanzi_story).toContain('㐀');

    // Verify DB state
    const [charRows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = '一'`);
    expect(charRows[0].meaning_zh).toBe('一,数之始。');

    const [etymRows] = await pool.query<any[]>(`SELECT story FROM char_etymology WHERE \`char\` = '丁'`);
    expect(etymRows[0].story.length).toBeGreaterThan(140);

    const [storyRows] = await pool.query<any[]>(`SELECT story FROM char_story WHERE \`char\` = '㐀'`);
    expect(storyRows[0].story).toBe('《说文》载㐀,罕用字。本义为始,后世多用于人名,字形从厶从八。');
  });

  it('does not overwrite existing meaning_zh (DB column is sacred)', async () => {
    const pool = getPool();
    await pool.execute(`INSERT INTO chars (\`char\`, level, unicode_codepoint, meaning_zh) VALUES
      ('䲢', 3, 'U+4CA2', 'EXISTING_MEANING')
      ON DUPLICATE KEY UPDATE meaning_zh = VALUES(meaning_zh)`);

    const file = join(CONTENT_DIR, '䲢.json');
    writeFileSync(file, JSON.stringify({
      char: '䲢', pinyin: 'téng', meaning_zh: 'OVERWRITE_ATTEMPT',
    }));
    testFiles.push(file);

    const { importContent } = await import('@/scripts/import-content');
    await importContent();

    const [rows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = '䲢'`);
    expect(rows[0].meaning_zh).toBe('EXISTING_MEANING');
  });
});
