// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MAX_CLASS_NAME,
  MAX_JOIN_CODE_TRIES,
  buildAssignmentPayload,
  generateJoinCode,
  isJoinCode,
  normalizeClassName,
  parseAssignmentPayload,
  sortAssignments,
} from '@/lib/classes';

/**
 * 班级与作业 — 领域层。
 *
 * 孔子学院开的是十到二十人的小班，老师每周要发一次「本周练这几个字」
 * 的班级作业。站内已有的字帖、听写、复习都在单人世界里，老师没有
 * 任何办法把一批字派给一个班。
 *
 * 这一层是纯函数：命名与校验、邀请码、作业载荷的编解码、排序。数据库
 * 访问与权限判定在 lib/classes-store.ts 里，两者分开是为了让规则能在
 * 没有数据库的情况下被钉住。
 */

describe('班级名', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeClassName('  HSK1   周三班 ')).toBe('HSK1 周三班');
  });

  it('rejects an empty name after trimming', () => {
    expect(normalizeClassName('   ')).toBe('');
  });

  it('keeps the name within the column width', () => {
    expect(MAX_CLASS_NAME).toBe(64);
    const long = 'x'.repeat(80);
    expect(normalizeClassName(long)).toHaveLength(64);
  });

  it('does not cut a surrogate pair in half', () => {
    // 班级名可以是中文（BMP 内，1 个 UTF-16 单元），但接口不能假设这一点。
    // 100 个 emoji（每个 2 个 UTF-16 单元）超过 64 个字符的上限，截断必须
    // 按「字符」而不是按 code unit —— 从代理对中间切下去会留下半个字符。
    const emoji = '\u{1F4DA}'.repeat(100);
    const trimmed = normalizeClassName(emoji);
    expect(Array.from(trimmed).length).toBe(MAX_CLASS_NAME);
    for (const char of trimmed) expect(char.codePointAt(0)).toBeGreaterThan(0xffff);
  });
});

describe('邀请码', () => {
  it('accepts the shapes the generator produces', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateJoinCode();
      expect(isJoinCode(code), `generated ${code}`).toBe(true);
    }
  });

  it('avoids characters that look alike when typed', () => {
    // 0/O、1/I/l 是手抄邀请码时最常见的错。
    for (const forbidden of ['0', 'O', '1', 'I', 'l']) {
      expect(isJoinCode(`AB${forbidden}D`)).toBe(false);
    }
  });

  it('rejects wrong lengths and lowercase', () => {
    expect(isJoinCode('ABC')).toBe(false);
    expect(isJoinCode('ABCDEFG')).toBe(false);
    expect(isJoinCode('abcd')).toBe(false);
  });

  it('produces codes that are not all the same character', () => {
    // A code of "AAAA" is technically valid but useless as an invite.
    for (let i = 0; i < 20; i += 1) {
      const code = generateJoinCode();
      expect(new Set(code).size).toBeGreaterThan(1);
    }
  });

  it('declares how many collisions are tolerated when creating a class', () => {
    expect(MAX_JOIN_CODE_TRIES).toBe(6);
  });
});

describe('作业载荷', () => {
  it('round-trips a worksheet assignment', () => {
    const payload = buildAssignmentPayload({
      kind: 'worksheet',
      title: '第 3 课生字',
      worksheetId: 12,
      chars: ['学', '生', '老', '师'],
    });
    const parsed = parseAssignmentPayload(payload);
    expect(parsed?.kind).toBe('worksheet');
    if (parsed?.kind !== 'worksheet') throw new Error('kind changed');
    expect(parsed.worksheetId).toBe(12);
    expect(parsed.chars).toEqual(['学', '生', '老', '师']);
  });

  it('round-trips a dictation assignment', () => {
    const payload = buildAssignmentPayload({
      kind: 'dictation',
      title: '听写：校园',
      items: [
        { word: '学生', pinyin: 'xué shēng' },
        { word: '老师', pinyin: 'lǎo shī' },
      ],
    });
    const parsed = parseAssignmentPayload(payload);
    expect(parsed?.kind).toBe('dictation');
    if (parsed?.kind !== 'dictation') throw new Error('kind changed');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].word).toBe('学生');
  });

  it('rejects a payload that is not an object', () => {
    expect(parseAssignmentPayload(null)).toBeNull();
    expect(parseAssignmentPayload('a string')).toBeNull();
    expect(parseAssignmentPayload([1, 2])).toBeNull();
  });

  it('rejects an unknown kind instead of guessing', () => {
    // 旧版本写下的行、或者手改过的行：宁可当它没有，也不能让页面把
    // 一个未知的作业渲染成「字帖」。
    expect(parseAssignmentPayload({ kind: 'review', title: 'x' })).toBeNull();
  });

  it('rejects a worksheet assignment with no characters', () => {
    // 空载荷等于「派了一个没有内容的作业」，学生打开是空白页。
    expect(parseAssignmentPayload({ kind: 'worksheet', title: 'x', worksheetId: 1, chars: [] })).toBeNull();
  });

  it('rejects a dictation assignment whose items are malformed', () => {
    expect(
      parseAssignmentPayload({ kind: 'dictation', title: 'x', items: [{ word: '', pinyin: '' }] }),
    ).toBeNull();
    expect(parseAssignmentPayload({ kind: 'dictation', title: 'x', items: 'nope' })).toBeNull();
  });

  it('drops more than the cap instead of refusing the whole assignment', () => {
    // 一个字帖最多 500 个格子，这是保存接口的上限；派作业沿用同一个上限。
    const chars = Array.from({ length: 600 }, () => '学');
    const payload = buildAssignmentPayload({
      kind: 'worksheet',
      title: 'x',
      worksheetId: 1,
      chars,
    });
    const parsed = parseAssignmentPayload(payload);
    expect(parsed?.kind).toBe('worksheet');
    if (parsed?.kind !== 'worksheet') throw new Error('kind changed');
    expect(parsed.chars).toHaveLength(500);
  });

  it('keeps the due date out of the payload', () => {
    // 截止时间是这一批作业的属性，不是内容的一部分；放进载荷会让
    // 「同一份作业派给两个班」需要两份载荷。
    const payload = buildAssignmentPayload({
      kind: 'worksheet',
      title: 'x',
      worksheetId: 1,
      chars: ['学'],
    });
    expect(payload).not.toHaveProperty('dueAt');
  });
});

describe('作业排序', () => {
  const assignment = (id: number, dueAt: string | null, createdAt: string) => ({
    id,
    dueAt,
    createdAt,
  });

  it('puts unfinished work with the nearest deadline first', () => {
    const sorted = sortAssignments([
      assignment(1, '2026-12-10', '2026-11-01'),
      assignment(2, '2026-11-25', '2026-11-20'),
      assignment(3, null, '2026-11-22'),
    ]);
    // 有截止的先按截止日期，没有截止的排在后面，再按创建时间。
    expect(sorted.map((a) => a.id)).toEqual([2, 1, 3]);
  });

  it('is stable when the deadlines are equal', () => {
    const sorted = sortAssignments([
      assignment(1, '2026-11-25', '2026-11-20'),
      assignment(2, '2026-11-25', '2026-11-21'),
    ]);
    expect(sorted.map((a) => a.id)).toEqual([1, 2]);
  });

  it('does not mutate the input', () => {
    const input = [assignment(1, '2026-12-10', '2026-11-01'), assignment(2, '2026-11-25', '2026-11-20')];
    const before = input.map((a) => a.id);
    sortAssignments(input);
    expect(input.map((a) => a.id)).toEqual(before);
  });
});
