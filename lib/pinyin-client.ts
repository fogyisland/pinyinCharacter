import { polyphonic } from 'pinyin-pro';

export interface PinyinToken {
  char: string;
  readings: string[];   // 多音字：所有读音
}

const HAN_RANGE = /[一-鿿㐀-䶿]/;

export function textToPinyin(text: string): PinyinToken[] {
  return Array.from(text).map((char) => {
    if (!HAN_RANGE.test(char)) {
      return { char, readings: [char] };
    }
    const arr = polyphonic(char, { type: 'array', toneType: 'symbol' }) as string[][];
    const readings = arr[0] ?? [];
    return { char, readings: readings.length > 0 ? readings : ['?'] };
  });
}

export function renderWithSpaces(tokens: PinyinToken[]): string {
  return tokens.map(t => t.readings[0] ?? '?').join(' ');
}

export function renderWithoutSpaces(tokens: PinyinToken[]): string {
  return tokens.map(t => t.readings[0] ?? '?').join('');
}
