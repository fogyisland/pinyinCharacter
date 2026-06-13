import { getPool } from './db';
import {
  ERAS,
  type Etymology,
  type EtymologyAdjacent,
  type EraGlyph,
} from './etymology-types';

export async function getEtymology(char: string): Promise<Etymology | null> {
  const pool = getPool();
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
  if (rows.length === 0) return null;
  const r = rows[0];
  const eraGlyphs: EraGlyph[] = ERAS.map((era) => ({
    era,
    font: r[`era_${era}_font`],
    hasGlyph: Boolean(r[`era_${era}_has`]),
  }));
  return {
    char: r.char,
    eraGlyphs,
    story: r.story,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at ? r.generated_at.toISOString() : null,
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