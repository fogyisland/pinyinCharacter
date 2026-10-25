import 'server-only';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import type { RowDataPacket } from 'mysql2';
import { readContentFromFs } from './content';
import { resolvePinyin } from './pinyin-index';
import { getPool } from './db';
import { readJsonAuto } from './json-fs';
import { getRadical } from './radical';
import { buildTier, toneFormsOf } from './game-quest';
import type { QuestCharFact, QuestTier } from './game-quest-types';
import type { CharContent } from '@/scripts/schemas/content';

/**
 * The quest data layer.
 *
 * It turns the `chars` rows of one HSK tier plus the char's content file into
 * the facts the pure builder (lib/game-quest.ts) consumes. The rules live in
 * the builder; this module owns the I/O and the memo.
 *
 * Two invariants make a shared URL stable:
 *
 *   1. the rows are read with `ORDER BY char` — the ④ meaning-clause pool is
 *      built in row order, so without a deterministic order the drawn
 *      distractors would drift between two visits to the same URL;
 *   2. the tier is memoized per process — the first request for a tier pays
 *      the content-file reads, every later request is a hit.
 *
 * A tier can be built from two sources: the `chars` table (`getQuestTier`)
 * and the files (`getFileQuestTier`). They hand the same rows to the same
 * pure builder, and the unit test proves the two produce byte-identical
 * tiers for all six HSK levels — which is what lets the MCP server serve
 * the quest without a database.
 */

/**
 * One char's row of a tier.
 *
 * The shape is shared by the two tier sources: the `chars` table and the
 * file-backed source (data/hsk-vocab.json + data/radicals.json). Everything
 * downstream — the fact builder and the pure builder — only sees this shape,
 * which is what makes the two sources interchangeable.
 */
export interface QuestCharRow {
  char: string;
  /** The DB reading, or null when the source has none. */
  pinyin: string | null;
  /** The radical, or null when the source has none. */
  radical: string | null;
}

/** One row of the `chars` table, as the tier query returns it. */
interface TierRow extends RowDataPacket, QuestCharRow {}

/**
 * The separators a multi-reading DB value may use: `xíng,háng`, `xíng/háng`,
 * `xíng háng`, `xíng;háng`. The DB column is empty today, so this only
 * matters once `chars.pinyin` is backfilled.
 */
const READING_SEPARATORS = /[,，、/;；\s]+/;

// ------------------------------------------------------------ the reading

/**
 * Resolve the tone-marked reading the quest uses for a char.
 *
 * The ② question's option set is `toneFormsOf(char)` — four spellings of the
 * char's syllable, derived from pinyin-pro — while the answer is the char's
 * reading. If the two disagree the question has no correct answer, so the
 * reading must always be one of the tone forms.
 *
 * The resolution order:
 *
 *   1. `resolvePinyin` — the DB value when it has one, pinyin-pro's default
 *      otherwise (the same source the 拼音 field on the page uses);
 *   2. a multi-reading value (`xíng,háng`) keeps only its first segment;
 *   3. a segment that is not one of the char's tone forms falls back to
 *      pinyin-pro's default reading, which is a member of the tone forms by
 *      construction.
 */
export function resolveQuestReading(char: string, dbPinyin: string | null | undefined): string {
  const raw = resolvePinyin(char, dbPinyin);
  const first = raw
    .split(READING_SEPARATORS)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0);
  const forms = toneFormsOf(char);
  if (first && forms && forms.includes(first)) return first;
  return pinyin(char, { toneType: 'symbol' }).trim();
}

// ------------------------------------------------------------ the content

/** Read a char's content file; a broken file must not take the tier down. */
function readContentSafely(char: string): CharContent | null {
  try {
    return readContentFromFs(char);
  } catch (err) {
    // readContentFromFs swallows a schema failure, but a malformed JSON file
    // throws out of JSON.parse. Either way the char simply has no meaning
    // and no story, which makes it ineligible — the tier survives.
    console.error(
      `[game-quest] content read failed for ${char} — the char loses its meaning and story, so it is dropped from the ladder (it becomes ineligible and the tier's skipped and levelCount shift)`,
      err,
    );
    return null;
  }
}

/**
 * The meaning phrase of a char.
 *
 * `dict.meaning_zh` is the current shape; the content schema still accepts
 * the legacy top-level `meaning_zh`, so the fallback keeps the loader working
 * for a file of that shape.
 */
function meaningOf(content: CharContent | null): string {
  return content?.dict?.meaning_zh ?? content?.meaning_zh ?? '';
}

/** The alternate readings of a char, trimmed and without the empty ones. */
function alternatesOf(content: CharContent | null): string[] {
  const alternates = content?.dict?.pinyin_alt;
  if (!Array.isArray(alternates)) return [];
  return alternates.map((alt) => String(alt).trim()).filter((alt) => alt.length > 0);
}

/** Does the char carry a story? The precedence is lib/story.ts's. */
function hasStoryOf(content: CharContent | null): boolean {
  return Boolean(content?.etymology?.story || content?.hanzi_story || content?.rare?.story);
}

