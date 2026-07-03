/** Char info returned by /api/chain/chars and used by ChainGame. */
export interface CharInfo {
  char: string;
  pinyin: string;        // 带声调字母: 'dēng'
  meaning: string;       // 中文释义
  radical: string;       // 部首 (empty string if unknown)
  tone: 1 | 2 | 3 | 4;   // 声调 (excludes 轻声)
}
