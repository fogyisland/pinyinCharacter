/**
 * Build the missing 五经 volumes (左传 full text + 春秋 经文) from guwendao.net.
 *
 * Source of truth: guwendao.net's 左传 book (bookId 5138229e537e), whose 255
 * year-by-year chapters each contain a 【经】 block (the terse 春秋 annals)
 * followed by a 【传】 block (the 左传 commentary). Nothing is paraphrased:
 * the 春秋 volume is a verbatim extraction of the 【经】 paragraphs, and the
 * 左传 volumes are the complete chapter text including both blocks.
 *
 * Also backfills conventional attributions for books whose guwendao/chinese-
 * poetry seed had `author: null`, and rebuilds data/classics-manifest.json
 * from the corpus on disk (same helper the other build scripts use).
 *
 * Idempotent: re-running rewrites the same slugs and regenerates the manifest.
 *
 * Usage: npx tsx scripts/build-classics-five-classics.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { scrapeChapterContent } from '../lib/guwendao-scraper';
import { corpusJsonFiles } from './corpus-files';
import { writeManifest } from './build-classics';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
const BASE = 'https://www.guwendao.net';
const UA = 'Mozilla/5.0 (compatible; pinyin-character-build/1.0)';
const DATA_DIR = join(process.cwd(), 'data', 'classics');

const ZUOZHUAN_BOOK_ID = '5138229e537e';
const SOURCE_TAG = 'guwendao.net/左传';
/** Resumable fetch cache: guwendao occasionally returns 512 under load. */
const FETCH_CACHE = join(tmpdir(), 'pinyin-character-zuozhuan-cache.json');

type FetchCache = Record<string, FetchedChapter>;

function loadFetchCache(): FetchCache {
  try {
    return JSON.parse(readFileSync(FETCH_CACHE, 'utf8')) as FetchCache;
  } catch {
    return {};
  }
}

function saveFetchCache(cache: FetchCache): void {
  writeFileSync(FETCH_CACHE, JSON.stringify(cache), 'utf8');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChapterRef {
  path: string;
  label: string;
}

interface FetchedChapter {
  label: string;
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

/** Conventional attributions for books whose upstream seed left author null. */
const AUTHOR_BACKFILL: Record<string, string> = {
  礼记: '戴圣',
  尚书: '孔子（编）',
  孝经: '曾子（相传）',
  仪礼: '周公（相传）',
  九章算术: '张苍/耿寿昌（整理）',
  三略: '黄石公（旧题）',
  尔雅: '佚名',
  诗经: '佚名',
  百家姓: '佚名',
  名贤集: '佚名',
  增广贤文: '佚名',
  山海经: '佚名',
  太上老君说常清静经: '佚名',
  三十六计: '佚名',
};

const ARTIFACT_SPACE = /[\u0020\u00a0\u3000\t]/;

/**
 * Drop whitespace that the upstream HTML-to-text conversion inserted between
 * Chinese characters (OCR line-wrap padding and indentation). Only spaces
 * touching a Chinese ideograph or Chinese punctuation are removed — a space
 * between two Latin letters is real content and is preserved.
 */
function normalizeLine(line: string): string {
  const chars = Array.from(line);
  return chars
    .filter((ch, i) => {
      if (!ARTIFACT_SPACE.test(ch)) return true;
      const prev = chars[i - 1] ?? '';
      const next = chars[i + 1] ?? '';
      const touchesCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(prev) || /[\u3000-\u9fff\uff00-\uffef]/.test(next);
      return !touchesCjk;
    })
    .join('');
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && typeof result[0] === 'string') return result[0];
  } catch {
    /* fall through */
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

async function fetchHtml(path: string): Promise<string> {
  const url = BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function listChapters(bookId: string): Promise<ChapterRef[]> {
  const html = await fetchHtml(`/guwen/book_${bookId}.aspx`);
  const re = /href="(\/guwen\/bookv_[0-9a-f]+\.aspx)"[^>]*>([^<]+)/g;
  const seen = new Set<string>();
  const out: ChapterRef[] = [];
  for (const match of html.matchAll(re)) {
    const path = match[1]!;
    const label = match[2]!.trim();
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label });
  }
  return out;
}

async function fetchChapter(ref: ChapterRef, cache: FetchCache): Promise<FetchedChapter> {
  const idMatch = ref.path.match(/bookv_([0-9a-f]+)\.aspx/);
  if (!idMatch) throw new Error(`unrecognized chapter path: ${ref.path}`);
  const chapterId = idMatch[1]!;
  if (cache[chapterId]) return cache[chapterId]!;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { paragraphs } = await scrapeChapterContent('', chapterId);
      if (paragraphs.length === 0) throw new Error(`no .contson div in ${ref.path}`);
      const normalized = paragraphs
        .map((p) => normalizeLine(t2s(p)))
        .filter((p) => p.length > 0);
      if (normalized.length === 0) throw new Error(`empty chapter after normalize: ${ref.path}`);
      const chapter: FetchedChapter = { label: ref.label.slice(0, 64), paragraphs: normalized };
      cache[chapterId] = chapter;
      saveFetchCache(cache);
      return chapter;
    } catch (err) {
      lastError = err;
      if (attempt < 4) await delay(800 * (attempt + 1));
    }
  }
  throw new Error(`${ref.label}: ${(lastError as Error).message}`);
}

