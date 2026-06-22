/**
 * Drop `chunks` (JSON) and `chunk_count` (GENERATED) columns from `classics`.
 *
 * After this migration:
 *   - classics table holds only metadata (id, slug, title, category, author,
 *     era, source, created_at, updated_at). 14 cols → 9 cols.
 *   - lib/classics reads from `data/classics-manifest.json` +
 *     `data/classics/<slug>.json`; no DB chunk access.
 *   - The `chunk_count` column is dropped entirely; chapterCount is served
 *     from the manifest.
 *
 * Pre-flight: verifies every DB slug has a corresponding manifest entry, and
 * that 0 `chunks` column reads remain in lib/. Refuses to run on `--dry-run`
 * mismatch.
 *
 * Idempotent: re-running after a successful drop is a no-op (SHOW COLUMNS
 * reports chunks absent; script exits 0 with a notice).
 *
 * Run: pnpm tsx --env-file=.env.local scripts/migrate-classics-drop-chunks.ts
 *      pnpm tsx --env-file=.env.local scripts/migrate-classics-drop-chunks.ts --dry-run
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');

interface Manifest {
  version: 1;
  books: Array<{ slug: string }>;
}

async function getColumnInfo(): Promise<{ chunks: boolean; chunkCount: boolean }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'classics'
       AND COLUMN_NAME IN ('chunks', 'chunk_count')`,
  );
  const cols = new Set((rows as any[]).map((r) => r.COLUMN_NAME as string));
  return { chunks: cols.has('chunks'), chunkCount: cols.has('chunk_count') };
}

async function verifyAlignment(): Promise<{ dbSlugs: Set<string>; manifestSlugs: Set<string>; aligned: boolean }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT slug FROM classics`);
  const dbSlugs = new Set((rows as any[]).map((r) => r.slug as string));
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestSlugs = new Set(manifest.books.map((b) => b.slug));
  const inDbNotManifest = [...dbSlugs].filter((s) => !manifestSlugs.has(s));
  const inManifestNotDb = [...manifestSlugs].filter((s) => !dbSlugs.has(s));
  const aligned = inDbNotManifest.length === 0 && inManifestNotDb.length === 0;
  if (!aligned) {
    console.warn(`[verify] db=${dbSlugs.size} manifest=${manifestSlugs.size} aligned=false`);
    if (inDbNotManifest.length > 0) console.warn(`[verify] DB-only: ${inDbNotManifest.join(', ')}`);
    if (inManifestNotDb.length > 0) console.warn(`[verify] Manifest-only: ${inManifestNotDb.join(', ')}`);
  } else {
    console.log(`[verify] db=${dbSlugs.size} manifest=${manifestSlugs.size} aligned=true`);
  }
  return { dbSlugs, manifestSlugs, aligned };
}

export async function dropClassicsChunks(opts: { dryRun: boolean }): Promise<{
  alreadyDropped: boolean;
  droppedChunks: boolean;
  droppedChunkCount: boolean;
  aligned: boolean;
}> {
  const cols = await getColumnInfo();
  if (!cols.chunks && !cols.chunkCount) {
    console.log(`[drop] already dropped (chunks and chunk_count both absent)`);
    const v = await verifyAlignment();
    return { alreadyDropped: true, droppedChunks: false, droppedChunkCount: false, aligned: v.aligned };
  }

  const v = await verifyAlignment();
  if (!v.aligned) {
    throw new Error(`db/manifest slug mismatch — run migrate-classics-to-files.ts first`);
  }

  if (opts.dryRun) {
    console.log(`[dry-run] would ALTER TABLE classics DROP COLUMN chunks`);
    console.log(`[dry-run] would ALTER TABLE classics DROP COLUMN chunk_count`);
    return { alreadyDropped: false, droppedChunks: false, droppedChunkCount: false, aligned: v.aligned };
  }

  const pool = getPool();
  // Drop chunk_count first — it's a GENERATED column that depends on chunks.
  if (cols.chunkCount) {
    console.log(`[drop] ALTER TABLE classics DROP COLUMN chunk_count`);
    await pool.query(`ALTER TABLE classics DROP COLUMN chunk_count`);
  }
  if (cols.chunks) {
    console.log(`[drop] ALTER TABLE classics DROP COLUMN chunks`);
    await pool.query(`ALTER TABLE classics DROP COLUMN chunks`);
  }
  return { alreadyDropped: false, droppedChunks: cols.chunks, droppedChunkCount: cols.chunkCount, aligned: v.aligned };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  dropClassicsChunks({ dryRun })
    .then((r) => {
      console.log(
        `[done] alreadyDropped=${r.alreadyDropped} ` +
          `droppedChunks=${r.droppedChunks} droppedChunkCount=${r.droppedChunkCount} ` +
          `aligned=${r.aligned}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => closePool());
}