import { getPool } from './db';
import {
  ERAS,
  type Etymology,
  type EtymologyAdjacent,
  type EraGlyph,
} from './etymology-types';
import { getContent } from './content';
import type { CharLevel } from '../components/etymology/era-dates';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function toCharLevel(n: number | null | undefined): CharLevel {
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

// Era → font-family name (must match globals.css @font-face declarations)
const ERA_FONT: Record<string, string> = {
  jiaguwen: 'YinQiJiaGuWen',
  jinwen: 'HanDianJinWen',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'QuanZiKuLiDing',
  kaishu: 'KaiTi',
};

type EraCoverage = Record<'jiaguwen' | 'jinwen' | 'xiaozhuan' | 'lishu', boolean>;
type CoverageMap = Record<string, EraCoverage>;
let _coverageCache: CoverageMap | null = null;
function getEraCoverage(char: string): EraCoverage | null {
  if (_coverageCache) return _coverageCache[char] ?? null;
  const path = join(process.cwd(), 'data', 'era-coverage.json');
  if (!existsSync(path)) return null;
  try {
    _coverageCache = JSON.parse(readFileSync(path, 'utf8')) as CoverageMap;
  } catch {
    _coverageCache = {};
  }
  return _coverageCache[char] ?? null;
}

interface DbEtymologyRow {
  era_jiaguwen_font?: string | null;
  era_jinwen_font?: string | null;
  era_xiaozhuan_font?: string | null;
  era_lishu_font?: string | null;
  era_kaishu_font?: string | null;
  era_jiaguwen_has?: number | null;
  era_jinwen_has?: number | null;
  era_xiaozhuan_has?: number | null;
  era_lishu_has?: number | null;
  era_kaishu_has?: number | null;
}

/**
 * Build the per-era glyph list shown by EtymologyMorph. The `hasGlyph` flag
 * is sourced from data/era-coverage.json when available (post-2026-06-18
 * source of truth); the DB char_etymology.era_*_has columns are only used
 * for chars missing from the JSON. Kaishu is always available. Fonts come
 * from DB columns if present, else fall back to the hardcoded ERA_FONT map.
 */
function buildEraGlyphs(
  char: string,
  cov: EraCoverage | null,
  row: DbEtymologyRow | null
): EraGlyph[] {
  return ERAS.map((era) => {
    const font = (row?.[`era_${era}_font`] ?? null) || ERA_FONT[era] || '';
    let hasGlyph: boolean;
    if (era === 'kaishu') {
      hasGlyph = true;
    } else if (cov) {
      hasGlyph = cov[era as 'jiaguwen' | 'jinwen' | 'xiaozhuan' | 'lishu'];
    } else if (row) {
      hasGlyph = Boolean(row[`era_${era}_has`]);
    } else {
      hasGlyph = false;
    }
    return { era, font, hasGlyph };
  });
}

async function readLevel(char: string): Promise<CharLevel> {
  // File-first (post 2026-06-17 slim-DB)
  const content = await getContent(char);
  if (content?.level != null) return toCharLevel(content.level);
  // DB fallback (legacy)
  const [rows] = await getPool().query<any[]>(
    `SELECT level FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  return toCharLevel(rows[0]?.level);
}

export async function getEtymology(char: string): Promise<Etymology | null> {
  const pool = getPool();
  // story/generation provenance is moving to data/content/<char>.json, but the
  // column still exists in the DB for in-flight migrations. Read JSON first,
  // fall back to the legacy column.
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`,
            era_jiaguwen_font, era_jiaguwen_has,
            era_jinwen_font, era_jinwen_has,
            era_xiaozhuan_font, era_xiaozhuan_has,
            era_lishu_font, era_lishu_has,
            era_kaishu_font, era_kaishu_has,
            story, generated_by, generated_at
     FROM char_etymology
     WHERE \`char\` = ?
     LIMIT 1`,
    [char]
  );
  if (rows.length === 0) {
    // Slim-DB path: no char_etymology row, but story may live in data/content/<char>.json.
    // Era glyph availability is filled from data/era-coverage.json (built by
    // scripts/build-era-coverage.ts) so the morph component can render ancient
    // forms even when the DB row is missing.
    const contentOnly = await getContent(char);
    const storyOnly = contentOnly?.etymology?.story ?? null;
    if (!storyOnly) return null;
    const cov = getEraCoverage(char);
    return {
      char,
      eraGlyphs: buildEraGlyphs(char, cov, null),
      story: storyOnly,
      generatedBy: contentOnly?.etymology?.generated_by ?? null,
      generatedAt: contentOnly?.etymology?.generated_at ?? null,
      level: await readLevel(char),
    };
  }
  const r = rows[0];
  // Era glyph availability comes from data/era-coverage.json (the post-2026-06-18
  // source of truth). The char_etymology.era_*_has columns are stale — they
  // were never backfilled after the refactor that moved era coverage to JSON,
  // and trust them here and the morph component renders only kaishu for every
  // char. Fall back to the DB column only if the JSON has no entry.
  const cov = getEraCoverage(char);
  const eraGlyphs: EraGlyph[] = buildEraGlyphs(char, cov, r);
  const content = await getContent(char);
  const story = content?.etymology?.story ?? r.story ?? null;
  const generatedBy = content?.etymology?.generated_by ?? r.generated_by ?? null;
  const generatedAt = content?.etymology?.generated_at
    ?? (r.generated_at ? r.generated_at.toISOString() : null);
  return {
    char: r.char,
    eraGlyphs,
    story,
    generatedBy,
    generatedAt,
    level: await readLevel(char),
  };
}

export async function getAdjacentChars(char: string): Promise<EtymologyAdjacent> {
  const pool = getPool();
  // prev: char with smaller unicode_codepoint, closest
  const [prevRows] = await pool.query<any[]>(
    `SELECT c.\`char\`
     FROM chars c
     WHERE c.unicode_codepoint < (SELECT unicode_codepoint FROM chars WHERE \`char\` = ?)
     ORDER BY c.unicode_codepoint DESC
     LIMIT 1`,
    [char]
  );
  const [nextRows] = await pool.query<any[]>(
    `SELECT c.\`char\`
     FROM chars c
     WHERE c.unicode_codepoint > (SELECT unicode_codepoint FROM chars WHERE \`char\` = ?)
     ORDER BY c.unicode_codepoint ASC
     LIMIT 1`,
    [char]
  );
  return {
    prev: prevRows[0]?.char ?? null,
    next: nextRows[0]?.char ?? null,
  };
}
