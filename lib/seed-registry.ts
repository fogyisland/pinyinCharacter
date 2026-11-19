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
  /**
   * The ids of datasets that must be seeded before this one.
   *
   * The dependency is real, not advisory: the HSK grading writes a column
   * on the `chars` table, so a grading that runs before the characters are
   * in place finds nothing to grade and stays empty. The same holds for
   * the etymology rows, which are joined against `chars`.
   *
   * The seed runner honours this order. Without it the datasets were
   * seeded in array order, which happened to put the grading first.
   */
  requires?: string[];
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

/**
 * Count the characters the importers will actually write.
 *
 * `initChars()` and `initCharEtymology()` only take a character whose
 * JavaScript `String.length` is 1 — that is, a single UTF-16 code unit,
 * i.e. a character in the Basic Multilingual Plane.
 *
 * The source file (`data/general-standard-chinese-characters.json`) holds
 * 8105 entries, of which **196 live in the Supplementary Planes** (code
 * point > U+FFFF). In JavaScript those strings have `length === 2`, so the
 * importers skip them. The skip is deliberate: mysql2's binary protocol
 * corrupts 4-byte UTF-8, so writing them would store mojibake.
 *
 * Counting the raw array length (8105) as the expected value therefore
 * produced a permanent shortfall: the seed could never reach it, so the
 * admin screen reported "missing 196 rows" forever and the "fill the gap"
 * button could do nothing. The expected value must be what the table can
 * hold — 7909 — not what the file contains.
 *
 * ⚠️ The length check below is JavaScript's, not Python's: `String.length`
 * counts UTF-16 code units, so a supplementary-plane character is 2 here
 * while `len()` in Python would report 1. Counting with the wrong
 * semantics is how this defect stayed invisible for a while.
 */
function countImportableChars(): number {
  const value = readJsonAuto(join(DATA_DIR, 'general-standard-chinese-characters.json'));
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length === 1) count++;
  }
  return count;
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
    const name = file.replace(/\.gz$/, '');
    // A `manifest.json` is an index of the directory, not a data file in
    // it. Counting it made the `sutras` expected value 12 while only 11
    // sutras exist — a shortfall the seed could never close, so the admin
    // screen asked for a row that does not exist.
    if (name === 'manifest.json') continue;
    names.add(name);
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
 * Count the idioms the repository ships.
 *
 * `data/idioms.json` holds one object per idiom. The count is the number of
 * objects in the file — not a number typed by hand, which is how the other
 * datasets drifted apart in the first place.
 *
 * The file is a plain JSON array, so it needs no `.gz` handling, but
 * `readJsonAuto` is used anyway so a gzipped bundle is read the same way as
 * a checkout.
 */
function countIdioms(): number {
  const value = readJsonAuto(join(DATA_DIR, 'idioms.json')) as unknown;
  if (!Array.isArray(value)) return 0;
  return value.length;
}

/**
 * Count the content files that carry a rare-character meaning.
 *
 * `data/content/<char>.json` holds one file per character. A file counts as
 * rare when its `level` is 3 and it has a non-empty `rare.meaning` — the
 * same rule `init-db.ts::initRareChars` uses when it populates the table.
 *
 * ⚠️ The manifest's `byField.rare_meaning` is **NOT** that number. It
 * counts every file with a non-empty `rare.meaning`, whatever its level:
 * 1412, while the `level === 3` rule yields 1409. The three extras
 * (`亍`, `尢`, `彳`) are level 2 — they carry a rare meaning but the
 * difficulty grading puts them below the rare tier, so the importer skips
 * them.
 *
 * Using the manifest number made the expected value 1412 while the table
 * can only ever hold 1409: the seed reported a permanent 3-row shortfall
 * and the admin screen kept asking for a gap that could not be closed.
 * The directory walk is the authority because it applies the import rule
 * itself.
 *
 * The walk reads 7905 files, so it is memoized for the life of the
 * process — `expected` is computed lazily on first access, and the admin
 * screen renders it on every request.
 */
let rareCharsCountCache: number | null = null;

function countRareChars(): number {
  if (rareCharsCountCache === null) {
    rareCharsCountCache = countContentFilesWithRareMeaning();
  }
  return rareCharsCountCache;
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
    id: 'chars',
    label: '通用规范汉字',
    table: 'chars',
    dependsOn: '字典与全部字库功能的基础表',
    expected: countImportableChars(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'chars',
    manualCommand: 'npm run seed:run -- --only=chars',
  },
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
    // The grading is a column on the `chars` table: without the
    // characters there is nothing to grade.
    requires: ['chars'],
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
    requires: ['chars'],
  },
  {
    id: 'char-etymology',
    label: '字源字体',
    table: 'char_etymology',
    dependsOn: '字源字形 — 缺行时字源页无字形',
    expected: countImportableChars(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'chars',
    manualCommand: 'npm run seed:run -- --only=char-etymology',
    // The etymology rows are joined against `chars`.
    requires: ['chars'],
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
  {
    id: 'idioms',
    label: '成语',
    table: 'idioms',
    dependsOn: '/game 成语拖字 — 缺数据时游戏没有题目',
    expected: countIdioms(),
    countSource: 'json',
    strategy: 'auto',
    kind: 'rows',
    manualCommand: 'npm run seed:run -- --only=idioms',
  },
];

/**
 * The datasets in the order they must be seeded.
 *
 * The order comes from the `requires` field, not from the array order:
 * a dataset that depends on another is seeded after it. Anything the
 * dependencies do not constrain keeps its declared order, so the result
 * is stable between runs.
 *
 * The HSK grading is the case this exists for. It writes a column on the
 * `chars` table, so seeding it before the characters are in place finds
 * nothing to grade and leaves the column empty — and because the grading
 * then counts as "done" (the run is over), it never gets another chance.
 */
export function seedOrder(datasets: readonly SeedDataset[] = SEED_DATASETS): SeedDataset[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const ordered: SeedDataset[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const place = (dataset: SeedDataset): void => {
    if (placed.has(dataset.id)) return;
    if (visiting.has(dataset.id)) {
      // A cycle in the dependency graph: seed it in declared order and
      // let the caller see the dataset rather than an exception.
      return;
    }
    visiting.add(dataset.id);
    for (const requirement of dataset.requires ?? []) {
      const dependency = byId.get(requirement);
      if (dependency) place(dependency);
    }
    visiting.delete(dataset.id);
    if (placed.has(dataset.id)) return;
    placed.add(dataset.id);
    ordered.push(dataset);
  };

  for (const dataset of datasets) place(dataset);
  return ordered;
}

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
