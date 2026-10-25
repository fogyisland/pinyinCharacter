// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 'server-only' throws outside a React Server Component graph. The data
// layer (and lib/content.ts behind it) is marked server-only, so the marker
// is neutralized for the test process.
vi.mock('server-only', () => ({}));

import { getQuestTier, clearQuestTierMemo } from '@/lib/game-quest-data';
import { buildLevel, buildTier, plainSyllable, toneFormsOf } from '@/lib/game-quest';
import { closePool } from '@/lib/db';
import type { QuestCharFact, QuestLevelPayload, QuestTier } from '@/lib/game-quest-types';
import tier1Fixture from '../../unit/lib/fixtures/quest-tier1.json';

// vitest does not load .env, so DATABASE_URL is unset in the test runner.
// Mirror the repo's other integration tests (etymology-era-font, import-hsk):
// skip cleanly unless the developer exports DATABASE_URL explicitly.
//
// To run it against the live database:
//   $env:DATABASE_URL = (Get-Content .env | Select-String '^DATABASE_URL=').ToString().Split('=',2)[1]
//   npx vitest run tests/integration/api/game-quest-db.test.ts
const integrationSkip = !process.env.DATABASE_URL;

/** The rows of every HSK tier in the live database. */
const TIER_SIZES = [178, 168, 272, 453, 639, 922];
/** The chars that survive the eligibility filter. */
const ELIGIBLE_POOLS = [152, 140, 220, 376, 535, 815];
/** The levels of every tier (the eligible pool sliced into levels of 5). */
const LEVEL_COUNTS = [31, 28, 44, 76, 107, 163];

