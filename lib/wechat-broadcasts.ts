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
 * Records how many recipients the run is about to send to.
 *
 * The counters are cleared here: they describe THIS run, so a second run
 * of the same announcement must not add to the first run's numbers.
 */
export async function markBroadcastSending(id: number, totalRecipients: number): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET status = 'sending', total_recipients = ?,
         accepted_count = 0, skipped_count = 0, failed_count = 0
     WHERE id = ?`,
    [totalRecipients, id],
  );
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
