import { getPool } from './db';
import {
  ERAS,
  type Etymology,
  type EtymologyAdjacent,
  type EraGlyph,
} from './etymology-types';
import { getContent } from './content';
import type { CharLevel } from '../components/etymology/era-dates';

function toCharLevel(n: number | null | undefined): CharLevel {
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
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
    const contentOnly = await getContent(char);
    const storyOnly = contentOnly?.etymology?.story ?? null;
    if (!storyOnly) return null;
    return {
      char,
      eraGlyphs: ERAS.map((era) => ({
        era,
        font: '',
        hasGlyph: false,
      })),
      story: storyOnly,
      generatedBy: contentOnly?.etymology?.generated_by ?? null,
      generatedAt: contentOnly?.etymology?.generated_at ?? null,
      level: await readLevel(char),
    };
  }
  const r = rows[0];
  const eraGlyphs: EraGlyph[] = ERAS.map((era) => ({
    era,
    font: r[`era_${era}_font`],
    hasGlyph: Boolean(r[`era_${era}_has`]),
  }));
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