/** How many pairs of chars in this level share a plain syllable. */
function sameSyllablePairs(readings: string[]): number {
  const counts = new Map<string, number>();
  for (const reading of readings) {
    const key = plainSyllable(reading);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let pairs = 0;
  for (const count of counts.values()) pairs += (count * (count - 1)) / 2;
  return pairs;
}

describe.skipIf(integrationSkip)('the real quest ladder', () => {
  const tiers: QuestTier[] = [];

  beforeAll(async () => {
    for (const tier of [1, 2, 3, 4, 5, 6]) {
      tiers.push(await getQuestTier(tier));
    }
  }, 180_000);

  afterAll(async () => {
    await closePool();
  });

  it('the tier sizes, the eligible pools and the level counts', () => {
    expect(tiers.map((tier) => tier.tierSize)).toEqual(TIER_SIZES);
    expect(tiers.map((tier) => tier.levels.flat().length)).toEqual(ELIGIBLE_POOLS);
    expect(tiers.map((tier) => tier.levels.length)).toEqual(LEVEL_COUNTS);
    expect(tiers.reduce((acc, tier) => acc + tier.levels.flat().length, 0)).toBe(2238);
    expect(tiers.reduce((acc, tier) => acc + tier.levels.length, 0)).toBe(449);
  });

  it('every level holds 5 chars except the two short tails', () => {
    const tails = tiers
      .flatMap((tier) =>
        tier.levels.map((level, index) => ({
          tier: tier.tier,
          level: index + 1,
          size: level.length,
        })),
      )
      .filter((level) => level.size !== 5);
    expect(tails).toEqual([
      { tier: 1, level: 31, size: 2 },
      { tier: 4, level: 76, size: 1 },
    ]);
  });

  it('the ladder keeps 21 same-syllable pairs', () => {
    let pairs = 0;
    for (const tier of tiers) {
      for (const level of tier.levels) {
        pairs += sameSyllablePairs(level.map((fact) => fact.reading));
      }
    }
    expect(pairs).toBe(21);
  });

  it('ORDER BY char determinism: two independent builds are byte-identical', async () => {
    const first = await getQuestTier(1);
    const firstLevels = JSON.stringify(first.levels);
    const firstPayload = JSON.stringify(buildLevel(first, 1));

    // Drop the memo so the second build really reads the database again.
    clearQuestTierMemo();
    const second = await getQuestTier(1);

    expect(JSON.stringify(second.levels)).toBe(firstLevels);
    expect(JSON.stringify(buildLevel(second, 1))).toBe(firstPayload);
  }, 180_000);

  it('the database tier 1 matches the unit fixture byte-for-byte', async () => {
    // The unit fixture (tests/unit/lib/fixtures/quest-tier1.json) was built
    // from the same content files, in the same order. If the database's
    // ORDER BY char disagreed with that order, the ④ meaning distractors
    // would drift from the spec's §6.1 payload — this is the cross-check
    // between Task 2's fixture and Task 3's data layer.
    const fromFixture = buildTier(tier1Fixture.tier, tier1Fixture.facts as QuestCharFact[]);
    const fromDatabase = await getQuestTier(1);
    expect(JSON.stringify(buildLevel(fromDatabase, 1))).toBe(
      JSON.stringify(buildLevel(fromFixture, 1)),
    );
  }, 180_000);

  it('the route serves a real level', async () => {
    // The route is called directly — the dev server is not involved, so the
    // whole stack (route → data layer → database → content files) is
    // exercised without a server.
    const { GET } = await import('@/app/api/game/quest/route');
    const res = await GET(new NextRequest('http://localhost/api/game/quest?hsk=1&level=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.hsk).toBe(1);
    expect(body.data.level).toBe(1);
    expect(body.data.levelCount).toBe(31);
    expect(body.data.tierSize).toBe(178);
    expect(body.data.chars).toHaveLength(5);
    for (const char of body.data.chars) {
      expect(char.questions).toHaveLength(4);
      for (const question of char.questions) {
        expect(question.options).toHaveLength(4);
        expect(question.answerIndex).toBeGreaterThanOrEqual(0);
        expect(question.answerIndex).toBeLessThanOrEqual(3);
      }
    }
  }, 180_000);

  it('the route answers 404 for a level beyond the tier', async () => {
    const { GET } = await import('@/app/api/game/quest/route');
    const res = await GET(new NextRequest('http://localhost/api/game/quest?hsk=1&level=999'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('level_not_found');
  }, 180_000);

  it('no question is broken: every answer has an option and ② answers a tone form', () => {
    const violations: string[] = [];
    let checked = 0;

    for (const tier of tiers) {
      for (let level = 1; level <= tier.levels.length; level++) {
        let payload: QuestLevelPayload | null = null;
        try {
          payload = buildLevel(tier, level);
        } catch (err) {
          violations.push(`HSK${tier.tier} L${level}: build failed — ${(err as Error).message}`);
          continue;
        }
        if (!payload) {
          violations.push(`HSK${tier.tier} L${level}: no payload`);
          continue;
        }
        for (const char of payload.chars) {
          checked++;
          if (char.questions.length !== 4) {
            violations.push(`${char.char}: ${char.questions.length} questions instead of 4`);
          }
          for (const question of char.questions) {
            if (question.options.length !== 4) {
              violations.push(`${char.char} ${question.kind}: ${question.options.length} options`);
            }
            if (question.answerIndex < 0 || question.answerIndex > 3) {
              violations.push(`${char.char} ${question.kind}: answerIndex ${question.answerIndex}`);
            }
          }
          // The ② option set is toneFormsOf(char) — the correct option has to
          // be one of them, or the question has no answer.
          const tone = char.questions.find((question) => question.kind === 'tone');
          const forms = toneFormsOf(char.char);
          if (!tone) {
            violations.push(`${char.char}: no tone question`);
            continue;
          }
          if (!forms) {
            violations.push(`${char.char}: no tone forms`);
            continue;
          }
          const correct = tone.options[tone.answerIndex];
          if (!correct || !forms.includes(correct)) {
            violations.push(
              `${char.char}: tone answer "${correct}" is not one of [${forms.join(', ')}]`,
            );
          }
          if (!forms.includes(char.pinyin)) {
            violations.push(
              `${char.char}: reading "${char.pinyin}" is not one of [${forms.join(', ')}]`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
    expect(checked).toBe(2238);
  }, 180_000);
});
