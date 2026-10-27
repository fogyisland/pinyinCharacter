/**
 * Type declarations for the parts of fontkit the rasteriser uses.
 *
 * fontkit 2.0 ships without types of its own. `scripts/fontkit.d.ts` shims the
 * handful of members the font-coverage build script needs; this file augments
 * the same module with the members `lib/png/glyph.ts` relies on — the shaped
 * layout and the vertical metrics — so the rasteriser needs no casts and no
 * `any`.
 *
 * It is an augmentation (the `import 'fontkit'` at the top makes this file a
 * module) rather than a second ambient declaration, so the two files merge
 * into one `Font` interface instead of colliding.
 */

import 'fontkit';

declare module 'fontkit' {
  interface Font {
    /** The size of the em square in font units — the scale factor for a pixel size. */
    unitsPerEm: number;
    /** The distance from the baseline to the top of the em box, in font units. */
    ascent: number;
    /** The distance from the baseline to the bottom of the em box, in font units (negative). */
    descent: number;
    /** Shapes a string and returns its glyphs with their pen positions. */
    layout(text: string): FontkitLayout;
  }

  interface FontkitLayout {
    glyphs: FontkitGlyph[];
    positions: FontkitPosition[];
  }

  interface FontkitGlyph {
    id: number;
    codePoints: number[];
    path: FontkitPath;
  }

  interface FontkitPosition {
    /** How far the pen moves after the glyph, in font units. */
    xAdvance: number;
    yAdvance: number;
    /** The glyph's offset from the pen position, in font units. */
    xOffset: number;
    yOffset: number;
  }

  interface FontkitPath {
    commands: FontkitCommand[];
    /** Applies an SVG matrix to the path and returns the transformed path. */
    transform(a: number, b: number, c: number, d: number, e: number, f: number): FontkitPath;
  }

  interface FontkitCommand {
    command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    args: number[];
  }
}
