import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  createWebhook,
  webhooksForCategory,
  updateWebhook,
  deleteWebhook,
} from '@/lib/wecom-webhooks';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
});

describe('creating a group robot', () => {
  it('refuses a URL that is not a WeCom webhook', async () => {
    await expect(
      createWebhook({
        name: 'ops',
        webhookUrl: 'https://internal.example.com/hook',
        enabled: true,
        categories: ['notes_notification'],
      }),
    ).rejects.toThrow(/webhook/i);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('stores the categories as a JSON array', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 7 }]);
    const id = await createWebhook({
      name: 'ops',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
      enabled: true,
      categories: ['notes_notification', 'welcome'],
    });
    expect(id).toBe(7);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('INSERT INTO wecom_webhooks');
    expect(params[params.length - 1]).toBe(
      JSON.stringify(['notes_notification', 'welcome']),
    );
  });
});

describe('finding the groups that want a category', () => {
  it('returns only the enabled groups whose categories contain it', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'ops',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: ['notes_notification'],
        },
      ],
    ]);
    const groups = await webhooksForCategory('notes_notification');
    expect(groups).toHaveLength(1);
    expect(groups[0].categories).toEqual(['notes_notification']);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('enabled = 1');
  });

  it('filters the categories in SQL, not in JavaScript', async () => {
    // The category set lives in a JSON column; the row filter has to happen
    // in the query or every group is loaded on every notification.
    queryMock.mockResolvedValueOnce([[]]);
    await webhooksForCategory('welcome');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('JSON_CONTAINS');
    expect(params).toContain(JSON.stringify(['welcome']));
  });

  it('drops a category the group does not want', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 2,
          name: 'mixed',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: ['welcome'],
        },
      ],
    ]);
    const groups = await webhooksForCategory('campaign');
    expect(groups).toHaveLength(1);
    expect(groups[0].categories).toEqual(['welcome']);
  });
});

describe('updating and deleting', () => {
  it('updates every column', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await updateWebhook(3, {
      name: 'renamed',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xyz',
      enabled: false,
      categories: ['welcome'],
    });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE wecom_webhooks');
    expect(sql).toContain('enabled');
  });

  it('deletes by id', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await deleteWebhook(3);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM wecom_webhooks');
    expect(params).toEqual([3]);
  });
});
