/**
 * The rules of 对韵消消 (the couplet matching game) — the pure logic, with
 * no DOM and no React.
 *
 * The game shows a couplet with some of its characters blanked out, and a
 * tray of candidate characters above it. The player drags the right
 * character into each blank.
 *
 * The thing these rules must get right is 平仄: at every position of the
 * couplet, one side is a ping tone (1 or 2) and the other is a ze tone
 * (3 or 4). That is what makes the two lines answer each other, and it is
 * what the interface shows the player.
 */
import { describe, it, expect } from 'vitest';
import {
  DUIYUN_CONFIG,
  blanksRemaining,
  buildRound,
  dropCharacter,
  finalOf,
  initialOf,
  isPing,
  isRoundWon,
  liftCharacter,
  toneOf,
  type DuiyunPair,
} from '@/lib/duiyun-rules';

/** A two-character couplet. */
const PAIR: DuiyunPair = {
  upper: '大陆',
  lower: '长空',
  upperPinyin: ['dà', 'lù'],
  lowerPinyin: ['cháng', 'kōng'],
  rhyme: '一东',
  book: '笠翁对韵',
};

/** A one-character couplet. */
const SHORT: DuiyunPair = {
  upper: '天',
  lower: '地',
  upperPinyin: ['tiān'],
  lowerPinyin: ['dì'],
  rhyme: '一东',
  book: '笠翁对韵',
};

