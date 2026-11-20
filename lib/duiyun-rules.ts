/**
 * 对韵消消 (duìyùn match) 的规则 —— 纯逻辑，没有 DOM、没有 React、没有 IO。
 *
 * 玩法：一副对联上下句并排，字位挖掉几个。字盘上放着答案字和几个干扰字，
 * 玩家把字拖回正确的位置。填对了这一副就成。
 *
 * 为什么规则住在单独的文件里：判断「这个字放对了吗」是整个游戏的全部，
 * 而判断一个界面像素很难断言。规则一旦能单独测，界面就只需要照着渲染。
 *
 * 平仄是这个游戏的骨头：上句与下句逐位平仄相反（详见 data/duiyun-pairs.json
 * 的生成脚本）。界面把平/仄标出来，玩家才看得见「为什么这两个字是一对」。
 */

import type { Difficulty } from './difficulty';
import { toneFromPinyin, type Tone } from './pinyin-tone';
import { makeRng } from './catch-char-rules';

/** 一个对句。 */
export interface DuiyunPair {
  /** 上句的字。 */
  upper: string;
  /** 下句的字。 */
  lower: string;
  /** 上句每个字的拼音。 */
  upperPinyin: string[];
  /** 下句每个字的拼音。 */
  lowerPinyin: string[];
  /** 韵部标签，如 '一东'。 */
  rhyme: string;
  /** 出处。 */
  book: string;
}

/** 一副对联的一个字位。 */
export interface DuiyunSlot {
  /** 0 是上句，1 是下句。 */
  side: 0 | 1;
  /** 这个字在那一侧里的下标。 */
  index: number;
  /** 这个字本身。挖空时它仍是答案。 */
  char: string;
  /** 这个字的拼音。 */
  pinyin: string;
  /** 这个字的声调。 */
  tone: Tone;
  /** 这一位是不是挖空的。挖过的位置玩家填对了也还是挖过的位置。 */
  isBlank: boolean;
  /**
   * 这一位是不是已经被玩家填上了。
   *
   * `isBlank` 和 `filled` 是两件事：`isBlank` 说「这是一位挖空的」，
   * `filled` 说「这位的空已经补上了」。分开记，才能既知道哪一位还差一个
   * 字，又能让玩家把填好的字取回来 —— 只看 `isBlank` 的话，填好之后这一位
   * 跟从来没挖过的地方长得一模一样，就取不回来了。
   */
  filled: boolean;
}

/** 字盘上的一块字。 */
export interface DuiyunTile {
  id: string;
  char: string;
  pinyin: string;
  tone: Tone;
  /** 是不是这一局的答案字。 */
  isAnswer: boolean;
}

/** 一局的配置。 */
export interface DuiyunConfig {
  /** 挖几个位置。 */
  blanks: number;
  /** 字盘上的干扰字个数。 */
  distractors: number;
}

/** 三个难度档。 */
export const DUIYUN_CONFIG: Record<Difficulty, DuiyunConfig> = {
  easy: { blanks: 1, distractors: 2 },
  medium: { blanks: 2, distractors: 3 },
  hard: { blanks: 3, distractors: 4 },
};

/** 一局。 */
export interface DuiyunRound {
  pair: DuiyunPair;
  slots: DuiyunSlot[];
  tray: DuiyunTile[];
  seed: number;
}

/** 一个音节的声调。没有声调符号就是轻声，返回 null。 */
export function toneOf(syllable: string): Tone | null {
  return toneFromPinyin(syllable);
}

/**
 * 去掉声调符号的音节。
 *
 * 两件事要注意：
 *
 * 1. 不能只把带调的字符**删掉** —— 'ō' 删掉就不是 'o' 了。Unicode 分解
 *    （NFD）会把 'ō' 拆成 'o' + 组合音符，再把组合音符去掉，才是 'o'。
 *
 * 2. 语料里的 ü 写成 `l` + 组合分音符（U+01DC），而这个音符要落在 u 上
 *    —— 绿读 lǜ，不是 l + ǜ。所以先把「声母 + 组合分音符」挪成「声母 + ü」，
 *    再做分解。
 *
 * ü 在纯 ASCII 的拼音记法里写作 v。
 */
function plain(syllable: string): string {
  // 把挂在声母后面的组合分音符挪到 u 上：'l' + U+01DC → 'l' + 'ü'。
  const fixed = syllable.replace(/([jqxnl])ǜ/g, '$1ü');
  // ü 要在 NFD **之前**换成 v —— NFD 会把 'ü' 拆成 'u' + 组合音符，到时候
  // 就找不到 'ü' 了。
  const withV = fixed.replace(/ü/g, 'v');
  const stripped = withV.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return stripped.toLowerCase();
}

