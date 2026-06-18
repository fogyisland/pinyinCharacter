import type { Tone } from './pinyin-tone';

export type RoundMode = 'tone' | 'radical' | 'pinyin';

export interface RoundChar {
  char: string;
  pinyin: string;
  meaning: string;
}

export interface GameRound {
  /** Which focus this round tests. Random per buildRound call. */
  mode: RoundMode;
  chars: RoundChar[];
  /**
   * For each char, the correct answer for the round's mode. For 'pinyin'
   * mode the answer is the pinyin string; for 'tone' it's the tone number;
   * for 'radical' it's the radical char.
   */
  charToAnswer: Record<string, { tone: Tone; radical: string; pinyin: string }>;
  /** Token bank for tone mode (always 1-4). */
  toneChoices: Tone[];
  /** Token bank for radical mode. */
  radicalChoices: string[];
  /** Token bank for pinyin mode (one per char, shuffled). */
  pinyinChoices: string[];
}
