import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  cellStyleLabel,
  generateLayout,
  getTool,
  paperSizeLabel,
  validateWorksheetInput,
  type CellStyle,
  type FontFamily,
  type PaperSize,
} from '@/lib/worksheet-types';
import { WORKSHEET_SCHEMES } from '@/lib/worksheet-schemes';
import { McpError } from '../errors';
import { runTool } from '../tool-result';
import { requireText } from './shared';
import { renderWorksheet } from './worksheet-render';

/**
 * The worksheet tools — the layout of a practice sheet.
 *
 * The layout is computed by lib/worksheet-types.ts, the same code the site's
 * own worksheet route uses, so a caller gets the cells the site would draw.
 * The last two tools go one step further: the catalogue of the ready-made
 * schemes, and the sheet itself as a PNG image.
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

/** The fonts a worksheet may be written in. */
const FONT_FAMILY = z.enum([
  'song',
  'kai',
  'hei',
  'wenkai-gb',
  'yozai',
  'iansui',
  'zen-kaku-thin',
  'ma-shan-zheng',
  'long-cang',
  'liu-jian-mao-cao',
  'zcool-xiaowei',
  'zhi-mang-xing',
]);

/** A scheme as the catalogue tool answers it. */
interface ListedScheme {
  id: string;
  name: string;
  nameZh: string;
  cellStyle: CellStyle;
  cellStyleLabel: string;
  paperSize: PaperSize;
  paperSizeLabel: string;
  fontFamily: FontFamily;
  note: string;
}

/**
 * The catalogue of the schemes, narrowed to one tool when the caller asks
 * for one.
 *
 * The labels are added here because a caller picks a scheme by its id and
 * then has to describe it to a human — the labels are what the site's own
 * pickers show.
 */
function listedSchemes(tool: 'brush' | 'pen' | undefined): ListedScheme[] {
  return WORKSHEET_SCHEMES.filter((scheme) => !tool || getTool(scheme.cellStyle) === tool).map(
    (scheme) => ({
      id: scheme.id,
      name: scheme.name,
      nameZh: scheme.nameZh,
      cellStyle: scheme.cellStyle,
      cellStyleLabel: cellStyleLabel(scheme.cellStyle),
      paperSize: scheme.paperSize,
      paperSizeLabel: paperSizeLabel(scheme.paperSize),
      fontFamily: scheme.fontFamily,
      note: scheme.note,
    }),
  );
}

/**
 * Registers the three worksheet tools.
 *
 * The registry is split per tool so that the wording of one tool cannot be
 * lost in the middle of another one; the order of the registrations is the
 * order the tools are listed in the README.
 */
export function registerWorksheetTools(server: McpServer): void {
  registerLayoutTool(server);
  registerSchemeCatalogueTool(server);
  registerRenderTool(server);
}

/** The descriptor of the layout tool — its wording and its input schema. */
const LAYOUT_TOOL = {
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
};

/** Registers the layout tool — the cells of a practice sheet. */
function registerLayoutTool(server: McpServer): void {
  server.registerTool(
    'generate_worksheet_layout',
    LAYOUT_TOOL,
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

/** Registers the catalogue tool — the ready-made schemes and their labels. */
function registerSchemeCatalogueTool(server: McpServer): void {
  server.registerTool(
    'list_worksheet_schemes',
    {
      title: 'List the worksheet schemes',
      description:
        'The catalogue of the ready-made worksheet schemes (字帖方案): sixteen named ' +
        'formats, each with a cell style, a paper size and a font. The tool argument ' +
        'narrows the catalogue to the brush schemes (毛笔) or the hard-pen ones (钢笔).',
      inputSchema: {
        tool: z
          .enum(['brush', 'pen'])
          .optional()
          .describe('the tool to narrow the catalogue to (default: both)'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const schemes = listedSchemes(args.tool);
        return { data: { total: schemes.length, schemes } };
      }),
  );
}

/** Registers the renderer — the sheet itself, as a PNG image. */
function registerRenderTool(server: McpServer): void {
  server.registerTool(
    'render_worksheet_png',
    {
      title: 'Render a practice worksheet as a PNG',
      description:
        'Render a practice worksheet (字帖) as a PNG image — the sheet the site prints, ' +
        'drawn by the rasteriser the printable worksheet uses: the same paper sizes, ' +
        'the same margins, the same header and footer. The image comes back as an ' +
        'image content block, so it can be looked at, together with the metadata of ' +
        'the page. Legal values — cellStyle: brush-square, brush-cross, pen-square, ' +
        'pen-cross, brush-trace-square, brush-trace-cross, pen-lined, pen-english; ' +
        'paperSize: A3, A4, B5, brush-12, brush-24, brush-28; fontFamily: song, kai, ' +
        'hei, wenkai-gb, yozai, zen-kaku-thin, iansui, ma-shan-zheng, long-cang, ' +
        'liu-jian-mao-cao, zcool-xiaowei, zhi-mang-xing; page: the page to draw, ' +
        '1 and up; scale: 1 for the natural size, 2 for twice the resolution.',
      inputSchema: {
        content: z.string().describe('the characters to practise, e.g. "天地玄黄"'),
        scheme: z
          .string()
          .optional()
          .describe('the id of a scheme from list_worksheet_schemes — it gives the cell style, the paper size and the font at once'),
        cellStyle: CELL_STYLE.optional().describe('the style of the practice cell'),
        paperSize: PAPER_SIZE.optional().describe(
          'the paper size (default A4 for the pen styles, brush-12 for the brush styles)',
        ),
        fontFamily: FONT_FAMILY.optional().describe('the font the characters are written in'),
        title: z.string().optional().describe('the title printed in the header band'),
        page: z.number().optional().describe('the page to draw, 1 and up (default 1)'),
        scale: z.number().optional().describe('1 for the natural size, 2 for twice the resolution'),
      },
      annotations: READ_ONLY,
    },
    async (args) => runTool(async () => renderWorksheet(args)),
  );
}
