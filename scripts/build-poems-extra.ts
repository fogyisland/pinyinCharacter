/**
 * Ingest 5 new poem collections into the `poems` table + data/poems/<slug>.json
 *
 * Sources:
 *  - guwendao.net (via lib/guwendao-scraper):
 *      汉乐府 (yuefu)        ~203 poems  dynasty=汉   category=汉乐府
 *      古诗十九首 (shijiu)    19 poems    dynasty=汉末  category=古诗十九首
 *      辞赋 (cifu)          ~47 poems    dynasty=mixed category=骈文
 *  - chinese-poetry/chinese-poetry GitHub repo:
 *      曹操诗集             ~20 poems    dynasty=三国  category=魏
 *      纳兰性德              ~350 poems   dynasty=清   category=qing
 *
 * Idempotent: each (dynasty, title, author) is checked before INSERT. Re-running
 * produces inserted=0 (just refreshes the source-of-truth JSON files).
 *
 * Usage: DATABASE_URL=<db> pnpm tsx scripts/build-poems-extra.ts
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { inferFormFromParagraphs, resolveFormFromSource, mergeForm } from '../lib/poetry/infer-form';
import { scrapePoemList, scrapePoemPage, type PoemPage } from '../lib/guwendao-scraper';

const DATA_DIR = join(process.cwd(), 'data', 'poems');

interface CollectionConfig {
  slug: string;
  title: string;
  category: string;
  dynasty: string;
  source: string;
  fetch: () => Promise<PoemPage[]>;
}

const CP_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';

async function fetchChinesePoetry(
  path: string,
  normalize: 'paragraphs' | 'para' = 'paragraphs',
): Promise<PoemPage[]> {
  const res = await fetch(CP_BASE + path, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
  const raw: any[] = JSON.parse(await res.text());
  return raw.map((p) => ({
    title: p.title,
    author: p.author || '佚名',
    dynasty: '',
    paragraphs: normalize === 'para' ? (p.para || []) : (p.paragraphs || []),
  }));
}

const COLLECTIONS: CollectionConfig[] = [
  {
    slug: 'yuefu',
    title: '汉乐府',
    category: '汉乐府',
    dynasty: '汉',
    source: 'guwendao:yuefu',
    async fetch() {
      const ids = await scrapePoemList('yuefu');
      const poems: PoemPage[] = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'shijiu',
    title: '古诗十九首',
    category: '古诗十九首',
    dynasty: '汉末',
    source: 'guwendao:shijiu',
    async fetch() {
      const ids = await scrapePoemList('shijiu');
      const poems: PoemPage[] = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'cifu',
    title: '辞赋',
    category: '骈文',
    dynasty: 'mixed',
    source: 'guwendao:cifu',
    async fetch() {
      const ids = await scrapePoemList('cifu');
      const poems: PoemPage[] = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'caocao',
    title: '曹操诗集',
    category: '魏',
    dynasty: '三国',
    source: 'chinese-poetry:/曹操诗集/caocao.json',
    fetch: () => fetchChinesePoetry('/%E6%9B%B9%E6%93%8D%E8%AF%97%E9%9B%86/caocao.json', 'paragraphs'),
  },
  {
    slug: 'nalan',
    title: '纳兰性德',
    category: 'qing',
    dynasty: '清',
    source: 'chinese-poetry:/纳兰性德/纳兰性德诗集.json',
    fetch: () => fetchChinesePoetry('/%E7%BA%B3%E5%85%B0%E6%80%A7%E5%BE%B7/%E7%BA%B3%E5%85%B0%E6%80%A7%E5%BE%B7%E8%AF%97%E9%9B%86.json', 'para'),
  },
];

function contentHash(paragraphs: string[]): string {
  return createHash('md5').update(JSON.stringify(paragraphs)).digest('hex');
}

export interface BuildResult {
  inserted: number;
  skipped: number;
  byCollection: Record<string, number>;
}

export async function buildPoemsExtra({ onlyCategory }: { onlyCategory?: string } = {}): Promise<BuildResult> {
  const pool = getPool();
  const result: BuildResult = { inserted: 0, skipped: 0, byCollection: {} };

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  for (const col of COLLECTIONS) {
    if (onlyCategory && col.category !== onlyCategory) continue;
    console.log(`[build-poems-extra] ${col.slug} (${col.category})...`);
    let poems: PoemPage[];
    try {
      poems = await col.fetch();
    } catch (err) {
      console.warn(`[build-poems-extra] ${col.slug} fetch failed: ${(err as Error).message}; skip`);
      result.byCollection[col.slug] = 0;
      continue;
    }
    result.byCollection[col.slug] = poems.length;

    for (const p of poems) {
      const _hash = contentHash(p.paragraphs);
      const [existing] = await pool.query<any[]>(
        `SELECT id FROM poems WHERE dynasty = ? AND title = ? AND author = ? LIMIT 1`,
        [col.dynasty, p.title, p.author],
      );
      if (Array.isArray(existing) && existing.length > 0) {
        result.skipped++;
        continue;
      }
      // Pass null for type/rhythmic: guwendao + chinese-poetry sources for these
      // 5 collections don't carry per-poem 词牌/套数/小令 tags. resolveFormFromSource
      // early-returns {primary: null} on null type, so the merge falls through to
      // structural inference from paragraph lengths. See audit §4.4.
      const form = mergeForm(
        inferFormFromParagraphs(p.paragraphs),
        resolveFormFromSource(null, null, col.category),
      );
      await pool.execute(
        `INSERT INTO poems (dynasty, category, title, author, form, content, pinyin, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          col.dynasty,
          col.category,
          p.title,
          p.author,
          form.primary,
          JSON.stringify(p.paragraphs),
          JSON.stringify(p.paragraphs.map(() => [])),
          col.source,
        ],
      );
      result.inserted++;
    }

    // Source-of-truth JSON (always rewrite, even on re-run)
    const filePath = join(DATA_DIR, `${col.slug}.json`);
    writeFileSync(filePath, JSON.stringify({ ...col, poems }, null, 2), 'utf8');
    console.log(`[build-poems-extra] ${col.slug}: ${poems.length} poems -> ${filePath}`);
  }

  console.log(`[build-poems-extra] inserted=${result.inserted} skipped=${result.skipped}`);
  return result;
}

if (require.main === module) {
  buildPoemsExtra()
    .then(() => closePool())
    .catch((err) => {
      console.error('[build-poems-extra] failed:', err);
      process.exit(1);
    });
}
