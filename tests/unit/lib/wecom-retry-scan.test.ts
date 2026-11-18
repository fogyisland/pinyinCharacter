import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { runWecomDeliver } from '@/lib/wecom-deliver';

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('the scan of the due messages', () => {
  it('picks up the messages that failed earlier', async () => {
    // ⚠️ THIS IS THE CORE OF THE FEATURE.
    //
    // A push that fails is written back as `status = 'failed'` with
    // `next_attempt_at = NOW() + 1 minute`. The spec says the failure is
    // NOT a terminal state: "failed 的记录 next_attempt_at 到期后重新变回
    // 可推" — once the time comes, the message becomes pushable again.
    //
    // So the scan must take BOTH 'pending' and 'failed'. A scan that reads
    // only `status = 'pending'` never sees a failed message again: the
    // retry does not happen, the message sits in the table forever, and
    // the admin sees a history full of failures with nothing coming.
    // That defeats decision 5 ("失败隔一分钟重推") entirely.
    //
    // The scan is the FIRST query of the run, so the assertion is on it.
    queryMock.mockResolvedValueOnce([[]]);

    await runWecomDeliver();

    const scan = queryMock.mock.calls[0][0] as string;
    expect(scan).toContain("status IN ('pending', 'failed')");
  });

  it('pushes a failed message again and marks it sent when it works', async () => {
    // The behaviour, not the SQL. A message that failed an hour ago and
    // whose time has come is pushed again — and when the push succeeds,
    // the row ends as 'sent', not as 'failed'.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 31,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'failed',
          attempts: 3,
          last_error: 'WeCom error 45009: rate limit',
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'ops',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: '["notes_notification"]',
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });

    const result = await runWecomDeliver();

    expect(fetchMock, 'the failed message was never pushed again').toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    const sentUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'sent'"));
    expect(sentUpdate, 'the row was not marked as sent').toBeTruthy();
    expect(sentUpdate).toContain('last_error = NULL');
  });

  it('keeps a message that fails again in the failed state', async () => {
    // A retry that fails must not be counted as a success, and the row
    // must go back to 'failed' with a new time — otherwise it leaves the
    // queue for good.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 32,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'failed',
          attempts: 3,
          last_error: 'WeCom error 45009: rate limit',
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'ops',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: '["notes_notification"]',
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 45009, errmsg: 'rate limit' }),
    });

    const result = await runWecomDeliver();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    const failUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'failed'"));
    expect(failUpdate, 'the row was not put back into the failed state').toBeTruthy();
    expect(failUpdate).toContain('attempts = attempts + 1');
  });
});
