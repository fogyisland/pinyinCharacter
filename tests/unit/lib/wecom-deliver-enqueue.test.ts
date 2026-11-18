import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { enqueueWecomNotification } from '@/lib/wecom-deliver';
import { webhooksForCategory } from '@/lib/wecom-webhooks';

vi.mock('@/lib/wecom-webhooks', () => ({
  webhooksForCategory: vi.fn(),
}));

const mockedWebhooks = vi.mocked(webhooksForCategory);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('queueing a notification for the groups that want it', () => {
  it('writes one row per matching group', async () => {
    // RF1: three groups want this category ⇒ three queue rows, one each.
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['notes_notification'] },
      { id: 2, name: 'b', webhookUrl: 'u2', enabled: true, categories: ['notes_notification'] },
      { id: 3, name: 'c', webhookUrl: 'u3', enabled: true, categories: ['notes_notification'] },
    ]);
    queryMock.mockResolvedValue([{ insertId: 1 }]);

    const count = await enqueueWecomNotification(
      'notes_notification',
      '新留言',
      '正文',
    );

    expect(count).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(3);
    const webhooks = queryMock.mock.calls.map((call) => call[1][0]);
    expect(webhooks).toEqual([1, 2, 3]);
  });

  it('writes nothing when no group wants the category', async () => {
    mockedWebhooks.mockResolvedValue([]);
    const count = await enqueueWecomNotification('campaign', '标题', '正文');
    expect(count).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('truncates a subject longer than the column', async () => {
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['welcome'] },
    ]);
    queryMock.mockResolvedValue([{ insertId: 1 }]);

    await enqueueWecomNotification('welcome', 'x'.repeat(900), '正文');

    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(String(params[2]).length).toBe(512);
  });

  it('never throws when the database is down', async () => {
    // The forwarding is an enhancement — the user's POST must still succeed.
    mockedWebhooks.mockRejectedValue(new Error('db gone'));
    await expect(
      enqueueWecomNotification('notes_notification', '标题', '正文'),
    ).resolves.toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when the insert fails', async () => {
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['welcome'] },
    ]);
    queryMock.mockRejectedValue(new Error('write failed'));
    await expect(
      enqueueWecomNotification('welcome', '标题', '正文'),
    ).resolves.toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
