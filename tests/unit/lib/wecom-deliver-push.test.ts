import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  buildWecomMarkdown,
  pushWecomDelivery,
  runWecomDeliver,
  WECOM_MAX_ATTEMPTS,
} from '@/lib/wecom-deliver';
import type { WecomDelivery } from '@/lib/wecom-types';

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

function delivery(overrides: Partial<WecomDelivery> = {}): WecomDelivery {
  return {
    id: 1,
    webhookId: 1,
    category: 'notes_notification',
    subject: '新留言',
    body: '留言正文',
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextAttemptAt: new Date(),
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('the forwarded message', () => {
  it('keeps the title identical to the email title', () => {
    const markdown = buildWecomMarkdown('新留言： somebody', '正文');
    expect(markdown).toContain('新留言： somebody');
    expect(markdown.split('\n')[0]).toContain('新留言： somebody');
  });

  it('puts the body after the title', () => {
    const markdown = buildWecomMarkdown('标题', '正文内容');
    expect(markdown).toContain('正文内容');
    expect(markdown.indexOf('标题')).toBeLessThan(markdown.indexOf('正文内容'));
  });
});

describe('pushing one message', () => {
  it('posts markdown to the webhook', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('qyapi.weixin.qq.com');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).msgtype).toBe('markdown');
  });

  it('treats a WeCom error code as a failure', async () => {
    // RF5: errcode 93000 means an invalid key. HTTP 200 does not mean success.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook url' }),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid webhook url');
  });

  it('treats a network error as a failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('socket hang up');
  });

  it('treats a non-2xx response as a failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
  });
});

describe('the delivery run', () => {
  it('marks a pushed message as sent', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: 0,
          last_error: null,
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [{ id: 1, name: 'ops', webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', enabled: 1, categories: '["notes_notification"]' }],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });

    const result = await runWecomDeliver();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    // ⚠️ Assert on the SQL that was run, found by its content — NOT by the
    // call index. The index breaks the moment the implementation adds one
    // more query (a lock, a join, a log write).
    const sentUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'sent'"));
    expect(sentUpdate, 'no UPDATE marked the delivery as sent').toBeTruthy();
    expect(sentUpdate).toContain('sent_at');
  });

  it('pushes a failed message one minute later, not right away', async () => {
    // RF2: the retry delay is measured from the moment of failure.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 12,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: 0,
          last_error: null,
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [{ id: 1, name: 'ops', webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', enabled: 1, categories: '["notes_notification"]' }],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook url' }),
    });

    const result = await runWecomDeliver();

    expect(result.failed).toBe(1);
    // The retry is measured from NOW: the SQL adds one minute to
    // CURRENT_TIMESTAMP, not to the row's original next_attempt_at.
    const failUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'failed'"));
    expect(failUpdate, 'no UPDATE marked the delivery as failed').toBeTruthy();
    expect(failUpdate).toContain('next_attempt_at');
    expect(failUpdate).toContain('attempts');
    // The delay comes from the database clock, not from JS: the SQL must
    // add the interval to CURRENT_TIMESTAMP, never to a JS-passed date.
    expect(failUpdate).toContain('DATE_ADD(CURRENT_TIMESTAMP');
    expect(failUpdate).toContain('INTERVAL ? MINUTE');
  });

  it('stops retrying after the attempt limit', async () => {
    // RF3: a permanently broken webhook must not hold the queue head forever.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 13,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: WECOM_MAX_ATTEMPTS,
          last_error: 'invalid webhook url',
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);

    const result = await runWecomDeliver();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
