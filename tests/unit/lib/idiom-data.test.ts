/**
 * The idiom validator — the gate between AI-generated data and the database.
 *
 * These rows are written by a model, so the validator is the only thing
 * standing between a hallucinated four-character string and the game. The
 * tests below pin every rule and, for each rule, the exact row that would
 * break it — so a future edit that loosens a check fails here rather than
 * in front of a player.
 */
import { describe, it, expect } from 'vitest';
import {
  validateIdiomRow,
  validateIdiomBatch,
  IDIOM_CATEGORIES,
  type IdiomRow,
} from '@/lib/idiom-data';

/** A row that passes every check, used as the base for the failure cases. */
const GOOD: IdiomRow = {
  word: '一帆风顺',
  pinyin: 'yī fān fēng shùn',
  meaning: '比喻做事顺利，没有阻碍，也用来祝颂对方诸事顺遂。',
  level: 1,
  category: '处境',
};

/** The messages a set of problems carries. */
function messages(row: unknown): string[] {
  return validateIdiomRow(row).map((p) => p.message);
}

describe('validateIdiomRow', () => {
  it('accepts a well-formed row', () => {
    expect(validateIdiomRow(GOOD)).toEqual([]);
  });

  it('accepts every known category', () => {
    for (const category of IDIOM_CATEGORIES) {
      expect(validateIdiomRow({ ...GOOD, category })).toEqual([]);
    }
  });

  it('rejects a word that is not four characters long', () => {
    // 小巫见大巫 is five characters.
    expect(messages({ ...GOOD, word: '小巫见大巫' })).toContain(
      'word must have exactly 4 characters, has 5',
    );
  });

  it('rejects a word of three characters', () => {
    expect(messages({ ...GOOD, word: '三人成' })).toContain(
      'word must have exactly 4 characters, has 3',
    );
  });

  it('rejects a word that is five characters long', () => {
    expect(messages({ ...GOOD, word: '小巫见大巫' })).toContain(
      'word must have exactly 4 characters, has 5',
    );
  });

  it('rejects a word holding a latin letter', () => {
    expect(messages({ ...GOOD, word: 'ab顺' })).toContain(
      'word contains a character that is not a Chinese character',
    );
  });

  it('rejects a row with no word', () => {
    expect(messages({ ...GOOD, word: '' })).toContain('missing word');
  });

  it('rejects a reading of the wrong length', () => {
    expect(messages({ ...GOOD, pinyin: 'yī fān fēng' })).toContain(
      'pinyin must have 4 syllables, has 3',
    );
  });

  it('rejects a reading whose tone mark was dropped', () => {
    // "ma" instead of "má" — the mark is gone, so the reading lost the tone.
    expect(messages({ ...GOOD, pinyin: 'yi fan feng shun' })).toContain(
      'pinyin syllable "yi" has no tone mark',
    );
  });

  it('accepts a syllable whose off-glide vowel is plain', () => {
    // Mandarin marks the NUCLEUS only: iè marks the i and leaves the e
    // plain, qiú marks the u and leaves the i plain. A check that looked
    // for "no plain vowel" would reject every correct multi-vowel
    // syllable — iè, qiú, liàn, guāng — which is most of them.
    expect(messages({ ...GOOD, pinyin: 'iè shí jīng tī' })).toEqual([]);
    expect(messages({ ...GOOD, pinyin: 'qiú jìng guāng liàn' })).toEqual([]);
  });

  it('rejects a reading where every vowel lost its mark', () => {
    expect(messages({ ...GOOD, pinyin: 'shi jing nian feng' })).toEqual([
      'pinyin syllable "shi" has no tone mark',
      'pinyin syllable "jing" has no tone mark',
      'pinyin syllable "nian" has no tone mark',
      'pinyin syllable "feng" has no tone mark',
    ]);
  });

  it('rejects a reading that writes ü as v', () => {
    // "nv" is how 女 is typed on a keyboard without ü.
    expect(messages({ ...GOOD, pinyin: 'lǜ ǘ ǚ qù' })).toEqual([]);
    expect(messages({ ...GOOD, pinyin: 'lu nv ju qu' })).toContain(
      'pinyin syllable "nv" writes ü as "v"',
    );
  });

  it('accepts a j/q/x reading whose u is really an ü', () => {
    // ju, qu, xu are correct spellings — the u there is an ü.
    expect(messages({ ...GOOD, pinyin: 'jú qù xū ēr' })).toEqual([]);
  });

  it('allows the er syllable, which is written without a tone mark', () => {
    // 二 ér / 耳 ěr — the neutral reading of er is legitimately unmarked.
    expect(messages({ ...GOOD, pinyin: 'èr shí yī lè' })).toEqual([]);
  });

  it('rejects a row with no reading', () => {
    expect(messages({ ...GOOD, pinyin: '' })).toContain('missing pinyin');
  });

  it('rejects a row with no meaning', () => {
    expect(messages({ ...GOOD, meaning: '   ' })).toContain('missing meaning');
  });

  it('rejects a level outside 1 to 4', () => {
    expect(messages({ ...GOOD, level: 0 })).toContain('level must be an integer from 1 to 4, got 0');
    expect(messages({ ...GOOD, level: 5 })).toContain('level must be an integer from 1 to 4, got 5');
  });

  it('rejects a level that is not an integer', () => {
    expect(messages({ ...GOOD, level: 2.5 })).toContain(
      'level must be an integer from 1 to 4, got 2.5',
    );
  });

  it('rejects an unknown category', () => {
    expect(messages({ ...GOOD, category: '天气' })).toContain(
      'category "天气" is not one of the 10 known categories',
    );
  });

  it('rejects a row that is not an object', () => {
    expect(validateIdiomRow(null)).toEqual([{ word: '', message: 'row is not an object' }]);
    expect(validateIdiomRow('一帆风顺')).toEqual([{ word: '', message: 'row is not an object' }]);
  });

  it('reports every problem at once rather than the first', () => {
    const broken = { word: 'x', pinyin: '', meaning: '', level: 9, category: 'nope' };
    expect(messages(broken).length).toBeGreaterThan(3);
  });

  it('names the word in the problem so a bad batch can be found', () => {
    const problems = validateIdiomRow({ ...GOOD, level: 9 });
    expect(problems[0].word).toBe('一帆风顺');
  });
});

describe('validateIdiomBatch', () => {
  it('accepts a batch of well-formed rows', () => {
    const result = validateIdiomBatch([GOOD, { ...GOOD, word: '胸有成竹' }]);
    expect(result.valid).toHaveLength(2);
    expect(result.problems).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('drops a duplicate and reports it', () => {
    const result = validateIdiomBatch([GOOD, { ...GOOD }]);
    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toEqual(['一帆风顺']);
    expect(result.problems).toEqual([]);
  });

  it('keeps the first copy of a duplicated word', () => {
    const second = { ...GOOD, meaning: '另一个释义' };
    const result = validateIdiomBatch([GOOD, second]);
    expect(result.valid[0].meaning).toBe(GOOD.meaning);
  });

  it('rejects a batch that is not an array', () => {
    const result = validateIdiomBatch({ word: '一帆风顺' });
    expect(result.valid).toEqual([]);
    expect(result.problems).toEqual([{ word: '', message: 'batch is not an array' }]);
  });

  it('keeps the valid rows of a mixed batch and reports the broken ones', () => {
    const result = validateIdiomBatch([GOOD, { ...GOOD, word: '小巫见大巫' }, { ...GOOD, word: '胸有成竹' }]);
    expect(result.valid).toHaveLength(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].word).toBe('小巫见大巫');
  });
});
