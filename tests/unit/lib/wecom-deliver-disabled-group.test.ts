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

/** A queued delivery row, as the driver hands it back. */
function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
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
    ...overrides,
  };
}

/** A group row, as the driver hands it back. */
function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'ops',
    webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    enabled: 1,
    categories: '["notes_notification"]',
    ...overrides,
  };
}

describe('a group that was switched off after the message was queued', () => {
  it('does not push the queued message', async () => {
    // The admin turns the group off because the group is too noisy — or
    // because the wrong URL was pasted. Messages that were queued BEFORE
    // the switch must not arrive after it.
    //
    // The `enabled` flag filters at enqueue time (that is where the
    // spec puts it), but the queue holds messages for minutes. Without a
    // check on the delivery side, the switch is a lie: it stops NEW
    // messages from being queued and says nothing about the ones already
    // waiting, so they still land in the group after the admin turned it
    // off.
    queryMock.mockResolvedValueOnce([[deliveryRow()]]);
    queryMock.mockResolvedValueOnce([[webhookRow({ enabled: 0 })]]);

    const result = await runWecomDeliver();

    expect(fetchMock, 'a message was pushed to a group that is switched off').not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
