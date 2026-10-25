import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSutraByIdFromFs, listSutrasFromFs } from '@/lib/sutras-fs';
import { McpError, notFound } from '../errors';
import { runTool } from '../tool-result';

/**
 * The sutra tools — the Buddhist scriptures.
 *
 * The scriptures are a set of files (data/sutras/manifest.json and
 * data/sutras/<slug>.json). No database is involved.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** How many sutras a page holds when the caller does not say. */
const DEFAULT_PAGE_SIZE = 12;

export function registerSutraTools(server: McpServer): void {
  server.registerTool(
    'list_sutras',
    {
      title: 'List the Buddhist scriptures',
      description:
        'The scriptures of the collection with their title, their slug and how many ' +
        'chunks and characters each of them holds.',
      inputSchema: {
        q: z.string().max(80).optional().describe('a search term matched against the title'),
        page: z.number().int().min(1).optional().describe('the page number, 1-based'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(`how many scriptures a page holds (default ${DEFAULT_PAGE_SIZE})`),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const result = listSutrasFromFs({
          q: args.q,
          page: args.page ?? 1,
          pageSize: args.pageSize ?? DEFAULT_PAGE_SIZE,
        });
        if (!result) {
          throw new McpError(
            'data_unavailable',
            'the sutra files are not readable — data/sutras/manifest.json is missing',
          );
        }
        return {
          data: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            items: result.items,
          },
        };
      }),
  );

  server.registerTool(
    'get_sutra_chunk',
    {
      title: 'Read a chapter of a scripture',
      description:
        'One chapter of a scripture: its text line by line with the pinyin of every ' +
        'line. Without a chapter number the tool answers with the chapter list of ' +
        'the scripture instead of its text.',
      inputSchema: {
        id: z.number().int().min(1).describe('the scripture id — list_sutras reports them'),
        chunk: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('the chapter number, 1-based — omit it for the chapter list'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const sutra = getSutraByIdFromFs(args.id);
        if (!sutra) throw notFound('sutra', args.id);
        if (args.chunk === undefined) {
          return {
            data: {
              id: sutra.id,
              title: sutra.title,
              slug: sutra.slug,
              chunkCount: sutra.chunks.length,
              chunks: sutra.chunks.map((chunk) => ({
                id: chunk.id,
                label: chunk.label,
                lineCount: chunk.content.length,
              })),
            },
          };
        }
        const chunk = sutra.chunks[args.chunk - 1];
        if (!chunk) {
          throw new McpError(
            'not_found',
            `chapter ${args.chunk} is beyond ${sutra.title} — it has ${sutra.chunks.length} chapters`,
            { id: sutra.id, chunk: args.chunk, chunkCount: sutra.chunks.length },
          );
        }
        return {
          data: {
            id: sutra.id,
            title: sutra.title,
            slug: sutra.slug,
            chunk: {
              id: chunk.id,
              label: chunk.label,
              content: chunk.content,
              pinyin: chunk.pinyin ?? [],
            },
          },
        };
      }),
  );
}
