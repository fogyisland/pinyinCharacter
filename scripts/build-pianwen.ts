// scripts/build-pianwen.ts
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { fetchChapterList, scrapeChapterContent } from '../lib/guwendao-scraper';
import type { ClassicChunk } from '../lib/classics-types';

const DATA_DIR = join(process.cwd(), 'data', 'classics');
const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');
const BOOK_ID = '427c5eea5943';
const SLUG = 'xunmeng-pianju';
const SOURCE = 'guwendao.net/训蒙骈句';
const PIANWEN_CATEGORY = 'pianwen';

interface VolumeJson {
  slug: string;
  title: string;
  category: string;
  author: string | null;
  era: string | null;
  source: string;
  bookId: string;
  bookTitle: string;
  chapterRange: { from: number; to: number };
  chunks: ClassicChunk[];
}

async function ensurePianwenCategory(pool: any): Promise<'widened' | 'already'> {
  const rows: any[] = (await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'classics' AND COLUMN_NAME = 'category'`
  ))[0] as any[];
  const colType: string = rows?.[0]?.COLUMN_TYPE ?? '';
  if (colType.includes("'pianwen'")) return 'already';
  await pool.query(
    `ALTER TABLE classics MODIFY COLUMN category
     ENUM('four-books','five-classics','mengxue','philosophy','history','other','pianwen')
     NOT NULL DEFAULT 'other'`
  );
  console.log('[build-pianwen] widened classics.category ENUM to include pianwen');
  return 'widened';
}

function countChars(chunks: ClassicChunk[]): number {
  return chunks.reduce((n, c) => n + c.content.reduce((s, p) => s + Array.from(p).length, 0), 0);
}

export interface PianwenResult {
  chapters: number;
  bytes: number;
  categoryStatus: 'widened' | 'already';
}

export async function buildPianwen(): Promise<PianwenResult> {
  const pool = getPool();
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const categoryStatus = await ensurePianwenCategory(pool);

  const filePath = join(DATA_DIR, `${SLUG}.json`);
  if (existsSync(filePath)) {
    const rows: any[] = (await pool.query(`SELECT 1 FROM classics WHERE slug = ? LIMIT 1`, [SLUG]))[0] as any[];
    if (rows.length > 0) {
      console.log(`[build-pianwen] ${SLUG} already on disk + DB, skipping`);
      return { chapters: 0, bytes: 0, categoryStatus };
    }
  }

  const chapterIds = await fetchChapterList(BOOK_ID);
  const chunks: ClassicChunk[] = [];
  for (let i = 0; i < chapterIds.length; i++) {
    const { title, paragraphs } = await scrapeChapterContent(BOOK_ID, chapterIds[i]!);
    chunks.push({
      id: i + 1,
      label: title,
      content: paragraphs,
      pinyin: paragraphs.map(() => []),
    });
  }

  const vol: VolumeJson = {
    slug: SLUG,
    title: '训蒙骈句',
    category: 'pianwen',
    author: '萧良有/司祢',
    era: '明/清',
    source: SOURCE,
    bookId: BOOK_ID,
    bookTitle: '训蒙骈句',
    chapterRange: { from: 1, to: chunks.length },
    chunks,
  };
  const json = JSON.stringify(vol, null, 2);
  writeFileSync(filePath, json, 'utf8');

  await pool.execute(
    `INSERT INTO classics (slug, title, category, author, era, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       category = VALUES(category),
       author = VALUES(author),
       era = VALUES(era),
       source = VALUES(source)`,
    [SLUG, '训蒙骈句', PIANWEN_CATEGORY, '萧良有/司祢', '明/清', SOURCE]
  );

  const manifestRaw = readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const newEntry = {
    slug: SLUG,
    title: '训蒙骈句',
    source: SOURCE,
    category: PIANWEN_CATEGORY,
    author: '萧良有/司祢',
    era: '明/清',
    chapterCount: chunks.length,
    charCount: countChars(chunks),
    jsonFile: `data/classics/${SLUG}.json`,
    jsonBytes: statSync(filePath).size,
    bookId: BOOK_ID,
    bookTitle: '训蒙骈句',
  };
  const idx = manifest.books.findIndex((b: any) => b.slug === SLUG);
  if (idx >= 0) manifest.books[idx] = newEntry;
  else manifest.books.push(newEntry);
  manifest.books.sort((a: any, b: any) => a.slug.localeCompare(b.slug));
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  const result: PianwenResult = { chapters: chunks.length, bytes: json.length, categoryStatus };
  console.log(`[build-pianwen] ${SLUG}: ${chunks.length} chapters, ${(json.length / 1024).toFixed(1)} KB -> ${filePath}`);
  return result;
}

if (require.main === module) {
  buildPianwen()
    .then((r) => console.log(`[done] chapters=${r.chapters} bytes=${r.bytes} categoryStatus=${r.categoryStatus}`))
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => closePool());
}