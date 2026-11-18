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
import { getPool } from './db';
import { webhooksForCategory } from './wecom-webhooks';
import type { WecomCategory } from './wecom-types';

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
