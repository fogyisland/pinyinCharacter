/**
 * The announcement store.
 *
 * ⚠️ This module NEVER talks to WeChat. It only touches the database.
 * The sending lives in `lib/wechat-sender.ts`, and the split is what
 * keeps "what was written" and "what was sent" separate questions.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';
import type {
  WechatBroadcast,
  WechatBroadcastStatus,
  WechatTemplateData,
} from './wechat-types';

/** The title is VARCHAR(128). */
const TITLE_MAX = 128;
/** The template id is VARCHAR(64). */
const TEMPLATE_ID_MAX = 64;
/** The jump url is VARCHAR(512). */
const URL_MAX = 512;
/** The error column is VARCHAR(1024). */
const ERROR_MAX = 1024;

/** A `wechat_broadcasts` row as the driver hands it back. */
interface BroadcastRow extends RowDataPacket {
  id: number;
  title: string;
  template_id: string;
  url: string | null;
  data: string | WechatTemplateData;
  status: string;
  total_recipients: number;
  accepted_count: number;
  skipped_count: number;
  failed_count: number;
  last_error: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

/**
 * The template data, as the driver hands it back.
 *
 * MySQL hands a JSON column back as a string when the driver is not
 * configured to parse it, and as an object when it is. Both are accepted
 * because a broadcast written by one deployment must still be readable
 * by another.
 */
function toTemplateData(raw: string | WechatTemplateData): WechatTemplateData {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as WechatTemplateData;
    } catch (error) {
      console.error(
        '[wechat] the stored template data is not valid JSON:',
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  }
  return raw;
}

/** One row → the shape the rest of the code uses. */
function toBroadcast(row: BroadcastRow): WechatBroadcast {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    url: row.url,
    data: toTemplateData(row.data),
    status: row.status as WechatBroadcastStatus,
    totalRecipients: row.total_recipients,
    acceptedCount: row.accepted_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

/** The columns every read needs. */
const COLUMNS =
  `id, title, template_id, url, data, status, total_recipients, accepted_count,
   skipped_count, failed_count, last_error, created_by, created_at, updated_at, finished_at`;

/** What a new announcement needs. */
export interface CreateBroadcastInput {
  title: string;
  templateId: string;
  url: string | null;
  data: WechatTemplateData;
  createdBy: number;
}

/** Writes a draft announcement and returns its id. */
export async function createBroadcast(input: CreateBroadcastInput): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `INSERT INTO wechat_broadcasts (title, template_id, url, data, status, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?)`,
    [
      input.title.slice(0, TITLE_MAX),
      input.templateId.slice(0, TEMPLATE_ID_MAX),
      input.url ? input.url.slice(0, URL_MAX) : null,
      JSON.stringify(input.data),
      input.createdBy,
    ],
  );
  return result.insertId;
}

/** The announcements, newest first. */
export async function listBroadcasts(limit = 50): Promise<WechatBroadcast[]> {
  const [rows] = await getPool().query<BroadcastRow[]>(
    `SELECT ${COLUMNS}
     FROM wechat_broadcasts
     ORDER BY id DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(toBroadcast);
}

/**
 * The announcements that are waiting to be sent.
 *
 * ⚠️ The filter is in SQL, not in JS. Filtering the newest page in
 * JavaScript would strand an older queued announcement: it falls outside
 * the window, and it is never sent — silently, forever.
 */
export async function listQueuedBroadcasts(limit = 5): Promise<WechatBroadcast[]> {
  const [rows] = await getPool().query<BroadcastRow[]>(
    `SELECT ${COLUMNS}
     FROM wechat_broadcasts
     WHERE status = 'queued'
     ORDER BY id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map(toBroadcast);
}

/**
 * Returns abandoned `sending` announcements to the queue.
 *
 * ⚠️ A process that dies mid-run leaves the row in `sending` forever.
 * The admin screen offers no way out of that state, so the announcement
 * would simply be lost — silently, with no error anywhere.
 *
 * A row is abandoned when it has not been touched for `staleMinutes`. A
 * run that is going on right now keeps its row fresh, so it is never
 * stolen from under itself.
 *
 * ⚠️ The announcement is sent again from the start, so followers that
 * already received it may receive it twice. That is the trade this
 * design takes: a duplicate message is better than a lost one, and the
 * design deliberately keeps no per-recipient table to do better.
 *
 * @param staleMinutes how long a `sending` row may sit untouched.
 * @returns how many rows were returned to the queue.
 */
export async function requeueStaleBroadcasts(staleMinutes: number): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE wechat_broadcasts
     SET status = 'queued', total_recipients = 0,
         accepted_count = 0, skipped_count = 0, failed_count = 0, last_error = NULL
     WHERE status = 'sending'
       AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [staleMinutes],
  );
  return result.affectedRows;
}

/** One announcement, or null when there is no such row. */
export async function getBroadcast(id: number): Promise<WechatBroadcast | null> {
  const [rows] = await getPool().query<BroadcastRow[]>(
    `SELECT ${COLUMNS}
     FROM wechat_broadcasts
     WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? toBroadcast(row) : null;
}

/** Moves a draft into the queue. */
export async function queueBroadcast(id: number): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts SET status = 'queued' WHERE id = ? AND status = 'draft'`,
    [id],
  );
}

/**
 * Cancels an announcement that has not gone out yet.
 *
 * @returns whether a row was actually changed — a broadcast that already
 *          went out cannot be cancelled.
 */
export async function cancelBroadcast(id: number): Promise<boolean> {
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE wechat_broadcasts SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('draft', 'queued')`,
    [id],
  );
  return result.affectedRows > 0;
}

/**
 * Claims an announcement for a run.
 *
 * ⚠️ The claim is ATOMIC: the UPDATE only fires when the row is still
 * `queued`, so two runs that overlap — a scheduler tick and a manual
 * send, say — cannot both claim the same announcement. That is what
 * keeps the daily quota from being spent twice on the same message.
 *
 * @returns whether this run got the row. False means somebody else has
 *          it, and the caller must not send.
 */
export async function claimBroadcast(
  id: number,
  totalRecipients: number,
): Promise<boolean> {
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE wechat_broadcasts
     SET status = 'sending', total_recipients = ?,
         accepted_count = 0, skipped_count = 0, failed_count = 0
     WHERE id = ? AND status = 'queued'`,
    [totalRecipients, id],
  );
  return result.affectedRows > 0;
}

/** What one run achieved. */
export interface BroadcastOutcome {
  accepted: number;
  skipped: number;
  failed: number;
  lastError: string | null;
}

/** Records the counts of one run. */
export async function recordBroadcastOutcome(
  id: number,
  outcome: BroadcastOutcome,
): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET accepted_count = ?, skipped_count = ?, failed_count = ?, last_error = ?
     WHERE id = ?`,
    [
      outcome.accepted,
      outcome.skipped,
      outcome.failed,
      outcome.lastError ? outcome.lastError.slice(0, ERROR_MAX) : null,
      id,
    ],
  );
}

/** Records the final state of an announcement. */
export async function finishBroadcast(
  id: number,
  status: WechatBroadcastStatus,
  lastError: string | null,
): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET status = ?, last_error = ?, finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, lastError ? lastError.slice(0, ERROR_MAX) : null, id],
  );
}
