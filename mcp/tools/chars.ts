import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readContentFromFs } from '@/lib/content';
import { getRadical } from '@/lib/radical';
import { getStrokeCount } from '@/lib/stroke-count';
import { resolvePinyin } from '@/lib/pinyin-index';
import { plainSyllable, toneFormsOf } from '@/lib/game-quest';
import { McpError } from '../errors';
import { runTool } from '../tool-result';
import { requireCjkChar } from './shared';

/**
 * The char tools — what a single Han character knows about itself.
 *
 * Everything here reads a file: data/content/<char>.json for the dictionary
 * and the story, public/strokes/<char>.json for the stroke count,
 * data/radicals.json for the radical. No database is involved.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerCharTools(server: McpServer): void {
  server.registerTool(
    'get_char',
    {
      title: 'Look up a Han character',
      description:
        'Look up one Han character: its pinyin, its Chinese and English meaning, its ' +
        'alternate readings, its variant forms and its etymology story. The data comes ' +
        'from the character library (data/content/<char>.json).',
      inputSchema: {
        char: z
          .string()
          .min(1)
          .max(4)
          .describe('the Han character to look up, e.g. "爱"'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const char = requireCjkChar(args.char);
        const content = readContentFromFs(char);
        if (!content) {
          // A missing file and a file that fails the schema both land here.
          // The message says so, because the two need different fixes.
          throw new McpError(
            'not_found',
            `the character library holds no usable entry for ${char} — the file is missing or does not match the schema`,
            { char },
          );
        }
        return {
          data: {
            char: content.char,
            pinyin: content.pinyin,
            level: content.level ?? null,
            meaningZh: content.dict?.meaning_zh ?? content.meaning_zh ?? null,
            meaningEn: content.dict?.meaning_en ?? null,
            pinyinAlt: content.dict?.pinyin_alt ?? [],
            variants: content.dict?.variants ?? [],
            story: content.etymology?.story ?? content.etymology_story ?? null,
            storySource: content.etymology?.generated_by ?? null,
            hanziStory: content.hanzi_story ?? null,
            rare: content.rare
              ? { meaning: content.rare.meaning ?? null, story: content.rare.story ?? null }
              : null,
          },
        };
      }),
  );

  server.registerTool(
    'get_radical',
    {
      title: "Get a character's radical",
      description:
        'The radical (部首) of one Han character — the component the character is ' +
        'indexed under. The radical comes from data/radicals.json.',
      inputSchema: {
        char: z
          .string()
          .min(1)
          .max(4)
          .describe('the Han character, e.g. "树"'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const char = requireCjkChar(args.char);
        const radical = getRadical(char);
        return {
          data: {
            char,
            radical,
            known: radical !== null,
          },
        };
      }),
  );

  server.registerTool(
    'get_stroke_count',
    {
      title: "Get a character's stroke count",
      description:
        'How many strokes one Han character is written with. The count comes from ' +
        'the bundled stroke-order data (public/strokes/<char>.json); it is null for ' +
        'the characters the stroke data does not cover.',
      inputSchema: {
        char: z
          .string()
          .min(1)
          .max(4)
          .describe('the Han character, e.g. "七"'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const char = requireCjkChar(args.char);
        const strokeCount = getStrokeCount(char);
        return {
          data: {
            char,
            strokeCount,
            known: strokeCount !== null,
          },
        };
      }),
  );

  server.registerTool(
    'get_tone_forms',
    {
      title: 'Get the four tone forms of a character',
      description:
        "The four tone-marked spellings of a character's syllable (1st to 4th tone), " +
        'together with its plain (toneless) syllable. These are the four options of ' +
        "the tone question in the character game, so a caller can build that question " +
        'itself.',
      inputSchema: {
        char: z
          .string()
          .min(1)
          .max(4)
          .describe('the Han character, e.g. "爱"'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const char = requireCjkChar(args.char);
        const reading = resolvePinyin(char, null);
        const forms = toneFormsOf(char);
        if (!forms) {
          throw new McpError(
            'data_unavailable',
            `the tone forms of ${char} could not be derived — pinyin-pro knows no syllable for it`,
            { char },
          );
        }
        return {
          data: {
            char,
            reading,
            plainSyllable: plainSyllable(reading),
            toneForms: forms,
          },
        };
      }),
  );
}
