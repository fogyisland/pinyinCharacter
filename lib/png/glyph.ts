/**
 * Glyph outlines for the worksheet rasteriser.
 *
 * NODE ONLY. The fonts are read from `public/fonts/*.woff2` through
 * `node:fs`, so no client component may import this module — a `'use client'`
 * file that pulls it in fails at build time.
 *
 * Three rules shape the code:
 *
 * 1. **The font's own metrics decide where the baseline goes.** A character
 *    is centred in its cell by the em box, not by its ink, so the baseline
 *    sits below the centre by `(ascent + descent) / 2` em — 0.336 em for
 *    霞鹜文楷 GB, not zero.
 * 2. **The fallback is per character.** Every character is looked up in the
 *    requested font first and in the two fallbacks after it, so one sheet may
 *    mix fonts.
 * 3. **A character no font can draw is drawn as a tofu box and reported.** A
 *    silently blank cell is the one outcome the renderer must never produce.
 *
 * The font objects are cached by file name, so the second render does not
 * re-parse a 3 MB woff2. The missing-glyph list is **not** cached: it is
 * created fresh on every `loadFontSet` so one call cannot pollute the next.
 */

import path from 'node:path';
import * as fontkit from 'fontkit';
import type { Font, FontkitPath } from 'fontkit';
import { flattenBezierCurve, flattenQuadCurve, type Point, type Polygon } from './geometry';
import type { FontFamily } from '../worksheet-types';

/**
 * A font the site ships, ready to draw with.
 *
 * The vertical metrics are exposed in em units (1 = the font size) because
 * the page compositor needs them to centre a character in its cell.
 */
export interface LoadedFont {
  /** The file this font was loaded from — its identity inside the fallback chain. */
  family: string;
  /** Whether the font has a glyph for `char`. */
  hasGlyph(char: string): boolean;
  /** The outlines of `text`, drawn at `sizePx` with the pen at (`penX`, `baselineY`). */
  outline(text: string, sizePx: number, penX: number, baselineY: number): Polygon[];
  /** The width `text` occupies at `sizePx`. */
  advance(text: string, sizePx: number): number;
  /** The ascent above the baseline, in em units. */
  ascentEm: number;
  /** The descent below the baseline, in em units — negative for every font here. */
  descentEm: number;
}

/** The fallback chain of a request, plus the characters that could not be drawn. */
export interface FontSet {
  /** The chain, most specific first: the requested font, then the two fallbacks. */
  fonts: LoadedFont[];
  /** The characters no font in the chain has — a fresh list on every `loadFontSet`. */
  missingGlyphs: string[];
  /** The outlines of `text` and the width it occupies. */
  outline(
    text: string,
    sizePx: number,
    penX: number,
    baselineY: number,
  ): { polygons: Polygon[]; advance: number };
}

/** The woff2 the site ships for each font family. The three system fonts have no local file. */
const FONT_FILES: Partial<Record<FontFamily, string>> = {
  'wenkai-gb': 'LXGWWenKaiGB-Regular.woff2',
  'yozai': 'Yozai-Regular.woff2',
  'iansui': 'Iansui-Regular.woff2',
  'zen-kaku-thin': 'ZenKakuGothicNew-Thin.woff2',
  'ma-shan-zheng': 'ma-shan-zheng.woff2',
  'long-cang': 'long-cang.woff2',
  'liu-jian-mao-cao': 'liu-jian-mao-cao.woff2',
  'zcool-xiaowei': 'zcool-xiaowei.woff2',
  'zhi-mang-xing': 'zhi-mang-xing.woff2',
};

/** The fallback chain, applied per character: 霞鹜文楷 GB, then babel stone han. */
const FALLBACK_FILES = ['LXGWWenKaiGB-Regular.woff2', 'BabelStoneHanBasic.woff2'] as const;

/** Where the site keeps its woff2 files. */
const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');

/** The tofu box is 60 % of the em wide and 70 % tall. */
const TOFU_WIDTH_RATIO = 0.6;
const TOFU_HEIGHT_RATIO = 0.7;
/** The frame of the tofu box, as a fraction of the em — never thinner than a pixel. */
const TOFU_FRAME_RATIO = 0.02;

/** The parsed fonts, keyed by file name. */
const fontCache = new Map<string, LoadedFont>();

/**
 * The file the given font family is drawn from, or `null` when the family has
 * no local file (the three system fonts) and the fallback chain takes over.
 */
export function fontFileFor(family: FontFamily): string | null {
  return FONT_FILES[family] ?? null;
}

