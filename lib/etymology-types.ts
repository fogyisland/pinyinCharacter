import type { CharLevel } from '../components/etymology/era-dates';

export const ERAS = ['jiaguwen', 'jinwen', 'xiaozhuan', 'lishu', 'kaishu'] as const;
export type Era = (typeof ERAS)[number];

export interface EraGlyph {
  era: Era;
  font: string;
  hasGlyph: boolean;
}

export interface Etymology {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  level: CharLevel;
}

export interface EtymologyAdjacent {
  prev: string | null;
  next: string | null;
}

export interface EtymologyClient {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  level: CharLevel;
  prev: string | null;
  next: string | null;
}
