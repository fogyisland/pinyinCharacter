/**
 * Sync generated content from DB → data/content/<char>.json.
 *
 * For each char in the DB, this script:
 *   1. Loads existing data/content/<char>.json (if any)
 *   2. Identifies which LLM-generated fields are missing
 *   3. Calls LLM (or mock) to fill missing fields
 *   4. Writes the merged JSON atomically
 *   5. Optionally writes back to DB (--write-db, default on)
 *
 * Modes:
 *   default          Process all chars; fill missing fields; write JSON+DB.
 *   --missing        Skip chars that have ANY data/content/<char>.json file.
 *                    (Use this when bootstrapping new chars that have no JSON.)
 *   --outdated       Skip chars whose JSON has all current DB content fields.
 *   --char <X>       Only process single char.
 *   --level <N>      Only process chars at level N (1/2/3).
 *   --fields <list>  Comma-separated fields to sync (default: all).
 *                    Valid: meaning_zh, meaning_en, pinyin_alt, variants,
 *                           etymology_story, rare_meaning, rare_story.
 *   --mock           Force mock LLM (no API calls).
 *   --dry-run        Report what would happen; don't write files or DB.
 *   --write-db       Also UPDATE the chars/char_etymology/rare_chars rows.
 *                    Default: true.
 *   --no-write-db    Only write JSON, don't touch DB.
 *   --concurrency N  Parallel LLM calls (default 4).
 *
 * Run: pnpm tsx scripts/content-sync.ts [--missing|--outdated|--char X|--level N|--fields f1,f2] [--mock] [--dry-run]
 */
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';
import { getConfig, setConfig } from '../lib/config';
import {
  generateMeaningZh,
  generateMeaningEn,
  generatePinyinAlt,
  generateVariants,
  generateEtymologyStory,
} from '../lib/char-ai';
import { generateRareCharContent } from '../lib/ai-rare-chars';
import { CharContentSchema, ContentManifestSchema } from './schemas/content';
import type { CharContent } from './schemas/content';

/**
 * pinyin-pro fallback for chars where DB pinyin column is empty.
 * Returns the char's pronunciation with tone marks (e.g. "yī").
 * Cached per-script call to avoid repeated computation.
 */
const pinyinCache = new Map<string, string>();
function getPinyinFor(char: string, dbPinyin: string | null): string {
  if (dbPinyin && dbPinyin.trim()) return dbPinyin.trim();
  const cached = pinyinCache.get(char);
  if (cached) return cached;
  const generated = pinyin(char, { toneType: 'symbol' }).trim();
  pinyinCache.set(char, generated);
  return generated;
}

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const MANIFEST_FILE = join(process.cwd(), 'data', 'content-manifest.json');

type FieldName =
  | 'meaning_zh'
  | 'meaning_en'
  | 'pinyin_alt'
  | 'variants'
  | 'etymology_story'
  | 'rare_meaning'
  | 'rare_story';

const ALL_FIELDS: FieldName[] = [
  'meaning_zh',
  'meaning_en',
  'pinyin_alt',
  'variants',
  'etymology_story',
  'rare_meaning',
  'rare_story',
];

interface SyncOptions {
  missing?: boolean;
  outdated?: boolean;
  char?: string;
  level?: number;
  fields?: FieldName[];
  mock?: boolean;
  dryRun?: boolean;
  writeDb?: boolean;
  concurrency?: number;
}

interface CharRow {
  char: string;
  level: number;
  pinyin: string;
  meaning_zh: string | null;
  meaning_en: string | null;
  pinyin_alt: string | null;
  variants: string | null;
}

interface RareRow {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
}

interface EtymRow {
  char: string;
  story: string;
}

function parseArgs(): SyncOptions {
  const opts: SyncOptions = { writeDb: true, concurrency: 4 };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--missing') opts.missing = true;
    else if (a === '--outdated') opts.outdated = true;
    else if (a === '--mock') opts.mock = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--write-db') opts.writeDb = true;
    else if (a === '--no-write-db') opts.writeDb = false;
    else if (a === '--char') opts.char = args[++i];
    else if (a === '--level') opts.level = parseInt(args[++i], 10);
    else if (a === '--fields') {
      const list = args[++i].split(',').map(s => s.trim()) as FieldName[];
      const valid = list.filter(f => ALL_FIELDS.includes(f));
      if (valid.length === 0) throw new Error(`--fields: no valid fields in "${args[i]}"`);
      opts.fields = valid;
    } else if (a === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
  }
  return opts;
}

function listExistingJsonFiles(): Set<string> {
  if (!existsSync(CONTENT_DIR)) return new Set();
  return new Set(
    readdirSync(CONTENT_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, '')),
  );
}

