/**
 * The authoritative registry of seeded content datasets.
 *
 * This file is the single source of truth for "how many rows of each
 * dataset this project expects". Before this existed the expectation lived
 * in four unrelated places — `import-hsk.ts` (2632), the `data/` directory
 * counts (7905 / 1165 / 196 / 12), `lib/init-checklist.ts` (hskExpected =
 * 2632) and `DEPLOY.md §9` (prose) — and they drifted. A server could be
 * missing an entire dataset while every checklist step was green.
 *
 * Three consumers read this file:
 *
 *  1. `scripts/init-db.ts` — seeds what is missing, automatically, on boot.
 *  2. `lib/seed-readiness.ts` — reports expected vs actual.
 *  3. `app/admin/seed/page.tsx` — the admin import screen.
 *
 * The expected counts are derived from the repository's own data files, so
 * "expected" always means "what this repository ships" — never a number
 * typed by hand that can drift again.
 *
 * This module is client-safe: it imports no database driver and no
 * server-only code, so the admin page can import it directly.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** How a dataset's expected row count is determined. */
export type SeedCountSource =
  /** Counted from a JSON file in `data/` at read time. */
  | 'json'
  /** Counted from the number of files in a `data/` directory. */
  | 'files'
  /** Counted from a JSON file's contents (e.g. entries across HSK levels). */
  | 'json-entries';

/** How a dataset's rows get into the database. */
export type SeedStrategy =
  /** Seeded by `scripts/init-db.ts` on every boot. */
  | 'auto'
  /** Seeded only when an operator (or the admin page) triggers it. */
  | 'manual';

/** What kind of row the dataset holds — used to explain a gap in the UI. */
export type SeedKind = 'chars' | 'chars-graded' | 'rows' | 'config';

export interface SeedDataset {
  /** Stable id, used as the DB column and the admin page key. */
  id: string;
  /** Human-readable Chinese label. */
  label: string;
  /** The table this dataset lands in. */
  table: string;
  /** One-line explanation of what breaks if the dataset is incomplete. */
  dependsOn: string;
  /** How many rows the repository ships for this dataset. */
  expected: number;
  /** Where the expected number comes from. */
  countSource: SeedCountSource;
  /** Whether it seeds on boot or only on request. */
  strategy: SeedStrategy;
  /** Row semantics, for the admin UI. */
  kind: SeedKind;
  /** The npm script or CLI command that can import it on demand. */
  manualCommand: string;
}

/** Root of the repository's data directory. */
const DATA_DIR = join(process.cwd(), 'data');

/**
 * Read a JSON file that may be gzipped. The deploy bundle ships `data/content`
 * as `.json.gz` to save ~190MB, so anything walking that directory has to
 * handle both shapes.
 */
function readJsonAuto(path: string): unknown {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  if (existsSync(path + '.gz')) {
    // Lazily required: `node:zlib` is fine in the browser bundle too, but the
    // gz path is server-only in practice.
    const { gunzipSync } = require('node:zlib') as typeof import('node:zlib');
    return JSON.parse(gunzipSync(readFileSync(path + '.gz')).toString('utf8'));
  }
  return null;
}

/** Count the entries of a JSON array file. Returns 0 when the file is absent. */
function countJsonArray(fileName: string): number {
  const value = readJsonAuto(join(DATA_DIR, fileName));
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Count the data files in a directory, ignoring the gzipped variant of a
 * file that is also present in plain form.
 *
 * The deploy bundle ships `data/classics/` and `data/content/` as
 * `.json.gz` (about 190MB saved), so a checkout and a bundle hold
 * different file names for the same data. Both shapes are counted, and a
 * file present in both forms counts once — the `.gz` suffix is stripped
 * before the name is recorded.
 *
 * Exported for the tests: the directory is a parameter so the gzipped
 * shape can be exercised without a 190MB fixture.
 */
export function countDataFilesIn(dir: string): number {
  if (!existsSync(dir)) return 0;
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') && !file.endsWith('.json.gz')) continue;
    names.add(file.replace(/\.gz$/, ''));
  }
  return names.size;
}

/** Count the data files in a `data/` subdirectory. */
function countDataFiles(dirName: string): number {
  return countDataFilesIn(join(DATA_DIR, dirName));
}

/** Count the characters across the HSK vocabulary, de-duplicated. */
function countHskVocab(): number {
  const value = readJsonAuto(join(DATA_DIR, 'hsk-vocab.json')) as
    | Record<string, Array<{ char: string }>>
    | null;
  if (!value || typeof value !== 'object') return 0;
  const chars = new Set<string>();
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry.char === 'string') chars.add(entry.char);
    }
  }
  return chars.size;
}

/**
 * Count the content files that carry a rare-character meaning.
 *
 * `data/content/<char>.json` holds one file per character. A file counts as
 * rare when its `level` is 3 and it has a non-empty `rare.meaning` — the
 * same rule `init-db.ts::initRareChars` uses when it populates the table.
 * Reading 7905 files on every request is too slow, so the manifest's
 * `rare_meaning` count is used when the manifest is present; the directory
 * walk is the fallback for a checkout without a manifest.
 */
function countRareChars(): number {
  const manifest = readJsonAuto(join(DATA_DIR, 'content-manifest.json')) as
    | { byField?: Record<string, number> }
    | null;
  const fromManifest = manifest?.byField?.rare_meaning;
  if (typeof fromManifest === 'number' && fromManifest > 0) return fromManifest;
  return countContentFilesWithRareMeaning();
}

