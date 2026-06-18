// fontkit 2.0 ships without types. Minimal shim for our usage.
declare module 'fontkit' {
  export function openSync(path: string | Buffer): Font;
  export function open(path: string | Buffer): Promise<Font>;
  interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
    characterToGlyphIndex?(str: string): number;
    numGlyphs?: number;
    postscriptName?: string;
    familyName?: string;
  }
}