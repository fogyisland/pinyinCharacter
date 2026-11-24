/**
 * Build the 周易 volumes (64 卦 + 十翼) from zh.wikisource.org.
 *
 * Source of truth: zh.wikisource.org's 周易 namespace, which is public domain.
 * Each of the 64 hexagram pages carries the 卦辞/爻辞 (易經), followed by 彖曰,
 * 象曰 (大象 + 小象) and — for 乾/坤 only — 文言, all verbatim. The 十翼 volume
 * is built from the five standalone翼 pages (繫辭上/繫辭下/說卦/序卦/雜卦).
 * The 彖/大象/小象/文言 合集 pages are deliberately NOT fetched: their content
 * already lives inside the hexagram pages and fetching them would duplicate it.
 *
 * Wikitext is cleaned (header2/Header/NoteTA templates, File links, -{}-
 * language-variant markers, <span> markup, [[x|y]] links, list prefixes), then
 * converted 繁→简 with OpenCC. 「乾」 is protected across the conversion: OpenCC
 * maps a lone 乾 to 干, but every occurrence in this corpus is the 乾
 * hexagram/heaven triangle and must stay 乾.
 *
 * Nothing is paraphrased: content lines are the page text verbatim after the
 * markup cleanup above. Pages that fail to fetch fail the build — no gaps.
 *
 * Usage (zh.wikisource.org needs an HTTP proxy from this network):
 *   NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:10808 npx tsx scripts/build-classics-zhouyi.ts
 *
 * Idempotent: re-running rewrites the same slugs and regenerates the manifest.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { writeManifest } from './build-classics';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
const UA = 'pinyin-character-build/1.0';
const API = 'https://zh.wikisource.org/w/api.php';
const DATA_DIR = join(process.cwd(), 'data', 'classics');
const SOURCE_TAG = 'zh.wikisource.org/周易';
/** Resumable fetch cache: the proxy occasionally drops mid-run. */
const FETCH_CACHE = join(tmpdir(), 'pinyin-character-zhouyi-cache.json');
/** PUA placeholder that survives the OpenCC 繁→简 pass (乾 → 干 must NOT happen). */
const QIAN_GUARD = '';

/**
 * The 64 hexagram pages in 周易 king-wen order, using the exact zh.wikisource
 * page titles (恒 and 无妄 are spelled that way upstream, not 恆/無妄).
 * First 30 = 上经, last 34 = 下经.
 */
const HEXAGRAM_TITLES: readonly string[] = [
  '乾', '坤', '屯', '蒙', '需', '訟', '師', '比', '小畜', '履',
  '泰', '否', '同人', '大有', '謙', '豫', '隨', '蠱', '臨', '觀',
  '噬嗑', '賁', '剝', '復', '无妄', '大畜', '頤', '大過', '坎', '離',
  '咸', '恒', '遯', '大壯', '晉', '明夷', '家人', '睽', '蹇', '解',
  '損', '益', '夬', '姤', '萃', '升', '困', '井', '革', '鼎',
  '震', '艮', '漸', '歸妹', '豐', '旅', '巽', '兌', '渙', '節',
  '中孚', '小過', '既濟', '未濟',
];

/** The five standalone 十翼 pages (the other four 彖/象/文言 wings live inside the hexagram pages). */
const YIZHUAN_TITLES: readonly string[] = ['繫辭上', '繫辭下', '說卦', '序卦', '雜卦'];
/** Fallback chunk labels if a page has no {{Header|title=…}} to extract from. */
const YIZHUAN_FALLBACK_LABELS: Record<string, string> = {
  繫辭上: '系辞上传',
  繫辭下: '系辞下传',
  說卦: '说卦传',
  序卦: '序卦传',
  雜卦: '杂卦传',
};

