/**
 * Export DB content (chars + char_etymology + char_story + rare_chars) to
 * data/content/<char>.json. One file per char, all content aggregated.
 *
 * This is the reverse of import-content.ts: where import reads JSON → DB,
 * export reads DB → JSON. Together they let the repo carry a complete
 * snapshot of generated content so a fresh `init-db + import` (or
 * `content-sync --from-files`) can bootstrap without burning LLM quota.
 *
 * Modes:
 *   default          Export all chars (overwrites existing JSON).
 *   --missing        Only export chars with NO JSON file in data/content/.
 *   --outdated       Only export chars where JSON file is missing or
 *                    doesn't have all current DB fields.
 *   --char <X>       Only export single char (skips manifest update).
 *   --level <N>      Only export chars at level N (1/2/3).
 *   --dry-run        Report what would change, don't write files.
 *
 * Writes are atomic: tmp file → rename. A partial failure leaves the
 * previous file intact.
 *
 * Run: pnpm tsx scripts/export-content.ts [--missing|--outdated|--char X|--level N|--dry-run]
 */
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { CharContentSchema, ContentManifestSchema } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const MANIFEST_FILE = join(process.cwd(), 'data', 'content-manifest.json');

interface ExportOptions {
  missing?: boolean;
  outdated?: boolean;
  char?: string;
  level?: number;
  dryRun?: boolean;
}

interface ExportStats {
  scanned: number;
  written: number;
  skipped: number;
  byField: Record<string, number>;
  errors: Array<{ char: string; error: string }>;
}

interface CharContentFull {
  char: string;
  pinyin: string;
  level?: number;
  // Legacy top-level fields (kept for 30 hand-written files).
  meaning_zh?: string;
  etymology_story?: string;
  // New nested blocks.
  dict?: {
    meaning_zh?: string;
    meaning_en?: string;
    pinyin_alt?: string[];
    variants?: string[];
  };
  etymology?: {
    story?: string;
    generated_by?: string;
    generated_at?: string;
  };
  rare?: {
    meaning?: string;
    story?: string;
    generated_by?: string;
    generated_at?: string;
  };
  hanzi_story?: string;
  generated_by?: string;
  generated_at?: string;
}

