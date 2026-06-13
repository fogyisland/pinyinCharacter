import type { Tone } from './pinyin-tone';

export interface RoundChar {
  char: string;
  pinyin: string;
  meaning: string;
}

export interface GameRound {
  chars: RoundChar[];
  charToAnswer: Record<string, { tone: Tone; radical: string }>;
  toneChoices: Tone[];
  radicalChoices: string[];
}
