import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getFileQuestTier } from '@/lib/game-quest-data';
import { buildLevel } from '@/lib/game-quest';
import { revealedFacets } from '@/lib/game-quest-reveal';
import { McpError } from '../errors';
import { runTool } from '../tool-result';

/**
 * The quest tools — the character game's content and its reveal rule.
 *
 * The tier is built from the files (data/hsk-vocab.json,
 * data/radicals.json, data/content/<char>.json), so no database is involved.
 * The result is byte-identical to what the site's own quest API serves.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The HSK tier of the ladder. */
const TIER = z.number().int().min(1).max(6);

export function registerQuestTools(server: McpServer): void {
  server.registerTool(
    'build_quest_level',
    {
      title: 'Build one level of the character quest',
      description:
        'One level of the character game (闯关): the characters of the level with the ' +
        'four questions asked about each of them — the reading, the tone, the radical ' +
        'and the meaning — each with its four options. The levels are built from the ' +
        'character library, without a database.',
      inputSchema: {
        hsk: TIER.describe('the HSK tier, 1 to 6'),
        level: z.number().int().min(1).describe('the level inside the tier, 1-based'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const tier = await getFileQuestTier(args.hsk);
        const payload = buildLevel(tier, args.level);
        if (!payload) {
          throw new McpError(
            'not_found',
            `level ${args.level} is beyond HSK ${args.hsk} — the tier has ${tier.levels.length} levels`,
            { hsk: args.hsk, level: args.level, levelCount: tier.levels.length },
          );
        }
        return {
          data: {
            ...payload,
            tierSize: tier.tierSize,
            skipped: tier.skipped,
          },
        };
      }),
  );

  server.registerTool(
    'reveal_facets',
    {
      title: 'Work out which hints may be shown',
      description:
        'The reveal rule of the character game: which parts of the character card may ' +
        'be shown at a given moment. A part stays hidden while a pending question of ' +
        'the current round tests it — the pinyin, for instance, stays hidden until the ' +
        'tone question is answered, because the tone question\'s options are the four ' +
        'tone forms of that very syllable.',
      inputSchema: {
        kind: z
          .enum(['main', 'remediation'])
          .describe('the kind of round — the first pass over the level, or the retry'),
        charIndex: z.number().int().min(0).describe('the character being asked about'),
        questionIndex: z.number().int().min(0).describe('the question being asked, 0-based'),
        questionIndices: z
          .array(z.array(z.number().int().min(0)))
          .describe('for each character of the round, the question indices it asks, in order'),
        answeredCounts: z
          .array(z.number().int().min(0))
          .describe('for each character of the round, how many of its questions are answered'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const facets = revealedFacets(args.charIndex, args.questionIndex, {
          kind: args.kind,
          questionIndices: args.questionIndices,
          answeredCounts: args.answeredCounts,
        });
        return {
          data: {
            kind: args.kind,
            charIndex: args.charIndex,
            questionIndex: args.questionIndex,
            showPinyin: facets.pinyin,
            showRadical: facets.radical,
            showMeaning: facets.meaning,
          },
        };
      }),
  );
}