function loadExistingJson(char: string): Partial<CharContent> | null {
  const path = join(CONTENT_DIR, `${char}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function hasField(existing: Partial<CharContent> | null, field: FieldName): boolean {
  if (!existing) return false;
  switch (field) {
    case 'meaning_zh': return !!(existing.meaning_zh || existing.dict?.meaning_zh);
    case 'meaning_en': return !!existing.dict?.meaning_en;
    case 'pinyin_alt': return !!existing.dict?.pinyin_alt;
    case 'variants': return !!existing.dict?.variants;
    case 'etymology_story': return !!(existing.etymology_story || existing.etymology?.story);
    case 'rare_meaning': return !!existing.rare?.meaning;
    case 'rare_story': return !!existing.rare?.story;
  }
}

function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

interface GenerateOneResult {
  char: string;
  generated: FieldName[];
  skipped: FieldName[];
  errors: Array<{ field: FieldName; error: string }>;
}

async function generateForChar(
  charRow: CharRow,
  rareRow: RareRow | null,
  etymRow: EtymRow | null,
  fields: FieldName[],
  existing: Partial<CharContent> | null,
  opts: SyncOptions,
): Promise<GenerateOneResult> {
  const result: GenerateOneResult = { char: charRow.char, generated: [], skipped: [], errors: [] };

  // Run all requested field gens in parallel.
  const tasks = fields.map(async (field) => {
    if (hasField(existing, field)) {
      result.skipped.push(field);
      return;
    }
    try {
      let value: string | string[] | null = null;
      const pinyinStr = getPinyinFor(charRow.char, charRow.pinyin);
      switch (field) {
        case 'meaning_zh':
          value = await generateMeaningZh({ char: charRow.char, pinyin: pinyinStr });
          break;
        case 'meaning_en':
          value = await generateMeaningEn({
            char: charRow.char,
            pinyin: pinyinStr,
            meaningZh: charRow.meaning_zh,
          });
          break;
        case 'pinyin_alt':
          value = await generatePinyinAlt({ char: charRow.char, pinyin: pinyinStr });
          break;
        case 'variants':
          value = await generateVariants({
            char: charRow.char,
            pinyin: pinyinStr,
            meaningZh: charRow.meaning_zh,
          });
          break;
        case 'etymology_story':
          // Only L1/L2 chars typically have etymology. Skip if char is in rare_chars only.
          if (rareRow && !pinyinStr) {
            result.skipped.push(field);
            return;
          }
          value = await generateEtymologyStory({
            char: charRow.char,
            pinyin: pinyinStr,
            meaningZh: charRow.meaning_zh,
          });
          break;
        case 'rare_meaning':
          if (!rareRow) { result.skipped.push(field); return; }
          value = (await generateRareCharContent(
            { char: charRow.char, pinyin: rareRow.pinyin },
            { fields: ['meaning'] },
          )).meaning;
          break;
        case 'rare_story':
          if (!rareRow) { result.skipped.push(field); return; }
          value = (await generateRareCharContent(
            { char: charRow.char, pinyin: rareRow.pinyin },
            { fields: ['story'] },
          )).story;
          break;
      }
      if (value !== null && value !== undefined && value !== '') {
        // Attach to result for the caller to assemble + write.
        (result as any)[field] = value;
        result.generated.push(field);
      } else {
        result.skipped.push(field);
      }
    } catch (err) {
      result.errors.push({ field, error: (err as Error).message });
    }
  });
  await Promise.all(tasks);
  return result;
}

function assembleContent(
  charRow: CharRow,
  existing: Partial<CharContent> | null,
  generated: GenerateOneResult,
  generatedBy: string,
  now: string,
): CharContent {
  const content: CharContent = {
    char: charRow.char,
    pinyin: getPinyinFor(charRow.char, charRow.pinyin),
    level: charRow.level,
  };

  // dict block — merge existing + newly generated.
  const dict: NonNullable<CharContent['dict']> = {
    meaning_zh: (generated as any).meaning_zh ?? existing?.dict?.meaning_zh ?? existing?.meaning_zh,
    meaning_en: (generated as any).meaning_en ?? existing?.dict?.meaning_en,
    pinyin_alt: (generated as any).pinyin_alt ?? existing?.dict?.pinyin_alt,
    variants: (generated as any).variants ?? existing?.dict?.variants,
  };
  const dictClean: NonNullable<CharContent['dict']> = {};
  if (dict.meaning_zh) dictClean.meaning_zh = dict.meaning_zh;
  if (dict.meaning_en) dictClean.meaning_en = dict.meaning_en;
  if (dict.pinyin_alt && dict.pinyin_alt.length > 0) dictClean.pinyin_alt = dict.pinyin_alt;
  if (dict.variants && dict.variants.length > 0) dictClean.variants = dict.variants;
  if (Object.keys(dictClean).length > 0) content.dict = dictClean;

  // etymology block
  const ety = (generated as any).etymology_story;
  if (ety) {
    content.etymology = { story: ety, generated_by: generatedBy, generated_at: now };
  } else if (existing?.etymology?.story) {
    content.etymology = existing.etymology;
  } else if (existing?.etymology_story) {
    content.etymology = { story: existing.etymology_story, generated_by: 'claude-handwritten' };
  }

  // rare block
  const rareMeaning = (generated as any).rare_meaning;
  const rareStory = (generated as any).rare_story;
  if (rareMeaning || rareStory) {
    content.rare = {
      meaning: rareMeaning,
      story: rareStory,
      generated_by: generatedBy,
      generated_at: now,
    };
  } else if (existing?.rare) {
    content.rare = existing.rare;
  }

  // legacy top-level
  if (existing?.hanzi_story) content.hanzi_story = existing.hanzi_story;
  if (existing?.meaning_zh && !content.dict?.meaning_zh) content.meaning_zh = existing.meaning_zh;
  if (existing?.etymology_story && !content.etymology?.story) {
    content.etymology_story = existing.etymology_story;
  }

  content.generated_by = generatedBy;
  content.generated_at = now;
  return content;
}

async function writeBackToDb(
  pool: ReturnType<typeof getPool>,
  char: string,
  content: CharContent,
): Promise<void> {
  if (content.dict?.meaning_zh) {
    await pool.execute(`UPDATE chars SET meaning_zh = ? WHERE \`char\` = ?`, [content.dict.meaning_zh, char]);
  }
  if (content.dict?.meaning_en) {
    await pool.execute(`UPDATE chars SET meaning_en = ? WHERE \`char\` = ?`, [content.dict.meaning_en, char]);
  }
  if (content.dict?.pinyin_alt) {
    await pool.execute(`UPDATE chars SET pinyin_alt = ? WHERE \`char\` = ?`, [JSON.stringify(content.dict.pinyin_alt), char]);
  }
  if (content.dict?.variants) {
    await pool.execute(`UPDATE chars SET variants = ? WHERE \`char\` = ?`, [JSON.stringify(content.dict.variants), char]);
  }
  if (content.etymology?.story) {
    await pool.execute(
      `INSERT INTO char_etymology (\`char\`, story, generated_by, generated_at) VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE story=VALUES(story), generated_by=VALUES(generated_by), generated_at=NOW()`,
      [char, content.etymology.story, content.generated_by ?? 'content-sync'],
    );
  }
  if (content.rare?.meaning || content.rare?.story) {
    await pool.execute(
      `UPDATE rare_chars SET meaning = COALESCE(NULLIF(?, ''), meaning), story = COALESCE(NULLIF(?, ''), story), generated_by = ?, generated_at = NOW() WHERE \`char\` = ?`,
      [content.rare.meaning ?? '', content.rare.story ?? '', content.generated_by ?? 'content-sync', char],
    );
  }
}

