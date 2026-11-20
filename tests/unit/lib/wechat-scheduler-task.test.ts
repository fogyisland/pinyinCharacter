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
vi.mock('@/lib/wechat-broadcasts', () => ({
  listBroadcasts: (...args: unknown[]) => listMock(...args),
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

  it('ignores an announcement that is not queued', async () => {
    listMock.mockResolvedValue([{ ...queued(1), status: 'sent' }]);

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
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