function parseArgs(): ExportOptions {
  const opts: ExportOptions = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--missing') opts.missing = true;
    else if (a === '--outdated') opts.outdated = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--char') opts.char = args[++i];
    else if (a === '--level') opts.level = parseInt(args[++i], 10);
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

function loadExistingJson(char: string): CharContentFull | null {
  const path = join(CONTENT_DIR, `${char}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CharContentFull;
  } catch {
    return null;
  }
}

/**
 * Returns true if the existing JSON file is "outdated" (missing fields that
 * the DB now has). Conservative: only flags outdated if DB has a non-empty
 * value for a field the JSON doesn't have yet.
 */
function isOutdated(existing: CharContentFull | null, fresh: CharContentFull): boolean {
  if (!existing) return true;
  if (fresh.dict?.meaning_zh && !existing.dict?.meaning_zh && !existing.meaning_zh) return true;
  if (fresh.dict?.meaning_en && !existing.dict?.meaning_en) return true;
  if (fresh.dict?.pinyin_alt && !existing.dict?.pinyin_alt) return true;
  if (fresh.dict?.variants && !existing.dict?.variants) return true;
  if (fresh.etymology?.story && !existing.etymology?.story && !existing.etymology_story) return true;
  if (fresh.rare?.meaning && !existing.rare?.meaning) return true;
  if (fresh.rare?.story && !existing.rare?.story) return true;
  return false;
}

function countFields(content: CharContentFull): string[] {
  const present: string[] = [];
  if (content.dict?.meaning_zh || content.meaning_zh) present.push('meaning_zh');
  if (content.dict?.meaning_en) present.push('meaning_en');
  if (content.dict?.pinyin_alt) present.push('pinyin_alt');
  if (content.dict?.variants) present.push('variants');
  if (content.etymology?.story || content.etymology_story) present.push('etymology_story');
  if (content.rare?.meaning) present.push('rare_meaning');
  if (content.rare?.story) present.push('rare_story');
  if (content.hanzi_story) present.push('hanzi_story');
  return present;
}

function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

/**
 * Strip <think>...</think> / <thinking>...</thinking> / <reasoning>...</reasoning>
 * blocks from text content. Belt-and-suspenders for the export path: the
 * real LLM is told to disable thinking (noThinking=true) and llmChat also
 * strips as a safety net, but mock LLM responses bypass the strip and
 * historical DB rows may still contain leaked thinking.
 */
function stripThinking(s: string): string {
  return s
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

export async function exportContent(opts: ExportOptions = {}): Promise<ExportStats> {
  const pool = getPool();
  const stats: ExportStats = {
    scanned: 0,
    written: 0,
    skipped: 0,
    byField: {
      meaning_zh: 0,
      meaning_en: 0,
      pinyin_alt: 0,
      variants: 0,
      etymology_story: 0,
      rare_meaning: 0,
      rare_story: 0,
      hanzi_story: 0,
    },
    errors: [],
  };

  // Build the char → content map from DB.
  const charFilter = opts.char ? `WHERE c.\`char\` = ?` : '';
  const charParams: unknown[] = opts.char ? [opts.char] : [];
  const levelFilter = opts.level ? (opts.char ? 'AND c.level = ?' : 'WHERE c.level = ?') : '';
  const levelParams: unknown[] = opts.level ? [opts.level] : [];

  const [charsRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, meaning_zh, meaning_en, pinyin_alt, variants
     FROM chars c
     ${charFilter} ${levelFilter}
     ORDER BY \`char\``,
    [...charParams, ...levelParams],
  );
  const [etymRows] = await pool.query<any[]>(
    `SELECT \`char\`, story, generated_by, generated_at
     FROM char_etymology
     ${opts.char ? 'WHERE `char` = ?' : ''}`,
    opts.char ? [opts.char] : [],
  );
  const [storyRows] = await pool.query<any[]>(
    `SELECT \`char\`, story, generated_by, generated_at
     FROM char_story
     ${opts.char ? 'WHERE `char` = ?' : ''}`,
    opts.char ? [opts.char] : [],
  );
  const [rareRows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, meaning, story, generated_by, generated_at
     FROM rare_chars
     ${opts.char ? 'WHERE `char` = ?' : ''}`,
    opts.char ? [opts.char] : [],
  );

  const etymByChar = new Map(etymRows.map(r => [r.char, r]));
  const storyByChar = new Map(storyRows.map(r => [r.char, r]));
  const rareByChar = new Map(rareRows.map(r => [r.char, r]));
  const existingFiles = opts.missing || opts.outdated ? listExistingJsonFiles() : new Set<string>();

  // For aggregation manifest counts we need to scan all JSON files too, so
  // we don't accidentally double-count or miss across runs.
  const allByFieldCounts = {
    meaning_zh: 0,
    meaning_en: 0,
    pinyin_alt: 0,
    variants: 0,
    etymology_story: 0,
    rare_meaning: 0,
    rare_story: 0,
    hanzi_story: 0,
  };

  // For --char mode we still want to update the manifest correctly; for
  // that we re-read everything after writing.
  const allCharContents: CharContentFull[] = [];

  for (const row of charsRows) {
    stats.scanned++;
    const char = row.char;
    const etym = etymByChar.get(char);
    const story = storyByChar.get(char);
    const rare = rareByChar.get(char);

    const content: CharContentFull = {
      char,
      pinyin: rare?.pinyin ?? row.pinyin ?? '',
      level: row.level ?? undefined,
    };
    // dict block: only include fields that are non-empty in DB
    const dict: CharContentFull['dict'] = {};
    if (row.meaning_zh) dict.meaning_zh = stripThinking(row.meaning_zh);
    if (row.meaning_en) dict.meaning_en = stripThinking(row.meaning_en);
    if (row.pinyin_alt) {
      try { dict.pinyin_alt = JSON.parse(row.pinyin_alt); }
      catch { /* skip malformed */ }
    }
    if (row.variants) {
      try { dict.variants = JSON.parse(row.variants); }
      catch { /* skip malformed */ }
    }
    if (Object.keys(dict).length > 0) content.dict = dict;

    if (etym?.story) {
      content.etymology = {
        story: stripThinking(etym.story),
        generated_by: etym.generated_by ?? undefined,
        generated_at: etym.generated_at ? new Date(etym.generated_at).toISOString() : undefined,
      };
    }
    if (story?.story) content.hanzi_story = stripThinking(story.story);
    if (rare && (rare.meaning || rare.story)) {
      content.rare = {
        meaning: rare.meaning ? stripThinking(rare.meaning) : undefined,
        story: rare.story ? stripThinking(rare.story) : undefined,
        generated_by: rare.generated_by ?? undefined,
        generated_at: rare.generated_at ? new Date(rare.generated_at).toISOString() : undefined,
      };
    }
    // Provenance at top level = the freshest timestamp across blocks.
    const stamps = [content.etymology?.generated_at, content.rare?.generated_at]
      .filter(Boolean) as string[];
    if (stamps.length > 0) {
      stamps.sort().reverse();
      content.generated_at = stamps[0];
      const byWho = content.etymology?.generated_by ?? content.rare?.generated_by;
      if (byWho) content.generated_by = byWho;
    }

    // Skip chars with no content at all (don't write empty files).
    const fields = countFields(content);
    if (fields.length === 0) {
      stats.skipped++;
      continue;
    }

    // Filter modes
    if (opts.missing && existingFiles.has(char)) {
      stats.skipped++;
      continue;
    }
    if (opts.outdated) {
      const existing = existingFiles.has(char) ? loadExistingJson(char) : null;
      if (!isOutdated(existing, content)) {
        stats.skipped++;
        continue;
      }
    }

    // Validate before writing.
    const validation = CharContentSchema.safeParse(content);
    if (!validation.success) {
      stats.errors.push({ char, error: validation.error.message });
      continue;
    }

    if (opts.dryRun) {
      console.log(`[dry-run] would write ${char}.json (${fields.join(',')})`);
      stats.written++;
      for (const f of fields) {
        if (f in allByFieldCounts) allByFieldCounts[f as keyof typeof allByFieldCounts]++;
      }
      allCharContents.push(validation.data as CharContentFull);
      continue;
    }

    const path = join(CONTENT_DIR, `${char}.json`);
    writeAtomic(path, JSON.stringify(validation.data, null, 2) + '\n');
    stats.written++;
    for (const f of fields) {
      if (f in allByFieldCounts) allByFieldCounts[f as keyof typeof allByFieldCounts]++;
    }
    allCharContents.push(validation.data as CharContentFull);
  }

  // Update manifest unless we're doing a single-char export (manifest is
  // global, not per-char).
  if (!opts.char && !opts.dryRun) {
    // Re-scan all JSON files for accurate global counts.
    const allFiles = listExistingJsonFiles();
    for (const c of allFiles) {
      const j = loadExistingJson(c);
      if (!j) continue;
      for (const f of countFields(j)) {
        if (f in allByFieldCounts) allByFieldCounts[f as keyof typeof allByFieldCounts]++;
      }
    }
    const manifest = {
      version: 1 as const,
      totalChars: 8105 as const,
      byField: allByFieldCounts,
      generatedAt: new Date().toISOString(),
    };
    const validated = ContentManifestSchema.parse(manifest);
    writeAtomic(MANIFEST_FILE, JSON.stringify(validated, null, 2) + '\n');
  }

  return stats;
}

async function main() {
  const opts = parseArgs();
  if (opts.dryRun) console.log('[export] DRY RUN — no files will be written');
  const stats = await exportContent(opts);
  console.log(
    `[export] scanned=${stats.scanned} written=${stats.written} skipped=${stats.skipped} ` +
    `errors=${stats.errors.length}`,
  );
  if (stats.errors.length > 0) {
    for (const e of stats.errors.slice(0, 10)) {
      console.error(`  ${e.char}: ${e.error}`);
    }
  }
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
