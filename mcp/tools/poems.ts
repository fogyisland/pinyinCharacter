import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadManifest, loadPoem } from '@/lib/poetry/loader';
import { McpError, notFound } from '../errors';
import { runTool } from '../tool-result';
import { requirePage } from './shared';

/**
 * The poem tools — the classical poetry collection.
 *
 * The collection is a set of files (data/poems-manifest.json and
 * data/poems/<id>.json). No database is involved.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** How many poems a page holds when the caller does not say. */
const DEFAULT_PAGE_SIZE = 20;

export function registerPoemTools(server: McpServer): void {
  server.registerTool(
    'list_poems',
    {
      title: 'List the classical poems',
      description:
        'The poems of the collection, newest id last, with their title, author and ' +
        'dynasty. A search term narrows the list to the poems whose title, author or ' +
        'category contains it.',
      inputSchema: {
        q: z
          .string()
          .max(80)
          .optional()
          .describe('a search term matched against the title, the author and the category'),
        page: z.number().int().min(1).optional().describe('the page number, 1-based'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(`how many poems a page holds (default ${DEFAULT_PAGE_SIZE})`),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const manifest = await loadManifest();
        const term = (args.q ?? '').trim();
        const filtered = term
          ? manifest.items.filter(
              (item) =>
                item.title.includes(term) ||
                item.author.includes(term) ||
                (item.category ?? '').includes(term),
            )
          : manifest.items;
        const page = requirePage(args.page ?? 1);
        const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
        const offset = (page - 1) * pageSize;
        return {
          data: {
            total: filtered.length,
            page,
            pageSize,
            items: filtered.slice(offset, offset + pageSize).map((item) => ({
              id: item.id,
              title: item.title,
              author: item.author,
              dynasty: item.dynasty,
              category: item.category,
              form: item.form,
              lineCount: item.contentLineCount,
            })),
          },
        };
      }),
  );

  server.registerTool(
    'get_poem',
    {
      title: 'Read one classical poem',
      description:
        'One poem of the collection: its title, author, dynasty, the text line by line ' +
        'with the pinyin of every line, the appreciation and the source.',
      inputSchema: {
        id: z.number().int().min(1).describe('the poem id — list_poems reports them'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const poem = await loadPoem(args.id);
        if (!poem) throw notFound('poem', args.id);
        if (!Array.isArray(poem.content) || poem.content.length === 0) {
          throw new McpError('data_unavailable', `the poem ${args.id} holds no text`, {
            id: args.id,
          });
        }
        return {
          data: {
            id: poem.id,
            title: poem.title,
            author: poem.author,
            dynasty: poem.dynasty,
            category: poem.category,
            form: poem.form,
            content: poem.content,
            pinyin: poem.pinyin ?? [],
            appreciation: poem.appreciation ?? null,
            source: poem.source ?? null,
          },
        };
      }),
  );
}
