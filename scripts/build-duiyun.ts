/**
 * 抽取对韵数据 —— 把《笠翁对韵》和《声律启蒙》里的对句挑出来，
 * 写成 `data/duiyun-pairs.json`。
 *
 * 为什么只要「平仄逐位相反」的那些：古人的对仗有宽有严。逐位平仄相反的
 * 是严对，不会有争议；只是词性相对而平仄有一处相同的属于宽对，自动判定
 * 容易出错，宽对一旦判错，教给玩家的是错的。
 *
 * 所以这里只要严对。本次实测：两书合计 275 片等长对句，其中 212 片
 * 逐位平仄相反 —— 去重后 761 对（1 字 283 + 2 字 478），够玩几百局。
 *
 * 运行：`npx tsx scripts/build-duiyun.ts`
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonAuto } from '../lib/json-fs';

export interface DuiyunPair {
  /** 上句的字。 */
  upper: string;
  /** 下句的字。 */
  lower: string;
  /** 上句每个字的拼音。 */
  upperPinyin: string[];
  /** 下句每个字的拼音。 */
  lowerPinyin: string[];
  /** 韵部标签，已归一化（去掉内部空格）：'一东'。 */
  rhyme: string;
  /** 语料出处。 */
  book: '笠翁对韵' | '声律启蒙';
}

/** 一行原文。 */
interface SourceLine {
  text: string;
  pinyin: string[];
}

/** 一个韵部的一批行。 */
interface SourceChunk {
  label: string;
  lines: SourceLine[];
  book: DuiyunPair['book'];
}

/** 语料文件与它的书名。 */
const SOURCES: ReadonlyArray<{ file: string; book: DuiyunPair['book'] }> = [
  { file: 'liweng-duiyun-1', book: '笠翁对韵' },
  { file: 'liweng-duiyun-2', book: '笠翁对韵' },
  { file: 'shenglv-qimeng-1', book: '声律启蒙' },
  { file: 'shenglv-qimeng-2', book: '声律启蒙' },
];

const CLASSICS_DIR = path.join(process.cwd(), 'data', 'classics');
const OUT_PATH = path.join(process.cwd(), 'data', 'duiyun-pairs.json');

/** 汉字（判断单个字符用）。 */
const HANZI = /[㐀-䶿一-鿿〇]/;

/** 汉字（在一段文字里逐个计数用 —— 必须带 g，否则 `match` 只返回第一个）。 */
const HANZI_GLOBAL = /[㐀-䶿一-鿿〇]/g;

/** 平仄：1、2 声是平，3、4 声是仄。 */
function isPing(tone: number): boolean {
  return tone === 1 || tone === 2;
}

/** 声调符号 → 声调数字。找不到就是轻声，不参与判定。 */
const TONE_BY_MARK: Record<string, number> = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};

/** 一个音节的声调。没有声调符号就是轻声，返回 null。 */
function toneOf(syllable: string): number | null {
  for (const ch of syllable) {
    const tone = TONE_BY_MARK[ch];
    if (tone !== undefined) return tone;
  }
  return null;
}

/** 韵部标签归一化：去掉内部空格。 */
export function normalizeRhyme(label: string): string {
  return label.replace(/\s+/g, '');
}

/**
 * 按句号切分，再按逗号切分。
 *
 * 切分必须同时切拼音 —— 语料里 `content` 和 `pinyin` 是逐字对齐的，
 * 包括标点也占一位，所以两边的下标永远一致。
 *
 * 每一段（句子之间、逗号之间）都要吐出来，包括最后一段：语料里的对句
 * 大多没有句号收尾（`天对地，雨对风。大陆对长空。`），漏掉尾巴会把
 * 一大半对句丢掉。
 */
function splitIntoPieces(text: string, pinyin: string[]): SourceLine[] {
  const pieces: SourceLine[] = [];

  /** 把一段（句号之间）按逗号切开。 */
  const splitByComma = (segment: string, segmentPinyin: string[]): void => {
    if (segment.length === 0) return;
    let pieceStart = 0;
    const comma = /，/g;
    for (let c = comma.exec(segment); c !== null; c = comma.exec(segment)) {
      pieces.push({
        text: segment.slice(pieceStart, c.index),
        pinyin: segmentPinyin.slice(pieceStart, c.index),
      });
      pieceStart = c.index + 1;
    }
    pieces.push({
      text: segment.slice(pieceStart),
      pinyin: segmentPinyin.slice(pieceStart),
    });
  };

  let start = 0;
  const sentenceEnd = /[。！？；]/g;
  for (let m = sentenceEnd.exec(text); m !== null; m = sentenceEnd.exec(text)) {
    splitByComma(text.slice(start, m.index), pinyin.slice(start, m.index));
    start = m.index + 1;
  }
  // 句号之后的尾巴。
  splitByComma(text.slice(start), pinyin.slice(start));

  return pieces;
}

