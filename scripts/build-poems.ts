/**
 * Pull 唐诗三百首 + 宋词三百首 from chinese-poetry/chinese-poetry GitHub repo,
 * generate pinyin for each char with pinyin-pro, UPSERT into the `poems` table.
 *
 * Idempotent: safe to re-run. Existing rows are updated, new rows are inserted.
 * Fails soft: network errors / parse errors throw, caller decides whether to fail.
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';

// 唐诗 JSON 来源是繁体, 转为简体以符合简体中文站点的用户体验
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const FILES: Array<{ dynasty: 'tang' | 'song'; path: string }> = [
  { dynasty: 'tang', path: '/%E5%85%A8%E5%94%90%E8%AF%97/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json' },
  { dynasty: 'song', path: '/%E5%AE%8B%E8%AF%8D/%E5%AE%8B%E8%AF%8D%E4%B8%89%E7%99%BE%E9%A6%96.json' },
];
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

// 唐诗 form 在 tags 中(如 "五言律诗"),宋词 form 在 rhythmic 字段(如 "念奴娇")
const FORM_TAG_RE = /^[三四五六七八九]言.{1,3}诗$/;

interface RawPoem {
  title: string;
  author: string;
  paragraphs?: string[];
  rhythmic?: string;
  tags?: string[];
  // 宋词 赏析字段 (可选)
  translation?: string;
  appreciation?: string;
}

function extractForm(p: RawPoem): string | null {
  if (p.rhythmic) return String(p.rhythmic);
  if (Array.isArray(p.tags)) {
    for (const t of p.tags) {
      if (typeof t === 'string' && FORM_TAG_RE.test(t)) return t;
    }
  }
  return null;
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

interface PreparedPoem {
  dynasty: 'tang' | 'song';
  title: string;
  author: string;
  form: string | null;
  content: string;
  pinyin: string;
  appreciation: string | null;
}

function prepare(p: RawPoem, dynasty: 'tang' | 'song'): PreparedPoem | null {
  const rawContent = Array.isArray(p.paragraphs) ? p.paragraphs.filter((s) => typeof s === 'string') : [];
  if (rawContent.length === 0) return null;
  // 唐诗为繁体, 统一转简体; 宋词已为简体, 转换是幂等的
  const content = rawContent.map((s) => t2s(s));
  // 宋词无 title 字段, 用 rhythmic (词牌名) 作为 title; 同时转简体
  const title = t2s(String(p.title ?? p.rhythmic ?? '').trim());
  const author = t2s(String(p.author ?? '').trim());
  if (!title || !author) return null;
  let form = extractForm(p);
  if (form) form = t2s(form);
  // 当 title 已是 rhythmic 时, 避免 form 字段重复显示
  if (form && form === title) form = null;
  return {
    dynasty,
    title,
    author,
    form,
    content: JSON.stringify(content),
    pinyin: JSON.stringify(content.map(linePinyin)),
    appreciation: (p.translation ?? p.appreciation ?? null) || null,
  };
}

export async function buildPoems(): Promise<number> {
  const pool = getPool();

  // Pass 1: fetch + dedup by uniq_poem(dynasty, title, author) key.
  // The chinese-poetry sources contain within-file duplicates (e.g. 春宫怨/杜荀鹤
  // appears twice in tang300.json with identical content). If we let them through
  // to MySQL, every duplicate pair hits ON DUPLICATE KEY UPDATE and MySQL returns
  // ambiguous signals (insertId is the updated row's id, affectedRows with
  // CLIENT_FOUND_ROWS reports matched rows not changed rows). Deduping here
  // makes `inserted++` trivially equal to the number of INSERT statements we
  // actually send — and equals the number of new rows on a fresh DB.
  const deduped = new Map<string, PreparedPoem>();
  for (const file of FILES) {
    const poems = await fetchFile(file.path);
    for (const p of poems) {
      const prepared = prepare(p, file.dynasty);
      if (!prepared) continue;
      const key = `${prepared.dynasty}|${prepared.title}|${prepared.author}`;
      // Last-write-wins: if two source rows share a key, the later one wins.
      // Content is identical for the known duplicates, so this is safe.
      deduped.set(key, prepared);
    }
  }

  let inserted = 0;
  for (const prepared of deduped.values()) {
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
        prepared.dynasty,
        prepared.title,
        prepared.author,
        prepared.form,
        prepared.content,
        prepared.pinyin,
        prepared.appreciation,
        SOURCE_TAG,
      ]
    );
    inserted++;
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
