import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadClassicFile, loadManifest } from '@/lib/classics/loader';
import { McpError, notFound } from '../errors';
import { runTool } from '../tool-result';
import { requireClassicSlug, requirePage } from './shared';

/**
 * The classic tools — the classical Chinese books.
 *
 * The books are a set of files (data/classics-manifest.json and
 * data/classics/<slug>.json). A single book can be 8 MB of JSON, so the
 * tools are split the same way the site splits them: the outline carries
 * the chapter list without the text, the chapter carries one chapter.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** How many books a page holds when the caller does not say. */
const DEFAULT_PAGE_SIZE = 20;

/** The categories a book can be filed under. */
const CATEGORY = z.enum([
  'four-books',
  'five-classics',
  'mengxue',
  'philosophy',
  'history',
  'other',
  'pianwen',
]);

/**
 * The slug of a classical book.
 *
 * The site's own API route validates the slug with the very same rule —
 * `classicSlugParamSchema` in lib/validators.ts: lowercase letters, digits
 * and dashes — so the MCP tool follows the site instead of inventing a rule
 * of its own. A slug becomes a file path (`data/classics/<slug>.json`), so
 * anything else, a `..` segment above all, would read a file outside the
 * classics directory. The loader refuses such a slug as well; this is the
 * first line of defence.
 */
const CLASSIC_SLUG = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, 'the slug must be lowercase letters, digits and dashes');

export function registerClassicTools(server: McpServer): void {
  server.registerTool(
    'list_classics',
    {
      title: 'List the classical books',
      description:
        'The classical books of the collection with their title, author, era and ' +
        'category. A search term narrows the list to the books whose title or author ' +
        'contains it.',
      inputSchema: {
        q: z
          .string()
          .max(80)
          .optional()
          .describe('a search term matched against the title and the author'),
        category: CATEGORY.optional().describe('keep only the books of this category'),
        page: z.number().int().min(1).optional().describe('the page number, 1-based'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(`how many books a page holds (default ${DEFAULT_PAGE_SIZE})`),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const manifest = await loadManifest();
        const term = (args.q ?? '').trim();
        const filtered = manifest.books.filter((book) => {
          if (args.category && book.category !== args.category) return false;
          if (!term) return true;
          return book.title.includes(term) || (book.author ?? '').includes(term);
        });
        const page = requirePage(args.page ?? 1);
        const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
        const offset = (page - 1) * pageSize;
        return {
          data: {
            total: filtered.length,
            page,
            pageSize,
            items: filtered.slice(offset, offset + pageSize).map((book) => ({
              slug: book.slug,
              title: book.title,
              category: book.category,
              author: book.author,
              era: book.era,
              chapterCount: book.chapterCount,
              charCount: book.charCount,
            })),
          },
        };
      }),
  );

  server.registerTool(
    'get_classic_outline',
    {
      title: "Get a classical book's outline",
      description:
        "A classical book's chapter list — the label of every chapter, without the " +
        'text. The text of a whole book can be 8 MB, so the outline is the cheap way ' +
        'to see what is in it.',
      inputSchema: {
        slug: CLASSIC_SLUG.describe("the book's slug — list_classics reports them"),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const slug = requireClassicSlug(args.slug);
        const book = await loadClassicFile(slug);
        if (!book) throw notFound('classic book', slug);
        return {
          data: {
            slug: book.slug,
            title: book.title,
            category: book.category,
            author: book.author,
            era: book.era,
            source: book.source,
            chunkCount: book.chunks.length,
            chunks: book.chunks.map((chunk) => ({
              id: chunk.id,
              label: chunk.label,
              lineCount: chunk.content.length,
            })),
          },
        };
      }),
  );

  server.registerTool(
    'get_classic_chapter',
    {
      title: 'Read one chapter of a classical book',
      description:
        'One chapter of a classical book: its label and its text line by line. The ' +
        'pinyin of every line is included as well.',
      inputSchema: {
        slug: CLASSIC_SLUG.describe("the book's slug — list_classics reports them"),
        chapter: z.number().int().min(1).describe('the chapter number, 1-based'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const slug = requireClassicSlug(args.slug);
        const book = await loadClassicFile(slug);
        if (!book) throw notFound('classic book', slug);
        const chapter = book.chunks[args.chapter - 1];
        if (!chapter) {
          throw new McpError(
            'not_found',
            `chapter ${args.chapter} is beyond ${book.title} — it has ${book.chunks.length} chapters`,
            { slug, chapter: args.chapter, chapterCount: book.chunks.length },
          );
        }
        return {
          data: {
            slug: book.slug,
            title: book.title,
            chapterCount: book.chunks.length,
            chapter: {
              id: chapter.id,
              label: chapter.label,
              content: chapter.content,
              pinyin: chapter.pinyin ?? [],
            },
          },
        };
      }),
  );
}
