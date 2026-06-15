/**
 * 扫 data/content/*.json 重算 byField, 写 data/content-manifest.json。
 * Run: pnpm tsx scripts/update-content-manifest.ts
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CharContentSchema, ContentManifestSchema, type ContentManifest } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const MANIFEST_PATH = join(process.cwd(), 'data', 'content-manifest.json');

export async function updateContentManifest(): Promise<ContentManifest> {
  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const byField = { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 };
  const files = existsSync(CONTENT_DIR) ? readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json')) : [];

  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      if (parsed.meaning_zh) byField.meaning_zh++;
      if (parsed.etymology_story) byField.etymology_story++;
      if (parsed.hanzi_story) byField.hanzi_story++;
    } catch (err) {
      console.error(`[manifest] skip ${f}: ${(err as Error).message}`);
    }
  }

  const manifest: ContentManifest = {
    version: 1,
    totalChars: 8105,
    byField,
    generatedAt: new Date().toISOString(),
  };

  ContentManifestSchema.parse(manifest);  // sanity check
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.error(`[manifest] byField: ${JSON.stringify(byField)} → ${MANIFEST_PATH}`);

  return manifest;
}

async function main() {
  await updateContentManifest();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}