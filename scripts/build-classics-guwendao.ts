/**
 * Prototype: pull one classic (醒世恒言) from guwendao.net (原古诗文网)
 * and UPSERT into the `classics` table.
 *
 * Source: HTML pages with <div class="contson"> holding <p> paragraphs
 * and <br/> line breaks (used for inline poetry).
 *
 * Idempotent: re-running UPSERTs the same slug with fresh content.
 * Network-bound: requires outbound HTTPS to www.guwendao.net.
 *
 * Usage: DATABASE_URL=<db> pnpm tsx scripts/build-classics-guwendao.ts
 *   (or set DATABASE_URL inline as shown above)
 */
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://www.guwendao.net';
const SOURCE_TAG = 'guwendao.net/醒世恒言';
const UA = 'Mozilla/5.0 (compatible; pinyin-character-build/1.0)';

interface ClassicVolume {
  slug: string;
  title: string;
  /** Inclusive 1-based chapter index range within the book. */
  fromIdx: number;
  toIdx: number;
}

interface ClassicFile {
  category: 'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other';
  author: string | null;
  era: string | null;
  indexPath: string;
  /**
   * Volumes for this book. Books ≤ ~25 chapters fit one row; larger
   * books must be split (e.g. 醒世恒言 → 上下两册) so each INSERT stays
   * under MySQL's `max_allowed_packet` (default 4MB).
   */
  volumes: ClassicVolume[];
}

// Prototype: just 醒世恒言. Split into 上/下 两册 so each INSERT
// stays under max_allowed_packet (40 卷 × ~64KB JSON/chapter ≈ 2.5MB).
const CLASSIC_FILES: ClassicFile[] = [
  {
    category: 'other',
    author: '冯梦龙',
    era: '明',
    indexPath: '/guwen/book_efdce10c023c.aspx',
    volumes: [
      { slug: 'xingshi-hengyan-1', title: '醒世恒言·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'xingshi-hengyan-2', title: '醒世恒言·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
];

interface ChapterRef {
  path: string;
  label: string;
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

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, '—')
    .replace(/&hellip;/g, '…')
    .trim();
}

async function fetchHtml(path: string): Promise<string> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

/** Pull (path, label) pairs from a guwendao book index page. */
async function listChapters(indexPath: string): Promise<ChapterRef[]> {
  const html = await fetchHtml(indexPath);
  const re = /href="(\/guwen\/bookv_[0-9a-f]+\.aspx)"[^>]*>([^<]+)/g;
  const seen = new Set<string>();
  const out: ChapterRef[] = [];
  for (const m of html.matchAll(re)) {
    const fullPath = m[1]!;
    const label = m[2]!.trim();
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    out.push({ path: fullPath, label });
  }
  return out;
}

/** Extract paragraph array from a guwendao chapter page. */
async function fetchChapterParagraphs(chapterPath: string): Promise<string[]> {
  const html = await fetchHtml(chapterPath);
  // <div class="contson"> ... </div>  (non-greedy, multiline)
  const m = html.match(/<div\s+class="contson"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) throw new Error(`no .contson div in ${chapterPath}`);
  const inner = m[1]!;
  // Split on </p> to get paragraph blocks
  const blocks = inner.split(/<\/p>/i).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((b) => stripTags(b))
    .map((p) => t2s(p))
    .filter((p) => p.length > 0);
}

export async function buildClassicsGuwendao(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const file of CLASSIC_FILES) {
    console.log(`[guwendao] listing chapters at ${file.indexPath}…`);
    const chapters = await listChapters(file.indexPath);
    if (chapters.length === 0) {
      console.warn(`[guwendao] skip: no chapters found at ${file.indexPath}`);
      continue;
    }
    console.log(`[guwendao] ${chapters.length} chapters total`);

    // Fetch every chapter once and re-use across volumes.
    const allChunks: Array<{ id: number; label: string; content: string[]; pinyin: string[][] }> = [];
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i]!;
      try {
        const paragraphs = await fetchChapterParagraphs(c.path);
        const pinyinArr = paragraphs.map(linePinyin);
        allChunks.push({ id: i + 1, label: c.label.slice(0, 64), content: paragraphs, pinyin: pinyinArr });
        process.stdout.write(`  [${i + 1}/${chapters.length}] ${c.label} (${paragraphs.length} 段)\n`);
      } catch (err) {
        console.warn(`  [guwendao] skip chapter ${c.path}: ${(err as Error).message}`);
      }
    }
    if (allChunks.length === 0) {
      console.warn(`[guwendao] skip: no chunks after fetch`);
      continue;
    }

    for (const vol of file.volumes) {
      const slice = allChunks.slice(vol.fromIdx - 1, vol.toIdx);
      if (slice.length === 0) {
        console.warn(`[guwendao] skip ${vol.slug}: empty slice ${vol.fromIdx}-${vol.toIdx}`);
        continue;
      }
      // Re-number chunk ids within the volume (1-based).
      const chunks = slice.map((c, i) => ({ ...c, id: i + 1 }));
      const json = JSON.stringify(chunks);
      const kb = Math.round(json.length / 1024);
      console.log(`[guwendao] ${vol.slug}: ${chunks.length} chapters, ${kb}KB JSON`);
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
        [vol.slug, vol.title, file.category, file.author, file.era, json, SOURCE_TAG],
      );
      inserted++;
      console.log(`[guwendao] ${vol.slug}: written`);
    }
  }
  return inserted;
}

if (require.main === module) {
  buildClassicsGuwendao()
    .then((n) => {
      console.log(`[guwendao] inserted/updated ${n} classics`);
      return closePool();
    })
    .catch((err) => {
      console.error('[guwendao] failed:', err);
      process.exit(1);
    });
}
