import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PoemsManifest, PoemDetail } from '@/lib/poetry-types';

const DATA_DIR = join(process.cwd(), 'data', 'poems');
const MANIFEST_PATH = join(process.cwd(), 'data', 'poems-manifest.json');

describe('build-poems JSON-reader pipeline', () => {
  it('manifest has count field matching items.length', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    expect(manifest.count).toBe(manifest.items.length);
    expect(manifest.items.length).toBeGreaterThanOrEqual(1000);
  });

  it('every manifest id has a matching data/poems/<id>.json file', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    const files = new Set(
      readdirSync(DATA_DIR)
        .filter(f => /^\d+\.json$/.test(f))
        .map(f => Number(f.replace('.json', '')))
    );
    for (const item of manifest.items) {
      expect(files.has(item.id)).toBe(true);
    }
  });

  it('every per-poem JSON has pinyin aligned with content', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
    let total = 0;
    for (const item of manifest.items) {
      const p = JSON.parse(readFileSync(join(DATA_DIR, `${item.id}.json`), 'utf8')) as PoemDetail;
      expect(Array.isArray(p.content)).toBe(true);
      expect(Array.isArray(p.pinyin)).toBe(true);
      expect(p.pinyin.length).toBe(p.content.length);
      for (let i = 0; i < p.content.length; i++) {
        expect(p.pinyin[i].length).toBe(Array.from(p.content[i]).length);
      }
      total++;
    }
    expect(total).toBeGreaterThanOrEqual(1000);
  });

  it('id=1 is 唐诗三百首 first poem (在岳咏蝉 by 骆宾王, form=五律)', () => {
    const p = JSON.parse(readFileSync(join(DATA_DIR, '1.json'), 'utf8')) as PoemDetail;
    expect(p.title).toBe('在岳咏蝉');
    expect(p.author).toBe('骆宾王');
    expect(p.dynasty).toBe('tang');
    expect(p.form).toBe('五律');
    expect(p.content.length).toBe(4);
  });
});