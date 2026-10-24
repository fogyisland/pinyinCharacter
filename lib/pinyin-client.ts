export interface PinyinToken {
  char: string;
  readings: string[]; // 多音字：所有读音
}

const HAN_RANGE = /[一-鿿㐀-䶿]/;

// pinyin-pro weighs about 300 KB of JavaScript — too much to ship in the
// initial bundle of /pinyin for a page whose only input is a text box. The
// dictionary is imported on demand instead: the first conversion pays for
// the download, every later one reuses the cached module.
let pinyinProPromise: Promise<typeof import('pinyin-pro')> | null = null;

/** Load (and cache) the pinyin dictionary. */
export function loadPinyinPro(): Promise<typeof import('pinyin-pro')> {
  if (!pinyinProPromise) {
    pinyinProPromise = import('pinyin-pro').catch((error: unknown) => {
      // Drop the cached promise so that a later attempt can retry.
      pinyinProPromise = null;
      throw error;
    });
  }
  return pinyinProPromise;
}

/** Convert a text to its per-character readings (多音字 included). */
export async function textToPinyin(text: string): Promise<PinyinToken[]> {
  const { polyphonic } = await loadPinyinPro();
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
  return tokens.map((t) => t.readings[0] ?? '?').join(' ');
}

export function renderWithoutSpaces(tokens: PinyinToken[]): string {
  return tokens.map((t) => t.readings[0] ?? '?').join('');
}
