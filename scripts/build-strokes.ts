/**
 * Pre-bundles hanzi-writer stroke data for our 8105 dict chars.
 * Output: public/strokes/{char}.json (static files served by Next.js)
 *         data/strokes-manifest.json (build verification)
 *
 * Run: pnpm strokes:build (~5-10 min for full 8105)
 */
import pLimit from 'p-limit';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';

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
}

export interface BuildStrokesResult {
  supported: string[];
  missing: string[];
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

export async function buildStrokes(
  options: BuildStrokesOptions = {},
): Promise<BuildStrokesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readFileImpl = options.readFile ?? readFile;
  const writeFileImpl = options.writeFile ?? writeFile;
  const mkdirImpl = options.mkdir ?? mkdir;

  const charsJson = await readFileImpl(CHARS_FILE, 'utf-8');
  const chars: string[] = JSON.parse(charsJson);

  await mkdirImpl(OUTPUT_DIR, { recursive: true });

  const limit = pLimit(CONCURRENCY);
  const supported: string[] = [];
  const missing: string[] = [];

  await Promise.all(
    chars.map((c) =>
      limit(async () => {
        const txt = await tryFetch(c, fetchImpl);
        if (txt !== null) {
          await writeFileImpl(`${OUTPUT_DIR}/${c}.json`, txt, 'utf-8');
          supported.push(c);
        } else {
          missing.push(c);
        }
      }),
    ),
  );

  const manifest = {
    version: '1',
    source: 'hanzi-writer-data',
    totalChars: chars.length,
    supported,
    missing,
  };
  await writeFileImpl(
    MANIFEST_FILE,
    JSON.stringify(manifest),
    'utf-8',
  );

  return { supported, missing };
}

// CLI entry
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  buildStrokes()
    .then(({ supported, missing }) => {
      const total = supported.length + missing.length;
      const missingPct = total > 0 ? (missing.length / total) * 100 : 0;
      console.log(`✓ ${supported.length} stroke files written`);
      console.log(`✗ ${missing.length} missing (${missingPct.toFixed(1)}%)`);
      console.log(`Manifest: ${MANIFEST_FILE}`);
      if (missingPct > 5) {
        console.error(`FATAL: >5% missing. Check CDN connectivity.`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('build-strokes failed:', err);
      process.exit(1);
    });
}
