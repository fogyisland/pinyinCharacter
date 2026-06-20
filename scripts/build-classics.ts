/**
 * Pull ancient Chinese classics (论语, 孟子, 弟子规, etc.) from
 * chinese-poetry/chinese-poetry GitHub repo, generate pinyin per char,
 * UPSERT into the `classics` table.
 *
 * Idempotent: safe to re-run. UPSERT by slug.
 * Network-bound: requires outbound HTTPS to raw.githubusercontent.com.
 * Fails soft on fetch error with a clear log + process.exit(1).
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

// IMPORTANT: All 17 paths below are GUESSES based on chinese-poetry repo structure.
// Before running on a network host, verify each path via:
//   curl -I https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/<path>
// Update this array with verified paths. Per-file soft-fail logs `skip <slug>` for any 404.

// slug → (upstream path, title, category, author, era)
const CLASSIC_FILES: Array<{
  path: string;
  slug: string;
  title: string;
  category: 'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other';
  author: string | null;
  era: string | null;
}> = [
  { path: '/古文/论语.json', slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋' },
  { path: '/古文/孟子.json', slug: 'mengzi', title: '孟子', category: 'four-books', author: '孟子', era: '战国' },
  { path: '/古文/大学.json', slug: 'daxue', title: '大学', category: 'four-books', author: '曾子', era: '春秋' },
  { path: '/古文中庸.json', slug: 'zhongyong', title: '中庸', category: 'four-books', author: '子思', era: '战国' },
  { path: '/古文/诗经.json', slug: 'shijing', title: '诗经', category: 'five-classics', author: null, era: '西周' },
  { path: '/古文/尚书.json', slug: 'shangshu', title: '尚书', category: 'five-classics', author: null, era: '上古' },
  { path: '/古文/礼记.json', slug: 'liji', title: '礼记', category: 'five-classics', author: null, era: '西汉' },
  { path: '/古文/易经.json', slug: 'yijing', title: '易经', category: 'five-classics', author: null, era: '上古' },
  { path: '/古文/春秋.json', slug: 'chunqiu', title: '春秋', category: 'five-classics', author: '孔子', era: '春秋' },
  { path: '/古文/弟子规.json', slug: 'dizigui', title: '弟子规', category: 'mengxue', author: '李毓秀', era: '清' },
  { path: '/古文/千字文.json', slug: 'qianziwen', title: '千字文', category: 'mengxue', author: '周兴嗣', era: '南朝' },
  { path: '/古文/三字经.json', slug: 'sanzijing', title: '三字经', category: 'mengxue', author: '王应麟', era: '宋' },
  { path: '/古文/百家姓.json', slug: 'baijiaxing', title: '百家姓', category: 'mengxue', author: null, era: '北宋' },
  { path: '/古文/道德经.json', slug: 'daodejing', title: '道德经', category: 'philosophy', author: '老子', era: '春秋' },
  { path: '/古文/庄子.json', slug: 'zhuangzi', title: '庄子', category: 'philosophy', author: '庄子', era: '战国' },
  { path: '/古文/列子.json', slug: 'liezi', title: '列子', category: 'philosophy', author: '列御寇', era: '战国' },
  { path: '/古文/史记.json', slug: 'shiji', title: '史记', category: 'history', author: '司马迁', era: '西汉' },
];

interface RawClassic {
  chapter?: string;
  paragraphs?: string[];
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const r = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'string') return r[0]!;
  } catch {
    /* fall through */
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

async function fetchFile(path: string): Promise<RawClassic[]> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`unexpected JSON shape from ${url}`);
  return data as RawClassic[];
}

export async function buildClassics(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const file of CLASSIC_FILES) {
    let raw: RawClassic[];
    try {
      raw = await fetchFile(file.path);
    } catch (err) {
      // Soft-fail: log and continue. File may not exist upstream (some are guesses).
      console.warn(`[build-classics] skip ${file.slug}: ${(err as Error).message}`);
      continue;
    }
    const chunks = raw
      .filter((c) => Array.isArray(c.paragraphs) && c.paragraphs.length > 0)
      .map((c, i) => {
        const content = (c.paragraphs as string[]).map((s) => t2s(s));
        const pinyinArr = content.map(linePinyin);
        return {
          id: i + 1,
          label: String(c.chapter ?? `第${i + 1}篇`).slice(0, 32),
          content,
          pinyin: pinyinArr,
        };
      });
    if (chunks.length === 0) {
      console.warn(`[build-classics] skip ${file.slug}: no chapters after parsing`);
      continue;
    }
    await pool.execute(
      `INSERT INTO classics (slug, title, category, author, era, chunks, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         category = VALUES(category),
         author = VALUES(author),
         era = VALUES(era),
         chunks = VALUES(chunks),
         source = VALUES(source)`,
      [file.slug, file.title, file.category, file.author, file.era, JSON.stringify(chunks), SOURCE_TAG],
    );
    inserted++;
    console.log(`[build-classics] ${file.slug}: ${chunks.length} chapters`);
  }
  return inserted;
}

if (require.main === module) {
  buildClassics()
    .then((n) => {
      console.log(`[build-classics] inserted/updated ${n} classics`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-classics] failed:', err);
      process.exit(1);
    });
}
