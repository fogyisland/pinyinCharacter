import type { Tone } from './pinyin-tone';

export type RoundMode = 'tone' | 'radical' | 'pinyin';

export interface RoundChar {
  char: string;
  pinyin: string;
  meaning: string;
  /**
   * Radical of the char. Surfaced so client renderers (e.g. ToneRadicalChar)
   * can show the radical as a hint cell per HSK reveal config without a
   * separate fetch.
   */
  radical: string;
}

export interface GameRound {
  /** Which focus this round tests. Random unless the caller overrides it. */
  mode: RoundMode;
  chars: RoundChar[];
  /**
   * For each char, the correct answer for the round's mode. For 'pinyin'
   * mode the answer is the pinyin string; for 'tone' it's the tone number;
   * for 'radical' it's the radical char.
   */
  charToAnswer: Record<string, { tone: Tone; radical: string; pinyin: string }>;
  /**
   * The tone token bank — ONE TOKEN PER CHAR, duplicates allowed.
   * `toneChoices[i]` is the tone of `chars[i]`. Two chars of the same tone
   * get two identical tokens, so neither can starve the other.
   */
  toneChoices: Tone[];
  /** The radical token bank — ONE TOKEN PER CHAR, duplicates allowed. */
  radicalChoices: string[];
  /** Unchanged: one pinyin per char (the pinyin mode picks unique pinyins). */
  pinyinChoices: string[];
}