/** 声母。'zhōng' → 'zh'，'mā' → 'm'。 */
export function initialOf(syllable: string): string {
  const p = plain(syllable);
  if (p.startsWith('zh')) return 'zh';
  if (p.startsWith('ch')) return 'ch';
  if (p.startsWith('sh')) return 'sh';
  return p.slice(0, 1);
}

/** 韵母。'zhōng' → 'ong'，'mā' → 'a'。 */
export function finalOf(syllable: string): string {
  const p = plain(syllable);
  const initial = initialOf(syllable);
  return p.length > initial.length ? p.slice(initial.length) : '';
}

/** 平声（1、2）还是仄声（3、4）。 */
export function isPing(tone: Tone): boolean {
  return tone === 1 || tone === 2;
}

/** 打乱一份列表。 */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy;
}

/** 干扰字候选。 */
interface DistractorCandidate {
  char: string;
  pinyin: string;
  tone: Tone;
  score: number;
}

/**
 * 从语料里挑干扰字。
 *
 * 干扰字要好认 —— 挑跟答案音近但字不同的字，玩家才需要看清而不是乱猜。
 * 优先挑同声母的，其次同韵母的。
 *
 * 两条硬规矩：
 *
 * 1. **一个字只能出现一次。** 语料里同一个字常常出现在好几副对句里，
 *    按字挑的时候不���重，字盘上就会有两个一模一样的字 —— 玩家分不清
 *    哪个是哪个，也不知道哪个是答案。
 * 2. **干扰字不能是这一局任何一个空的答案。** 一个空要的字在字盘上出现
 *    两次，玩家看得见两个一样的字却只填得出一个格，剩下的那个就成了死字，
 *    而「放错了」在玩家眼里像是他自己的错。
 */
function pickDistractors(
  pool: readonly DuiyunPair[],
  answerChars: readonly string[],
  answerPinyin: string,
  count: number,
  rng: () => number,
): Array<{ char: string; pinyin: string; tone: Tone }> {
  const forbidden = new Set(answerChars);
  const candidates: DistractorCandidate[] = [];
  const seen = new Set<string>();
  for (const pair of pool) {
    const sides: Array<{ chars: string; pinyin: string[] }> = [
      { chars: pair.upper, pinyin: pair.upperPinyin },
      { chars: pair.lower, pinyin: pair.lowerPinyin },
    ];
    for (const side of sides) {
      for (let i = 0; i < side.chars.length; i++) {
        const char = side.chars[i]!;
        const syllable = side.pinyin[i] ?? '';
        if (forbidden.has(char)) continue;
        // 同一个字只算一次候选。
        if (seen.has(char)) continue;
        const tone = toneOf(syllable);
        if (tone === null) continue;
        seen.add(char);
        let score = 0;
        if (initialOf(syllable) === initialOf(answerPinyin)) score += 2;
        if (finalOf(syllable) === finalOf(answerPinyin)) score += 1;
        candidates.push({ char, pinyin: syllable, tone, score });
      }
    }
  }
  if (candidates.length === 0) return [];

  // 分数高的在前；同分时按字排，让结果不依赖语料的顺序。
  candidates.sort((x, y) => y.score - x.score || x.char.localeCompare(y.char));
  const chosen = candidates.slice(0, count);
  return shuffle(chosen, rng).map((c) => ({ char: c.char, pinyin: c.pinyin, tone: c.tone }));
}

/**
 * 挖哪几个位置。
 *
 * 上下句各挖一半左右 —— 只挖一边的话，玩家只需要想一边，难度上不去。
 */
function chooseBlanks(slots: DuiyunSlot[], want: number, rng: () => number): Set<number> {
  if (want <= 0) return new Set();
  const upper = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.side === 0);
  const lower = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.side === 1);
  if (upper.length === 0 && lower.length === 0) return new Set();

  const upperWant = Math.min(upper.length, Math.ceil(want / 2));
  const lowerWant = Math.min(lower.length, want - upperWant);
  // 上下句的可挖位不够分时，把剩下的名额补给还有余的一边。
  const leftover = want - upperWant - lowerWant;
  const extraUpper = Math.min(upper.length - upperWant, leftover);
  const extraLower = Math.min(lower.length - lowerWant, leftover - extraUpper);

  const chosen = new Set<number>();
  for (const { index } of shuffle(upper, rng).slice(0, upperWant + extraUpper)) chosen.add(index);
  for (const { index } of shuffle(lower, rng).slice(0, lowerWant + extraLower)) chosen.add(index);
  return chosen;
}