export interface SyncStats {
  scanned: number;
  generated: number;
  skipped: number;
  errors: number;
  byField: Record<FieldName, number>;
}

export async function contentSync(opts: SyncOptions = {}): Promise<SyncStats> {
  const pool = getPool();
  const fields = opts.fields ?? ALL_FIELDS;
  const concurrency = opts.concurrency ?? 4;

  // Force mock mode if --mock, or if ai.mock_mode is already on.
  if (opts.mock) {
    await setConfig('ai.mock_mode', 'true', null);
  }
  const mockMode = await getConfig('ai.mock_mode');
  const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';

  const stats: SyncStats = {
    scanned: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    byField: {
      meaning_zh: 0,
      meaning_en: 0,
      pinyin_alt: 0,
      variants: 0,
      etymology_story: 0,
      rare_meaning: 0,
      rare_story: 0,
    },
  };

  // Build char filter
  const charFilter = opts.char ? 'WHERE c.`char` = ?' : '';
  const charParams: unknown[] = opts.char ? [opts.char] : [];
  const levelFilter = opts.level ? (opts.char ? 'AND c.level = ?' : 'WHERE c.level = ?') : '';
  const levelParams: unknown[] = opts.level ? [opts.level] : [];

  const [chars] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, meaning_zh, meaning_en, pinyin_alt, variants FROM chars c
     ${charFilter} ${levelFilter}
     ORDER BY \`char\``,
    [...charParams, ...levelParams],
  );
  const charRows: CharRow[] = chars;
  if (charRows.length === 0) {
    console.log('[sync] no chars match filter');
    return stats;
  }

  const charList = charRows.map(r => r.char);
  const placeholders = charList.map(() => '?').join(',');
  const [rareRows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, meaning, story FROM rare_chars WHERE \`char\` IN (${placeholders})`,
    charList,
  );
  const [etymRows] = await pool.query<any[]>(
    `SELECT \`char\`, story FROM char_etymology WHERE \`char\` IN (${placeholders})`,
    charList,
  );
  const rareByChar = new Map<string, RareRow>(rareRows.map(r => [r.char, r]));
  const etymByChar = new Map<string, EtymRow>(etymRows.map(r => [r.char, r]));
  const existingFiles = opts.missing || opts.outdated ? listExistingJsonFiles() : new Set<string>();

  // Process with limited concurrency.
  const queue = [...charRows];
  const generatedBy = mockMode === 'true' ? 'mock-llm' : model;
  const now = new Date().toISOString();

  async function worker() {
    while (queue.length > 0) {
      const charRow = queue.shift();
      if (!charRow) break;
      stats.scanned++;
      // Skip malformed entries (e.g. multi-char rows from a bad import).
      if ([...charRow.char].length !== 1) {
        stats.skipped++;
        continue;
      }
      const rareRow = rareByChar.get(charRow.char) ?? null;
      const etymRow = etymByChar.get(charRow.char) ?? null;
      const existing = loadExistingJson(charRow.char);

      if (opts.missing && existingFiles.has(charRow.char)) {
        stats.skipped++;
        continue;
      }
      if (opts.outdated) {
        const allPresent = fields.every(f => hasField(existing, f));
        if (allPresent) {
          stats.skipped++;
          continue;
        }
      }

      const result = await generateForChar(charRow, rareRow, etymRow, fields, existing, opts);

      // Only assemble + write if anything was generated.
      if (result.generated.length === 0) {
        stats.skipped++;
        // Still record errors
        stats.errors += result.errors.length;
        for (const e of result.errors.slice(0, 3)) {
          console.error(`  ${charRow.char}/${e.field}: ${e.error}`);
        }
        continue;
      }

      const content = assembleContent(charRow, existing, result, generatedBy, now);

      if (opts.dryRun) {
        console.log(`[dry-run] ${charRow.char}: would write ${result.generated.join(',')}`);
        stats.generated++;
        for (const f of result.generated) stats.byField[f]++;
        continue;
      }

      // Validate
      const validation = CharContentSchema.safeParse(content);
      if (!validation.success) {
        stats.errors++;
        console.error(`[sync] ${charRow.char} validation: ${validation.error.message}`);
        continue;
      }

      const path = join(CONTENT_DIR, `${charRow.char}.json`);
      writeAtomic(path, JSON.stringify(validation.data, null, 2) + '\n');
      stats.generated++;
      for (const f of result.generated) stats.byField[f]++;

      if (opts.writeDb) {
        try {
          await writeBackToDb(pool, charRow.char, validation.data as CharContent);
        } catch (e) {
          console.error(`[sync] ${charRow.char} DB write: ${(e as Error).message}`);
          stats.errors++;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Update manifest unless --char or --dry-run
  if (!opts.char && !opts.dryRun) {
    const allFiles = listExistingJsonFiles();
    const byFieldCounts = {
      meaning_zh: 0,
      meaning_en: 0,
      pinyin_alt: 0,
      variants: 0,
      etymology_story: 0,
      hanzi_story: 0,
      rare_meaning: 0,
      rare_story: 0,
    };
    for (const c of allFiles) {
      const j = loadExistingJson(c);
      if (!j) continue;
      if (j.meaning_zh || j.dict?.meaning_zh) byFieldCounts.meaning_zh++;
      if (j.dict?.meaning_en) byFieldCounts.meaning_en++;
      if (j.dict?.pinyin_alt) byFieldCounts.pinyin_alt++;
      if (j.dict?.variants) byFieldCounts.variants++;
      if (j.etymology_story || j.etymology?.story) byFieldCounts.etymology_story++;
      if (j.hanzi_story) byFieldCounts.hanzi_story++;
      if (j.rare?.meaning) byFieldCounts.rare_meaning++;
      if (j.rare?.story) byFieldCounts.rare_story++;
    }
    const manifest = {
      version: 1 as const,
      totalChars: 8105 as const,
      byField: byFieldCounts,
      generatedAt: new Date().toISOString(),
    };
    const validated = ContentManifestSchema.parse(manifest);
    writeAtomic(MANIFEST_FILE, JSON.stringify(validated, null, 2) + '\n');
  }

  return stats;
}

async function main() {
  const opts = parseArgs();
  if (opts.dryRun) console.log('[sync] DRY RUN — no files or DB will be touched');
  if (opts.mock) console.log('[sync] mock mode forced');
  const t0 = Date.now();
  const stats = await contentSync(opts);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[sync] scanned=${stats.scanned} generated=${stats.generated} skipped=${stats.skipped} ` +
    `errors=${stats.errors} time=${dt}s`,
  );
  console.log(`[sync] byField: ${JSON.stringify(stats.byField)}`);
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
