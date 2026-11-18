/**
 * Forwarding notifications to WeCom groups.
 *
 * Two halves, deliberately separate:
 *
 *   - the QUEUE (this file, `enqueueWecomNotification`): runs on the request
 *     path of whatever produced the notification. It only writes rows.
 *   - the DELIVERY (`pushWecomDelivery`, `runWecomDeliver`, Task 5): runs
 *     in the scheduler tick. It is the only thing that talks to WeCom.
 *
 * The split is why a WeCom outage cannot fail a user's registration: the
 * request path never waits on WeCom, and it never throws.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { webhooksForCategory } from './wecom-webhooks';
import type { WecomCategory, WecomDelivery } from './wecom-types';

/** The `subject` column is VARCHAR(512) — a longer title is truncated. */
export const WECOM_SUBJECT_MAX = 512;

/**
 * Queues a notification for every group that wants this category.
 *
 * ⚠️ NEVER THROWS. A failure here must not fail the notification that
 * triggered it — the user's registration, the note they posted. The error
 * is logged and the forwarding is skipped; the next notification of the
 * same category will try again.
 *
 * @returns how many queue rows were written (0 when nothing was queued)
 */
export async function enqueueWecomNotification(
  category: WecomCategory,
  subject: string,
  body: string,
): Promise<number> {
  let groups;
  try {
    groups = await webhooksForCategory(category);
  } catch (error) {
    console.warn(
      `[wecom] could not find the groups for ${category}:`,
      error instanceof Error ? error.message : String(error),
    );
    return 0;
  }
  if (groups.length === 0) return 0;

  const truncated = subject.slice(0, WECOM_SUBJECT_MAX);
  let queued = 0;
  for (const group of groups) {
    try {
      await getPool().query(
        `INSERT INTO wecom_deliveries (webhook_id, category, subject, body, status, next_attempt_at)
         VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP(3))`,
        [group.id, category, truncated, body],
      );
      queued += 1;
    } catch (error) {
      console.warn(
        `[wecom] could not queue a ${category} notification for group ${group.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return queued;
}

/** The push is retried until this many attempts have been made. */
export const WECOM_MAX_ATTEMPTS = 20;

/** How long a failed message waits before it is tried again. */
export const WECOM_RETRY_DELAY_MINUTES = 1;

/** A push that has not answered in this long is a failure. */
export const WECOM_REQUEST_TIMEOUT_MS = 10_000;

/** How many messages one tick pushes. */
const BATCH = 50;

/**
 * The WeCom message body.
 *
 * The title is IDENTICAL to the email title — that is the product
 * decision, not an accident. The title is the first line, in bold, so the
 * group reads it the way they read the mail subject.
 *
 * The body is the PLAIN-TEXT part of the email. The HTML part would print
 * its tags verbatim inside the markdown.
 */
export function buildWecomMarkdown(subject: string, body: string): string {
  const trimmedBody = body.trim();
  return trimmedBody.length > 0 ? `**${subject}**\n\n${trimmedBody}` : `**${subject}**`;
}

/**
 * Pushes one message to one group.
 *
 * A 2xx response is NOT success. WeCom answers 200 with a JSON body
 * carrying `errcode`; `errcode != 0` is a failure (93000 = the key is
 * invalid, 45009 = rate limited). Treating those as success would leave
 * the admin UI green while no message ever arrives.
 */
export async function pushWecomDelivery(
  delivery: WecomDelivery,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const content = buildWecomMarkdown(delivery.subject, delivery.body);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: AbortSignal.timeout(WECOM_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { errcode?: number; errmsg?: string };
    if (payload.errcode !== 0) {
      return {
        ok: false,
        error: `WeCom error ${payload.errcode ?? 'unknown'}: ${payload.errmsg ?? 'no message'}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A `wecom_webhooks` row as the driver hands it back.
 *
 * This shape is ALSO declared in `lib/wecom-webhooks.ts` — but that one
 * is module-private, and `lib/wecom-deliver.ts` cannot see it. Declare a
 * local copy here rather than exporting the other module's internals: the
 * delivery module only needs the URL, and the two modules can drift apart
 * without either breaking.
 */
interface WebhookRow extends RowDataPacket {
  id: number;
  name: string;
  webhook_url: string;
  enabled: number;
  categories: string | string[];
}

/** A `wecom_deliveries` row as the driver hands it back. */
interface DeliveryRow extends RowDataPacket {
  id: number;
  webhook_id: number;
  category: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

/** One row → the shape the rest of the code uses. */
function toDelivery(row: DeliveryRow): WecomDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    category: row.category as WecomCategory,
    subject: row.subject,
    body: row.body,
    status: row.status as WecomDelivery['status'],
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * Pushes every message that is due.
 *
 * A message that fails is tried again one minute later — the same code
 * path, the same query, only `next_attempt_at` moves. After
 * `WECOM_MAX_ATTEMPTS` attempts the message stops being picked up; the
 * admin sees it in the history and can reset it by hand.
 */
export async function runWecomDeliver(): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const pool = getPool();
  const [rows] = await pool.query<DeliveryRow[]>(
    `SELECT id, webhook_id, category, subject, body, status, attempts, last_error,
            next_attempt_at, sent_at, created_at
     FROM wecom_deliveries
     WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP(3)
     ORDER BY next_attempt_at ASC
     LIMIT ?`,
    [BATCH],
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const delivery = toDelivery(row);
    if (delivery.attempts >= WECOM_MAX_ATTEMPTS) {
      skipped += 1;
      continue;
    }
    const [groups] = await pool.query<WebhookRow[]>(
      `SELECT id, name, webhook_url, enabled, categories
       FROM wecom_webhooks WHERE id = ? LIMIT 1`,
      [delivery.webhookId],
    );
    const group = groups[0];
    if (!group) {
      skipped += 1;
      continue;
    }
    // A group that was switched off after the message was queued must not
    // receive it. The `enabled` flag filters at enqueue time, but the queue
    // holds messages for minutes — without this check, the switch is a lie:
    // it stops NEW messages from being queued and says nothing about the
    // ones already waiting, so they land in the group after the admin
    // turned it off. The row stays `pending` and is picked up again if the
    // group is switched back on.
    if (group.enabled !== 1) {
      skipped += 1;
      continue;
    }
    const result = await pushWecomDelivery(delivery, group.webhook_url);
    if (result.ok) {
      await pool.query(
        `UPDATE wecom_deliveries
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3), last_error = NULL
         WHERE id = ?`,
        [delivery.id],
      );
      sent += 1;
    } else {
      // RF2: the delay is measured from NOW, not from the queue time.
      await pool.query(
        `UPDATE wecom_deliveries
         SET status = 'failed', attempts = attempts + 1, last_error = ?,
             next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)
         WHERE id = ?`,
        [(result.error ?? 'unknown error').slice(0, 1024), WECOM_RETRY_DELAY_MINUTES, delivery.id],
      );
      console.warn(
        `[wecom] delivery ${delivery.id} failed (attempt ${delivery.attempts + 1}): ${result.error}`,
      );
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}
