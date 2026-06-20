/**
 * Pull ancient Chinese classics (论语, 孟子, 弟子规, etc.) from
 * chinese-poetry/chinese-poetry GitHub repo, generate pinyin per char,
 * UPSERT into the `classics` table.
 *
 * Idempotent: safe to re-run. UPSERT by slug.
 * Network-bound: requires outbound HTTPS to raw.githubusercontent.com.
 * Fails soft on fetch error with a clear log + process.exit(1).
 *
 * All paths were verified 2026-06-20 against chinese-poetry/master via
 * the recursive git tree. Eight paths from the original guess list
 * (尚书/礼记/易经/春秋/道德经/庄子/列子/史记) DO NOT exist upstream and
 * were dropped. Six bonus paths from 蒙学 + 楚辞/chuci.json were added.
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';
const DATA_DIR = join(process.cwd(), 'data', 'classics');
const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');

interface ChunkSeed {
  chapter: string;
  paragraphs: string[];
}

interface ChunkJson {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

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
  chunks: ChunkJson[];
}

interface ManifestEntry {
  slug: string;
  title: string;
  source: string;
  category: string;
  author: string | null;
  era: string | null;
  chapterCount: number;
  charCount: number;
  jsonFile: string;
  jsonBytes: number;
  bookId?: string;
  bookTitle?: string;
}

interface Manifest {
  version: 1;
  updatedAt: string;
  books: ManifestEntry[];
}

function countChars(chunks: ChunkJson[]): number {
  return chunks.reduce((n, c) => n + c.content.reduce((s, p) => s + Array.from(p).length, 0), 0);
}

function writeVolumeJson(vol: VolumeJson): { path: string; bytes: number } {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(vol, null, 2);
  const filePath = join(DATA_DIR, `${vol.slug}.json`);
  writeFileSync(filePath, json, 'utf8');
  return { path: filePath, bytes: json.length };
}

function buildManifestFromDisk(): Manifest {
  const entries: ManifestEntry[] = [];
  if (!existsSync(DATA_DIR)) {
    return { version: 1, updatedAt: new Date().toISOString(), books: entries };
  }
  for (const name of readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const filePath = join(DATA_DIR, name);
    const stat = statSync(filePath);
    const vol: VolumeJson = JSON.parse(readFileSync(filePath, 'utf8'));
    entries.push({
      slug: vol.slug,
      title: vol.title,
      source: vol.source,
      category: vol.category,
      author: vol.author,
      era: vol.era,
      chapterCount: vol.chunks.length,
      charCount: countChars(vol.chunks),
      jsonFile: `data/classics/${name}`,
      jsonBytes: stat.size,
      bookId: vol.bookId,
      bookTitle: vol.bookTitle,
    });
  }
  entries.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.slug.localeCompare(b.slug)));
  return { version: 1, updatedAt: new Date().toISOString(), books: entries };
}

function writeManifest(): Manifest {
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const manifest = buildManifestFromDisk();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

interface ClassicFile {
  path: string;
  slug: string;
  title: string;
  category: 'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other';
  author: string | null;
  era: string | null;
}

const CLASSIC_FILES: ClassicFile[] = [
  // 四书 (Four Books)
  { path: '/论语/lunyu.json', slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋' },
  { path: '/四书五经/mengzi.json', slug: 'mengzi', title: '孟子', category: 'four-books', author: '孟子', era: '战国' },
  { path: '/四书五经/daxue.json', slug: 'daxue', title: '大学', category: 'four-books', author: '曾子', era: '春秋' },
  { path: '/四书五经/zhongyong.json', slug: 'zhongyong', title: '中庸', category: 'four-books', author: '子思', era: '战国' },
  // 五经 (only 诗经 available; 尚书/礼记/易经/春秋 not in upstream repo)
  { path: '/诗经/shijing.json', slug: 'shijing', title: '诗经', category: 'five-classics', author: null, era: '西周' },
  // 蒙学 (Children's classics)
  { path: '/蒙学/dizigui.json', slug: 'dizigui', title: '弟子规', category: 'mengxue', author: '李毓秀', era: '清' },
  { path: '/蒙学/qianziwen.json', slug: 'qianziwen', title: '千字文', category: 'mengxue', author: '周兴嗣', era: '南朝' },
  { path: '/蒙学/sanzijing-new.json', slug: 'sanzijing', title: '三字经', category: 'mengxue', author: '王应麟', era: '宋' },
  { path: '/蒙学/baijiaxing.json', slug: 'baijiaxing', title: '百家姓', category: 'mengxue', author: null, era: '北宋' },
  { path: '/蒙学/zengguangxianwen.json', slug: 'zengguangxianwen', title: '增广贤文', category: 'mengxue', author: null, era: '明清' },
  { path: '/蒙学/youxueqionglin.json', slug: 'youxueqionglin', title: '幼学琼林', category: 'mengxue', author: '程登吉', era: '明' },
  { path: '/蒙学/wenzimengqiu.json', slug: 'wenzimengqiu', title: '文字蒙求', category: 'mengxue', author: '王筠', era: '清' },
  { path: '/蒙学/guwenguanzhi.json', slug: 'guwenguanzhi', title: '古文观止', category: 'other', author: '吴楚材/吴调侯', era: '清' },
  // 楚辞 (Songs of Chu — poetry rather than prose, but tagged as a classic)
  { path: '/楚辞/chuci.json', slug: 'chuci', title: '楚辞', category: 'other', author: '屈原等', era: '战国' },
];

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function isStringArrayContainer(x: unknown): x is Record<string, unknown> & { content: string[] } {
  return !!x && typeof x === 'object' && isStringArray((x as { content?: unknown }).content);
}

/**
 * Normalize the upstream JSON (which uses 5 different shapes) into
 * a uniform Array<{chapter, paragraphs}>.
 *
 * Observed shapes (verified 2026-06-20):
 *   1. Array<{chapter, paragraphs[]}>     (lunyu, mengzi)
 *   2. {chapter, paragraphs[]}            (daxue, zhongyong)
 *   3. {title, ..., paragraphs[]}         (qianziwen, baijiaxing, zengguangxianwen, youxueqionglin)
 *   4. {title, ..., content:[{chapter, paragraphs[]}]}  (dizigui, wenzimengqiu, guwenguanzhi)
 *   5. Array<{title, content[]: string[]}>                (shijing, chuci)
 */
