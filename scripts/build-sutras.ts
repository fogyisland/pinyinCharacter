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
import { join, dirname } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';
import { parseCbetaXml } from './cbeta-parser';

// Local CBETA archive root. Override via env var if needed.
const CBETA_ROOT =
  process.env.CBETA_ROOT ||
  'C:/Users/徐鹏/Downloads/Compressed/bookcase_v099_20260430/Bookcase/CBETA';

const SOURCE_TAG = `cbeta-local:${CBETA_ROOT}`;

interface SlugEntry {
  slug: string;
  title: string;
  cbeta: string; // e.g. T08n0251
  /** Treat each _NNN.xml file as one chunk (multi-juan sutras) */
  perJuan?: boolean;
  /** Manual chunking: diamond32 = 32 品 split for 金刚经 */
  manualChunk?: 'diamond32';
  /** For pumen: only the 普门品 section of T09n0262 卷 7 */
  keepMulu?: string;
  /** Specific juan file to load (for pumen, only the 卷 7 file) */
  juanFile?: number;
}

// 11 target sutras (miaofa is dropped — pumen covers the 普门品 sub-section).
const SLUGS: SlugEntry[] = [
  { slug: 'xinjing', title: '心经', cbeta: 'T08n0251' },
  { slug: 'jingang', title: '金刚经', cbeta: 'T08n0235', manualChunk: 'diamond32' },
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
  { slug: 'lengyan', title: '楞严经', cbeta: 'T19n0945', perJuan: true },
  { slug: 'weimo', title: '维摩诘经', cbeta: 'T14n0475', perJuan: true },
  { slug: 'liuzu', title: '六祖坛经', cbeta: 'T48n2008' },
  { slug: 'dabei', title: '大悲咒', cbeta: 'T20n1060' },
  { slug: 'shishan', title: '十善业道经', cbeta: 'T15n0600' },
];

// 32 品 split for 金刚经 — start markers in document order.
// When the same marker appears multiple times, the next occurrence after the
// previous section's end is used (sequential disambiguation).
const DIAMOND_32_SECTIONS: { label: string; startMarker: string }[] = [
  { label: '法会因由分第一', startMarker: '如是我闻' },
  { label: '善现启请分第二', startMarker: '时长老须菩提' },
  { label: '大乘正宗分第三', startMarker: '佛告须菩提' },
  { label: '妙行无住分第四', startMarker: '菩萨应如是降伏其心' },
  { label: '如理实见分第五', startMarker: '须菩提。于意云何' }, // 1st
  { label: '正信希有分第六', startMarker: '须菩提白佛言' },
  { label: '无得无说分第七', startMarker: '须菩提。于意云何' }, // 2nd
  { label: '依法出生分第八', startMarker: '须菩提。于意云何' }, // 3rd
  { label: '一相无相分第九', startMarker: '须菩提。于意云何' }, // 4th
  { label: '庄严净土分第十', startMarker: '佛告须菩提' }, // 2nd
  { label: '无为福胜分第十一', startMarker: '须菩提。如来悉知悉见' },
  { label: '尊重正教分第十二', startMarker: '须菩提。随说是经' },
  { label: '如法受持分第十三', startMarker: '须菩提。若有人以满无量阿僧祇世界七宝' },
  { label: '离相寂灭分第十四', startMarker: '尔时须菩提' },
  { label: '持经功德分第十五', startMarker: '须菩提。若有善男子善女人' },
  { label: '能净业障分第十六', startMarker: '复次须菩提' },
  { label: '究竟无我分第十七', startMarker: '尔时须菩提' }, // 2nd
  { label: '一体同观分第十八', startMarker: '须菩提。如来有肉眼不' },
  { label: '法界通化分第十九', startMarker: '须菩提。于意云何' }, // 5th
  { label: '离色离相分第二十', startMarker: '须菩提。可以具足色身见不' },
  { label: '非说所说分第二十一', startMarker: '须菩提。汝勿谓如来作是念' },
  { label: '无法可得分第二十二', startMarker: '须菩提白佛言' }, // 2nd (白佛言)
  { label: '净心行善分第二十三', startMarker: '复次须菩提' }, // 2nd
  { label: '福智无比分第二十四', startMarker: '须菩提。若三千大千世界中' },
  { label: '化无所化分第二十五', startMarker: '须菩提。汝等勿谓如来作是念' },
  { label: '法身非相分第二十六', startMarker: '须菩提。汝若作是念' },
  { label: '无断无灭分第二十七', startMarker: '须菩提。若菩萨以满恒河沙等世界七宝' },
  { label: '不受不贪分第二十八', startMarker: '须菩提。若有人受持此经' },
  { label: '威仪寂净分第二十九', startMarker: '须菩提。若有人言如来若来若去若坐若卧' },
  { label: '一合理相分第三十', startMarker: '须菩提。若善男子善女人' }, // 2nd 若善男子女
  { label: '知见不生分第三十一', startMarker: '须菩提。须陀洹能作是念' },
  { label: '应化非真分第三十二', startMarker: '须菩提。可以三十二相见如来不' },
];

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
 * Split a single-juan sutra's paragraphs into the 32 品 sections of the
 * Diamond Sutra, using sequential start-marker disambiguation.
 */
