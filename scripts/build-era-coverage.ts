/**
 * build-era-coverage.ts
 *
 * Detects which chars (in data/content/*.json) have a glyph in each ancient
 * font. Writes a single JSON cache at data/era-coverage.json.
 *
 * Slim-DB path of getEtymology() reads this cache to fill eraGlyphs when no
 * char_etymology row exists. Skip codepoints in the supplementary plane
 * (mysql2 bug per mysql2-supp-plane-bug.md memory).
 *
 * Output shape:
 *   { "<char>": { "jiaguwen": bool, "jinwen": bool, "xiaozhuan": bool, "lishu": bool } }
 *
 * Cascade (per globals.css @font-face):
 *   jiaguwen  ← founder-jiaguwen.ttf || BabelStoneHanBasic.ttf
 *   jinwen    ← BabelStoneHanBasic.ttf
 *   xiaozhuan ← quanziku-shuowen.ttf || BabelStoneHanBasic.ttf
 *   lishu     ← wang-hanzong-lishu.ttf || BabelStoneHanBasic.ttf
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fontkit from 'fontkit';

const ROOT = resolve(process.cwd());
const CONTENT_DIR = resolve(ROOT, 'data', 'content');
const OUT_PATH = resolve(ROOT, 'data', 'era-coverage.json');

type EraKey = 'jiaguwen' | 'jinwen' | 'xiaozhuan' | 'lishu';
type Coverage = Record<EraKey, boolean>;
type CoverageMap = Record<string, Coverage>;

const FONTS: Array<{ path: string; eras: EraKey[]; role: 'primary' | 'fallback' }> = [
  { path: 'public/fonts/founder-jiaguwen.ttf', eras: ['jiaguwen'], role: 'primary' },
  { path: 'public/fonts/quanziku-shuowen.ttf', eras: ['xiaozhuan'], role: 'primary' },
  { path: 'public/fonts/wang-hanzong-lishu.ttf', eras: ['lishu'], role: 'primary' },
  { path: 'public/fonts/BabelStoneHanBasic.ttf', eras: ['jiaguwen', 'jinwen', 'xiaozhuan', 'lishu'], role: 'fallback' },
];

function listCharsFromContentDir(): string[] {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => f.slice(0, -'.json'.length));
}

function isBmpChar(c: string): boolean {
  const cp = c.codePointAt(0);
  return cp != null && cp <= 0xFFFF;
}

async function main() {
  if (!existsSync(CONTENT_DIR)) {
    console.error(`[coverage] data/content/ not found at ${CONTENT_DIR}`);
    process.exit(1);
  }

  // Load fonts once.
  console.log('[coverage] loading fonts...');
  const fontCache: Record<string, any> = {};
  for (const f of FONTS) {
    const abs = resolve(ROOT, f.path);
    if (!existsSync(abs)) {
      console.warn(`[coverage] missing font: ${f.path} (skipping)`);
      continue;
    }
    fontCache[f.path] = fontkit.openSync(abs);
    console.log(`[coverage] loaded: ${f.path}`);
  }

  const chars = listCharsFromContentDir();
  console.log(`[coverage] scanning ${chars.length} chars from data/content/...`);

  const coverage: CoverageMap = {};
  let bmpCount = 0;
  let suppSkipped = 0;
  let processed = 0;
  const start = Date.now();

  for (const char of chars) {
    if (!isBmpChar(char)) {
      suppSkipped++;
      continue;
    }
    bmpCount++;
    const cp = char.codePointAt(0)!;
    const charCov: Coverage = { jiaguwen: false, jinwen: false, xiaozhuan: false, lishu: false };

    for (const f of FONTS) {
      const font = fontCache[f.path];
      if (!font) continue;
      const has = font.hasGlyphForCodePoint(cp);
      if (!has) continue;
      for (const era of f.eras) {
        if (f.role === 'primary') {
          charCov[era] = true;
        } else if (f.role === 'fallback' && !charCov[era]) {
          charCov[era] = true;
        }
      }
    }
    coverage[char] = charCov;
    processed++;
    if (processed % 1000 === 0) {
      console.log(`[coverage] ${processed}/${bmpCount} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    }
  }

  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(coverage, null, 0), 'utf-8');

  // Stats
  const stats: Record<EraKey, number> = { jiaguwen: 0, jinwen: 0, xiaozhuan: 0, lishu: 0 };
  for (const c of Object.values(coverage)) {
    for (const era of Object.keys(stats) as EraKey[]) {
      if (c[era]) stats[era]++;
    }
  }
  const anyTrue = Object.values(coverage).filter((c) => c.jiaguwen || c.jinwen || c.xiaozhuan || c.lishu).length;

  console.log(`\n[coverage] done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`[coverage] chars scanned: ${bmpCount} (skipped supp-plane: ${suppSkipped})`);
  console.log(`[coverage] chars with ≥1 era: ${anyTrue} (${((anyTrue / bmpCount) * 100).toFixed(1)}%)`);
  console.log(`[coverage] per-era coverage:`);
  for (const era of Object.keys(stats) as EraKey[]) {
    console.log(`[coverage]   ${era.padEnd(10)} ${stats[era]} (${((stats[era] / bmpCount) * 100).toFixed(1)}%)`);
  }
  console.log(`[coverage] wrote: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('[coverage] error:', e);
  process.exit(1);
});