function normalize(raw: unknown): ChunkSeed[] {
  const out: ChunkSeed[] = [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    // Form 1 & 2: {chapter?, paragraphs[]}
    if (Array.isArray(obj.paragraphs) && isStringArray(obj.paragraphs)) {
      out.push({
        chapter: String(obj.chapter ?? obj.title ?? '').slice(0, 32),
        paragraphs: obj.paragraphs,
      });
      continue;
    }

    // Form 5: {title, content: string[]}
    if (isStringArrayContainer(obj)) {
      out.push({
        chapter: String(obj.chapter ?? obj.title ?? '').slice(0, 32),
        paragraphs: obj.content,
      });
      continue;
    }

    // Form 3/4: content: [{chapter, paragraphs[]}]  (possibly nested)
    if (Array.isArray(obj.content)) {
      for (const c of obj.content) {
        if (!c || typeof c !== 'object') continue;
        const cObj = c as Record<string, unknown>;

        if (Array.isArray(cObj.paragraphs) && isStringArray(cObj.paragraphs)) {
          out.push({
            chapter: String(cObj.chapter ?? cObj.title ?? obj.title ?? '').slice(0, 32),
            paragraphs: cObj.paragraphs,
          });
          continue;
        }

        if (isStringArrayContainer(cObj)) {
          out.push({
            chapter: String(cObj.chapter ?? cObj.title ?? obj.title ?? '').slice(0, 32),
            paragraphs: cObj.content,
          });
          continue;
        }

        // Deepest nesting: content: [{title, content: [{chapter, paragraphs[]}]}]
        // e.g. guwenguanzhi.json
        if (Array.isArray(cObj.content)) {
          for (const cc of cObj.content) {
            if (!cc || typeof cc !== 'object') continue;
            const ccObj = cc as Record<string, unknown>;
            if (Array.isArray(ccObj.paragraphs) && isStringArray(ccObj.paragraphs)) {
              out.push({
                chapter: String(ccObj.chapter ?? ccObj.title ?? cObj.title ?? obj.title ?? '').slice(0, 32),
                paragraphs: ccObj.paragraphs,
              });
            }
          }
        }
      }
    }
  }
  return out;
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

async function fetchFile(path: string): Promise<unknown> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const text = await res.text();
  if (text.trim().length === 0) throw new Error(`empty body from ${url}`);
  return JSON.parse(text);
}

export async function buildClassics(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const file of CLASSIC_FILES) {
    let raw: unknown;
    try {
      raw = await fetchFile(file.path);
    } catch (err) {
      // Soft-fail: log and continue. File may not exist upstream or be empty.
      console.warn(`[build-classics] skip ${file.slug}: ${(err as Error).message}`);
      continue;
    }
    const seeds = normalize(raw);
    const chunks = seeds
      .filter((s) => s.paragraphs.length > 0)
      .map((s, i) => {
        const content = s.paragraphs.map((p) => t2s(p));
        const pinyinArr = content.map(linePinyin);
        return {
          id: i + 1,
          label: (s.chapter || `第${i + 1}篇`).slice(0, 32),
          content,
          pinyin: pinyinArr,
        };
      });
    if (chunks.length === 0) {
      console.warn(`[build-classics] skip ${file.slug}: no chapters after parsing`);
      continue;
    }
    const jsonStr = JSON.stringify(chunks);
    const volJson: VolumeJson = {
      slug: file.slug,
      title: file.title,
      category: file.category,
      author: file.author,
      era: file.era,
      source: SOURCE_TAG,
      bookId: file.slug,
      bookTitle: file.title,
      chapterRange: { from: 1, to: chunks.length },
      chunks,
    };
    const { path: jsonPath, bytes } = writeVolumeJson(volJson);
    console.log(`[build-classics] ${file.slug}: ${chunks.length} chapters, ${Math.round(bytes / 1024)}KB JSON → ${jsonPath}`);
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
      [file.slug, file.title, file.category, file.author, file.era, jsonStr, SOURCE_TAG],
    );
    inserted++;
  }
  writeManifest();
  return inserted;
}

if (require.main === module) {
  buildClassics()
    .then((n) => {
      console.log(`[build-classics] inserted/updated ${n} classics`);
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
      console.log(`[build-classics] manifest has ${manifest.books.length} books total`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-classics] failed:', err);
      process.exit(1);
    });
}

export { writeManifest, buildManifestFromDisk, MANIFEST_PATH, DATA_DIR };