/**
 * Loads the fallback chain for a font family.
 *
 * The fonts are cached by file name, so the second call does not re-parse the
 * woff2 files. The missing-glyph list is created fresh on every call — a
 * shared list would let one request's tofu characters show up in the next
 * request's report.
 */
export async function loadFontSet(family: FontFamily): Promise<FontSet> {
  const fonts: LoadedFont[] = [];
  for (const fileName of chainFiles(family)) {
    fonts.push(await loadFontFile(fileName));
  }
  const missingGlyphs: string[] = [];
  return {
    fonts,
    missingGlyphs,
    outline: (text, sizePx, penX, baselineY) =>
      outlineWithFallback(fonts, missingGlyphs, text, sizePx, penX, baselineY),
  };
}

/**
 * Lists the characters of `text` that no font in the chain can draw.
 *
 * The characters are reported in the order they first appear and only once
 * each. This is the same chain and the same glyph lookup the renderer uses,
 * so the report and the tofu boxes can never disagree.
 */
export function findMissingGlyphs(text: string, fontFamily: FontFamily): string[] {
  const fonts = chainFiles(fontFamily).map((fileName) => loadFontFileSync(fileName));
  const missing: string[] = [];
  for (const char of Array.from(text)) {
    if (missing.includes(char)) continue;
    if (!fonts.some((font) => font.hasGlyph(char))) missing.push(char);
  }
  return missing;
}

/** The files a character may be looked up in, most specific first. */
function chainFiles(family: FontFamily): string[] {
  const files: string[] = [];
  const requested = fontFileFor(family);
  if (requested) files.push(requested);
  for (const fallback of FALLBACK_FILES) {
    if (!files.includes(fallback)) files.push(fallback);
  }
  return files;
}

async function loadFontFile(fileName: string): Promise<LoadedFont> {
  const cached = fontCache.get(fileName);
  if (cached) return cached;
  const font = await fontkit.open(fontPath(fileName));
  const loaded = createLoadedFont(fileName, font);
  fontCache.set(fileName, loaded);
  return loaded;
}

function loadFontFileSync(fileName: string): LoadedFont {
  const cached = fontCache.get(fileName);
  if (cached) return cached;
  const font = fontkit.openSync(fontPath(fileName));
  const loaded = createLoadedFont(fileName, font);
  fontCache.set(fileName, loaded);
  return loaded;
}

function fontPath(fileName: string): string {
  return path.join(FONT_DIR, fileName);
}

function createLoadedFont(fileName: string, font: Font): LoadedFont {
  const unitsPerEm = font.unitsPerEm;
  return {
    family: fileName,
    ascentEm: font.ascent / unitsPerEm,
    descentEm: font.descent / unitsPerEm,
    hasGlyph(char) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return false;
      return font.hasGlyphForCodePoint(codePoint);
    },
    outline(text, sizePx, penX, baselineY) {
      return outlineRun(font, text, sizePx, penX, baselineY);
    },
    advance(text, sizePx) {
      return advanceOfRun(font, text, sizePx);
    },
  };
}

/**
 * Draws a run of text with one font.
 *
 * `font.layout` shapes the whole string, so the advances and the kerning are
 * the font's own. The `-scale` on the y axis is the flip: font units have
 * their origin on the baseline with y pointing up, the canvas has y pointing
 * down.
 */
function outlineRun(
  font: Font,
  text: string,
  sizePx: number,
  penX: number,
  baselineY: number,
): Polygon[] {
  if (text.length === 0) return [];
  const run = font.layout(text);
  const scale = sizePx / font.unitsPerEm;
  const polygons: Polygon[] = [];
  let pen = penX;
  for (let index = 0; index < run.glyphs.length; index += 1) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    if (!glyph || !position) continue;
    const x = pen + position.xOffset * scale;
    const y = baselineY - position.yOffset * scale;
    const transformed = glyph.path.transform(scale, 0, 0, -scale, x, y);
    polygons.push(...pathToPolygons(transformed));
    pen += position.xAdvance * scale;
  }
  return polygons;
}

/** The width a run occupies: the sum of its advances. */
function advanceOfRun(font: Font, text: string, sizePx: number): number {
  if (text.length === 0) return 0;
  const scale = sizePx / font.unitsPerEm;
  const run = font.layout(text);
  let total = 0;
  for (const position of run.positions) total += position.xAdvance * scale;
  return total;
}

/**
 * Flattens a fontkit path into rings.
 *
 * A `moveTo` opens a new ring, the curves are flattened into eight segments
 * each — well under a pixel of error at the sizes a cell uses — and the ring
 * is closed implicitly, exactly like the rest of the rasteriser expects.
 */
