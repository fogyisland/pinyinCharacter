/**
 * Build the 抄佛经 / sutras data from a local CBETA TEI P5 XML archive.
 *
 * Previously fetched from chinese-poetry/chinese-poetry (佛经/ dir, now 404),
 * now reads from the user's local CBETA archive at $CBETA_ROOT.
 *
 * For each target sutra:
 *  1. Locate the matching XML files (multi-juan files matched by glob)
 *  2. Parse + t→s + chunk via cbeta-parser
 *  3. Compute pinyin per char with pinyin-pro
 *  4. UPSERT into the `sutras` table (idempotent)
 *
 * Run with:  pnpm sutras:build
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';
import { parseCbetaXml } from './cbeta-parser';
import { writeSutrasFs, type SutraManifestEntry } from '../lib/sutras-fs';
import type { SutraChunk } from '../lib/sutra-types';

// Local CBETA archive root. Override via env var if needed.
const CBETA_ROOT =
  process.env.CBETA_ROOT ||
  'C:/Users/徐鹏/Downloads/Compressed/bookcase_v099_20260430/Bookcase/CBETA';

const SOURCE_TAG = `cbeta-local:${CBETA_ROOT}`;

interface SlugEntry {
  slug: string;
  title: string;
  cbeta: string; // e.g. T08n0251
  /** For pumen: only the 普门品 section of T09n0262 卷 7 */
  keepMulu?: string;
  /** Specific juan file to load (for pumen, only the 卷 7 file) */
  juanFile?: number;
}

// 11 target sutras (miaofa is dropped — pumen covers the 普门品 sub-section).
// Per user 2026-06-30: no 品 splits, no per-juan splits — every sutra is a
// single chunk. The runtime is graceful when chunkCount === 1, and most 品
// of multi-juan sutras are single-sentence chapters that aren't useful.
const SLUGS: SlugEntry[] = [
  { slug: 'xinjing', title: '心经', cbeta: 'T08n0251' },
  { slug: 'jingang', title: '金刚经', cbeta: 'T08n0235' },
  { slug: 'yaoshi', title: '药师经', cbeta: 'T14n0449' },
  { slug: 'amituo', title: '阿弥陀经', cbeta: 'T12n0366' },
  {
    slug: 'pumen',
    title: '观音菩萨普门品',
    cbeta: 'T09n0262',
    keepMulu: '观世音菩萨普门品',
    juanFile: 7,
  },
  // 普贤行愿品 is the 40th juan of 華嚴經 T10n0293 — pull only that juan.
  { slug: 'puxian', title: '普贤行愿品', cbeta: 'T10n0293', juanFile: 40 },
  { slug: 'lengyan', title: '楞严经', cbeta: 'T19n0945' },
  { slug: 'weimo', title: '维摩诘经', cbeta: 'T14n0475' },
  { slug: 'liuzu', title: '六祖坛经', cbeta: 'T48n2008' },
  { slug: 'dabei', title: '大悲咒', cbeta: 'T20n1060' },
  { slug: 'shishan', title: '十善业道经', cbeta: 'T15n0600' },
];

/**
 * Removed 2026-06-30: the 32 品 split for 金刚经 — single-chunk files
 * now (see flatten-sutras.ts commit); the per-juan chunking for 楞严 / 维摩
 * is also gone. Left as private notes in git history; do not reintroduce
 * without a chunking-purpose reason.
 */

interface RawChunk {
  label: string;
  content: string[];
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    // pinyin-pro: must pass type: 'array' to get an array result;
    // otherwise it returns a single string with spaces between chars.
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

function withPinyin(c: RawChunk) {
  // mysql2 binary protocol mojibakes 4-byte UTF-8 (supp-plane) chars on
  // parameter binding (see memory: mysql2-supp-plane-bug). Drop them at
  // write time so all downstream consumers get clean text. Same for
  // U+FFFD replacement chars and lone surrogate halves, in case the XML
  // parser already normalised them.
  const content = c.content.map(toBmp);
  return {
    label: c.label,
    content,
    pinyin: content.map(linePinyin),
  };
}

function toBmp(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch.length > 1) return false;             // 4-byte UTF-8 (surrogate pair)
      if (code >= 0xD800 && code <= 0xDFFF) return false; // surrogate half
      if (code === 0xFFFD) return false;                  // replacement char
      return true;
    })
    .join('');
}

/**
 * Find the XML files for a given CBETA T-number. Each file matches the pattern
 * T<vol>n<num>_<juan>.xml inside XML/T/T<vol>/.
 *
 * If `juanFile` is given, return only that specific juan. Otherwise return all
 * juan files for that T-number, sorted by juan number ascending.
 */
