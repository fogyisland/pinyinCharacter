/**
 * lib/wechat-broadcasts.ts
 *
 * The announcement store. This module NEVER talks to WeChat — it only
 * touches the database. The sending lives in `lib/wechat-sender.ts`, and
 * the split is what keeps "what was written" and "what was sent" separate
 * questions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  cancelBroadcast,
  createBroadcast,
  finishBroadcast,
  getBroadcast,
  listBroadcasts,
  markBroadcastSending,
  queueBroadcast,
  recordBroadcastOutcome,
} from '@/lib/wechat-broadcasts';

const ROW = {
  id: 1,
  title: 'v1.2 已上线',
  template_id: 'TM00001',
  url: null,
  data: '{"keyword1":{"value":"hello"}}',
  status: 'queued',
  total_recipients: 3,
  accepted_count: 0,
  skipped_count: 0,
  failed_count: 0,
  last_error: null,
  created_by: 7,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  finished_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
});

describe('creating an announcement', () => {
  it('writes a draft row and returns its id', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 42 }, []]);

    const id = await createBroadcast({
      title: 'v1.2 已上线',
      templateId: 'TM00001',
      url: null,
      data: { keyword1: { value: 'hello' } },
      createdBy: 7,
    });

    expect(id).toBe(42);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO wechat_broadcasts');
    expect(String(sql)).toContain("'draft'");
    expect(params).toContain('v1.2 已上线');
    expect(params).toContain('TM00001');
    expect(params).toContain(7);
  });

  it('stores the template data as a JSON string', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 1 }, []]);

    await createBroadcast({
      title: 't',
      templateId: 'TM00001',
      url: null,
      data: { keyword1: { value: 'hello' } },
      createdBy: 7,
    });

    const params = queryMock.mock.calls[0][1];
    const jsonIndex = params.findIndex(
      (param: unknown) => typeof param === 'string' && param.includes('"keyword1"'),
    );
    expect(jsonIndex).toBeGreaterThan(-1);
  });

  it('stores a null url as null, not as an empty string', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 1 }, []]);

    await createBroadcast({
      title: 't',
      templateId: 'TM00001',
      url: null,
      data: { keyword1: { value: 'x' } },
      createdBy: 7,
    });

    expect(queryMock.mock.calls[0][1]).toContain(null);
  });
});

describe('the announcement list', () => {
  it('returns the rows it was given', async () => {
    queryMock.mockResolvedValueOnce([[ROW], []]);

    const list = await listBroadcasts();

    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('v1.2 已上线');
    expect(list[0].data.keyword1.value).toBe('hello');
    expect(list[0].status).toBe('queued');
    expect(list[0].totalRecipients).toBe(3);
  });

  it('returns an empty list when there is nothing', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    expect(await listBroadcasts()).toEqual([]);
  });

  it('orders the newest first', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    await listBroadcasts();

    expect(String(queryMock.mock.calls[0][0])).toContain('ORDER BY id DESC');
  });

  it('reads a JSON column that the driver already parsed', async () => {
    // mysql2 hands a JSON column back as a string when it is not
    // configured to parse it, and as an object when it is. Both must work.
    queryMock.mockResolvedValueOnce([[{ ...ROW, data: { keyword1: { value: 'hello' } } }], []]);

    const list = await listBroadcasts();

    expect(list[0].data.keyword1.value).toBe('hello');
  });

  it('survives a data column that is not valid JSON', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockResolvedValueOnce([[{ ...ROW, data: '{broken' }], []]);

    const list = await listBroadcasts();

    expect(list[0].data).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('one announcement', () => {
  it('is null when the row does not exist', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    expect(await getBroadcast(999)).toBeNull();
  });

  it('is found by its id', async () => {
    queryMock.mockResolvedValueOnce([[{ ...ROW, status: 'sent' }], []]);

    const broadcast = await getBroadcast(5);

    expect(broadcast).not.toBeNull();
    expect(broadcast?.id).toBe(1);
    expect(broadcast?.status).toBe('sent');
  });
});

describe('the state changes', () => {
  it('queues a draft', async () => {
    await queueBroadcast(3);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("status = 'queued'");
    expect(String(sql)).toContain("status = 'draft'");
    expect(params).toContain(3);
  });

  it('cancels a draft and reports that it did', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    expect(await cancelBroadcast(3)).toBe(true);
  });

  it('does not cancel a broadcast that already went out', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    expect(await cancelBroadcast(3)).toBe(false);
  });

  it('only cancels a broadcast that has not gone out', async () => {
    // ⚠️ The affectedRows in the mock says nothing about WHICH rows the
    // statement matched — that comes from the WHERE clause. Without this
    // assertion the guard could be dropped and the test would still pass.
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await cancelBroadcast(3);

    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("status IN ('draft', 'queued')");
  });

  it('records the recipient count when the run starts', async () => {
    await markBroadcastSending(4, 12);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("status = 'sending'");
    expect(params).toContain(12);
    expect(params).toContain(4);
  });

  it('clears the counters when a run starts', async () => {
    // A second run of the same announcement must not add to the first
    // run's counts — the counters describe THIS run.
    await markBroadcastSending(4, 12);

    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain('accepted_count = 0');
    expect(sql).toContain('skipped_count = 0');
    expect(sql).toContain('failed_count = 0');
  });

  it('records the outcome counts', async () => {
    await recordBroadcastOutcome(4, { accepted: 8, skipped: 1, failed: 2, lastError: 'boom' });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('accepted_count');
    expect(String(sql)).toContain('skipped_count');
    expect(String(sql)).toContain('failed_count');
    expect(params).toContain(8);
    expect(params).toContain(1);
    expect(params).toContain(2);
    expect(params).toContain('boom');
    expect(params).toContain(4);
  });

  it('stores no error when there was none', async () => {
    await recordBroadcastOutcome(4, { accepted: 1, skipped: 0, failed: 0, lastError: null });

    expect(queryMock.mock.calls[0][1]).toContain(null);
  });

  it('records the final status and the moment it finished', async () => {
    await finishBroadcast(4, 'sent', null);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('finished_at');
    expect(params).toContain('sent');
  });

  it('records the final error', async () => {
    await finishBroadcast(4, 'failed', 'boom');

    expect(queryMock.mock.calls[0][1]).toContain('boom');
  });

  it('cuts an error that is longer than the column', async () => {
    await finishBroadcast(4, 'failed', 'x'.repeat(2000));

    const params = queryMock.mock.calls[0][1];
    const error = params.find((param: unknown) => typeof param === 'string' && param.startsWith('x'));
    expect((error as string).length).toBe(1024);
  });
});