function pathToPolygons(path: FontkitPath): Polygon[] {
  const polygons: Polygon[] = [];
  let current: Polygon = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const command of path.commands) {
    switch (command.command) {
      case 'moveTo': {
        current = [];
        polygons.push(current);
        cursor = pointAt(command.args, 0);
        current.push(cursor);
        break;
      }
      case 'lineTo': {
        cursor = pointAt(command.args, 0);
        current.push(cursor);
        break;
      }
      case 'quadraticCurveTo': {
        const end = pointAt(command.args, 2);
        current.push(...flattenQuadCurve(cursor, pointAt(command.args, 0), end));
        cursor = end;
        break;
      }
      case 'bezierCurveTo': {
        const end = pointAt(command.args, 4);
        current.push(
          ...flattenBezierCurve(cursor, pointAt(command.args, 0), pointAt(command.args, 2), end),
        );
        cursor = end;
        break;
      }
      case 'closePath': {
        cursor = current.length > 0 ? current[0] : cursor;
        break;
      }
    }
  }
  return polygons.filter((polygon) => polygon.length >= 3);
}

function pointAt(args: number[], offset: number): Point {
  return { x: args[offset], y: args[offset + 1] };
}

/** A stretch of text drawn by one font, or a single character drawn as a tofu box. */
interface TextRun {
  /** The font that draws the run, or null when the run is a tofu box. */
  font: LoadedFont | null;
  text: string;
}

/**
 * Draws text through the fallback chain.
 *
 * The text is split into runs of consecutive characters that share a font, so
 * a Latin row is still shaped as one run while a mixed sheet may use several
 * fonts. Every character no font has becomes a tofu box and is recorded in
 * `missingGlyphs`.
 */
function outlineWithFallback(
  fonts: LoadedFont[],
  missingGlyphs: string[],
  text: string,
  sizePx: number,
  penX: number,
  baselineY: number,
): { polygons: Polygon[]; advance: number } {
  const runs = splitIntoRuns(fonts, text, missingGlyphs);
  const polygons: Polygon[] = [];
  let pen = penX;
  for (const run of runs) {
    if (!run.font) {
      polygons.push(...tofuBox(pen, baselineY, sizePx));
      pen += TOFU_WIDTH_RATIO * sizePx;
      continue;
    }
    polygons.push(...run.font.outline(run.text, sizePx, pen, baselineY));
    pen += run.font.advance(run.text, sizePx);
  }
  return { polygons, advance: pen - penX };
}

/** Splits text into runs of consecutive characters that the same font draws. */
function splitIntoRuns(
  fonts: LoadedFont[],
  text: string,
  missingGlyphs: string[],
): TextRun[] {
  const runs: TextRun[] = [];
  for (const char of Array.from(text)) {
    const font = fonts.find((candidate) => candidate.hasGlyph(char)) ?? null;
    if (!font) {
      if (!missingGlyphs.includes(char)) missingGlyphs.push(char);
      runs.push({ font: null, text: char });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += char;
    else runs.push({ font, text: char });
  }
  return runs;
}

/**
 * The empty box drawn in place of a character no font could draw.
 *
 * It is a hollow frame, so it is one ring that walks the outer rectangle,
 * steps into the inner one, walks that, and steps back out along the same
 * line. The two steps are the same segment walked twice, so they cancel out
 * under the even-odd rule and the middle of the box stays empty.
 *
 * The obvious alternative — the outer ring followed by the inner ring — is
 * wrong: it joins the two rings with two *different* bridges, and those
 * bridges cross each other. The rasteriser then sees four crossings where it
 * expects two and the left edge of the box breaks into slivers.
 */
function tofuBox(penX: number, baselineY: number, sizePx: number): Polygon[] {
  const width = sizePx * TOFU_WIDTH_RATIO;
  const height = sizePx * TOFU_HEIGHT_RATIO;
  const frame = Math.max(1, sizePx * TOFU_FRAME_RATIO);
  const left = penX;
  const right = penX + width;
  const top = baselineY - height;
  const bottom = baselineY;
  const outer: Point[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const inner: Point[] = [
    { x: left + frame, y: top + frame },
    { x: right - frame, y: top + frame },
    { x: right - frame, y: bottom - frame },
    { x: left + frame, y: bottom - frame },
  ];
  // The outer ring closes on itself, the inner ring closes on itself, and
  // the two are joined by one segment that is walked in both directions.
  return [[...outer, outer[0], ...inner, inner[0]]];
}
