/**
 * Pre-bundles hanzi-writer stroke data for the 8105 dict chars.
 * Output: public/strokes/{char}.json (static files served by Next.js)
 *         data/strokes-manifest.json (build verification)
 *
 * Coverage: hanzi-writer-data covers ~87% of our 8105 chars (~6866/7909 BMP).
 * The 1239 missing are mostly rare/old forms not in the upstream library;
 * StrokeOrderCard gracefully hides itself for those chars.
 *
 * Modes:
 *   default          Process all chars from data/general-standard-chinese-characters.json.
 *   --missing        Only process chars that don't have a JSON file in public/strokes/.
 *                    Use this for incremental builds when only a few new chars
 *                    were added (e.g. after `pnpm tsx scripts/import-chars.ts`).
 *   --from-db        Read char list from chars table (DB) instead of standard list.
 *                    Combine with --missing to add strokes for new DB chars.
 *   --char <X>       Only process single char.
 *   --level <N>      (--from-db only) Only process chars at level N.
 *   --dry-run        Report what would happen; don't write files.
 *   --no-manifest    Skip writing the manifest file (faster for single-char runs).
 *
 * Examples:
 *   pnpm strokes:build                              # full 8105 (~10-15 min)
 *   pnpm strokes:build --missing                    # only chars without strokes
 *   pnpm strokes:build --from-db --missing          # new DB chars missing strokes
 *   pnpm strokes:build --char 龘                     # single char
 *   pnpm strokes:build --from-db --level 1 --missing  # new L1 chars
 *
 * Run: pnpm tsx scripts/build-strokes.ts [flags]
 */
import pLimit from 'p-limit';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { getPool, closePool } from '../lib/db';

const CHARS_FILE = 'data/general-standard-chinese-characters.json';
const OUTPUT_DIR = 'public/strokes';
const MANIFEST_FILE = 'data/strokes-manifest.json';

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/',
  'https://unpkg.com/hanzi-writer-data@latest/',
  'https://raw.githubusercontent.com/chanind/hanzi-writer-data/master/data/',
] as const;

const CONCURRENCY = 8;

export interface BuildStrokesOptions {
  fetchImpl?: typeof fetch;
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
  readdir?: typeof readdir;
  // CLI flags
  missing?: boolean;
  fromDb?: boolean;
  char?: string;
  level?: number;
  dryRun?: boolean;
  noManifest?: boolean;
}

export interface BuildStrokesResult {
  supported: string[];
  missing: string[];
  skipped: number;
  considered: number;
}

async function tryFetch(char: string, fetchImpl: typeof fetch): Promise<string | null> {
  for (const base of SOURCES) {
    try {
      const r = await fetchImpl(`${base}${char}.json`);
      if (r.ok) return await r.text();
    } catch {
      // try next source
    }
  }
  return null;
}

async function listExistingStrokes(
  readdirImpl: typeof readdir,
  outputDir: string,
): Promise<Set<string>> {
  if (!existsSync(outputDir)) return new Set();
  const files = await readdirImpl(outputDir);
  return new Set(
    files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, '')),
  );
}

async function loadCharList(options: BuildStrokesOptions): Promise<string[]> {
  if (options.char) return [options.char];
  if (options.fromDb) {
    const pool = getPool();
    const levelFilter = options.level ? 'WHERE level = ?' : '';
    const params: unknown[] = options.level ? [options.level] : [];
    const [rows] = await pool.query<any[]>(
      `SELECT \`char\` FROM chars ${levelFilter} ORDER BY \`char\``,
      params,
    );
    return rows.map(r => r.char);
  }
  const charsJson = await readFile(CHARS_FILE, 'utf-8');
  return JSON.parse(charsJson) as string[];
}

export async function buildStrokes(
  options: BuildStrokesOptions = {},
): Promise<BuildStrokesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readFileImpl = options.readFile ?? readFile;
  const writeFileImpl = options.writeFile ?? writeFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const readdirImpl = options.readdir ?? readdir;

  const chars = await loadCharList(options);

  if (options.fromDb) {
    await mkdirImpl(OUTPUT_DIR, { recursive: true });
  } else {
    await mkdirImpl(OUTPUT_DIR, { recursive: true });
  }

  // --missing: filter to only chars without existing JSON
  let toProcess = chars;
  let skipped = 0;
  if (options.missing) {
    const existing = await listExistingStrokes(readdirImpl, OUTPUT_DIR);
    toProcess = chars.filter(c => !existing.has(c));
    skipped = chars.length - toProcess.length;
  }

  if (toProcess.length === 0) {
    console.log(`[strokes] nothing to process (${skipped} already exist)`);
    return { supported: [], missing: [], skipped, considered: chars.length };
  }

  const limit = pLimit(CONCURRENCY);
  const supported: string[] = [];
  const missing: string[] = [];

  await Promise.all(
    toProcess.map((c) =>
      limit(async () => {
        const txt = await tryFetch(c, fetchImpl);
        if (txt !== null) {
          if (!options.dryRun) {
            await writeFileImpl(`${OUTPUT_DIR}/${c}.json`, txt, 'utf-8');
          }
          supported.push(c);
        } else {
          missing.push(c);
        }
      }),
    ),
  );

  if (!options.noManifest && !options.char) {
    const existing = await listExistingStrokes(readdirImpl, OUTPUT_DIR);
    const allSupported = new Set([...existing, ...supported]);
    const manifest = {
      version: '1',
      source: 'hanzi-writer-data',
      totalChars: chars.length,
      supported: [...allSupported].sort(),
      missing: missing.sort(),
    };
    if (!options.dryRun) {
      await writeFileImpl(MANIFEST_FILE, JSON.stringify(manifest), 'utf-8');
    }
  }

  return { supported, missing, skipped, considered: chars.length };
}

function parseArgs(): BuildStrokesOptions {
  const opts: BuildStrokesOptions = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--missing') opts.missing = true;
    else if (a === '--from-db') opts.fromDb = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-manifest') opts.noManifest = true;
    else if (a === '--char') opts.char = args[++i];
    else if (a === '--level') opts.level = parseInt(args[++i], 10);
  }
  return opts;
}

// CLI entry
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs();
  if (opts.dryRun) console.log('[strokes] DRY RUN — no files will be written');
  buildStrokes(opts)
    .then(async ({ supported, missing, skipped, considered }) => {
      const verb = opts.dryRun ? 'would write' : 'wrote';
      console.log(
        `[strokes] considered=${considered} ` +
        `${verb}=${supported.length} missing=${missing.length} skipped=${skipped}`,
      );
      if (supported.length > 0 && supported.length <= 20) {
        console.log(`  supported: ${supported.join(' ')}`);
      }
      if (missing.length > 0 && missing.length <= 20) {
        console.log(`  missing: ${missing.join(' ')}`);
      }
      if (!opts.noManifest && !opts.char) {
        console.log(`Manifest: ${MANIFEST_FILE}`);
      }
      // sanity check (only for full builds, not --missing or --char)
      if (!opts.missing && !opts.char) {
        const total = supported.length + missing.length;
        const missingPct = total > 0 ? (missing.length / total) * 100 : 0;
        if (missingPct > 25) {
          console.error(`FATAL: >25% missing. Likely CDN connectivity issue.`);
          await closePool();
          process.exit(1);
        }
      }
      await closePool();
    })
    .catch(async (err) => {
      console.error('build-strokes failed:', err);
      await closePool();
      process.exit(1);
    });
}
