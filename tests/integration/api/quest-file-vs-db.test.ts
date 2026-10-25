// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { loadEnvFromFile } from '@/lib/setup';
import { getFileQuestTier, getQuestTier, clearQuestTierMemo } from '@/lib/game-quest-data';
import { buildLevel } from '@/lib/game-quest';
import { closePool } from '@/lib/db';
import type { QuestTier } from '@/lib/game-quest-types';

/**
 * The file-backed quest tier against the database-backed one.
 *
 * This is the test that makes the MCP server's "no database" claim safe.
 * The MCP server serves the quest from the files (data/hsk-vocab.json,
 * data/radicals.json, data/content/<char>.json); the site serves it from the
 * `chars` table. Both hand the same rows to the same pure builder
 * (buildQuestTier), so the two tiers must be byte-identical — otherwise a
 * caller of the MCP server would get a different ladder than the site.
 *
 * The database is reached through DATABASE_URL. When the environment does not
 * carry it, the project's .env is read — vitest does not load .env itself, and
 * the developer running the suite normally has one. When neither carries it
 * the test skips cleanly.
 */
if (!process.env.DATABASE_URL) {
  const fromFile = loadEnvFromFile();
  if (fromFile.DATABASE_URL) process.env.DATABASE_URL = fromFile.DATABASE_URL;
}

const integrationSkip = !process.env.DATABASE_URL;

/** The six tiers of the ladder. */
const TIERS = [1, 2, 3, 4, 5, 6];

describe.skipIf(integrationSkip)('the file-backed quest tier', () => {
  const fromFiles: QuestTier[] = [];
  const fromDatabase: QuestTier[] = [];

  beforeAll(async () => {
    for (const tier of TIERS) {
      fromFiles.push(await getFileQuestTier(tier));
      fromDatabase.push(await getQuestTier(tier));
    }
  }, 300_000);

  afterAll(async () => {
    await closePool();
  });

  it('holds the same chars as the database tier', () => {
    for (const tier of TIERS) {
      const fileChars = fromFiles[tier - 1]!.levels.flat().map((fact) => fact.char);
      const dbChars = fromDatabase[tier - 1]!.levels.flat().map((fact) => fact.char);
      expect(fileChars, `HSK ${tier}`).toEqual(dbChars);
    }
  });

  it('holds the same eligible pool and the same level count', () => {
    for (const tier of TIERS) {
      const fromFile = fromFiles[tier - 1]!;
      const fromDb = fromDatabase[tier - 1]!;
      expect(fromFile.tierSize, `HSK ${tier} tier size`).toBe(fromDb.tierSize);
      expect(fromFile.levels.length, `HSK ${tier} level count`).toBe(fromDb.levels.length);
      expect(fromFile.skipped, `HSK ${tier} skipped`).toBe(fromDb.skipped);
    }
  });

  it('is byte-identical to the database tier', () => {
    for (const tier of TIERS) {
      const fromFile = fromFiles[tier - 1]!;
      const fromDb = fromDatabase[tier - 1]!;
      expect(JSON.stringify(fromFile.levels), `HSK ${tier} levels`).toBe(
        JSON.stringify(fromDb.levels),
      );
    }
  });

  it('serves the same level payloads', () => {
    for (const tier of TIERS) {
      const fileTier = fromFiles[tier - 1]!;
      const dbTier = fromDatabase[tier - 1]!;
      for (let level = 1; level <= fileTier.levels.length; level++) {
        expect(JSON.stringify(buildLevel(fileTier, level)), `HSK ${tier} L${level}`).toBe(
          JSON.stringify(buildLevel(dbTier, level)),
        );
      }
    }
  });

  it('reads the radicals from the file the database holds', () => {
    // The radical is the one field the two sources could disagree about:
    // `chars.radical` in the table, `data/radicals.json` on disk.
    const mismatches: string[] = [];
    for (const tier of TIERS) {
      const fileFacts = fromFiles[tier - 1]!.levels.flat();
      const dbFacts = fromDatabase[tier - 1]!.levels.flat();
      for (let index = 0; index < fileFacts.length; index++) {
        const fileRadical = fileFacts[index]!.radical;
        const dbRadical = dbFacts[index]!.radical;
        if (fileRadical !== dbRadical) {
          mismatches.push(
            `HSK ${tier} ${fileFacts[index]!.char}: file "${fileRadical}" vs db "${dbRadical}"`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('is a pure function of the files — two builds agree', async () => {
    // Drop the memo so the second build really reads the files again.
    clearQuestTierMemo();
    const rebuilt = await getFileQuestTier(1);
    expect(JSON.stringify(rebuilt.levels)).toBe(JSON.stringify(fromFiles[0]!.levels));
  }, 300_000);
});