describe('duiyun rules', () => {
  it('reads the tone of a syllable', () => {
    expect(toneOf('tiān')).toBe(1);
    expect(toneOf('dì')).toBe(4);
    expect(toneOf('de')).toBeNull();
  });

  it('knows 平 from 仄', () => {
    expect(isPing(1)).toBe(true);
    expect(isPing(2)).toBe(true);
    expect(isPing(3)).toBe(false);
    expect(isPing(4)).toBe(false);
  });

  it('splits a syllable into its initial and its final', () => {
    expect(initialOf('zhōng')).toBe('zh');
    expect(initialOf('chuáng')).toBe('ch');
    expect(initialOf('shān')).toBe('sh');
    expect(initialOf('mā')).toBe('m');
    expect(finalOf('zhōng')).toBe('ong');
    expect(finalOf('mā')).toBe('a');
    // ü 的两点在拼音里省掉了 —— 'lǜ' 的韵母记作 'v'。
    expect(finalOf('lǜ')).toBe('v');
  });

  it('spells the final of jiu as iou, not iu', () => {
    // 拼音里 j/q/x 后的 iu 其实念的是 iou ——「九」是 jiǔ 不是 juǔ。
    // 干扰字是按韵母挑的，韵母算错，干扰字就挑不准。
    expect(finalOf('jiu')).toBe('iou');
    expect(finalOf('qiu')).toBe('iou');
    expect(finalOf('xiu')).toBe('iou');
    // 没有 iu 的字不受影响。
    expect(finalOf('jiao')).toBe('iao');
  });

  it('reads the bare u after j/q/x/y as the ü it really is', () => {
    // 语料里 j/q/x/y 后的 ü 一个声调符号都不带（ju、qu、xu、jue、xue、
    // yuan、yu），韵母要自己还原成 ü —— 不还原的话「居」的韵母算成 u，
    // 跟「猪」混成一类。
    expect(finalOf('ju')).toBe('v');
    expect(finalOf('qu')).toBe('v');
    expect(finalOf('xu')).toBe('v');
    expect(finalOf('jue')).toBe('ve');
    expect(finalOf('xue')).toBe('ve');
    expect(finalOf('yuan')).toBe('van');
    expect(finalOf('yu')).toBe('v');
    expect(finalOf('yue')).toBe('ve');
    // l 后的 u 就是 u，不是 ü。
    expect(finalOf('lu')).toBe('u');
  });

  it('reads the ü after l and n, whatever tone it carries', () => {
    // 语料里 ü 是**预组合**字符（lǜ = 006C 01DC、lǚ = 006C 01DA、
    // lǘ = 006C 01D8、nǚ = 006E 01DA），不带任何组合记号。
    // 之前只认了 ǜ（一声那个），于是「履」lǚ、「闾」lǘ、「女」nǚ 的
    // 韵母都算成了 u —— 跟「鲁」「卢」混成一类，干扰字就挑不准。
    expect(finalOf('lǜ')).toBe('v');
    expect(finalOf('lǚ')).toBe('v');
    expect(finalOf('lǘ')).toBe('v');
    expect(finalOf('nǚ')).toBe('v');
    expect(finalOf('nüè')).toBe('ve');
    // l/n 后的 u 真的是 u，不是 ü。
    expect(finalOf('lù')).toBe('u');
    expect(finalOf('nǚ')).not.toBe('u');
  });

  it('keeps the i glide after the y initial', () => {
    // y 不是声母，是韵母头 —— 「严」yán 的韵母是 ian，不是 an。
    // 之前把 y 后的 u 换成 v 的时候，把 yán 的 i 一起吃掉了，
    // 「岩」yán 跟「安」ān 混成一类。
    expect(finalOf('yán')).toBe('ian');
    expect(finalOf('yáo')).toBe('iao');
    expect(finalOf('yè')).toBe('ie');
    expect(finalOf('yīn')).toBe('in');
    expect(finalOf('yīng')).toBe('ing');
    expect(finalOf('yǎng')).toBe('iang');
    // y 后的 u 是 ü，但前面的 i 要留着：yuan 的韵母是 üan（记作 van）。
    expect(finalOf('yuán')).toBe('van');
    // 「云」yun 是 ün —— y 就是 ü 的省写，所以韵母是 vn，跟「绿」的 v 一族。
    expect(finalOf('yún')).toBe('vn');
    expect(finalOf('yù')).toBe('v');
    expect(finalOf('yuè')).toBe('ve');
  });

  it('gives a zero-initial syllable its whole body as the final', () => {
    // 零声母音节（爱、鹅、欧、昂）整个音节都是韵母。
    // 之前一律把第一个字母当声母，于是「爱」ài 的韵母成了 'i'、
    // 「昂」áng 成了 'ng'、「鹅」é 成了空 —— 韵母算错，干扰字就挑不准。
    expect(finalOf('ài')).toBe('ai');
    expect(finalOf('é')).toBe('e');
    expect(finalOf('óu')).toBe('ou');
    expect(finalOf('áng')).toBe('ang');
    expect(finalOf('ér')).toBe('er');
    expect(finalOf('ēi')).toBe('ei');
    // 有声母的音节不受影响。
    expect(finalOf('mā')).toBe('a');
    expect(finalOf('zhōng')).toBe('ong');
  });

  it('refuses a couplet whose syllables have no tone', () => {
    // 轻声（de、le、ma）没有平仄，判不了对。抽取脚本会把这样的对句丢掉，
    // 但语料文件要是被人手改过、或者换了别的脚本生成，就可能混进来。
    // 这样的对句必须被拒绝 —— 硬把轻声当成平声，界面上的平仄标记就是错的。
    const neutral: DuiyunPair = {
      upper: '天地',
      lower: '古今',
      upperPinyin: ['tiān', 'de'],
      lowerPinyin: ['gǔ', 'jīn'],
      rhyme: '一东',
      book: '笠翁对韵',
    };
    expect(() => buildRound(neutral, DUIYUN_CONFIG.easy, 1, [neutral])).toThrow(/声调|tone/i);
  });

  it('gives an empty final to a syllable that is only an initial', () => {
    // 'zh' 这样的音节没有韵母 —— 韵母是空串，不是 'zh'，也不是 'h'。
    expect(initialOf('zh')).toBe('zh');
    expect(finalOf('zh')).toBe('');
  });

  it('makes one slot per character of both sides', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.slots).toHaveLength(4);
    expect(round.slots.filter((s) => s.side === 0)).toHaveLength(2);
    expect(round.slots.filter((s) => s.side === 1)).toHaveLength(2);
  });

  it('blanks the number of positions the config asks for', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.slots.filter((s) => s.isBlank)).toHaveLength(1);
    expect(blanksRemaining(round)).toBe(1);
  });

  it('puts the answer and the distractors on the tray', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.tray).toHaveLength(3);
    expect(round.tray.filter((t) => t.isAnswer)).toHaveLength(1);
  });

  it('refuses a character that does not belong in the slot', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const wrong = round.tray.find((t) => !t.isAnswer);
    expect(wrong).toBeDefined();
    const result = dropCharacter(round, blankIndex, wrong!.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_character');
  });

  it('refuses a drop into a slot that is already filled', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const result = dropCharacter(filled.state, blankIndex, answer.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('slot_filled');
  });

  it('refuses a tile that is not on the tray', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const result = dropCharacter(round, blankIndex, 'not-a-real-tile');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_a_tray_item');
  });

  it('is won when every blank is filled', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(isRoundWon(round)).toBe(false);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (filled.ok) expect(isRoundWon(filled.state)).toBe(true);
  });

  it('counts a blank as filled the moment the right character lands in it', () => {
    // 填好之后这一位还是「挖过的位置」，但空已经补上了 —— 还剩几个空要
    // 跟着这个变，不然界面上的数字会一直停在旧值。
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(blanksRemaining(round)).toBe(1);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (filled.ok) expect(blanksRemaining(filled.state)).toBe(0);
  });

  it('keeps a filled position marked as blanked, so it can be taken back', () => {
    // `isBlank` 说的是「这是一位挖过的」，`filled` 说的是「玩家填上了」。
    // 两个都留着，玩家才点得回自己填的字。
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.state.slots[blankIndex]!.isBlank).toBe(true);
    expect(filled.state.slots[blankIndex]!.filled).toBe(true);
  });

  it('puts a character back when it is lifted', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const lifted = liftCharacter(filled.state, blankIndex);
    expect(lifted.slots[blankIndex]!.isBlank).toBe(true);
    expect(blanksRemaining(lifted)).toBe(1);
    expect(lifted.tray.some((t) => t.id === answer.id)).toBe(true);
  });

  it('leaves a slot alone when the player lifts one that was never blank', () => {
    // 联上本来就写着的字不是字盘上的字，取走它这副联就不完整了。
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const filledInIndex = round.slots.findIndex((s) => !s.isBlank);
    expect(filledInIndex).toBeGreaterThanOrEqual(0);
    const lifted = liftCharacter(round, filledInIndex);
    expect(lifted).toBe(round);
    expect(lifted.tray).toHaveLength(round.tray.length);
  });

  it('builds the same round from the same seed', () => {
    const a = buildRound(PAIR, { blanks: 1, distractors: 2 }, 42, [PAIR]);
    const b = buildRound(PAIR, { blanks: 1, distractors: 2 }, 42, [PAIR]);
    expect(a.slots.map((s) => `${s.side}:${s.index}:${s.char}:${s.isBlank}`)).toEqual(
      b.slots.map((s) => `${s.side}:${s.index}:${s.char}:${s.isBlank}`),
    );
    expect(a.tray.map((t) => t.char)).toEqual(b.tray.map((t) => t.char));
  });

  it('shuffles the tray so the answers are not always first', () => {
    // 字盘的顺序要打乱 —— 不打乱的话答案总是排在最前面，玩家闭着眼都能赢。
    let shuffled = false;
    for (let seed = 0; seed < 40 && !shuffled; seed++) {
      const round = buildRound(PAIR, DUIYUN_CONFIG.hard, seed, [PAIR]);
      const answerPositions = round.tray
        .map((t, i) => (t.isAnswer ? i : -1))
        .filter((i) => i >= 0);
      // 两个答案字不在字盘的最前面。
      if (answerPositions.length > 0 && answerPositions[0]! > 0) shuffled = true;
    }
    expect(shuffled).toBe(true);
  });

  it('gives the three tiers a different number of blanks', () => {
    expect(DUIYUN_CONFIG.easy.blanks).toBe(1);
    expect(DUIYUN_CONFIG.medium.blanks).toBe(2);
    expect(DUIYUN_CONFIG.hard.blanks).toBe(3);
  });

  it('never leaves a tier with more blanks than the pair has slots', () => {
    // 一字对一字的对句只有两个位置 —— 挖三个会挖不到。
    const round = buildRound(SHORT, DUIYUN_CONFIG.hard, 7, [SHORT]);
    expect(round.slots.filter((s) => s.isBlank).length).toBeLessThanOrEqual(
      DUIYUN_CONFIG.hard.blanks,
    );
    expect(round.slots.filter((s) => s.isBlank).length).toBeGreaterThan(0);
  });

  it('blanks positions on both sides of the couplet', () => {
    // 只挖一边的话，玩家只需要想一边，难度上不去。
    const round = buildRound(PAIR, DUIYUN_CONFIG.medium, 7, [PAIR]);
    const blanks = round.slots.filter((s) => s.isBlank);
    expect(blanks).toHaveLength(2);
    expect(new Set(blanks.map((s) => s.side)).size).toBe(2);
  });

  it('gives every blank an answer tile on the tray', () => {
    const round = buildRound(PAIR, DUIYUN_CONFIG.hard, 7, [PAIR]);
    const blanks = round.slots.filter((s) => s.isBlank);
    const answers = round.tray.filter((t) => t.isAnswer);
    expect(answers).toHaveLength(blanks.length);
    for (const blank of blanks) {
      expect(answers.some((t) => t.char === blank.char)).toBe(true);
    }
  });

  it('never puts the same character on the tray twice', () => {
    // 字盘上出现两个一样的字，玩家就分不清哪个是哪个了 —— 而且他无从
    // 知道这两个字是一道题的答案还是干扰字。
    // 语料里同一个字出现在好几副对句里（纡、带、杉…），挑选干扰字的时候
    // 必须按字去重，否则七成的局都会出问题。
    // 语料里同一个字常常出现在好几副对句里（纡 出现在五副），
    // 而干扰字是按字挑的 —— 不去重的话字盘上就有两个一样的字。
    // 真机走查里「雨/风」那一局字盘上就是两个纡。
    const pool = [
      PAIR,
      { ...PAIR, upper: '绿纡', lower: '红锦', upperPinyin: ['lǜ', 'yū'], lowerPinyin: ['hóng', 'jǐn'] },
      { ...PAIR, upper: '素纡', lower: '端绵', upperPinyin: ['sù', 'yū'], lowerPinyin: ['duān', 'mián'] },
      { ...PAIR, upper: '翠纡', lower: '白纱', upperPinyin: ['cuì', 'yū'], lowerPinyin: ['bái', 'shā'] },
      { ...PAIR, upper: '青纡', lower: '紫绡', upperPinyin: ['qīng', 'yū'], lowerPinyin: ['zǐ', 'xiāo'] },
      { ...PAIR, upper: '黄纡', lower: '白绫', upperPinyin: ['huáng', 'yū'], lowerPinyin: ['bái', 'líng'] },
    ];
    // 只看「同一批候选里有多少个不同的字」：纡 出现了五次，
    // 一次挖空、挖两个空的时候，选中的干扰字很可能撞车。
    for (let seed = 0; seed < 200; seed++) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const round = buildRound(PAIR, DUIYUN_CONFIG[difficulty], seed, pool);
        const chars = round.tray.map((t) => t.char);
        expect(new Set(chars).size).toBe(chars.length);
      }
    }
  });

  it('never puts a blank answer on the tray as a distractor', () => {
    // 一个空要的字，出现在字盘上两次 —— 玩家看得见两个一样的字，却只填
    // 得出一个格。剩下的那个就是死字，而「放错了」看上去又是玩家的错。
    // 干扰字必须避开这一局所有的答案字。
    const pair: DuiyunPair = {
      upper: '地阔',
      lower: '天开',
      upperPinyin: ['dì', 'kuò'],
      lowerPinyin: ['tiān', 'kāi'],
      rhyme: '一东',
      book: '笠翁对韵',
    };
    const pool = [
      pair,
      { ...pair, upper: '门开', lower: '户阔', upperPinyin: ['mén', 'kāi'], lowerPinyin: ['hù', 'kuò'] },
      { ...pair, upper: '窗开', lower: '径阔', upperPinyin: ['chuāng', 'kāi'], lowerPinyin: ['jìng', 'kuò'] },
    ];
    for (let seed = 0; seed < 40; seed++) {
      const round = buildRound(pair, DUIYUN_CONFIG.medium, seed, pool);
      const answerChars = round.slots.filter((s) => s.isBlank).map((s) => s.char);
      for (const tile of round.tray) {
        if (tile.isAnswer) continue;
        expect(answerChars).not.toContain(tile.char);
      }
    }
  });

  it('keeps the number of distractors even when some candidates are dropped', () => {
    // 去重和排除答案之后，可选的字可能不够数 —— 宁可少给几个干扰字，
    // 也不能拿答案字来凑数。
    const pair: DuiyunPair = {
      upper: '地阔',
      lower: '天开',
      upperPinyin: ['dì', 'kuò'],
      lowerPinyin: ['tiān', 'kāi'],
      rhyme: '一东',
      book: '笠翁对韵',
    };
    const pool = [
      pair,
      { ...pair, upper: '门开', lower: '户阔', upperPinyin: ['mén', 'kāi'], lowerPinyin: ['hù', 'kuò'] },
    ];
    const round = buildRound(pair, DUIYUN_CONFIG.medium, 3, pool);
    const answers = round.tray.filter((t) => t.isAnswer);
    const distractors = round.tray.filter((t) => !t.isAnswer);
    expect(answers).toHaveLength(2);
    expect(distractors.length).toBeGreaterThan(0);
    expect(new Set(round.tray.map((t) => t.char)).size).toBe(round.tray.length);
  });
});
