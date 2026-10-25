import { z } from 'zod';
import { pinyin } from 'pinyin-pro';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCandidates } from '@/server/dictionary';
import { convertSentence } from '@/server/sentence-converter';
import { plainSyllable } from '@/lib/game-quest';
import { runTool } from '../tool-result';
import { isCjkChar, requireText } from './shared';

/**
 * The pinyin tools — the three directions of the reading.
 *
 *   pinyin → hanzi    (the dictionary's candidates)
 *   pinyin → sentence (the sentence a pinyin string spells out)
 *   text   → pinyin   (the reading of a piece of text)
 *
 * All three read files: data/pinyin-hanzi.json and data/bigrams.json. No
 * database is involved.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The script the dictionary answers in. */
const SCRIPT = z.enum(['simplified', 'traditional']);

/** The default number of candidates `pinyin_to_hanzi` returns. */
const DEFAULT_CANDIDATE_LIMIT = 30;

export function registerPinyinTools(server: McpServer): void {
  server.registerTool(
    'pinyin_to_hanzi',
    {
      title: 'Find the characters of a pinyin syllable',
      description:
        'The Han characters that are read with a given pinyin syllable, most frequent ' +
        'first. The syllable may carry a tone mark ("ài"), a tone digit ("ai4") or ' +
        'neither ("ai"); they all find the same candidates.',
      inputSchema: {
        pinyin: z
          .string()
          .min(1)
          .max(32)
          .describe('the pinyin syllable, e.g. "ài" or "ai4"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe(`how many candidates to return at most (default ${DEFAULT_CANDIDATE_LIMIT})`),
        safeMode: z
          .boolean()
          .optional()
          .describe('drop the characters and words on the block list (default false)'),
        script: SCRIPT.optional().describe('the script of the returned characters (default simplified)'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const syllable = requireText(args.pinyin, 'pinyin', 32);
        const limit = args.limit ?? DEFAULT_CANDIDATE_LIMIT;
        const script = args.script ?? 'simplified';
        const candidates = getCandidates(syllable, args.safeMode ?? false, script);
        return {
          data: {
            pinyin: syllable,
            total: candidates.length,
            candidates: candidates.slice(0, limit).map((entry) => ({
              char: entry.char,
              freq: entry.freq,
            })),
          },
        };
      }),
  );

  server.registerTool(
    'pinyin_to_sentence',
    {
      title: 'Spell a sentence out of pinyin',
      description:
        'Convert a pinyin string into the Chinese sentence it spells — the decoder ' +
        'picks the most likely characters for the syllable sequence. A word separator ' +
        '(a space or a punctuation mark) forces a break between two words.',
      inputSchema: {
        pinyin: z
          .string()
          .min(1)
          .max(500)
          .describe('the pinyin string, e.g. "ni hao" or "nihao"'),
        safeMode: z
          .boolean()
          .optional()
          .describe('drop the characters and words on the block list (default false)'),
        script: SCRIPT.optional().describe('the script of the returned sentence (default simplified)'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const text = requireText(args.pinyin, 'pinyin', 500);
        const script = args.script ?? 'simplified';
        const sentence = convertSentence(text, args.safeMode ?? false, script);
        return {
          data: {
            pinyin: text,
            sentence,
            length: sentence.length,
          },
        };
      }),
  );

  server.registerTool(
    'text_to_pinyin',
    {
      title: 'Read a piece of text out in pinyin',
      description:
        'The pinyin of every character of a piece of text, in order. The tone-marked ' +
        'reading and the plain (toneless) syllable are both given; the characters ' +
        'that are not Han keep their place with a null reading.',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .max(500)
          .describe('the text to read, e.g. "我爱汉字"'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const text = requireText(args.text, 'text', 500);
        const characters = Array.from(text).map((char) => {
          if (!isCjkChar(char)) return { char, pinyin: null, plain: null };
          const reading = pinyin(char, { toneType: 'symbol' }).trim();
          return { char, pinyin: reading, plain: plainSyllable(reading) };
        });
        return {
          data: {
            text,
            characters,
            pinyinLine: characters.map((entry) => entry.pinyin ?? entry.char).join(' '),
          },
        };
      }),
  );
}
