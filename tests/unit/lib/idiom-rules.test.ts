/**
 * The idiom drag game's rules.
 *
 * Every rule the game has is pinned here, including the ones a player
 * cannot see: which slots start blank, what the tray holds, and which
 * drops are refused and why.
 */
import { describe, it, expect } from 'vitest';
import {
  IDIOM_CONFIG,
  buildRound,
  chooseBlankSlots,
  charactersOf,
  readingsOf,
  dropCharacter,
  liftCharacter,
  isRoundWon,
  blanksRemaining,
  isRoundStuck,
  type GameIdiom,
  type IdiomRound,
} from '@/lib/idiom-rules';

/** An idiom the tests use as the question. */
const TARGET: GameIdiom = {
  word: '一帆风顺',
  pinyin: 'yī fān fēng shùn',
  meaning: '比喻做事顺利，没有阻碍。',
  level: 1,
  category: '处境',
};

/** Other idioms the tray's distractors are drawn from. */
const POOL: GameIdiom[] = [
  TARGET,
  { word: '胸有成竹', pinyin: 'xiōng yǒu chéng zhú', meaning: '比喻做事已有把握。', level: 2, category: '品格' },
  { word: '水到渠成', pinyin: 'shuǐ dào qú chéng', meaning: '比喻条件成熟，事情自然成功。', level: 3, category: '处境' },
  { word: '精益求精', pinyin: 'jīng yì qiú jīng', meaning: '已经很好了还追求更好。', level: 2, category: '品格' },
  { word: '心花怒放', pinyin: 'xīn huā nù fàng', meaning: '形容欣喜万分。', level: 1, category: '情绪' },
];

/** A round over TARGET at the given difficulty. */
function roundAt(difficulty: 'easy' | 'medium' | 'hard', seed = 7): IdiomRound {
  return buildRound(TARGET, IDIOM_CONFIG[difficulty], seed, POOL);
}

/** The characters a round's tray holds. */
function trayChars(state: IdiomRound): string[] {
  return state.tray.map((item) => item.char);
}

describe('charactersOf / readingsOf', () => {
  it('splits the word into its characters', () => {
    expect(charactersOf(TARGET)).toEqual(['一', '帆', '风', '顺']);
  });

  it('splits the reading into its syllables', () => {
    expect(readingsOf(TARGET)).toEqual(['yī', 'fān', 'fēng', 'shùn']);
  });

  it('ignores extra spaces in the reading', () => {
    expect(readingsOf({ ...TARGET, pinyin: '  yī   fān fēng shùn ' })).toEqual([
      'yī',
      'fān',
      'fēng',
      'shùn',
    ]);
  });
});

describe('chooseBlankSlots', () => {
  it('blanks the requested number of slots', () => {
    const slots = chooseBlankSlots(TARGET, 2, () => 0.5);
    expect(slots).toHaveLength(2);
  });

  it('never blanks the first slot when there is more than one blank', () => {
    // The player needs an anchor to read the rest from.
    for (let seed = 0; seed < 50; seed++) {
      const rng = (() => {
        let state = seed * 7919 + 13;
        return () => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state / 2147483648;
        };
      })();
      const slots = chooseBlankSlots(TARGET, 2, rng);
      expect(slots).not.toContain(0);
    }
  });

  it('may blank the first slot when there is only one blank', () => {
    const slots = chooseBlankSlots(TARGET, 1, () => 0);
    expect(slots).toEqual([0]);
  });

  it('blanks nothing when asked for nothing', () => {
    expect(chooseBlankSlots(TARGET, 0, () => 0.5)).toEqual([]);
  });

  it('never blanks more slots than the idiom has', () => {
    expect(chooseBlankSlots(TARGET, 99, () => 0.5)).toHaveLength(4);
  });

  it('returns the slots in order', () => {
    const slots = chooseBlankSlots(TARGET, 3, () => 0.9);
    expect([...slots].sort((a, b) => a - b)).toEqual(slots);
  });
});

