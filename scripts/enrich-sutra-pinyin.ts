/**
 * One-shot: enrich every data/sutras/<slug>.json with a `pinyin: string[][]` field
 * generated via pinyin-pro. Required because `data/sutras/*.json` was historically
 * flat (SutraChunkNoPinyin) but the DB schema + runtime readers expect SutraChunk
 * with per-char pinyin.
 *
 * Idempotent: re-running detects existing `pinyin` on the first chunk and skips
 * the slug with a warning. Atomic writes via writeSutrasFs (tmp+rename).
 *
 * Run once on dev: `npx tsx scripts/enrich-sutra-pinyin.ts`
 *
 * After running, commit the 11 enriched JSONs. Dev paths/dev env should rerun
 * only if the JSON shape changes again (YAGNI — no scheduled re-runs).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withPinyinBatch, type RawChunk } from '../lib/pinyin-gen';
import { writeSutrasFs, type SutraManifestEntry } from '../lib/sutras-fs';
import type { SutraChunkNoPinyin, SutraChunk } from '../lib/sutra-types';

const SUTRAS_DIR = join(process.cwd(), 'data', 'sutras');
const MANIFEST_PATH = join(SUTRAS_DIR, 'manifest.json');

interface SlimManifest {
  version: 1;
  generatedAt: string;
  items: SutraManifestEntry[];
}

function readSlimManifest(): SlimManifest {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as SlimManifest;
}

function listSlugNames(): string[] {
  return readdirSync(SUTRAS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function enrichSlug(slug: string): { lines: number; chars: number } | 'skipped' {
  const path = join(SUTRAS_DIR, `${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as SutraChunkNoPinyin[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${slug}.json is empty or not an array`);
  }
  // Idempotency: if the first chunk already has pinyin, skip.
  if (raw[0] && typeof (raw[0] as SutraChunk).pinyin !== 'undefined') {
    return 'skipped';
  }
  // Cast: SutraChunkNoPinyin fields match RawChunk's interface exactly.
  const rawChunks: RawChunk[] = raw.map((c) => ({ label: c.label, content: c.content }));
  const withPinyin = withPinyinBatch(rawChunks);
  // Re-attach the `id` field from the original chunk (Task 1's lib returns
  // {label, content, pinyin} only — SutraChunk requires `id`).
  const enriched: SutraChunk[] = raw.map((c, i) => ({
    id: c.id,
    label: withPinyin[i]!.label,
    content: withPinyin[i]!.content,
    pinyin: withPinyin[i]!.pinyin,
  }));
  // Stats for log line.
  const lines = enriched.reduce((n, c) => n + c.content.length, 0);
  const chars = enriched.reduce(
    (n, c) => n + c.content.reduce((s, line) => s + Array.from(line).length, 0),
    0,
  );
  const manifest = readSlimManifest();
  writeSutrasFs({
    items: manifest.items,
    chunksBySlug: { [slug]: enriched },
  });
  return { lines, chars };
}

async function main(): Promise<void> {
  const slugs = listSlugNames();
  console.log(`[enrich-sutra-pinyin] scanning ${slugs.length} slugs under ${SUTRAS_DIR}`);
  let enrichedCount = 0;
  let skippedCount = 0;
  for (const slug of slugs) {
    try {
      const result = enrichSlug(slug);
      if (result === 'skipped') {
        console.log(`[enrich-sutra-pinyin] skip ${slug}: already has pinyin`);
        skippedCount += 1;
      } else {
        console.log(`[enrich-sutra-pinyin] ${slug}: ${result.lines} lines, ${result.chars} chars enriched`);
        enrichedCount += 1;
      }
    } catch (err) {
      console.warn(`[enrich-sutra-pinyin] ${slug} failed: ${(err as Error).message}`);
    }
  }
  console.log(`[enrich-sutra-pinyin] done: ${enrichedCount} enriched, ${skippedCount} skipped, ${slugs.length - enrichedCount - skippedCount} failed`);
  if (enrichedCount === 0 && skippedCount > 0) {
    console.log('[enrich-sutra-pinyin] all slugs already enriched — no work to do (idempotent re-run).');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[enrich-sutra-pinyin] fatal:', err);
    process.exit(1);
  });
}
