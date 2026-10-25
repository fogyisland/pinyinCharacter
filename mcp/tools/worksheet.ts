import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateLayout,
  getTool,
  paperSizeLabel,
  validateWorksheetInput,
} from '@/lib/worksheet-types';
import { McpError } from '../errors';
import { runTool } from '../tool-result';
import { requireText } from './shared';

/**
 * The worksheet tools — the layout of a practice sheet.
 *
 * The layout is computed by lib/worksheet-types.ts, the same code the site's
 * own worksheet route uses, so a caller gets the cells the site would draw.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The cell styles a worksheet may use. */
const CELL_STYLE = z.enum([
  'brush-square',
  'brush-cross',
  'pen-square',
  'pen-cross',
  'brush-trace-square',
  'brush-trace-cross',
  'pen-lined',
  'pen-english',
]);

/** The paper sizes a worksheet may use. */
const PAPER_SIZE = z.enum(['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28']);

export function registerWorksheetTools(server: McpServer): void {
  server.registerTool(
    'generate_worksheet_layout',
    {
      title: 'Lay out a practice worksheet',
      description:
        'The cells of a practice worksheet (字帖): the characters, the cell style ' +
        '(square, cross, four-line, lined, trace) and the paper size. The layout is ' +
        'padded to whole pages, so the last page is full of blank practice cells ' +
        'rather than a half-empty sheet.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('the title of the worksheet (default "Untitled")'),
        content: z
          .string()
          .min(1)
          .max(500)
          .describe('the characters to practise, e.g. "天地玄黄"'),
        cellStyle: CELL_STYLE.describe('the style of the practice cell'),
        paperSize: PAPER_SIZE.optional().describe(
          'the paper size (default A4 for the pen styles, brush-12 for the brush styles)',
        ),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const title = requireText(args.title ?? 'Untitled', 'title', 80);
        const content = requireText(args.content, 'content', 500);
        const paperSize =
          args.paperSize ?? (getTool(args.cellStyle) === 'brush' ? 'brush-12' : 'A4');

        // The site's own validator — the same rules the worksheet route
        // enforces, so a layout the site would reject never reaches a caller.
        const validated = validateWorksheetInput({
          title,
          content: Array.from(content),
          cellStyle: args.cellStyle,
          paperSize,
        });
        if (!validated.ok) {
          throw new McpError('bad_input', validated.error, { field: 'content' });
        }

        const cells = generateLayout(Array.from(content), args.cellStyle, paperSize);
        return {
          data: {
            title,
            cellStyle: args.cellStyle,
            paperSize,
            paperSizeLabel: paperSizeLabel(paperSize),
            cellCount: cells.length,
            cells,
          },
        };
      }),
  );
}