describe('buildRound', () => {
  it('gives one slot per character', () => {
    const round = roundAt('easy');
    expect(round.slots).toHaveLength(4);
    expect(round.slots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('leaves the requested number of slots blank', () => {
    expect(roundAt('easy').slots.filter((s) => s.char === '')).toHaveLength(1);
    expect(roundAt('medium').slots.filter((s) => s.char === '')).toHaveLength(2);
    expect(roundAt('hard').slots.filter((s) => s.char === '')).toHaveLength(3);
  });

  it('marks exactly the blank slots as blank', () => {
    const round = roundAt('medium');
    expect(round.slots.filter((s) => s.isBlank)).toHaveLength(2);
    for (const slot of round.slots) {
      expect(slot.isBlank).toBe(slot.char === '');
    }
  });

  it('shows the reading of a slot that is not blank', () => {
    const round = roundAt('medium');
    for (const slot of round.slots) {
      if (slot.char === '') continue;
      expect(slot.pinyin).not.toBe('');
    }
  });

  it('holds the missing characters and the distractors in the tray', () => {
    const round = roundAt('medium');
    const missing = round.slots.filter((s) => s.char === '').map((s) => charactersOf(TARGET)[s.index]);
    expect(trayChars(round)).toHaveLength(missing.length + IDIOM_CONFIG.medium.distractors);
    for (const char of missing) {
      expect(trayChars(round)).toContain(char);
    }
  });

  it('never puts the same character in the tray twice', () => {
    for (let seed = 0; seed < 30; seed++) {
      const round = buildRound(TARGET, IDIOM_CONFIG.hard, seed, POOL);
      const chars = trayChars(round);
      expect(new Set(chars).size).toBe(chars.length);
    }
  });

  it('gives every tray character a reading', () => {
    const round = roundAt('medium');
    for (const item of round.tray) {
      expect(item.pinyin).not.toBe('');
    }
  });

  it('starts with nothing placed', () => {
    expect(roundAt('easy').placed).toBe(0);
  });

  it('gives two identical tray characters different ids', () => {
    // The ids must be unique even if two characters were the same, or one
    // of them could not be picked.
    const round = roundAt('medium');
    const ids = round.tray.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('dropCharacter', () => {
  it('fills a blank slot with the right character', () => {
    const round = roundAt('easy');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    const wanted = charactersOf(TARGET)[blankIndex];
    const item = round.tray.find((entry) => entry.char === wanted)!;

    const result = dropCharacter(round, blankIndex, item.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.slots[blankIndex].char).toBe(wanted);
    expect(result.state.placed).toBe(1);
  });

  it('takes the character out of the tray', () => {
    const round = roundAt('easy');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    const wanted = charactersOf(TARGET)[blankIndex];
    const item = round.tray.find((entry) => entry.char === wanted)!;

    const result = dropCharacter(round, blankIndex, item.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tray.map((t) => t.id)).not.toContain(item.id);
  });

  it('refuses a slot that is out of bounds', () => {
    const round = roundAt('easy');
    const item = round.tray[0];
    const result = dropCharacter(round, 99, item.id);
    expect(result).toEqual({ ok: false, reason: 'out_of_bounds' });
  });

  it('refuses a slot that already holds a character', () => {
    const round = roundAt('easy');
    const filledIndex = round.slots.findIndex((s) => s.char !== '');
    const result = dropCharacter(round, filledIndex, round.tray[0].id);
    expect(result).toEqual({ ok: false, reason: 'slot_filled' });
  });

  it('refuses a tray item that does not exist', () => {
    const round = roundAt('easy');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    const result = dropCharacter(round, blankIndex, 'no-such-item');
    expect(result).toEqual({ ok: false, reason: 'not_a_tray_item' });
  });

  it('refuses a distractor', () => {
    // The wrong character must not fill the slot — that is the whole point
    // of the distractors.
    const round = roundAt('hard');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    const wanted = charactersOf(TARGET)[blankIndex];
    const wrong = round.tray.find((entry) => entry.char !== wanted);
    if (!wrong) return; // no distractor in this seed — nothing to assert

    const result = dropCharacter(round, blankIndex, wrong.id);
    expect(result).toEqual({ ok: false, reason: 'wrong_character' });
  });

  it('does not change the round when the drop is refused', () => {
    const round = roundAt('easy');
    const filledIndex = round.slots.findIndex((s) => s.char !== '');
    const result = dropCharacter(round, filledIndex, round.tray[0].id);
    expect(result.ok).toBe(false);
    // The original object is untouched — the rules never mutate.
    expect(round.placed).toBe(0);
  });
});

describe('liftCharacter', () => {
  it('puts a placed character back into the tray', () => {
    const round = roundAt('easy');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    const wanted = charactersOf(TARGET)[blankIndex];
    const item = round.tray.find((entry) => entry.char === wanted)!;
    const dropped = dropCharacter(round, blankIndex, item.id);
    if (!dropped.ok) throw new Error('the drop should have been accepted');

    const lifted = liftCharacter(dropped.state, blankIndex);
    expect(lifted.slots[blankIndex].char).toBe('');
    expect(lifted.tray.map((t) => t.char)).toContain(wanted);
    expect(lifted.placed).toBe(0);
  });

  it('will not empty a slot the game filled in', () => {
    // The filled slots are part of the question; emptying them would let
    // the player solve the round without reading anything.
    const round = roundAt('medium');
    const filledIndex = round.slots.findIndex((s) => s.char !== '');
    const lifted = liftCharacter(round, filledIndex);
    expect(lifted.slots[filledIndex].char).toBe(round.slots[filledIndex].char);
  });

  it('does nothing to a slot that is already blank', () => {
    const round = roundAt('easy');
    const blankIndex = round.slots.findIndex((s) => s.char === '');
    expect(liftCharacter(round, blankIndex)).toBe(round);
  });
});

describe('isRoundWon / blanksRemaining / isRoundStuck', () => {
  it('is not won while a slot is blank', () => {
    expect(isRoundWon(roundAt('medium'))).toBe(false);
  });

  it('is won once every slot holds the idiom character', () => {
    let round = roundAt('medium');
    for (let index = 0; index < round.slots.length; index++) {
      if (round.slots[index].char !== '') continue;
      const wanted = charactersOf(TARGET)[index];
      const item = round.tray.find((entry) => entry.char === wanted);
      if (!item) throw new Error(`the tray is missing ${wanted}`);
      const result = dropCharacter(round, index, item.id);
      if (!result.ok) throw new Error('the drop should have been accepted');
      round = result.state;
    }
    expect(isRoundWon(round)).toBe(true);
  });

  it('counts the slots still blank', () => {
    expect(blanksRemaining(roundAt('hard'))).toBe(3);
  });

  it('is not stuck while the missing characters are in the tray', () => {
    expect(isRoundStuck(roundAt('hard'))).toBe(false);
  });

  it('is stuck when a missing character is not in the tray', () => {
    const round = roundAt('easy');
    const broken: IdiomRound = { ...round, tray: [] };
    expect(isRoundStuck(broken)).toBe(true);
  });

  it('is not stuck when the round is already filled', () => {
    const round = roundAt('easy');
    const filled: IdiomRound = {
      ...round,
      slots: round.slots.map((slot) => ({ ...slot, char: charactersOf(TARGET)[slot.index] })),
      tray: [],
    };
    expect(isRoundStuck(filled)).toBe(false);
  });
});
