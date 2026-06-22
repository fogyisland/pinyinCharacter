/**
 * Align DB `classics` rows with `data/classics/*.json` files + manifest.
 *
 * Phase A — export 4 DB-only books (daxue / mengzi / shijing / zhongyong)
 *           to `data/classics/<slug>.json` using the chunks currently in DB.
 * Phase B — insert 1 manifest-only book (dizigui) into DB with empty chunks
 *           (placeholder; the chunks column will be dropped in a follow-up).
 * Phase C — rebuild `data/classics-manifest.json` from disk so every file
 *           has a manifest entry, sorted by slug.
 * Phase D — verify DB slug set ≡ manifest slug set.
 *
 * Run: pnpm tsx scripts/migrate-classics-to-files.ts
 * Idempotent: re-running skips files that already exist + DB rows that exist.
 */
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

const DATA_DIR = join(process.cwd(), 'data', 'classics');
const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');

// 2026-06-21 alignment: pre-G6+ classics that lived only in DB chunks.
const DB_ONLY_SLUGS = ['daxue', 'mengzi', 'shijing', 'zhongyong'];
// 2026-06-21 alignment: G6+ classics whose file shipped but DB row never did.
const MANIFEST_ONLY_SLUGS = ['dizigui'];

interface DbChunk {
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
  chunks: DbChunk[];
}

interface ManifestEntry {
  slug: string;
  title: string;
  source: string;
  category: string;
  author: string | null;
  era: string | null;
  chapterCount: number;
  charCount: number;
  jsonFile: string;
  jsonBytes: number;
  bookId?: string;
  bookTitle?: string;
}

interface Manifest {
  version: 1;
  updatedAt: string;
  books: ManifestEntry[];
}

function parseJsonArray<T>(s: unknown, fallback: T): T {
  if (Array.isArray(s)) return s as T;
  if (typeof s === 'string') {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function countChars(chunks: DbChunk[]): number {
  return chunks.reduce((n, c) => n + c.content.reduce((s, p) => s + Array.from(p).length, 0), 0);
}

async function exportDbOnlyBooks(): Promise<{ written: string[]; skipped: string[] }> {
  const pool = getPool();
  const written: string[] = [];
  const skipped: string[] = [];
  for (const slug of DB_ONLY_SLUGS) {
    const filePath = join(DATA_DIR, `${slug}.json`);
    try {
      await readFileSync(filePath);
      skipped.push(slug);
      continue;
    } catch {
      /* not on disk — export below */
    }
    const [rows] = await pool.query<any[]>(
      `SELECT slug, title, category, author, era, chunks, source FROM classics WHERE slug = ?`,
      [slug],
    );
    const r = (rows as any[])[0];
    if (!r) {
      console.warn(`[export] ${slug}: not in DB, skipping`);
      continue;
    }
    const chunks = parseJsonArray<DbChunk[]>(r.chunks, []);
    const vol: VolumeJson = {
      slug: r.slug,
      title: r.title,
      category: r.category,
      author: r.author ?? null,
      era: r.era ?? null,
      source: r.source,
      bookId: slug,
      bookTitle: r.title,
      chapterRange: { from: 1, to: chunks.length },
      chunks,
    };
    const json = JSON.stringify(vol, null, 2);
    writeFileSync(filePath, json, 'utf8');
    written.push(slug);
    console.log(`[export] ${slug}: ${chunks.length} chapters, ${(json.length / 1024).toFixed(1)} KB → ${filePath}`);
  }
  return { written, skipped };
}

async function insertManifestOnlyBooks(): Promise<{ inserted: string[]; skipped: string[] }> {
  const pool = getPool();
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const inserted: string[] = [];
  const skipped: string[] = [];
  for (const slug of MANIFEST_ONLY_SLUGS) {
    const entry = manifest.books.find((b) => b.slug === slug);
    if (!entry) {
      console.warn(`[insert] ${slug}: not in manifest, skipping`);
      continue;
    }
    const [exists] = await pool.query<any[]>(
      `SELECT 1 FROM classics WHERE slug = ? LIMIT 1`,
      [slug],
    );
    if ((exists as any[]).length > 0) {
      skipped.push(slug);
      continue;
    }
    await pool.execute(
      `INSERT INTO classics (slug, title, category, author, era, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.slug, entry.title, entry.category, entry.author ?? null, entry.era ?? null, entry.source],
    );
    inserted.push(slug);
    console.log(`[insert] ${slug}: ${entry.chapterCount} chapters, source=${entry.source}`);
  }
  return { inserted, skipped };
}

async function rebuildManifest(): Promise<Manifest> {
  const files = (await readdirSync(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();
  const entries: ManifestEntry[] = [];
  for (const name of files) {
    const filePath = join(DATA_DIR, name);
    const raw = await readFileSync(filePath, 'utf8');
    const vol: VolumeJson = JSON.parse(raw);
    entries.push({
      slug: vol.slug,
      title: vol.title,
      source: vol.source,
      category: vol.category,
      author: vol.author,
      era: vol.era,
      chapterCount: vol.chunks.length,
      charCount: countChars(vol.chunks),
      jsonFile: `data/classics/${name}`,
      jsonBytes: raw.length,
      bookId: vol.bookId,
      bookTitle: vol.bookTitle,
    });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  const manifest: Manifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    books: entries,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[manifest] rebuilt with ${entries.length} books`);
  return manifest;
}

async function verify(): Promise<{ dbSlugs: Set<string>; manifestSlugs: Set<string>; aligned: boolean }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT slug FROM classics`);
  const dbSlugs = new Set((rows as any[]).map((r) => r.slug as string));
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestSlugs = new Set(manifest.books.map((b) => b.slug));
  const inDbNotManifest = [...dbSlugs].filter((s) => !manifestSlugs.has(s)).sort();
  const inManifestNotDb = [...manifestSlugs].filter((s) => !dbSlugs.has(s)).sort();
  const aligned = inDbNotManifest.length === 0 && inManifestNotDb.length === 0;
  console.log(`[verify] db=${dbSlugs.size} manifest=${manifestSlugs.size} aligned=${aligned}`);
  if (inDbNotManifest.length > 0) console.warn(`[verify] DB-only (${inDbNotManifest.length}): ${inDbNotManifest.join(', ')}`);
  if (inManifestNotDb.length > 0) console.warn(`[verify] Manifest-only (${inManifestNotDb.length}): ${inManifestNotDb.join(', ')}`);
  return { dbSlugs, manifestSlugs, aligned };
}

export async function migrateClassicsToFiles(): Promise<{
  exported: string[];
  exportedSkipped: string[];
  inserted: string[];
  insertedSkipped: string[];
  manifestBooks: number;
  aligned: boolean;
}> {
  const exported = await exportDbOnlyBooks();
  const inserted = await insertManifestOnlyBooks();
  const manifest = await rebuildManifest();
  const { aligned } = await verify();
  return {
    exported: exported.written,
    exportedSkipped: exported.skipped,
    inserted: inserted.inserted,
    insertedSkipped: inserted.skipped,
    manifestBooks: manifest.books.length,
    aligned,
  };
}

if (require.main === module) {
  migrateClassicsToFiles()
    .then((r) => {
      console.log(
        `[done] exported=${r.exported.length} exportedSkipped=${r.exportedSkipped.length} ` +
          `inserted=${r.inserted.length} insertedSkipped=${r.insertedSkipped.length} ` +
          `manifestBooks=${r.manifestBooks} aligned=${r.aligned}`,
      );
      process.exit(r.aligned ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => closePool());
}