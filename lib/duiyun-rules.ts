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
 * 三件事要注意：
 *
 * 1. 不能只把带调的字符**删掉** —— 'ō' 删掉就不是 'o' 了。Unicode 分解
 *    （NFD）会把 'ō' 拆成 'o' + 组合音符，再把组合音符去掉，才是 'o'。
 *
 * 2. 语料里的 ü 是**预组合**字符：lǜ = 006C 01DC、lǚ = 006C 01DA、
 *    lǘ = 006C 01D8、nǚ = 006E 01DA。声调不同，字母就不同 ——
 *    只认其中一种（以前只认 ǜ），其余的 ü 就悄悄变成了 u，
 *    「履」「闾」「女」于是跟「鲁」「卢」混成一类。
 *
 * 3. ü 在纯 ASCII 的拼音记法里写作 v。
 *
 * 另外，j/q/x/y 后的 u 念的是 ü —— 语料里就是这么写的（ju、qu、xu、
 * jue、xue、yuan、yu），一个声调符号都不带。而 y 不是声母，是韵母的头，
 * y 后的 i（yan、yao、ye、yin、ying、yang）是韵母的一部分，不能丢。
 *
 * 所以这里先把音节拆成「声母 + 韵母」，再单独处理 ü，
 * 而不是拿正则一路替换 —— 一路替换会把 y 的 i 一起吃掉。
 */
function plain(syllable: string): string {
  // ü 要在 NFD **之前**换成 v —— NFD 会把 'ü' 拆成 'u' + 组合音符，到时候
  // 就找不到 'ü' 了。四种带调的 ü 都要换。
  const withV = syllable.replace(/[üǖǘǚǜ]/g, 'v');
  const stripped = withV.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return stripped.toLowerCase();
}

/**
 * 零声母音节的首字母。
 *
 * 这些字母开头的音节没有声母（爱 ài、鹅 é、欧 ōu、昂 áng），整个音节
 * 都是韵母。它们也是声母表里的字母 —— 区别在于「ai」这种组合本身
 * 就是一个韵母，而不是「a」声母加「i」韵母。
 */
const ZERO_INITIAL = new Set(['a', 'o', 'e', 'ê']);

/** 双字母声母。zh/ch/sh 的第一个字母跟零声母的字母重叠，要先排除它们。 */
const REAL_INITIALS = new Set(['zh', 'ch', 'sh']);

/**
 * 把音节拆成声母和韵母。
 *
 * 声母最长两个字母（zh、ch、sh），其余是一个。y 不算声母 —— 它是
 * 韵母的头（yan 的韵母是 ian），算成声母的话韵母就会被砍掉一截。
 *
 * 零声母音节（爱、鹅、欧、昂）整个音节都是韵母 —— 它们没有声母，
 * 第一个字母就是韵母的一部分，不能当成声母砍掉。
 */
function split(syllable: string): { initial: string; final: string } {
  const p = plain(syllable);

  // y 开头的：y 自己不算声母，y 后面紧跟的 i 也是韵母的一部分。
  if (p.startsWith('y')) {
    // yu/yuan/yue 里的 u 念的是 ü —— 语料写的是 u，还原成 v。
    const rest = p.slice(1);
    if (rest.startsWith('u')) {
      // yuan → van（üan），yu → v（ü），yue → ve（üe）。
      // i 要留着：yuan 里 u 是 ü，前面没有 i。
      return { initial: '', final: 'v' + rest.slice(1) };
    }
    // yan → ian，yao → iao，ye → ie，yin → in，ying → ing，yang → iang。
    return { initial: '', final: rest.startsWith('i') ? rest : 'i' + rest };
  }

  // 零声母音节：整个音节都是韵母。
  // 这些是《汉语拼音方案》里 a、o、e、ê 开头的音节，以及 ai、ei、ao、
  // ou、an、en、ang、eng、ong、er —— 它们的第一个字母不是声母。
  if (ZERO_INITIAL.has(p.slice(0, 1)) && !REAL_INITIALS.has(p.slice(0, 2))) {
    return { initial: '', final: p };
  }

  let initial = '';
  if (p.startsWith('zh')) initial = 'zh';
  else if (p.startsWith('ch')) initial = 'ch';
  else if (p.startsWith('sh')) initial = 'sh';
  else initial = p.slice(0, 1);

  let rest = p.slice(initial.length);

  // j/q/x 后的 u 念的是 ü —— 语料里就是这么写的（ju、qu、xu、jue、xue）。
  // 不还原的话「居」的韵母算成 u，跟「猪」混成一类。
  if ((initial === 'j' || initial === 'q' || initial === 'x') && rest.startsWith('u')) {
    rest = 'v' + rest.slice(1);
  }

  return { initial, final: rest };
}

/** 声母。'zhōng' → 'zh'，'mā' → 'm'。 */
export function initialOf(syllable: string): string {
  return split(syllable).initial;
}

/** 韵母。'zhōng' → 'ong'，'mā' → 'a'。 */
export function finalOf(syllable: string): string {
  const { initial, final } = split(syllable);
  if (final.length === 0) return '';
  // j/q/x 后的 iu 其实念 iou ——「九」是 jiǔ，不是 juǔ。拼音书里 iou
  // 在 j/q/x 后省写成 iu，但韵母还是 iou。干扰字是按韵母挑的，算错了
  // 就挑不准（跟 iu 近的字该挑没挑，不该挑的挑进来了）。
  if ((initial === 'j' || initial === 'q' || initial === 'x') && final === 'iu') {
    return 'iou';
  }
  return final;
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
 *    按字挑的时候不重复，字盘上就会有两个一模一样的字 —— 玩家分不清
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
      // 没有声调就判不了平仄 —— 轻声（de、le、ma）就是这样。
      // 硬把它当成平声，界面上的平仄标记就是错的，玩家照着错标记去对，
      // 对出来的东西也是错的。宁可这一局开不起来，也不能给错标记。
      if (tone === null) {
        throw new Error(
          `duiyun: the couplet "${pair.upper} / ${pair.lower}" has a syllable without a tone: ${syllable || '(empty)'}`,
        );
      }
      slots.push({
        side: s.side,
        index: i,
        char: s.chars[i]!,
        pinyin: syllable,
        tone,
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
