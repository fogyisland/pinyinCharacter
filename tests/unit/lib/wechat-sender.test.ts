/**
 * lib/wechat-sender.ts
 *
 * The whole file is about one question: WeChat said no — now what?
 *
 *   - 43101 (the follower left, or muted the account) → skip this one
 *     follower, keep going. The others still get their message.
 *   - 40001 (the token died) → refresh it, try that one follower once
 *     more. If it fails again, stop.
 *   - 40003 / 40037 / 47003 / 48001 (the request is wrong) → STOP.
 *     Retrying a wrong request spends the daily quota to arrive at the
 *     same answer.
 *   - 45009 (the daily quota is spent) → STOP and wait for the next tick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const followerMock = vi.fn();
const sendMock = vi.fn();
const resetTokenMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  fetchFollowerOpenids: () => followerMock(),
  sendTemplateMessage: (...args: unknown[]) => sendMock(...args),
  resetWechatTokenCache: () => resetTokenMock(),
}));

const getBroadcastMock = vi.fn();
const claimMock = vi.fn();
const recordOutcomeMock = vi.fn();
const finishMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  getBroadcast: (...args: unknown[]) => getBroadcastMock(...args),
  claimBroadcast: (...args: unknown[]) => claimMock(...args),
  recordBroadcastOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
  finishBroadcast: (...args: unknown[]) => finishMock(...args),
}));

import { sendBroadcast } from '@/lib/wechat-sender';
import {
  WechatParamError,
  WechatQuotaError,
  WechatRecipientError,
  WechatTokenError,
} from '@/lib/wechat-types';

function broadcast(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'v1.2',
    templateId: 'TM00001',
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  followerMock.mockReset();
  sendMock.mockReset();
  getBroadcastMock.mockReset();
  getBroadcastMock.mockResolvedValue(broadcast());
  claimMock.mockReset();
  recordOutcomeMock.mockReset();
  finishMock.mockReset();
  // By default the run gets the row — a test that cares sets it otherwise.
  claimMock.mockResolvedValue(true);
});

describe('sending an announcement', () => {
  it('sends one message per follower', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);
    sendMock.mockResolvedValue(undefined);

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result.accepted).toBe(3);
    expect(result.totalRecipients).toBe(3);
  });

  it('records the recipient count before it starts', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    await sendBroadcast(1);

    expect(claimMock).toHaveBeenCalledWith(1, 1);
  });

  it('passes the template id and the data to every message', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledWith('a', 'TM00001', { keyword1: { value: 'x' } }, null);
  });

  it('finishes as sent when everybody was reached', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    const result = await sendBroadcast(1);

    expect(result.status).toBe('sent');
    expect(finishMock).toHaveBeenCalledWith(1, 'sent', null);
  });

  it('does nothing when the announcement does not exist', async () => {
    getBroadcastMock.mockResolvedValue(null);

    const result = await sendBroadcast(999);

    expect(result.status).toBe('failed');
    expect(sendMock).not.toHaveBeenCalled();
    expect(finishMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the account has no followers', async () => {
    followerMock.mockResolvedValue([]);

    const result = await sendBroadcast(1);

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.totalRecipients).toBe(0);
    expect(result.status).toBe('sent');
  });

  it('fails the whole run when the follower list cannot be fetched', async () => {
    followerMock.mockRejectedValue(new WechatQuotaError(45009, 'api freq out of limit'));

    const result = await sendBroadcast(1);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('45009');
    expect(finishMock).toHaveBeenCalledWith(1, 'failed', expect.stringContaining('45009'));
  });
});

describe('when a follower cannot be reached', () => {
  it('skips that follower and keeps going', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'user refuse to accept the msg'))
      .mockResolvedValueOnce(undefined);

    const result = await sendBroadcast(1);

    expect(result.skipped).toBe(1);
    expect(result.accepted).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('keeps going after several skips in a row', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c', 'd']);
    sendMock
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'x'))
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'x'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await sendBroadcast(1);

    expect(result.skipped).toBe(2);
    expect(result.accepted).toBe(2);
    expect(result.status).toBe('sent');
  });
});

describe('when the token is stale', () => {
  it('refreshes the token and tries that follower once more', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock
      .mockRejectedValueOnce(new WechatTokenError(40001, 'invalid credential'))
      .mockResolvedValueOnce(undefined);

    const result = await sendBroadcast(1);

    expect(resetTokenMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.accepted).toBe(1);
  });

  it('does not refresh the token for a follower error', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockRejectedValue(new WechatRecipientError(43101, 'x'));

    await sendBroadcast(1);

    expect(resetTokenMock).not.toHaveBeenCalled();
  });

  it('stops when the retry also fails', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatTokenError(40001, 'invalid credential'));

    const result = await sendBroadcast(1);

    expect(result.status).toBe('failed');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('when the request itself is wrong', () => {
  it('stops the run instead of retrying — a parameter error never gets better', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);
    sendMock.mockRejectedValue(new WechatParamError(47003, 'argument invalid'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('47003');
  });

  it('stops when the template id is wrong', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatParamError(40037, 'invalid template_id'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
  });

  it('does not retry a parameter error — retrying spends the quota', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatParamError(47003, 'argument invalid'));

    await sendBroadcast(1);

    expect(resetTokenMock).not.toHaveBeenCalled();
  });
});

describe('when the daily quota is spent', () => {
  it('stops the run', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatQuotaError(45009, 'api freq out of limit'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('45009');
  });
});

describe('when the network fails', () => {
  it('stops the run', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new Error('network down'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('network down');
  });
});

describe('the recording of the outcome', () => {
  it('records the counts', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'user refuse'));

    await sendBroadcast(1);

    expect(recordOutcomeMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ accepted: 1, skipped: 1, failed: 0 }),
    );
  });

  it('records the failure when the run stopped', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockRejectedValue(new WechatParamError(47003, 'argument invalid'));

    await sendBroadcast(1);

    expect(recordOutcomeMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ failed: 1 }),
    );
  });

  it('records nothing when the announcement does not exist', async () => {
    getBroadcastMock.mockResolvedValue(null);

    await sendBroadcast(999);

    expect(recordOutcomeMock).not.toHaveBeenCalled();
  });
});

describe('the atomic claim', () => {
  it('sends nothing when another run already claimed the announcement', async () => {
    // A scheduler tick and a manual send can overlap. The claim is what
    // stops the daily quota from being spent twice on the same message.
    followerMock.mockResolvedValue(['a', 'b', 'c']);
    sendMock.mockResolvedValue(undefined);
    claimMock.mockResolvedValue(false);

    const result = await sendBroadcast(1);

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('already claimed');
  });

  it('does not overwrite the row when the claim failed', async () => {
    followerMock.mockResolvedValue(['a']);
    claimMock.mockResolvedValue(false);

    await sendBroadcast(1);

    expect(recordOutcomeMock).not.toHaveBeenCalled();
    expect(finishMock).not.toHaveBeenCalled();
  });
});
