/**
 * Pull 唐诗三百首 + 宋词三百首 from chinese-poetry/chinese-poetry GitHub repo,
 * generate pinyin for each char with pinyin-pro, UPSERT into the `poems` table.
 *
 * Idempotent: safe to re-run. Existing rows are updated, new rows are inserted.
 * Fails soft: network errors / parse errors throw, caller decides whether to fail.
 */
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const FILES: Array<{ dynasty: 'tang' | 'song'; path: string }> = [
  { dynasty: 'tang', path: '/json/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json' },
  { dynasty: 'song', path: '/json/%E5%AE%8B%E8%AF%8D%E4%B8%89%E7%99%BE%E9%A6%96.json' },
];
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

interface RawPoem {
  title: string;
  author: string;
  paragraphs?: string[];
  rhythmic?: string;
  // 宋词 赏析字段 (可选)
  translation?: string;
  appreciation?: string;
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
      return result[0]!;
    }
  } catch {
    // fall through
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

async function fetchFile(path: string): Promise<RawPoem[]> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`unexpected JSON shape from ${url}`);
  return data as RawPoem[];
}

export async function buildPoems(): Promise<number> {
  const pool = getPool();
  let inserted = 0;

  for (const file of FILES) {
    const poems = await fetchFile(file.path);
    for (const p of poems) {
      const content = Array.isArray(p.paragraphs) ? p.paragraphs.filter((s) => typeof s === 'string') : [];
      if (content.length === 0) continue;
      const pinyinArr = content.map(linePinyin);
      const appreciation = (p.translation ?? p.appreciation ?? null) || null;
      const title = String(p.title ?? '').trim();
      const author = String(p.author ?? '').trim();
      if (!title || !author) continue;
      const form = p.rhythmic ? String(p.rhythmic) : null;

      await pool.execute(
        `INSERT INTO poems (dynasty, title, author, form, content, pinyin, appreciation, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           form = VALUES(form),
           content = VALUES(content),
           pinyin = VALUES(pinyin),
           appreciation = VALUES(appreciation),
           source = VALUES(source)`,
        [
          file.dynasty,
          title,
          author,
          form,
          JSON.stringify(content),
          JSON.stringify(pinyinArr),
          appreciation,
          SOURCE_TAG,
        ]
      );
      inserted++;
    }
  }
  return inserted;
}

if (require.main === module) {
  buildPoems()
    .then((n) => {
      console.log(`[build-poems] inserted/updated ${n} poems`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-poems] failed:', err);
      process.exit(1);
    });
}