/** Bounded-concurrency map that preserves input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function writeVolumeFile(vol: VolumeJson): { file: string; bytes: number; chars: number } {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const plainPath = join(DATA_DIR, `${vol.slug}.json`);
  const gzPath = `${plainPath}.gz`;
  const json = JSON.stringify(vol, null, 2);
  const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  writeFileSync(gzPath, compressed);
  if (existsSync(plainPath)) rmSync(plainPath);
  const chars = vol.chunks.reduce(
    (total, chunk) => total + chunk.content.reduce((n, line) => n + Array.from(line).length, 0),
    0,
  );
  return { file: `data/classics/${vol.slug}.json.gz`, bytes: compressed.byteLength, chars };
}

/** Patch the author field of existing gzipped volume files in place. */
function backfillAuthors(): number {
  let patched = 0;
  for (const name of corpusJsonFiles(DATA_DIR)) {
    const path = join(DATA_DIR, name);
    const vol = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as VolumeJson;
    const author = AUTHOR_BACKFILL[vol.bookTitle ?? vol.title];
    if (!author || vol.author === author) continue;
    vol.author = author;
    writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(vol, null, 2), 'utf8'), { level: 9 }));
    patched++;
  }
  return patched;
}

/** Extract the verbatim 【经】 annals from a 左传 chapter. */
function extractAnnals(chapter: FetchedChapter, pinyinLines: string[][]): { content: string[]; pinyin: string[][] } {
  const start = chapter.paragraphs.indexOf('【经】');
  if (start < 0) return { content: [], pinyin: [] };
  const endMarker = chapter.paragraphs.indexOf('【传】', start + 1);
  const end = endMarker < 0 ? chapter.paragraphs.length : endMarker;
  return {
    content: chapter.paragraphs.slice(start + 1, end),
    pinyin: pinyinLines.slice(start + 1, end),
  };
}

export async function buildFiveClassics(): Promise<{ volumes: VolumeJson[]; manifestBooks: number }> {
  const patched = backfillAuthors();
  console.log(`[five-classics] backfilled ${patched} volume author field(s)`);

  console.log('[five-classics] listing 左传 chapters…');
  const refs = await listChapters(ZUOZHUAN_BOOK_ID);
  if (refs.length === 0) throw new Error('左传 chapter list is empty');
  console.log(`[five-classics] ${refs.length} chapters; fetching…`);

  const cache = loadFetchCache();
  const chapters = await mapWithConcurrency(refs, 2, async (ref, index) => {
    const chapter = await fetchChapter(ref, cache);
    if ((index + 1) % 25 === 0 || index + 1 === refs.length) {
      console.log(`  [${index + 1}/${refs.length}] ${chapter.label}`);
    }
    return chapter;
  });

  // Pinyin is generated once per line and shared by the 左传 and 春秋 volumes.
  const pinyinByChapter = chapters.map((chapter) => chapter.paragraphs.map(linePinyin));

  const zuozhuanChunks: ChunkJson[] = chapters.map((chapter, index) => ({
    id: index + 1,
    label: chapter.label,
    content: chapter.paragraphs,
    pinyin: pinyinByChapter[index]!,
  }));

  const annalChunks: ChunkJson[] = [];
  chapters.forEach((chapter, index) => {
    const annals = extractAnnals(chapter, pinyinByChapter[index]!);
    if (annals.content.length === 0) return;
    annalChunks.push({
      id: annalChunks.length + 1,
      label: chapter.label,
      content: annals.content,
      pinyin: annals.pinyin,
    });
  });
  if (annalChunks.length === 0) throw new Error('no 【经】 annals found in 左传 chapters');

  const volumes: VolumeJson[] = [];
  const ranges: Array<{ slug: string; title: string; from: number; to: number }> = [
    { slug: 'zuozhuan-1', title: '左传·上册', from: 1, to: 85 },
    { slug: 'zuozhuan-2', title: '左传·中册', from: 86, to: 170 },
    { slug: 'zuozhuan-3', title: '左传·下册', from: 171, to: zuozhuanChunks.length },
  ];
  for (const range of ranges) {
    const chunks = zuozhuanChunks.slice(range.from - 1, range.to).map((chunk, i) => ({ ...chunk, id: i + 1 }));
    if (chunks.length === 0) continue;
    volumes.push({
      slug: range.slug,
      title: range.title,
      category: 'five-classics',
      author: '左丘明',
      era: '春秋',
      source: SOURCE_TAG,
      bookId: ZUOZHUAN_BOOK_ID,
      bookTitle: '左传',
      chapterRange: { from: range.from, to: range.to },
      chunks,
    });
  }

  volumes.push({
    slug: 'chunqiu-jing',
    title: '春秋·经文（左氏本）',
    category: 'five-classics',
    author: '孔子',
    era: '春秋',
    source: 'guwendao.net/左传·【经】部分',
    bookId: ZUOZHUAN_BOOK_ID,
    bookTitle: '春秋',
    chapterRange: { from: 1, to: annalChunks.length },
    chunks: annalChunks,
  });

  for (const vol of volumes) {
    const written = writeVolumeFile(vol);
    console.log(
      `[five-classics] ${vol.slug}: ${vol.chunks.length} chapters, ${written.chars} chars → ${written.file}`,
    );
  }

  const manifest = writeManifest();
  console.log(`[five-classics] manifest rebuilt: ${manifest.books.length} books`);
  return { volumes, manifestBooks: manifest.books.length };
}

if (require.main === module) {
  buildFiveClassics()
    .then(({ volumes, manifestBooks }) => {
      console.log(`[five-classics] wrote ${volumes.length} volumes; manifest has ${manifestBooks} books`);
    })
    .catch((err) => {
      console.error('[five-classics] failed:', err);
      process.exit(1);
    });
}
