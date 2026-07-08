/**
 * Mirror pre-built JSON chunks from data/sutras/ into the `sutras` MySQL table.
 *
 * Source-of-truth is `data/sutras/<slug>.json` (each: `SutraChunk[]`) and
 * `data/sutras/manifest.json` (id + slug + title mapping). This script UPSERTs
 * them into the DB and refreshes the manifest's id mapping afterwards.
 *
 * This script used to parse CBETA TEI P5 XML from a local archive rooted at
 * $CBETA_ROOT. That dependency was removed 2026-07-08 — the JSONs are
 * authoritative. If pinyin enrichment is ever needed again, run
 * `npx tsx scripts/enrich-sutra-pinyin.ts` once; this script will pick up the
 * result automatically because it never regenerates pinyin itself.
 *
 * UPSERT semantics: safe to re-run. Existing rows are updated; new slugs are
 * inserted. The `source` column is set to `prebuilt-json:data/sutras`.
 *
 * Run with:  npx tsx scripts/build-sutras.ts
 *            (or `npm run sutras:build`)
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { writeSutrasFs, readSutraManifest } from '../lib/sutras-fs';
import type { SutraManifestEntry } from '../lib/sutras-fs';
import type { SutraChunk } from '../lib/sutra-types';

const SUTRAS_DIR = join(process.cwd(), 'data', 'sutras');
const SOURCE_TAG = 'prebuilt-json:data/sutras';

function ensureDataDir(): void {
  // mkdirSync(recursive) is a no-op if the dir exists. Safety check only —
  // production deployments ship data/sutras/* via the bundle.
  if (!existsSyncCompat(SUTRAS_DIR)) {
    mkdirSync(SUTRAS_DIR, { recursive: true });
  }
}

function existsSyncCompat(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function listSlugFiles(): string[] {
  return readdirSync(SUTRAS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort();
}

function readSutraFile(slug: string): SutraChunk[] {
  const path = join(SUTRAS_DIR, `${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as SutraChunk[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${slug}.json is empty or not an array`);
  }
  // Defensive: every chunk must have a pinyin array. If not, the slug needs
  // re-running through scripts/enrich-sutra-pinyin.ts.
  if (!raw.every((c) => Array.isArray(c.pinyin) && c.pinyin.length === c.content.length)) {
    throw new Error(
      `${slug}.json is missing pinyin — run \`npx tsx scripts/enrich-sutra-pinyin.ts\` first`,
    );
  }
  return raw;
}

export async function buildSutras(): Promise<number> {
  ensureDataDir();

  const manifest = readSutraManifest();
  if (!manifest) {
    throw new Error(
      `${SUTRAS_DIR}/manifest.json missing — clone the repo or run scripts/enrich-sutra-pinyin.ts first`,
    );
  }

  const pool = getPool();
  const chunksBySlug: Record<string, SutraChunk[]> = {};
  let upserted = 0;
  let manifestNeedsRewrite = false;

  for (const item of manifest.items) {
    try {
      const chunks = readSutraFile(item.slug);
      await pool.query(
        `INSERT INTO sutras (title, slug, chunks, source) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), chunks = VALUES(chunks), source = VALUES(source)`,
        [item.title, item.slug, JSON.stringify(chunks), SOURCE_TAG],
      );
      console.log(
        `[build-sutras] upserted ${item.slug} (${chunks.length} chunks, ${chunks.reduce((n, c) => n + c.content.length, 0)} paragraphs)`,
      );
      chunksBySlug[item.slug] = chunks;
      upserted += 1;
    } catch (err) {
      console.warn(`[build-sutras] skip ${item.slug}: ${(err as Error).message}`);
    }
  }

  // Refresh manifest id mapping only if at least one slug was upserted (read
  // back id+title from DB). Skip rewrite if nothing changed — keeps mtime
  // stable on idempotent re-runs (Task 2 review note I3).
  if (upserted > 0) {
    const [idRows] = await pool.query<any[]>(
      `SELECT id, slug, title, chunks FROM sutras WHERE slug IN (${manifest.items.map(() => '?').join(',')})`,
      manifest.items.map((s) => s.slug),
    );
    const items: SutraManifestEntry[] = [];
    for (const row of idRows as Array<{ id: number; slug: string; title: string; chunks: string | SutraChunk[] }>) {
      const raw = typeof row.chunks === 'string' ? (JSON.parse(row.chunks) as SutraChunk[]) : row.chunks;
      const chunkCount = raw.length;
      const charCount = raw.reduce(
        (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0),
        0,
      );
      items.push({
        id: Number(row.id),
        slug: row.slug,
        title: row.title,
        chunkCount,
        charCount,
      });
    }
    // Preserve the original list of slugs whose UPSERT didn't run (so the
    // manifest stays complete even on partial failures). For slugs that DID
    // upsert, we re-use the id from the DB read-back.
    const manifestItemMap = new Map(items.map((it) => [it.slug, it]));
    const mergedItems = manifest.items.map(
      (existing) => manifestItemMap.get(existing.slug) ?? existing,
    );
    writeSutrasFs({ items: mergedItems, chunksBySlug });
    manifestNeedsRewrite = true;
    console.log(
      `[build-sutras] wrote ${Object.keys(chunksBySlug).length} files + manifest (${mergedItems.length} items) to data/sutras/`,
    );
  }

  return upserted;
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
