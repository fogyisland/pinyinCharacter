/**
 * One-time migration: read all rows from the `sutras` table and write them
 * to data/sutras/<slug>.json + data/sutras/manifest.json. After this
 * succeeds, lib/sutras.ts will read from the FS layer first.
 *
 * Idempotent: safe to re-run. Re-runs overwrite the FS files with the
 * current DB state.
 *
 * Modes:
 *   default          Write all sutras.
 *   --dry-run        Report what would change; don't write files.
 *   --verify         After writing, re-read each file and compare chunks
 *                    against the DB row (catches silent corruption).
 *
 * Run: pnpm tsx scripts/export-sutras.ts [--dry-run|--verify]
 */
import { getPool, closePool } from '../lib/db';
import { writeSutrasFs, sutrasFsAvailable, type SutraManifestEntry } from '../lib/sutras-fs';
import type { SutraChunk } from '../lib/sutra-types';

interface ExportOpts {
  dryRun?: boolean;
  verify?: boolean;
}

function parseArgs(): ExportOpts {
  const opts: ExportOpts = {};
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--verify') opts.verify = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (opts.dryRun) console.log('[export-sutras] DRY RUN — no files will be written');
  if (sutrasFsAvailable()) console.log('[export-sutras] data/sutras/ already exists, will overwrite');

  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, slug, chunks FROM sutras ORDER BY id ASC`,
  );
  console.log(`[export-sutras] found ${rows.length} rows in sutras table`);

  const manifestItems: SutraManifestEntry[] = [];
  const chunksBySlug: Record<string, SutraChunk[]> = {};
  for (const row of rows as Array<{ id: number; title: string; slug: string; chunks: string | SutraChunk[] }>) {
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
    chunksBySlug[row.slug] = raw;
    console.log(
      `[export-sutras]   ${row.slug}: id=${row.id} title=${row.title} chunks=${chunkCount} chars=${charCount}`,
    );
  }

  if (opts.dryRun) {
    console.log(`[export-sutras] would write ${rows.length} files + manifest (dry-run)`);
    await closePool();
    return;
  }

  const manifest = writeSutrasFs({ items: manifestItems, chunksBySlug });
  console.log(
    `[export-sutras] wrote ${Object.keys(chunksBySlug).length} files + manifest.json ` +
      `(${manifest.items.length} items, generatedAt=${manifest.generatedAt})`,
  );

  if (opts.verify) {
    const { readSutraManifest, readSutraChunksBySlug } = await import('../lib/sutras-fs');
    const m = readSutraManifest();
    if (!m) throw new Error('verify: manifest missing after write');
    if (m.items.length !== manifestItems.length) {
      throw new Error(`verify: manifest item count mismatch (${m.items.length} vs ${manifestItems.length})`);
    }
    for (const item of manifestItems) {
      const chunks = readSutraChunksBySlug(item.slug);
      if (!chunks) throw new Error(`verify: ${item.slug}.json missing`);
      if (chunks.length !== item.chunkCount) {
        throw new Error(`verify: ${item.slug} chunk count mismatch (${chunks.length} vs ${item.chunkCount})`);
      }
    }
    console.log(`[export-sutras] verified ${manifestItems.length} files`);
  }

  await closePool();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[export-sutras] failed:', err);
    process.exit(1);
  });
}