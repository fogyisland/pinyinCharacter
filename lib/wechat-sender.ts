/**
 * Sending an announcement to the followers.
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
 *
 * ⚠️ A zero errcode means WeChat ACCEPTED the message. It does not mean
 * the follower received it — WeChat issues no delivery receipt. The count
 * this file reports is therefore named "accepted", not "delivered", and
 * the admin UI has to say the same thing.
 */
import {
  fetchFollowerOpenids,
  resetWechatTokenCache,
  sendTemplateMessage,
} from './wechat-api';
import {
  WechatRecipientError,
  WechatTokenError,
} from './wechat-types';
import {
  claimBroadcast,
  finishBroadcast,
  getBroadcast,
  recordBroadcastOutcome,
} from './wechat-broadcasts';

/** What one run achieved. */
export interface BroadcastSendResult {
  status: 'sent' | 'failed';
  totalRecipients: number;
  accepted: number;
  skipped: number;
  failed: number;
  error: string | null;
}

/** The counts of a run, as the store wants them. */
interface Outcome {
  accepted: number;
  skipped: number;
  failed: number;
  lastError: string | null;
}

/**
 * Sends one announcement to every follower.
 *
 * Never throws — the outcome is the return value and the database rows.
 * The scheduler calls this, and a scheduler that throws is a scheduler
 * that stops.
 */
export async function sendBroadcast(id: number): Promise<BroadcastSendResult> {
  const broadcast = await getBroadcast(id);
  if (!broadcast) {
    return {
      status: 'failed',
      totalRecipients: 0,
      accepted: 0,
      skipped: 0,
      failed: 0,
      error: 'the announcement does not exist',
    };
  }

  let openids: string[];
  try {
    openids = await fetchFollowerOpenids();
  } catch (error) {
    const message = describeError(error);
    await recordOutcome(id, { accepted: 0, skipped: 0, failed: 0, lastError: message });
    await finishBroadcast(id, 'failed', message);
    return {
      status: 'failed',
      totalRecipients: 0,
      accepted: 0,
      skipped: 0,
      failed: 0,
      error: message,
    };
  }

  // ⚠️ The claim is atomic. If somebody else already has this
  // announcement — a scheduler tick and a manual send overlapping — this
  // run must NOT send it: the daily quota would be spent twice on the
  // same message.
  const claimed = await claimBroadcast(id, openids.length);
  if (!claimed) {
    return {
      status: 'failed',
      totalRecipients: openids.length,
      accepted: 0,
      skipped: 0,
      failed: 0,
      error: 'the announcement was already claimed by another run',
    };
  }

  let accepted = 0;
  let skipped = 0;
  let failed = 0;
  let lastError: string | null = null;
  let stopped = false;

  for (const openid of openids) {
    if (stopped) break;

    try {
      await sendTemplateMessage(openid, broadcast.templateId, broadcast.data, broadcast.url);
      accepted += 1;
    } catch (error) {
      if (error instanceof WechatRecipientError) {
        // This one follower cannot be reached. The rest still can.
        skipped += 1;
        continue;
      }

      if (error instanceof WechatTokenError) {
        // The token died. Refresh it and try this one follower once more.
        resetWechatTokenCache();
        try {
          await sendTemplateMessage(openid, broadcast.templateId, broadcast.data, broadcast.url);
          accepted += 1;
          continue;
        } catch (retryError) {
          failed += 1;
          lastError = describeError(retryError);
          stopped = true;
          continue;
        }
      }

      // A parameter error, a quota error, or a network failure: all of
      // them mean the rest of this run will not do any better.
      failed += 1;
      lastError = describeError(error);
      stopped = true;
    }
  }

  await recordOutcome(id, { accepted, skipped, failed, lastError });

  if (stopped) {
    await finishBroadcast(id, 'failed', lastError);
    return {
      status: 'failed',
      totalRecipients: openids.length,
      accepted,
      skipped,
      failed,
      error: lastError,
    };
  }

  await finishBroadcast(id, 'sent', null);
  return {
    status: 'sent',
    totalRecipients: openids.length,
    accepted,
    skipped,
    failed,
    error: null,
  };
}

/**
 * Records the counts of one run.
 *
 * A failure here must not take the run down: the messages are already
 * sent, and losing the counts would hide that. The error is logged and
 * the run continues.
 */
async function recordOutcome(id: number, outcome: Outcome): Promise<void> {
  try {
    await recordBroadcastOutcome(id, outcome);
  } catch (error) {
    console.error(
      '[wechat] could not record the outcome of the broadcast',
      id,
      ':',
      describeError(error),
    );
  }
}

/** The message of an error, for the log and the admin screen. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