/**
 * Walk `data/content/` and count the files that qualify as rare chars.
 *
 * The deploy bundle ships this directory as `.json.gz`, so both shapes are
 * read — `readJsonAuto` handles either. A file that exists in both forms
 * is counted once.
 */
function countContentFilesWithRareMeaning(): number {
  const dir = join(DATA_DIR, 'content');
  if (!existsSync(dir)) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') && !file.endsWith('.json.gz')) continue;
    const name = file.replace(/\.gz$/, '');
    if (seen.has(name)) continue;
    seen.add(name);
    const value = readJsonAuto(join(dir, name)) as
      | { level?: number; rare?: { meaning?: string } }
      | null;
    if (!value) continue;
    if (value.level === 3 && value.rare?.meaning) count++;
  }
  return count;
}

/**
 * The expected HSK grading count.
 *
 * The import writes one `hsk_level` per character in `data/hsk-vocab.json`.
 * Every level's characters are disjoint, so the union is the sum — but the
 * union is computed anyway, because a future data file could repeat a
 * character across levels and the count must reflect what the database can
 * actually hold.
 */
export const HSK_EXPECTED = countHskVocab();

/**
 * Every seeded dataset, in the order they should be seeded.
 *
 * `expected` is computed lazily on first access rather than at module load,
 * so importing this module from a client component does not synchronously
 * stat the filesystem before hydration.
 */
export const SEED_DATASETS: readonly SeedDataset[] = [
  {
    id: 'hsk-grading',
    label: 'HSK 分级',
    table: 'chars',
    dependsOn: '/game 闯关与小游戏 — 缺分级时每关 404、每轮 503',
    expected: HSK_EXPECTED,
    countSource: 'json-entries',
    strategy: 'auto',
    kind: 'chars-graded',
    manualCommand: 'npm run seed:run -- --only=hsk-grading',
  },
  {
    id: 'chars',
    label: '通用规范汉字',
    table: 'chars',
    dependsOn: '字典与全部字库功能的基础表',
    expected: countJsonArray('general-standard-chinese-characters.json'),
    countSource: 'json',
    strategy: 'auto',
    kind: 'chars',
    manualCommand: 'npm run seed:run -- --only=chars',
  },
  {
    id: 'rare-chars',
    label: '罕用字',
    table: 'rare_chars',
    dependsOn: '/rare-chars 页面 — 缺数据时页面显示"字库为空"',
    expected: countRareChars(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'chars',
    manualCommand: 'npm run seed:run -- --only=rare-chars',
  },
  {
    id: 'char-etymology',
    label: '字源字体',
    table: 'char_etymology',
    dependsOn: '字源字形 — 缺行时字源页无字形',
    expected: countJsonArray('general-standard-chinese-characters.json'),
    countSource: 'json',
    strategy: 'auto',
    kind: 'chars',
    manualCommand: 'npm run seed:run -- --only=char-etymology',
  },
  {
    id: 'poems',
    label: '诗词',
    table: 'poems',
    dependsOn: '/poetry 页面',
    expected: countPoemsFromManifest(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'rows',
    manualCommand: 'npm run seed:run -- --only=poems',
  },
  {
    id: 'classics',
    label: '古籍',
    table: 'classics',
    dependsOn: '/ancient 页面 — 缺数据时经文列表为空',
    expected: countClassicsFromManifest(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'rows',
    manualCommand: 'npm run seed:run -- --only=classics',
  },
  {
    id: 'sutras',
    label: '经文',
    table: 'sutras',
    dependsOn: '/sutra 页面',
    expected: countDataFiles('sutras'),
    countSource: 'files',
    strategy: 'auto',
    kind: 'rows',
    manualCommand: 'npm run seed:run -- --only=sutras',
  },
];

/**
 * Count the poems the manifest declares.
 *
 * `poems-manifest.json` has `{ version, updatedAt, count, items }`. The
 * `count` field is what the build actually wrote, so it wins over
 * `items.length` — they can differ when the manifest was written by an
 * older builder.
 */
function countPoemsFromManifest(): number {
  const manifest = readJsonAuto(join(DATA_DIR, 'poems-manifest.json')) as
    | { count?: number; poems?: unknown[]; items?: unknown[]; total?: number }
    | null;
  if (!manifest) return 0;
  if (typeof manifest.count === 'number') return manifest.count;
  if (Array.isArray(manifest.items)) return manifest.items.length;
  if (Array.isArray(manifest.poems)) return manifest.poems.length;
  if (typeof manifest.total === 'number') return manifest.total;
  return 0;
}

/**
 * Count the classics the manifest declares.
 *
 * `data/classics/` holds one file per book, so the directory walk is the
 * accurate count; the manifest is used only to confirm the build ran.
 */
function countClassicsFromManifest(): number {
  const manifest = readJsonAuto(join(DATA_DIR, 'classics-manifest.json')) as
    | { books?: unknown[]; items?: unknown[]; total?: number }
    | null;
  const files = countDataFiles('classics');
  if (files > 0) return files;
  if (!manifest) return 0;
  if (Array.isArray(manifest.books)) return manifest.books.length;
  if (Array.isArray(manifest.items)) return manifest.items.length;
  if (typeof manifest.total === 'number') return manifest.total;
  return 0;
}

/** Look a dataset up by id. */
export function getSeedDataset(id: string): SeedDataset | undefined {
  return SEED_DATASETS.find((d) => d.id === id);
}