/** Turn one row plus its content file into the builder's fact. */
export function buildQuestFact(row: QuestCharRow): QuestCharFact {
  const char = String(row.char ?? '');
  const content = readContentSafely(char);
  return {
    char,
    reading: resolveQuestReading(char, row.pinyin),
    radical: row.radical ?? '',
    meaningZh: meaningOf(content),
    pinyinAlt: alternatesOf(content),
    hasStory: hasStoryOf(content),
  };
}

// ---------------------------------------------------------------- the tier

/**
 * Build one tier from a set of rows.
 *
 * This is the one place where a tier is built, so the two sources below
 * (the database and the files) cannot drift: they hand the same rows to the
 * same pure builder.
 */
export function buildQuestTier(tier: number, rows: QuestCharRow[]): QuestTier {
  const facts = rows.map(buildQuestFact);
  return buildTier(tier, facts);
}

/**
 * Build one tier from the database.
 *
 * The query has no LIMIT: the largest tier is 922 rows, and every one of
 * them feeds the syllable / radical / clause pools.
 */
async function buildQuestTierFromDb(tier: number): Promise<QuestTier> {
  const pool = getPool();
  let rows: TierRow[];
  try {
    const [result] = await pool.query<TierRow[]>(
      'SELECT `char`, pinyin, radical FROM chars WHERE hsk_level = ? ORDER BY `char`',
      [tier],
    );
    rows = result;
  } catch (err) {
    console.error('[game-quest] tier query failed for HSK', tier, err);
    throw err;
  }
  return buildQuestTier(tier, rows);
}

/** The memoized tiers, keyed by HSK tier. */
const tierMemo = new Map<number, Promise<QuestTier>>();

/**
 * The tier of the quest ladder.
 *
 * The memoized *promise* is returned, not the value: two concurrent first
 * requests for the same tier share one build instead of racing two.
 */
export function getQuestTier(tier: number): Promise<QuestTier> {
  const memoized = tierMemo.get(tier);
  if (memoized) return memoized;
  const pending = buildQuestTierFromDb(tier).catch((err: unknown) => {
    // A failed build must not poison the memo: drop the entry so the next
    // request retries (the lib/pinyin-index.ts indexPromise pattern).
    tierMemo.delete(tier);
    throw err;
  });
  tierMemo.set(tier, pending);
  return pending;
}

// ------------------------------------------------------- the file-backed tier

/**
 * The HSK vocabulary, as the files hold it.
 *
 * data/hsk-vocab.json is `{ "1": [{ "char": "一" }], ... "6": [...] }` — the
 * six tiers, each already in code-point order (the same order the database
 * query's `ORDER BY char` produces).
 */
const HSK_VOCAB_PATH = join(process.cwd(), 'data', 'hsk-vocab.json');

interface HskVocabEntry {
  char: string;
}

type HskVocab = Record<string, HskVocabEntry[]>;

let hskVocab: HskVocab | null = null;

function loadHskVocab(): HskVocab {
  if (hskVocab) return hskVocab;
  const raw = readJsonAuto(HSK_VOCAB_PATH);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`the HSK vocabulary could not be read from ${HSK_VOCAB_PATH}`);
  }
  hskVocab = raw as HskVocab;
  return hskVocab;
}

/**
 * The rows of one tier, from the files.
 *
 * The three substitutions the file source makes are all exact, not
 * approximations:
 *
 *   1. **the chars** — data/hsk-vocab.json holds exactly the chars whose
 *      `chars.hsk_level` is not null (2632 chars over the six tiers);
 *   2. **the radical** — data/radicals.json holds the same radical the
 *      `chars.radical` column holds (verified char for char);
 *   3. **the reading** — `chars.pinyin` is empty for every row, so a null
 *      reading resolves through the same pinyin-pro default the database
 *      path would use.
 *
 * The content files (data/content/<char>.json) are read by both sources, so
 * the meaning, the alternate readings and the story flag are identical.
 */
export function listTierRowsFromFiles(tier: number): QuestCharRow[] {
  const entries = loadHskVocab()[String(tier)];
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    char: entry.char,
    pinyin: null,
    radical: getRadical(entry.char),
  }));
}

/** The memoized file-backed tiers, keyed by HSK tier. */
const fileTierMemo = new Map<number, Promise<QuestTier>>();

/**
 * The tier of the quest ladder, built from the files.
 *
 * No database is touched: this is what lets the MCP server serve the quest
 * without MySQL. The unit test proves the result is byte-identical to
 * `getQuestTier`'s for all six tiers.
 */
export function getFileQuestTier(tier: number): Promise<QuestTier> {
  const memoized = fileTierMemo.get(tier);
  if (memoized) return memoized;
  const pending = Promise.resolve()
    .then(() => buildQuestTier(tier, listTierRowsFromFiles(tier)))
    .catch((err: unknown) => {
      fileTierMemo.delete(tier);
      throw err;
    });
  fileTierMemo.set(tier, pending);
  return pending;
}

/**
 * Drop the memoized tiers — both the database-backed and the file-backed
 * ones.
 *
 * Used when the underlying data changes (a content regeneration) and by the
 * integration test, which rebuilds a tier to prove that two independent
 * builds are byte-identical.
 */
export function clearQuestTierMemo(): void {
  tierMemo.clear();
  fileTierMemo.clear();
}