/** 建一局。 */
export function buildRound(
  pair: DuiyunPair,
  config: DuiyunConfig,
  seed: number,
  pool: readonly DuiyunPair[],
): DuiyunRound {
  const rng = makeRng(seed);

  const slots: DuiyunSlot[] = [];
  const sides: Array<{ chars: string; pinyin: string[]; side: 0 | 1 }> = [
    { chars: pair.upper, pinyin: pair.upperPinyin, side: 0 },
    { chars: pair.lower, pinyin: pair.lowerPinyin, side: 1 },
  ];
  for (const s of sides) {
    for (let i = 0; i < s.chars.length; i++) {
      const syllable = s.pinyin[i] ?? '';
      const tone = toneOf(syllable);
      slots.push({
        side: s.side,
        index: i,
        char: s.chars[i]!,
        pinyin: syllable,
        tone: tone ?? 1,
        isBlank: false,
        filled: false,
      });
    }
  }

  const blankIndexes = chooseBlanks(slots, config.blanks, rng);
  for (const index of blankIndexes) slots[index]!.isBlank = true;

  // 字盘：每一个挖空位置都要一块对应的答案字。
  const answerTiles: DuiyunTile[] = [];
  for (const index of blankIndexes) {
    const slot = slots[index]!;
    answerTiles.push({
      id: `answer-${index}`,
      char: slot.char,
      pinyin: slot.pinyin,
      tone: slot.tone,
      isAnswer: true,
    });
  }

  // 干扰字要避开这一局**所有**空的答案字 —— 挖两个空的时候，
  // 第二个空的答案字也不能作为干扰字出现在字盘上。
  const firstAnswer = answerTiles[0];
  const distractors = firstAnswer
    ? pickDistractors(
        pool,
        answerTiles.map((t) => t.char),
        firstAnswer.pinyin,
        config.distractors,
        rng,
      )
    : [];
  const distractorTiles: DuiyunTile[] = distractors.map((d, i) => ({
    id: `distractor-${i}`,
    char: d.char,
    pinyin: d.pinyin,
    tone: d.tone,
    isAnswer: false,
  }));

  return {
    pair,
    slots,
    tray: shuffle([...answerTiles, ...distractorTiles], rng),
    seed,
  };
}

/** 放字失败的理由。 */
export type DuiyunDropReason = 'wrong_character' | 'slot_filled' | 'not_a_tray_item';

/** 放字的结果。 */
export type DuiyunDropResult =
  | { ok: true; state: DuiyunRound }
  | { ok: false; reason: DuiyunDropReason };

/**
 * 放字。
 *
 * 拒绝的顺序是有讲究的：先看这一位是不是已经填过了（填过了就是
 * `slot_filled`），再看这块字在不在字盘上（不在就是 `not_a_tray_item`），
 * 最后才看字对不对。玩家看到的话必须能说出是哪一样错了。
 */
export function dropCharacter(
  round: DuiyunRound,
  slotIndex: number,
  tileId: string,
): DuiyunDropResult {
  const slot = round.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'not_a_tray_item' };
  if (!slot.isBlank) return { ok: false, reason: 'slot_filled' };
  if (slot.filled) return { ok: false, reason: 'slot_filled' };
  const tile = round.tray.find((t) => t.id === tileId);
  if (!tile) return { ok: false, reason: 'not_a_tray_item' };
  if (tile.char !== slot.char) return { ok: false, reason: 'wrong_character' };

  const slots = round.slots.map((s, i) =>
    i === slotIndex ? { ...s, isBlank: true, filled: true } : s,
  );
  return {
    ok: true,
    state: { ...round, slots, tray: round.tray.filter((t) => t.id !== tileId) },
  };
}

/**
 * 把字取回来。
 *
 * 只有玩家填上去的字才取得回来 —— 原本就写在联上的字不是「字盘上的字」，
 * 取走它这副联就不完整了。
 */
export function liftCharacter(round: DuiyunRound, slotIndex: number): DuiyunRound {
  const slot = round.slots[slotIndex];
  if (!slot || !slot.filled) return round;
  const slots = round.slots.map((s, i) =>
    i === slotIndex ? { ...s, isBlank: true, filled: false } : s,
  );
  const tray = round.tray.some((t) => t.char === slot.char)
    ? round.tray
    : [
        ...round.tray,
        {
          id: `answer-${slotIndex}`,
          char: slot.char,
          pinyin: slot.pinyin,
          tone: slot.tone,
          isAnswer: true,
        },
      ];
  return { ...round, slots, tray };
}

/** 这一局是不是赢了 —— 每个挖过的位置都填上了字。 */
export function isRoundWon(round: DuiyunRound): boolean {
  return round.slots.every((slot) => !slot.isBlank || slot.filled);
}

/** 还剩几个空 —— 挖过但还没填上的位置。 */
export function blanksRemaining(round: DuiyunRound): number {
  return round.slots.filter((slot) => slot.isBlank && !slot.filled).length;
}