interface FetchedPage {
  title: string;
  wikitext: string;
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

type FetchCache = Record<string, string>;

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

async function fetchWikitext(page: string, cache: FetchCache): Promise<FetchedPage> {
  const cached = cache[page];
  if (cached !== undefined) return { title: page, wikitext: cached };
  const url = `${API}?${new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  })}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        parse?: { title: string; wikitext: string };
        error?: { code: string; info: string };
      };
      if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
      const wikitext = data.parse?.wikitext;
      if (!wikitext || wikitext.trim().length === 0) {
        throw new Error(`empty wikitext for ${page}`);
      }
      cache[page] = wikitext;
      saveFetchCache(cache);
      // Be a polite client: wikisource rate-limits burst API access (HTTP 429).
      await delay(400);
      return { title: data.parse?.title ?? page, wikitext };
    } catch (err) {
      lastError = err;
      if (attempt < 4) {
        // 429 = wikisource rate limit: back off much harder than transient errors.
        const rateLimited = /HTTP 429/.test((err as Error).message);
        await delay(rateLimited ? 5000 * (attempt + 1) : 800 * (attempt + 1));
      }
    }
  }
  const hint = lastError instanceof Error && /fetch|connect|timeout/i.test(lastError.message)
    ? ' (set NODE_USE_ENV_PROXY=1 and https_proxy if this network needs a proxy for wikisource)'
    : '';
  throw new Error(`fetch ${page} failed after 5 attempts: ${(lastError as Error).message}${hint}`);
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

function decodeEntities(line: string): string {
  return line
    .replace(/&nbsp;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/**
 * Strip the zh.wikisource wikitext down to plain text lines.
 *
 * Order matters: structural templates (header2/Header/NoteTA) go first so the
 * later -{}- variant-marker pass never sees their internals; then variant
 * markers, remaining templates, links, markup, list prefixes; last the
 * line-level filters (empty lines, the "周易　第X卦" breadcrumb, the bare
 * hexagram-name line that the definition list renders above each page).
 */
function cleanWikitext(raw: string, hexName: string | null): string[] {
  let text = raw;
  // -{T|周易/乾}- variant-title line.
  text = text.replace(/-\{T\|[^}]*\}-/g, '');
  // Multi-line {{header2 …}} nav box (sometimes written as "{{\nheader2"), then
  // single-line {{Header|…}} / {{NoteTA|…}}.
  text = text.replace(/\{\{\s*header2[\s\S]*?\}\}/gi, '');
  text = text.replace(/\{\{(?:Header|NoteTA)\|[\s\S]*?\}\}/g, '');
  // -{无}- / -{于}- language-variant markers: keep the inner character.
  text = text.replace(/-\{([^{}]*)\}-/g, '$1');
  // {{另|磐|盤}} → first argument (the recommended character); {{*|一作太和}} and {{gap}} are layout-only.
  text = text.replace(/\{\{另\|([^|}]+)\|[^}]*\}\}/g, '$1');
  text = text.replace(/\{\{\*[^}]*\}\}/g, '');
  text = text.replace(/\{\{gap\}\}/gi, '');
  // Anything else template-shaped: surface it (never silently drop content).
  text = text.replace(/\{\{[^{}]*\}\}/g, (match) => {
    console.warn(`[zhouyi] dropped unexpected template: ${match}`);
    return '';
  });
  // [[File:Iching-hexagram-01.svg|alt=䷀]] — the trigram glyph line keeps its trailing text.
  text = text.replace(/\[\[[^\]]*\]\]/gi, (match) => (match.startsWith('[[File:') ? '' : match));
  // [[x|y]] → y, [[x]] → x.
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // <span style="color:blue"> may wrap across lines; the character class allows \n.
  text = text.replace(/<\/?span[^>]*>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // '''bold''' / '''''' / ''italic'' — the corpus has no real apostrophes.
  text = text.replace(/'{2,}/g, '');
  // ==第一章== / ==上篇== section headings become plain paragraph lines.
  text = text.replace(/^==+\s*([^=\n]+?)\s*==+$/gm, '$1');

  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = decodeEntities(rawLine.replace(/^[*#;:\s]+/, '')).trim();
    if (line.length === 0) continue;
    // Breadcrumb: [[周易]]　第三卦
    if (/^周易\s*第[一二三四五六七八九十]{1,4}卦$/.test(line)) continue;
    // Bare hexagram name rendered by the ;Name definition-list line — compared
    // in traditional form because the conversion happens after this filter.
    if (hexName !== null && line === hexName) continue;
    lines.push(line);
  }
  // 繁→简 for the whole corpus, with every「乾」preserved.
  return lines.map(toSimplified);
}

/** 繁→简 with every「乾」preserved (OpenCC would otherwise emit 干). */
function toSimplified(text: string): string {
  const guarded = text.split('乾').join(QIAN_GUARD);
  return t2s(guarded).split(QIAN_GUARD).join('乾');
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && typeof result[0] === 'string') return result[0];
  } catch (err) {
    console.warn(`[zhouyi] pinyin failed for ${ch}: ${(err as Error).message}`);
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

/** Extract the human chunk label from {{Header|title=繫辭上傳|…}}, falling back to a known name. */
function extractHeaderTitle(wikitext: string, fallback: string): string {
  const match = wikitext.match(/\{\{Header\|[^}]*?\btitle=([^|}]+)/);
  const title = match?.[1]?.trim();
  return title && title.length > 0 && title.length <= 16 ? title : fallback;
}

function toChunk(id: number, label: string, lines: string[], context: string): ChunkJson {
  if (lines.length === 0) throw new Error(`${context}: no content after cleaning`);
  return {
    id,
    label,
    content: lines,
    pinyin: lines.map(linePinyin),
  };
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

export async function buildZhouyi(): Promise<{ volumes: VolumeJson[]; manifestBooks: number }> {
  const cache = loadFetchCache();
  const requests: Array<{ page: string; kind: 'hex' | 'yi'; title: string }> = [
    ...HEXAGRAM_TITLES.map((title) => ({ page: `周易/${title}`, kind: 'hex' as const, title })),
    ...YIZHUAN_TITLES.map((title) => ({ page: `周易/${title}`, kind: 'yi' as const, title })),
  ];
  console.log(`[zhouyi] fetching ${requests.length} wikisource pages…`);

  const fetched = await mapWithConcurrency(requests, 1, async (req, index) => {
    const result = await fetchWikitext(req.page, cache);
    if ((index + 1) % 10 === 0 || index + 1 === requests.length) {
      console.log(`  [${index + 1}/${requests.length}] ${result.title}`);
    }
    return { ...req, ...result };
  });

  // ---- 上经 / 下经 (hexagram pages: 易經 + 彖曰 + 象曰 + 文言) ----
  const hexChunks: ChunkJson[] = [];
  fetched
    .filter((entry) => entry.kind === 'hex')
    .forEach((entry, index) => {
      const titleName = entry.title.replace(/^周易\//, ''); // traditional: matches the page's own lines
      const hexName = toSimplified(titleName); // simplified: the chunk label
      const lines = cleanWikitext(entry.wikitext, titleName);
      const joined = lines.join('\n');
      if (!joined.includes('彖曰')) console.warn(`[zhouyi] ${entry.title}: no 彖曰 section found`);
      if (!joined.includes('象曰')) console.warn(`[zhouyi] ${entry.title}: no 象曰 section found`);
      if (hexName === '乾' || hexName === '坤') {
        if (!joined.includes('文言')) console.warn(`[zhouyi] ${entry.title}: no 文言 section found`);
      }
      hexChunks.push(toChunk(index + 1, `${hexName}卦`, lines, entry.title));
    });
  if (hexChunks.length !== HEXAGRAM_TITLES.length) {
    throw new Error(`expected ${HEXAGRAM_TITLES.length} hexagram chunks, got ${hexChunks.length}`);
  }

  // ---- 十翼 (standalone 繫辭/說卦/序卦/雜卦 pages) ----
  const yiChunks: ChunkJson[] = fetched
    .filter((entry) => entry.kind === 'yi')
    .map((entry, index) => {
      const pageKey = entry.title.replace(/^周易\/|^易傳\//, '');
      const label = toSimplified(
        extractHeaderTitle(entry.wikitext, YIZHUAN_FALLBACK_LABELS[pageKey] ?? pageKey),
      );
      const lines = cleanWikitext(entry.wikitext, null);
      return toChunk(index + 1, label, lines, entry.title);
    });
  if (yiChunks.length !== YIZHUAN_TITLES.length) {
    throw new Error(`expected ${YIZHUAN_TITLES.length} 十翼 chunks, got ${yiChunks.length}`);
  }

  const upper = hexChunks.slice(0, 30).map((chunk, i) => ({ ...chunk, id: i + 1 }));
  const lower = hexChunks.slice(30).map((chunk, i) => ({ ...chunk, id: i + 1 }));

  const volumes: VolumeJson[] = [
    {
      slug: 'zhouyi-shangjing',
      title: '周易·上经',
      category: 'five-classics',
      author: '周文王（相传）',
      era: '西周',
      source: SOURCE_TAG,
      bookId: 'zhouyi-shangjing',
      bookTitle: '周易',
      chapterRange: { from: 1, to: upper.length },
      chunks: upper,
    },
    {
      slug: 'zhouyi-xiajing',
      title: '周易·下经',
      category: 'five-classics',
      author: '周文王（相传）',
      era: '西周',
      source: SOURCE_TAG,
      bookId: 'zhouyi-xiajing',
      bookTitle: '周易',
      chapterRange: { from: 1, to: lower.length },
      chunks: lower,
    },
    {
      slug: 'zhouyi-yizhuan',
      title: '周易·易传（十翼）',
      category: 'five-classics',
      author: '孔子（相传）',
      era: '春秋',
      source: 'zh.wikisource.org/易传',
      bookId: 'zhouyi-yizhuan',
      bookTitle: '周易',
      chapterRange: { from: 1, to: yiChunks.length },
      chunks: yiChunks,
    },
  ];

  for (const vol of volumes) {
    const written = writeVolumeFile(vol);
    console.log(
      `[zhouyi] ${vol.slug}: ${vol.chunks.length} chapters, ${written.chars} chars → ${written.file}`,
    );
  }

  const manifest = writeManifest();
  console.log(`[zhouyi] manifest rebuilt: ${manifest.books.length} books`);
  return { volumes, manifestBooks: manifest.books.length };
}

if (require.main === module) {
  buildZhouyi()
    .then(({ volumes, manifestBooks }) => {
      console.log(`[zhouyi] wrote ${volumes.length} volumes; manifest has ${manifestBooks} books`);
    })
    .catch((err) => {
      console.error('[zhouyi] failed:', err);
      process.exit(1);
    });
}
