import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { encodePng } from '@/lib/png/encode';
import { findMissingGlyphs } from '@/lib/png/glyph';
import { pageCount, pagePixelCount, renderWorksheetPage } from '@/lib/png/worksheet-page';
import { findScheme } from '@/lib/worksheet-schemes';
import {
  BRUSH_PAPER_SIZES,
  generateLayout,
  getPresentation,
  getTool,
  validateWorksheetInput,
  type CellStyle,
  type FontFamily,
  type PaperSize,
} from '@/lib/worksheet-types';
import { McpError, notFound } from '../errors';
import {
  acquireRenderPermit,
  MAX_CONCURRENT_RENDERS,
  releaseRenderPermit,
} from './render-guard';
import { requirePage, requireText } from './shared';

/**
 * The worksheet PNG renderer.
 *
 * The bridge between an MCP request and the site's own rasteriser: the
 * request is resolved into a cell style, a paper size and a font, the site's
 * own validator is run over the content, and the page is drawn by
 * `lib/png/worksheet-page.ts` — the code the printable worksheet uses.
 *
 * NODE ONLY. The renderer reads the site's woff2 fonts from `public/fonts`
 * through `node:fs`, so it may only ever run on the server.
 */

/**
 * The largest canvas the renderer allocates, in device pixels.
 *
 * The canvas is the memory: an A3 page at scale 2 is 2246x3174 = 7.13 Mpx,
 * which is 27 MiB of RGBA buffer plus the encoder's copy of it. A4 at scale 2
 * is 1588x2246 = 3.57 Mpx and stays inside the budget — that is a
 * documented, legitimate use — so the limit sits between the two.
 */
const MAX_RENDER_PIXELS = 4_000_000;

/** The cell style a request without a scheme falls back to. */
const DEFAULT_CELL_STYLE: CellStyle = 'brush-square';

/** The font a request without a scheme falls back to. */
const DEFAULT_FONT_FAMILY: FontFamily = 'ma-shan-zheng';

/** The title a request without one falls back to. */
const DEFAULT_TITLE = 'Untitled';

/** The name the footer carries when the site url is not configured. */
const SITE_NAME = '字·韵';

/** A request for one page of a worksheet. */
export interface RenderRequest {
  /** The characters to practise. */
  content: string;
  /** The id of a scheme from the catalogue — it gives all three formats at once. */
  scheme?: string;
  /** The shape of one practice cell. */
  cellStyle?: CellStyle;
  /** The sheet the cells are laid out on. */
  paperSize?: PaperSize;
  /** The font the characters are written in. */
  fontFamily?: FontFamily;
  /** The title printed in the header band. */
  title?: string;
  /** The page to draw, 1-based. */
  page?: number;
  /** 1 draws the page at its natural size, 2 at twice the resolution. */
  scale?: number;
}

/** The answer of the renderer: the metadata and the image itself. */
export interface RenderOutcome {
  /** The metadata of the page, handed back as the tool's `data`. */
  data: Record<string, unknown>;
  /** The PNG as an image content block. */
  extraContent: CallToolResult['content'];
}

/** The format a request is rendered in, once every source has been consulted. */
interface Format {
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  /** The scheme the request named, when it named one. */
  scheme?: string;
}

/**
 * Renders one page of a worksheet and answers with the page metadata and the
 * image itself.
 *
 * @throws McpError `not_found` for a scheme the catalogue does not hold,
 * `bad_input` for a content, a page or a scale that cannot be rendered.
 */
export async function renderWorksheet(request: RenderRequest): Promise<RenderOutcome> {
  const format = resolveFormat(request);
  assertPaperFits(format.cellStyle, format.paperSize);
  const { title, content, characters } = resolveContent(request, format);
  const totalPages = pageCount(format.cellStyle, format.paperSize, characters.length);
  const page = resolvePage(request.page, totalPages);
  const scale = resolveScale(request.scale);
  assertRenderSize(format.paperSize, scale);
  const cells = generateLayout(characters, format.cellStyle, format.paperSize);
  // The permit is taken before the canvas is allocated and given back in the
  // `finally` below, so an exception cannot leak it.
  if (!acquireRenderPermit()) {
    throw new McpError(
      'bad_input',
      'the renderer is busy — try again in a moment',
      { limit: MAX_CONCURRENT_RENDERS },
    );
  }
  try {
    const canvas = await renderWorksheetPage({
      title,
      cells,
      cellStyle: format.cellStyle,
      paperSize: format.paperSize,
      fontFamily: format.fontFamily,
      page,
      scale,
      siteHost: siteHost(),
    });
    const png = await encodePng(canvas);
    const base64 = Buffer.from(png).toString('base64');
    return {
      data: {
        title,
        ...(format.scheme ? { scheme: format.scheme } : {}),
        cellStyle: format.cellStyle,
        paperSize: format.paperSize,
        fontFamily: format.fontFamily,
        page,
        totalPages,
        width: canvas.width,
        height: canvas.height,
        bytes: png.byteLength,
        base64Length: base64.length,
        missingGlyphs: findMissingGlyphs(content, format.fontFamily),
      },
      extraContent: [{ type: 'image', data: base64, mimeType: 'image/png' }],
    };
  } finally {
    releaseRenderPermit();
  }
}

