/**
 * Pull 佛经/ from chinese-poetry/chinese-poetry GitHub repo,
 * split each sutra into chunks (by 品 markers), generate pinyin per char,
 * UPSERT into the `sutras` table.
 *
 * Idempotent: safe to re-run. Existing rows are updated, new rows are inserted.
 * Fails soft: missing slugs are skipped with a warning.
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';
import { splitIntoChunks } from '../lib/sutras';

// 佛经 source is mostly 繁体, normalize to 简体 for cn site
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const FOJING_DIR = `${SOURCE_BASE}/%E4%BD%9B%E7%BB%8F`;
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

const SLUGS: Array<{ slug: string; title: string }> = [
  { slug: 'xinjing', title: '心经' },
  { slug: 'jingang', title: '金刚经' },
  { slug: 'yaoshi', title: '药师经' },
  { slug: 'amituo', title: '阿弥陀经' },
  { slug: 'pumen', title: '观音菩萨普门品' },
  { slug: 'puxian', title: '普贤行愿品' },
  { slug: 'lengyan', title: '楞严经' },
  { slug: 'miaofa', title: '妙法莲华经' },
  { slug: 'weimo', title: '维摩诘经' },
  { slug: 'liuzu', title: '六祖坛经' },
  { slug: 'dabei', title: '大悲咒' },
  { slug: 'shishan', title: '十善业道经' },
];

interface RawSutra {
  title?: string;
  content?: string;
  paragraphs?: string[];
}

function extractParagraphs(raw: RawSutra): string[] {
  if (Array.isArray(raw.paragraphs)) return raw.paragraphs;
  if (typeof raw.content === 'string') {
    // Split on common sentence-ending punctuation, keep groups non-empty
    return raw.content
      .split(/[。！？]/u)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s + '。');
  }
  return [];
}

function calcChunkPinyin(label: string, paragraphs: string[]): { label: string; content: string[]; pinyin: string[][] } {
  const t2sParagraphs = paragraphs.map(p => t2s(p));
  const t2sLabel = t2s(label);
  const pinyinRows = t2sParagraphs.map(line =>
    Array.from(line).map(char => {
      const py = pinyin(char, { toneType: 'symbol' });
      return Array.isArray(py) && py.length > 0 ? py[0]! : '';
    })
  );
  return { label: t2sLabel, content: t2sParagraphs, pinyin: pinyinRows };
}

export async function buildSutras(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const { slug, title } of SLUGS) {
    const url = `${FOJING_DIR}/${encodeURIComponent(slug)}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[build-sutras] skip ${slug}: HTTP ${res.status}`);
        continue;
      }
      const raw = (await res.json()) as RawSutra;
      const paragraphs = extractParagraphs(raw);
      if (paragraphs.length === 0) {
        console.warn(`[build-sutras] skip ${slug}: no paragraphs`);
        continue;
      }
      const chunks = splitIntoChunks(raw.title ?? title, paragraphs).map(c =>
        calcChunkPinyin(c.label, c.content)
      );

      await pool.query(
        `INSERT INTO sutras (title, slug, chunks, source) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), chunks = VALUES(chunks), source = VALUES(source)`,
        [t2s(raw.title ?? title), slug, JSON.stringify(chunks), SOURCE_TAG]
      );
      console.log(`[build-sutras] upserted ${slug} (${chunks.length} chunks)`);
      inserted += 1;
    } catch (err) {
      console.warn(`[build-sutras] skip ${slug}: ${(err as Error).message}`);
    }
  }
  return inserted;
}

if (require.main === module) {
  buildSutras()
    .then((n) => { console.log(`done: ${n} sutras upserted`); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