function splitDiamond32(paragraphs: string[]): RawChunk[] {
  if (paragraphs.length === 0) return [];
  // Build a flat list of (sectionIdx, paragraphIdx) by finding the next
  // occurrence of each section's startMarker after the previous section's end.
  const boundaries: number[] = []; // paragraph index where each section starts
  let cursor = 0;
  for (const section of DIAMOND_32_SECTIONS) {
    let found = -1;
    for (let i = cursor; i < paragraphs.length; i++) {
      if (paragraphs[i]!.includes(section.startMarker)) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      // Start marker not found — start at the cursor (rest of text in this section)
      found = cursor;
    }
    boundaries.push(found);
    cursor = found + 1;
  }
  // Build chunks from boundaries. The last section includes any remaining paragraphs.
  const chunks: RawChunk[] = [];
  for (let i = 0; i < DIAMOND_32_SECTIONS.length; i++) {
    const start = boundaries[i]!;
    const end = i + 1 < boundaries.length ? boundaries[i + 1]! : paragraphs.length;
    if (start >= paragraphs.length) {
      // No paragraphs for this section — skip but keep its label
      chunks.push({ label: DIAMOND_32_SECTIONS[i]!.label, content: [] });
      continue;
    }
    const content = paragraphs.slice(start, end);
    chunks.push({ label: DIAMOND_32_SECTIONS[i]!.label, content });
  }
  // Drop trailing empty chunks (where the start marker was never matched)
  while (chunks.length > 0 && chunks[chunks.length - 1]!.content.length === 0) {
    chunks.pop();
  }
  return chunks;
}

export async function buildSutras(): Promise<number> {
  // Quick sanity: bail early if CBETA_ROOT is unreachable
  try {
    statSync(CBETA_ROOT);
  } catch (err) {
    throw new Error(`CBETA_ROOT not reachable: ${CBETA_ROOT} (${(err as Error).message})`);
  }

  const pool = getPool();
  let inserted = 0;
  for (const entry of SLUGS) {
    try {
      const files = findCbetaFiles(entry.cbeta, entry.juanFile);
      console.log(`[build-sutras] ${entry.slug}: ${files.length} file(s) for ${entry.cbeta}`);

      // Collect chunks across all juan files
      const rawChunks: RawChunk[] = [];

      if (entry.perJuan) {
        // Each XML file → one chunk labelled "卷 N"
        for (const file of files) {
          const sutra = parseCbetaXml(file);
          rawChunks.push({
            label: `第 ${sutra.juan} 卷`,
            content: sutra.paragraphs,
          });
        }
      } else {
        // For single-juan or combined: parse first file (juanFile if set)
        // For puxian (T10n0293 has 40 files), use only the first one — the actual sutra
        // is contained in the first juan file (rest are supplementary texts).
        const file = files[0]!;
        const sutra = parseCbetaXml(file, entry.keepMulu ? { keepOnlyMuluLabel: entry.keepMulu } : undefined);
        if (sutra.paragraphs.length === 0) {
          console.warn(`[build-sutras] skip ${entry.slug}: no paragraphs in ${file}`);
          continue;
        }
        if (entry.manualChunk === 'diamond32') {
          const diamond = splitDiamond32(sutra.paragraphs);
          rawChunks.push(...diamond);
        } else {
          // Single chunk with the sutra title as label
          rawChunks.push({ label: entry.title, content: sutra.paragraphs });
        }
      }

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
      inserted += 1;
    } catch (err) {
      console.warn(`[build-sutras] skip ${entry.slug}: ${(err as Error).message}`);
    }
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