/**
 * Resolves the format of a request.
 *
 * A scheme gives all three parts at once, an explicit argument overrides the
 * scheme, and a request with neither falls back to the site's own defaults —
 * the brush sheet on the big brush paper.
 */
function resolveFormat(request: RenderRequest): Format {
  const scheme = request.scheme === undefined ? undefined : findScheme(request.scheme);
  if (request.scheme !== undefined && !scheme) throw schemeNotFound(request.scheme);
  const cellStyle = request.cellStyle ?? scheme?.cellStyle ?? DEFAULT_CELL_STYLE;
  const paperSize = request.paperSize ?? scheme?.paperSize ?? paperSizeFor(cellStyle);
  const fontFamily = request.fontFamily ?? scheme?.fontFamily ?? DEFAULT_FONT_FAMILY;
  return {
    cellStyle,
    paperSize,
    fontFamily,
    ...(scheme ? { scheme: scheme.id } : {}),
  };
}

/** The paper a cell style is printed on when the caller names none. */
function paperSizeFor(cellStyle: CellStyle): PaperSize {
  return getTool(cellStyle) === 'brush' ? 'brush-12' : 'A4';
}

/** The error a request with an unknown scheme gets. */
function schemeNotFound(id: string): McpError {
  const error = notFound('scheme', id);
  return new McpError(error.code, error.message, { ...error.details, scheme: id });
}

/**
 * Refuses a combination the site would draw as an empty sheet.
 *
 * The lined paper and the four-line paper have no rows on the brush papers —
 * the site's own row count for them is zero — so the sheet would carry a
 * header and a footer and nothing else. The site draws that sheet too, but a
 * tool must not hand out a blank page as if it were a worksheet.
 */
function assertPaperFits(cellStyle: CellStyle, paperSize: PaperSize): void {
  const presentation = getPresentation(cellStyle);
  if (presentation !== 'lined' && presentation !== 'four-line') return;
  if (!(BRUSH_PAPER_SIZES as readonly string[]).includes(paperSize)) return;
  const paper = presentation === 'lined' ? 'the lined paper' : 'the four-line paper';
  throw new McpError(
    'bad_input',
    `${paper} does not come in the ${paperSize} format — the site's row count for it is zero, so the sheet would be blank`,
    { cellStyle, paperSize },
  );
}

/** The title and the characters of a request, after the site's own validation. */
function resolveContent(
  request: RenderRequest,
  format: Format,
): { title: string; content: string; characters: string[] } {
  const title = requireText(request.title ?? DEFAULT_TITLE, 'title', 80);
  const content = requireText(request.content, 'content', 500);
  const characters = Array.from(content);
  // The site's own validator — the same rules the worksheet route enforces,
  // so a sheet the site would reject never reaches a caller.
  const validated = validateWorksheetInput({
    title,
    content: characters,
    cellStyle: format.cellStyle,
    paperSize: format.paperSize,
  });
  if (!validated.ok) {
    throw new McpError('bad_input', validated.error, { field: 'content' });
  }
  return { title, content, characters };
}

/** The page to draw, which has to exist on the sheet. */
function resolvePage(requested: number | undefined, totalPages: number): number {
  const page = requirePage(requested ?? 1);
  if (page > totalPages) {
    throw new McpError('bad_input', `page must be between 1 and ${totalPages} — got ${page}`, {
      page,
      totalPages,
    });
  }
  return page;
}

/** The resolution of the page: the natural size, or twice it. */
function resolveScale(requested: number | undefined): number {
  const scale = requested ?? 1;
  if (scale !== 1 && scale !== 2) {
    throw new McpError('bad_input', `scale must be 1 or 2 — got ${scale}`, { scale });
  }
  return scale;
}

/**
 * Refuses a page whose canvas would be bigger than the budget.
 *
 * The check runs before the canvas is allocated, so a request that is too
 * big costs nothing but the arithmetic.
 */
function assertRenderSize(paperSize: PaperSize, scale: number): void {
  const pixels = pagePixelCount(paperSize, scale);
  if (pixels <= MAX_RENDER_PIXELS) return;
  throw new McpError(
    'bad_input',
    `the page would be ${pixels} device pixels, which is over the renderer's budget of ${MAX_RENDER_PIXELS} — use a smaller paper or scale 1`,
    { pixels, maxPixels: MAX_RENDER_PIXELS, paperSize, scale },
  );
}

/**
 * The host the page footer prints.
 *
 * The site's own printable worksheet reads it from the environment, and so
 * does this: the PNG has to be the sheet the site prints, and the site does
 * not go to the database for its own pages either — the tools stay
 * file-only, and only the auth path talks to MySQL.
 */
function siteHost(): string {
  return hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? '') || SITE_NAME;
}

/**
 * The host part of a url, or the string itself when it is not a url.
 *
 * The site's own printable worksheet uses the same helper; the difference is
 * that a url this cannot read is logged here instead of passing by unnoticed.
 */
function hostOf(raw: string): string {
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch (error) {
    console.error('[mcp] the site url could not be read as a url', { siteUrl: raw, error });
    return raw;
  }
}
