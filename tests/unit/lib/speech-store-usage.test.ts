// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 站长的用量面板数据。
 *
 * 这张表原本只为**配额**而写。站长付了 Azure 的钱，却回答不了决定配额是否
 * 合适的两个问题：「有人在用吗？」「哪些词一直低分？」——于是这里补上读侧。
 *
 * 三条必须成立：
 *   1. 只读分数，绝不读声音（从来就没存过）；
 *   2. 缺表时给空面板而不是报错 —— 这是给人看的读，不是账单的守卫；
 *   3. 任何 NaN 都变成 0 或 null，否则页面会渲染出 `NaN 分`。
 */

type Row = Record<string, unknown>;

const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getPool: getPoolMock }));

import { readSpeechUsage } from '@/lib/speech-store';

beforeEach(() => {
  queryMock.mockReset();
  getPoolMock.mockReset();
  getPoolMock.mockReturnValue({ query: queryMock });
});

/** Answer the two queries readSpeechUsage makes, in order. */
function scripted(usage: Row[], recent: Row[]): void {
  queryMock.mockResolvedValueOnce([usage, []]).mockResolvedValueOnce([recent, []]);
}

describe('readSpeechUsage', () => {
  it('reads today’s count, today’s people and the 7-day average', async () => {
    scripted([{ today_count: 12, today_users: 4, avg_score: 88.25 }], []);
    const usage = await readSpeechUsage();
    expect(usage.todayCount).toBe(12);
    expect(usage.todayUsers).toBe(4);
    expect(usage.avgScore).toBe(88.3);
  });

  it('rounds the average to one decimal, the way the panel prints it', async () => {
    scripted([{ today_count: 1, today_users: 1, avg_score: 93.55 }], []);
    expect((await readSpeechUsage()).avgScore).toBe(93.6);
  });

  it('reports a null average when nothing was scored', async () => {
    // 0 分 and 「没人用过」 are different facts; showing 0 would look like
    // everyone failed.
    scripted([{ today_count: 0, today_users: 0, avg_score: null }], []);
    const usage = await readSpeechUsage();
    expect(usage.avgScore).toBeNull();
    expect(usage.todayCount).toBe(0);
  });

  it('maps the recent rows, newest first as the query ordered them', async () => {
    scripted(
      [{ today_count: 1, today_users: 1, avg_score: 90 }],
      [
        {
          id: 9,
          user_id: 5,
          username: '小明',
          reference: '学生',
          recognised: '学生',
          pronunciation: '93.5',
          created_at: new Date('2026-11-23T10:00:00Z'),
        },
      ],
    );
    const usage = await readSpeechUsage();
    expect(usage.recent).toHaveLength(1);
    expect(usage.recent[0]).toMatchObject({
      id: 9,
      userId: 5,
      username: '小明',
      reference: '学生',
      pronunciation: 93.5,
    });
  });

  it('keeps a deleted user’s row with no username', async () => {
    // The FK cascades on delete, but a row can still be joined before the
    // cascade runs; a null name must not drop the record.
    scripted(
      [{ today_count: 1, today_users: 0, avg_score: null }],
      [
        {
          id: 3,
          user_id: 99,
          username: null,
          reference: '学',
          recognised: '学',
          pronunciation: 80,
          created_at: '2026-11-23T10:00:00Z',
        },
      ],
    );
    const usage = await readSpeechUsage();
    expect(usage.recent[0].username).toBeNull();
    expect(usage.recent[0].createdAt).toBeInstanceOf(Date);
  });

  it('returns an empty panel instead of throwing when the table is missing', async () => {
    // This is a read for a human. The learner's route already answers 503
    // with the migration command; the settings page should just look empty.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    queryMock.mockRejectedValue(
      Object.assign(new Error("ER_NO_SUCH_TABLE: Table 'pinyin_test.speech_assessments' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
      }),
    );
    await expect(readSpeechUsage()).resolves.toEqual({
      todayCount: 0,
      todayUsers: 0,
      avgScore: null,
      recent: [],
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('turns a NaN aggregate into 0 rather than rendering it', async () => {
    // MySQL returns strings for SUM/AVG; Number('') is NaN, and a panel that
    // prints `NaN 次` looks broken.
    scripted([{ today_count: '', today_users: null, avg_score: 'abc' }], []);
    const usage = await readSpeechUsage();
    expect(usage.todayCount).toBe(0);
    expect(usage.todayUsers).toBe(0);
    expect(usage.avgScore).toBeNull();
  });

  it('never selects an audio column', async () => {
    // Deliberate: a voice is personal data and was never stored. If someone
    // later adds such a column, this test is the reminder that the panel
    // must not read it.
    scripted([{ today_count: 0, today_users: 0, avg_score: null }], []);
    await readSpeechUsage();
    for (const call of queryMock.mock.calls) {
      const sql = String(call[0]).toLowerCase();
      expect(sql).not.toContain('audio');
      expect(sql).not.toContain('wav');
    }
  });
});
