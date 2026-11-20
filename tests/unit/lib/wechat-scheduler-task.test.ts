/**
 * lib/scheduler-tasks.ts + lib/scheduler-config.ts
 *
 * The WeChat broadcast task, and the switch that turns it on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('@/lib/wechat-sender', () => ({
  sendBroadcast: (...args: unknown[]) => sendMock(...args),
}));

const listMock = vi.fn();
const requeueMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  listQueuedBroadcasts: (...args: unknown[]) => listMock(...args),
  requeueStaleBroadcasts: (...args: unknown[]) => requeueMock(...args),
}));

const configMock = vi.fn();
vi.mock('@/lib/wechat-config', () => ({
  getWechatConfig: () => configMock(),
  isWechatConfigured: (config: { enabled: boolean; appId: string; appSecretSet: boolean }) =>
    config.enabled && config.appId.length > 0 && config.appSecretSet,
}));

import { ALL_TASKS, runTask } from '@/lib/scheduler-tasks';
import { DEFAULT_CONFIG, SCHEDULER_KEYS } from '@/lib/scheduler-config';

function queued(id: number) {
  return {
    id,
    title: 'a',
    templateId: 'TM1',
    url: null,
    data: { keyword1: { value: 'x' } },
    status: 'queued' as const,
    totalRecipients: 0,
    acceptedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
    createdBy: 7,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    finishedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockReset();
  listMock.mockReset();
  requeueMock.mockReset();
  requeueMock.mockResolvedValue(0);
  configMock.mockReset();
  configMock.mockResolvedValue({ enabled: true, appId: 'wx1234567890abcdef', appSecretSet: true });
});

describe('the scheduler task registration', () => {
  it('is one of the known tasks', () => {
    expect(ALL_TASKS).toContain('wechat-broadcast-send');
  });

  it('has a switch in the scheduler config', () => {
    expect(SCHEDULER_KEYS.taskWechatBroadcast).toBe('scheduler.task_wechat_broadcast');
    expect(DEFAULT_CONFIG).toHaveProperty('taskWechatBroadcast');
  });
});

describe('the WeChat broadcast task', () => {
  it('does nothing when nothing is queued', async () => {
    listMock.mockResolvedValue([]);

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('asks the database for queued announcements only', async () => {
    // The filter is in SQL: filtering the newest page in JavaScript
    // would strand an older queued announcement outside the window, and
    // it would never be sent.
    listMock.mockResolvedValue([]);

    await runTask('wechat-broadcast-send');

    expect(listMock).toHaveBeenCalledWith(5);
  });

  it('sends the queued announcement', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 2,
      accepted: 2,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const result = await runTask('wechat-broadcast-send');

    expect(sendMock).toHaveBeenCalledWith(1);
    expect(result.ok).toBe(true);
  });

  it('sends one announcement per tick', async () => {
    listMock.mockResolvedValue([queued(1), queued(2)]);
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 0,
      accepted: 0,
      skipped: 0,
      failed: 0,
      error: null,
    });

    await runTask('wechat-broadcast-send');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(1);
  });

  it('reports a failed run without throwing', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockResolvedValue({
      status: 'failed',
      totalRecipients: 2,
      accepted: 0,
      skipped: 0,
      failed: 1,
      error: 'WeChat error 47003: argument invalid',
    });

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('47003');
  });

  it('reports the counts in its summary', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 5,
      accepted: 4,
      skipped: 1,
      failed: 0,
      error: null,
    });

    const result = await runTask('wechat-broadcast-send');

    expect(result.summary).toContain('accepted=4');
    expect(result.summary).toContain('skipped=1');
  });

  it('survives a throw from the sender — the scheduler must not go down', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockRejectedValue(new Error('the database went away'));

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('the database went away');
  });

  it('survives a throw while listing the queue', async () => {
    listMock.mockRejectedValue(new Error('the table does not exist'));

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('the table does not exist');
  });
});

describe('an announcement abandoned by a dead process', () => {
  it('is put back in the queue before the task looks for work', async () => {
    // A process that dies mid-run leaves the row in `sending` forever,
    // and the admin screen offers no way out of it. The announcement
    // would simply be lost.
    listMock.mockResolvedValue([]);

    await runTask('wechat-broadcast-send');

    expect(requeueMock).toHaveBeenCalled();
  });

  it('is sent after it was recovered', async () => {
    listMock.mockResolvedValue([queued(9)]);
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 1,
      accepted: 1,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(9);
  });

  it('does not fail the task when the recovery itself fails', async () => {
    // The recovery is a repair job; failing it must not stop the
    // announcements that are properly queued.
    requeueMock.mockRejectedValue(new Error('the table does not exist'));
    listMock.mockResolvedValue([]);

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(true);
  });
});

describe('the switch the admin turned off', () => {
  it('stops the task from sending anything', async () => {
    // The switch must reach the scheduler too — otherwise turning it off
    // only stops the writing, and the queued announcements still go out.
    configMock.mockResolvedValue({ enabled: false, appId: 'wx1234567890abcdef', appSecretSet: true });
    listMock.mockResolvedValue([queued(1)]);

    const result = await runTask('wechat-broadcast-send');

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('stops the task when the credentials are gone', async () => {
    configMock.mockResolvedValue({ enabled: true, appId: '', appSecretSet: false });
    listMock.mockResolvedValue([queued(1)]);

    await runTask('wechat-broadcast-send');

    expect(sendMock).not.toHaveBeenCalled();
  });
});
