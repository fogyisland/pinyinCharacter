/**
 * Flatten every data/sutras/<slug>.json to a single chunk.
 *
 * Why: SutraAudioPlayer + SutraChunkPicker + SutraCard are all graceful when
 * chunkCount === 1. Splitting by 品 produces single-sentence "chapters" that
 * are not useful (per user request 2026-06-30). Per-slug data files become
 * the entire sutra as one chunk.
 *
 * Idempotent: re-running is a no-op.
 *
 * Run with:  npx tsx scripts/flatten-sutras.ts
 */
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const SUTRAS_DIR = join(process.cwd(), 'data', 'sutras');
const MANIFEST_PATH = join(SUTRAS_DIR, 'manifest.json');

interface SutraChunk {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

interface ManifestEntry {
  id: number;
  slug: string;
  title: string;
  chunkCount: number;
  charCount: number;
}

interface Manifest {
  version: 1;
  generatedAt: string;
  items: ManifestEntry[];
}

function flatten(slug: string, title: string, chunks: SutraChunk[]): SutraChunk[] {
  if (chunks.length <= 1) return chunks;
  const content: string[] = [];
  const pinyin: string[][] = [];
  for (const c of chunks) {
    content.push(...c.content);
    pinyin.push(...c.pinyin);
  }
  return [{ id: 0, label: title, content, pinyin }];
}

function countChars(chunks: SutraChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0), 0);
}

function main() {
  const slugs = readdirSync(SUTRAS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .map((f) => f.replace(/\.json$/, ''));

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const titleBySlug = new Map(manifest.items.map((i) => [i.slug, i.title]));

  let changed = 0;
  const newChunksBySlug: Record<string, SutraChunk[]> = {};
  for (const slug of slugs) {
    const path = join(SUTRAS_DIR, `${slug}.json`);
    const original = JSON.parse(readFileSync(path, 'utf8')) as SutraChunk[];
    const title = titleBySlug.get(slug) ?? slug;
    const flat = flatten(slug, title, original);
    if (flat.length !== original.length) {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(flat), 'utf8');
      renameSync(tmp, path);
      changed += 1;
      console.log(
        `[flatten-sutras] ${slug}: ${original.length} → ${flat.length} chunk(s), ${countChars(flat)} chars`,
      );
    } else {
      console.log(`[flatten-sutras] ${slug}: already flat (${flat.length} chunk)`);
    }
    newChunksBySlug[slug] = flat;
  }

  // Refresh manifest chunkCount/charCount from disk.
  for (const item of manifest.items) {
    const chunks = newChunksBySlug[item.slug];
    if (!chunks) continue;
    item.chunkCount = chunks.length;
    item.charCount = countChars(chunks);
  }
  manifest.generatedAt = new Date().toISOString();
  const tmp = `${MANIFEST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, MANIFEST_PATH);
  console.log(`[flatten-sutras] manifest updated; ${changed} file(s) flattened.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[flatten-sutras] failed:', err);
    process.exit(1);
  }
}
