import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPool } from './db';

export type CampaignAudience = 'all' | 'members' | 'admins';
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'cancelled';
export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface CampaignRow {
  id: number;
  subject: string;
  html_body: string;
  text_body: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  started_at: Date | null;
  finished_at: Date | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

function unsubscribeSecret(): string {
  // HMAC secret for unsubscribe tokens. JWT_SECRET doubles as a stable,
  // server-only secret. If absent (dev / unset), fall back to a literal so
  // the function never throws — tokens issued in that mode are valid only
  // within the same process anyway.
  return process.env.JWT_SECRET || 'dev-only-marketing-secret';
}

/**
 * Issue a per-user unsubscribe token. Embed user_id + HMAC-SHA256(secret, user_id).
 * Stateless: no DB lookup needed to verify; rotating JWT_SECRET invalidates
 * all outstanding tokens, which is the desired "force resubscribe" behavior.
 */
export function issueUnsubscribeToken(userId: number): string {
  const payload = String(userId);
  const mac = createHmac('sha256', unsubscribeSecret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyUnsubscribeToken(token: string): number | null {
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  const idStr = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const userId = parseInt(idStr, 10);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const expected = createHmac('sha256', unsubscribeSecret()).update(idStr).digest('base64url');
  // timingSafeEqual requires equal-length buffers; macs are fixed width so safe.
  if (mac.length !== expected.length) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (!timingSafeEqual(a, b)) return null;
  return userId;
}

export async function setMarketingOptOut(userId: number, optedOut: boolean): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE users SET marketing_opted_out = ? WHERE id = ?`,
    [optedOut ? 1 : 0, userId]
  );
}

export interface AudienceUser {
  id: number;
  email: string;
}

/**
 * Resolve a campaign audience into a concrete user list. Excludes:
 *   - users without email
 *   - users who opted out (marketing_opted_out = 1)
 */
export async function resolveAudience(audience: CampaignAudience): Promise<AudienceUser[]> {
  const pool = getPool();
  let where = `email IS NOT NULL AND email <> '' AND marketing_opted_out = 0`;
  if (audience === 'admins') {
    where += ` AND is_admin = 1`;
  } else if (audience === 'members') {
    where += ` AND id IN (
      SELECT user_id FROM memberships
      WHERE revoked_at IS NULL AND expires_at > NOW()
      GROUP BY user_id
    )`;
  }
  const [rows] = await pool.query<any[]>(
    `SELECT id, email FROM users WHERE ${where} ORDER BY id`
  );
  return rows.map(r => ({ id: Number(r.id), email: String(r.email) }));
}

export async function createCampaign(args: {
  subject: string;
  htmlBody: string;
  textBody: string;
  audience: CampaignAudience;
  createdBy: number;
}): Promise<number> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `INSERT INTO email_campaigns (subject, html_body, text_body, audience, status, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?)`,
    [args.subject, args.htmlBody, args.textBody, args.audience, args.createdBy]
  );
  return Number(res.insertId);
}

export async function getCampaign(id: number): Promise<CampaignRow | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT * FROM email_campaigns WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length > 0 ? (rows[0] as CampaignRow) : null;
}

export async function listCampaigns(limit = 50): Promise<CampaignRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM email_campaigns ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return rows as CampaignRow[];
}

/**
 * Insert pending recipient rows for a campaign and flip status -> 'sending'.
 * Idempotent on (campaign_id, user_id) so re-arming after a crash doesn't
 * duplicate rows. Returns the number of recipients queued.
 */
export async function armCampaign(campaignId: number, users: AudienceUser[]): Promise<number> {
  const pool = getPool();
  if (users.length === 0) return 0;
  const placeholders = users.map(() => '(?, ?, ?, ?)').join(',');
  const params: unknown[] = [];
  for (const u of users) {
    params.push(campaignId, u.id, u.email, 'pending');
  }
  await pool.query(
    `INSERT IGNORE INTO email_campaign_recipients (campaign_id, user_id, email, status)
     VALUES ${placeholders}`,
    params
  );
  await pool.execute(
    `UPDATE email_campaigns SET status = 'sending', started_at = COALESCE(started_at, NOW()),
       total_recipients = (SELECT COUNT(*) FROM email_campaign_recipients WHERE campaign_id = ?)
     WHERE id = ?`,
    [campaignId, campaignId]
  );
  return users.length;
}

export async function markRecipient(
  recipientId: number,
  status: RecipientStatus,
  error?: string
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE email_campaign_recipients
     SET status = ?, sent_at = IF(? IN ('sent','skipped'), NOW(), sent_at), error = ?
     WHERE id = ?`,
    [status, status, error?.slice(0, 1024) ?? null, recipientId]
  );
}

/**
 * Recompute campaign counters from recipient rows. Call after each batch.
 * If all recipients are terminal and at least one is non-pending, mark
 * the campaign as 'sent' (or 'failed' if success rate < 50%).
 */
export async function finalizeCampaignIfDone(campaignId: number): Promise<CampaignStatus> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT
       SUM(status = 'sent')    AS sent_count,
       SUM(status = 'failed')  AS failed_count,
       SUM(status IN ('pending','skipped')) AS pending_count
     FROM email_campaign_recipients WHERE campaign_id = ?`,
    [campaignId]
  );
  const r = rows[0] as { sent_count: number; failed_count: number; pending_count: number };
  const sent = Number(r.sent_count ?? 0);
  const failed = Number(r.failed_count ?? 0);
  const pending = Number(r.pending_count ?? 0);
  await pool.execute(
    `UPDATE email_campaigns SET sent_count = ?, failed_count = ? WHERE id = ?`,
    [sent, failed, campaignId]
  );
  if (pending > 0) return 'sending';
  const total = sent + failed;
  const newStatus: CampaignStatus = total === 0
    ? 'failed'
    : sent / total >= 0.5 ? 'sent' : 'failed';
  await pool.execute(
    `UPDATE email_campaigns SET status = ?, finished_at = NOW() WHERE id = ? AND status = 'sending'`,
    [newStatus, campaignId]
  );
  return newStatus;
}