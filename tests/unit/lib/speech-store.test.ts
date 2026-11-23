// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 语音评测的记账层 —— 用假的 mysql 池驱动。
 *
 * 这一层存在的唯一理由是**账单**：Azure 按音频秒数收费，所以每打一次分
 * 就要有一条记录，配额也按记录数算。它必须做对三件事：
 *
 *   1. 记分（谁、哪个词、听到了什么、四分）；
 *   2. 数今天已经用了几次（配额的唯一来源）；
 *   3. 不记音频 —— 这一层连字段名都不该出现「audio」「wav」。
 *
 * 假池让这三件事都能在没有 MySQL 的情况下被钉住。
 */

type Row = Record<string, unknown>;

const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getPool: getPoolMock }));

import { countAssessmentsToday, recordAssessment } from '@/lib/speech-store';
import type { Assessment } from '@/lib/speech-types';

/** The pool's `query` records each call and answers from a script. */
function scripted(rows: Row[]): void {
  queryMock.mockResolvedValue([rows, []]);
}

beforeEach(() => {
  queryMock.mockReset();
  getPoolMock.mockReset();
  getPoolMock.mockReturnValue({ query: queryMock });
  scripted([]);
});

/** The last SQL statement and its parameters. */
function lastCall(): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls[queryMock.mock.calls.length - 1];
  return { sql: String(call[0]).replace(/\s+/g, ' ').trim(), params: call[1] ?? [] };
}

const ASSESSMENT: Assessment = {
  reference: '学生',
  recognised: '学生',
  accuracy: 92,
  fluency: 95,
  completeness: 100,
  prosody: 88,
  pronunciation: 93.5,
  syllables: [],
  phonemes: [],
};

describe('countAssessmentsToday', () => {
  it('counts the rows dated today for that user', async () => {
    scripted([{ n: 4 }]);
    expect(await countAssessmentsToday(9)).toBe(4);
    // The count must be per user and per day: a global count would make one
    // class starve the next.
    expect(lastCall().sql).toContain('user_id = ?');
    expect(lastCall().sql).toContain('CURDATE()');
    expect(lastCall().params).toEqual([9]);
  });

  it('returns 0 when the row set is empty', async () => {
    scripted([]);
    expect(await countAssessmentsToday(9)).toBe(0);
  });

  it('returns 0 rather than NaN when COUNT is null', async () => {
    scripted([{ n: null }]);
    expect(await countAssessmentsToday(9)).toBe(0);
  });

  it('throws when the count cannot be read, rather than reporting "not used today"', async () => {
    // The quota is the only guard between a retry loop and a bill. A read
    // failure that answered 0 would read as "quota never reached" and leave
    // the paid path uncapped — so it must surface, not default.
    queryMock.mockRejectedValue(
      Object.assign(new Error("ER_NO_SUCH_TABLE: Table 'pinyin_test.speech_assessments' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
      }),
    );
    await expect(countAssessmentsToday(9)).rejects.toThrow(/speech_assessments/);
  });
});

describe('recordAssessment', () => {
  it('inserts the scores and the word, and nothing about the audio', async () => {
    await recordAssessment(9, ASSESSMENT);
    const { sql, params } = lastCall();
    expect(sql).toContain('INSERT INTO speech_assessments');
    // Which columns: the scores are what the learner was shown, so a
    // 「为什么昨天 88 今天 96」 question has an answer.
    expect(sql).toContain('pronunciation');
    expect(sql).toContain('accuracy');
    // The audio must never be a column here: a voice is personal data and
    // this table is deliberately scoreable data only.
    expect(sql.toLowerCase()).not.toContain('audio');
    expect(sql.toLowerCase()).not.toContain('wav');
    expect(params).toEqual([9, '学生', '学生', 93.5, 92, 95, 100]);
  });

  it('truncates a long recognised text to the column width', async () => {
    // Azure can answer with a whole sentence when the learner talks over the
    // word. A VARCHAR(64) would otherwise reject the insert and lose the row
    // that the quota depends on.
    await recordAssessment(9, { ...ASSESSMENT, recognised: '学'.repeat(80) });
    expect(lastCall().params[2]).toHaveLength(64);
  });

  it('clamps a score outside 0–100 into the column', async () => {
    // DECIMAL(5,1) cannot hold 120.0 or -5. Clamping keeps the row instead of
    // failing the insert and losing a billable call.
    await recordAssessment(9, { ...ASSESSMENT, pronunciation: 120, accuracy: -5 });
    expect(lastCall().params[3]).toBe(100);
    expect(lastCall().params[4]).toBe(0);
  });

  it('swallows a write failure without throwing at the caller', async () => {
    // The learner already has their score; the row is for the operator's bill.
    // Losing it must be logged, not turned into a failed assessment.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    queryMock.mockRejectedValue(new Error('table is missing'));
    await expect(recordAssessment(9, ASSESSMENT)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