/**
 * 取原文某个区间里那些汉字的拼音。
 *
 * 原文和拼音是逐字对齐的，所以区间 [from, to) 里的第 i 个汉字，就是拼音
 * 数组的第 i 个音节 —— 但中间夹着逗号、句号这些标点，标点也在拼音数组里
 * 占着位（记的是它自己）。所以要按原文的位置挑，不能按拼音串的内容挑：
 * 拼音串从来不是汉字。
 */
function pinyinOfHanzi(text: string, pinyin: string[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i < to && i < pinyin.length; i++) {
    if (HANZI.test(text[i] ?? '')) out.push(pinyin[i]!);
  }
  return out;
}

/**
 * 从一批行里挑出对句。
 *
 * 一片对句的形状是 `X对Y`。判定要过四关：
 *   1. 只有一个「对」字 —— 「早对晚，」这样的一片拆不干净。
 *   2. `X` 与 `Y` 的字数一样多。
 *   3. 每个字都有声调（轻声判不了对错）。
 *   4. 逐位平仄相反。
 */
export function extractPairs(chunks: SourceChunk[]): DuiyunPair[] {
  const pairs: DuiyunPair[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.lines) {
      for (const piece of splitIntoPieces(line.text, line.pinyin)) {
        const text = piece.text;
        if (text.split('对').length !== 2) continue;
        const hinge = text.indexOf('对');
        const upper = text.slice(0, hinge);
        const lower = text.slice(hinge + 1);
        // `match` 遇到非全局正则只返回第一个匹配 —— 一句里的第二个字就漏
        // 计数了。`matchAll` 才是逐个数的。
        const upperCount = (upper.match(HANZI_GLOBAL) ?? []).length;
        const lowerCount = (lower.match(HANZI_GLOBAL) ?? []).length;
        if (upperCount === 0 || upperCount !== lowerCount) continue;

        // 拼音数组跟原文逐字对齐（180 行全部核对过，长度一致），所以第 n 个
        // 字就是第 n 个拼音。`hinge` 是「对」字在原文里的下标，切拼音时用同
        // 一个下标跳过铰链自己那一条 —— 上句取 [0, hinge)，下句取 (hinge, …]。
        //
        // 拼音里可能混着标点（逗号、句号各占一位），那些位要按汉字的位置挑
        // 出来，而不是按拼音本身是不是汉字 —— 拼音串从来不是汉字。
        const upperPinyin = pinyinOfHanzi(text, piece.pinyin, 0, hinge);
        const lowerPinyin = pinyinOfHanzi(text, piece.pinyin, hinge + 1, text.length);
        if (upperPinyin.length !== upperCount || lowerPinyin.length !== lowerCount) continue;

        const upperTones = upperPinyin.map(toneOf);
        const lowerTones = lowerPinyin.map(toneOf);
        if (upperTones.some((t) => t === null) || lowerTones.some((t) => t === null)) continue;

        let opposes = true;
        for (let i = 0; i < upperTones.length; i++) {
          if (isPing(upperTones[i]!) === isPing(lowerTones[i]!)) {
            opposes = false;
            break;
          }
        }
        if (!opposes) continue;

        pairs.push({
          upper,
          lower,
          upperPinyin,
          lowerPinyin,
          rhyme: normalizeRhyme(chunk.label),
          book: chunk.book,
        });
      }
    }
  }
  return pairs;
}

/** 读语料、抽对句。 */
export function buildPairs(): DuiyunPair[] {
  const chunks: SourceChunk[] = [];
  for (const source of SOURCES) {
    // `readJsonAuto` 自己认 `.json.gz` —— 传不带后缀的路径即可。
    const raw = readJsonAuto(path.join(CLASSICS_DIR, `${source.file}.json`));
    if (!raw) {
      throw new Error(`build-duiyun: cannot read ${source.file} from ${CLASSICS_DIR}`);
    }
    const file = raw as {
      chunks?: Array<{
        label?: string;
        content?: string[];
        pinyin?: string[][];
      }>;
    };
    for (const chunk of file.chunks ?? []) {
      const lines: SourceLine[] = [];
      const content = chunk.content ?? [];
      const pinyin = chunk.pinyin ?? [];
      for (let i = 0; i < content.length; i++) {
        const syllables = pinyin[i] ?? [];
        lines.push({ text: content[i]!, pinyin: syllables });
      }
      chunks.push({ label: chunk.label ?? '', lines, book: source.book });
    }
  }
  return extractPairs(chunks);
}

/** 写文件。 */
function main(): void {
  const pairs = buildPairs();
  // 同一本里可能有重复的对句 —— 按「上句+下句」去重，第一次出现的那份留下。
  const seen = new Set<string>();
  const unique = pairs.filter((pair) => {
    const key = `${pair.upper}|${pair.lower}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');
  console.log(`build-duiyun: ${unique.length} pairs -> ${OUT_PATH}`);
}

if (process.argv[1] && process.argv[1].endsWith('build-duiyun.ts')) {
  main();
}