function findCbetaFiles(cbetaId: string, juanFile?: number): string[] {
  // T08n0251 -> vol=T08, num=0251
  const m = cbetaId.match(/^T(\d{2})n(\d{4,5})$/);
  if (!m) throw new Error(`bad cbeta id: ${cbetaId}`);
  const vol = `T${m[1]}`;
  const num = m[2];
  const dir = join(CBETA_ROOT, 'XML', 'T', vol);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`cannot read ${dir}: ${(err as Error).message}`);
  }
  const prefix = `${vol}n${num}_`;
  const matches = entries
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xml'))
    .map((f) => {
      const juan = parseInt(f.slice(prefix.length, f.length - '.xml'.length), 10);
      return { f, juan };
    })
    .filter((e) => Number.isFinite(e.juan))
    .sort((a, b) => a.juan - b.juan);
  if (matches.length === 0) {
    throw new Error(`no XML files for ${cbetaId} in ${dir}`);
  }
  if (typeof juanFile === 'number') {
    const found = matches.find((e) => e.juan === juanFile);
    if (!found) {
      throw new Error(`no XML file for ${cbetaId} juan ${juanFile} in ${dir}`);
    }
    return [join(dir, found.f)];
  }
  return matches.map((e) => join(dir, e.f));
}

/**
 * Removed 2026-06-30: splitDiamond32 — sutras now emit a single chunk per
 * file. See scripts/flatten-sutras.ts.
 */

export async function buildSutras(): Promise<number> {
  // Quick sanity: bail early if CBETA_ROOT is unreachable
  try {
    statSync(CBETA_ROOT);
  } catch (err) {
    throw new Error(`CBETA_ROOT not reachable: ${CBETA_ROOT} (${(err as Error).message})`);
  }

  const pool = getPool();
  const chunksBySlug: Record<string, SutraChunk[]> = {};
  const manifestItems: SutraManifestEntry[] = [];
  let inserted = 0;
  for (const entry of SLUGS) {
    try {
      const files = findCbetaFiles(entry.cbeta, entry.juanFile);
      console.log(`[build-sutras] ${entry.slug}: ${files.length} file(s) for ${entry.cbeta}`);

      // Always emit a single chunk per sutra. `juanFile` (when set) limits
      // which XML file we load; the first file's paragraphs become the chunk.
      const file = files[0]!;
      const sutra = parseCbetaXml(file, entry.keepMulu ? { keepOnlyMuluLabel: entry.keepMulu } : undefined);
      if (sutra.paragraphs.length === 0) {
        console.warn(`[build-sutras] skip ${entry.slug}: no paragraphs in ${file}`);
        continue;
      }
      const rawChunks: RawChunk[] = [{ label: entry.title, content: sutra.paragraphs }];

      const chunks = rawChunks
        .filter((c) => c.content.length > 0)
        .map(withPinyin);

      if (chunks.length === 0) {
        console.warn(`[build-sutras] skip ${entry.slug}: no chunks after processing`);
        continue;
      }

      await pool.query(
        `INSERT INTO sutras (title, slug, chunks, source) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), chunks = VALUES(chunks), source = VALUES(source)`,
        [entry.title, entry.slug, JSON.stringify(chunks), SOURCE_TAG],
      );
      console.log(
        `[build-sutras] upserted ${entry.slug} (${chunks.length} chunks, ${chunks.reduce((n, c) => n + c.content.length, 0)} paragraphs)`,
      );
      chunksBySlug[entry.slug] = chunks.map((c, i) => ({ ...c, id: i }));
      inserted += 1;
    } catch (err) {
      console.warn(`[build-sutras] skip ${entry.slug}: ${(err as Error).message}`);
    }
  }

  // After all DB upserts complete, read back id+slug+title+(chunkCount, charCount)
  // for the manifest. INSERT...ON DUPLICATE preserves existing ids and assigns
  // new ones for fresh inserts.
  if (inserted > 0) {
    const [idRows] = await pool.query<any[]>(
      `SELECT id, slug, title, chunks FROM sutras WHERE slug IN (${SLUGS.map(() => '?').join(',')})`,
      SLUGS.map((s) => s.slug),
    );
    for (const row of idRows as Array<{ id: number; slug: string; title: string; chunks: string | SutraChunk[] }>) {
      const raw = typeof row.chunks === 'string' ? (JSON.parse(row.chunks) as SutraChunk[]) : row.chunks;
      const chunkCount = raw.length;
      const charCount = raw.reduce(
        (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0),
        0,
      );
      manifestItems.push({
        id: Number(row.id),
        slug: row.slug,
        title: row.title,
        chunkCount,
        charCount,
      });
    }
    const manifest = writeSutrasFs({ items: manifestItems, chunksBySlug });
    console.log(
      `[build-sutras] wrote ${Object.keys(chunksBySlug).length} files + manifest (${manifest.items.length} items) to data/sutras/`,
    );
  }

  return inserted;
}

if (require.main === module) {
  buildSutras()
    .then((n) => {
      console.log(`[build-sutras] done: ${n} sutras upserted`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-sutras] failed:', err);
      process.exit(1);
    });
}
