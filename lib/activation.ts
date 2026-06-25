/**
 * Platform activation helpers — read/write the singleton `activate` row
 * (id=1). This row is the local instance's view of its relationship with
 * the cloud platform at www.booming.one. The cloud can set `lock`=1 to
 * disable this install; a future local daemon will sync lock/expire/heartbeat
 * state on a schedule. For now, the table is read by middleware to enforce
 * the lock and written by /api/activation/unlock to clear it.
 */
import { getPool } from './db';

export interface ActivationStatus {
  shortName: string;
  isActivated: boolean;
  activatedAt: Date | null;
  isExpired: boolean;
  expireDate: Date | null;
  isLocked: boolean;
  lastHeartbeatAt: Date | null;
  lastCloudSyncAt: Date | null;
  cloudEndpoint: string | null;
  installationData: unknown;
}

const ACTIVATION_ROW_ID = 1;

/**
 * Read the singleton activation row. Returns null if the table is missing
 * (pre-init) or if DB is unreachable — callers must treat null as
 * "no opinion" and let other guards (middleware /init redirect) handle it.
 */
export async function getActivationStatus(): Promise<ActivationStatus | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT short_name, is_activated, activated_at, is_expired, expire_date,
              \`lock\`, last_heartbeat_at, last_cloud_sync_at, cloud_endpoint,
              installation_data
         FROM activate WHERE id = ? LIMIT 1`,
      [ACTIVATION_ROW_ID],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      shortName: r.short_name,
      isActivated: !!r.is_activated,
      activatedAt: r.activated_at,
      isExpired: !!r.is_expired,
      expireDate: r.expire_date,
      isLocked: !!r.lock,
      lastHeartbeatAt: r.last_heartbeat_at,
      lastCloudSyncAt: r.last_cloud_sync_at,
      cloudEndpoint: r.cloud_endpoint,
      installationData: r.installation_data,
    };
  } catch {
    return null;
  }
}

/** True if the install is currently locked by the cloud. Defensive: returns
 *  false on any error so a broken DB doesn't accidentally lock everyone out. */
export async function isLocked(): Promise<boolean> {
  const s = await getActivationStatus();
  return s?.isLocked ?? false;
}

/** True if expire_date is in the past. Reads the stored is_expired flag
 *  for fast-path; falls back to a date check if the flag is unset. */
export async function isExpired(): Promise<boolean> {
  const s = await getActivationStatus();
  if (!s) return false;
  if (s.isExpired) return true;
  if (s.expireDate && new Date(s.expireDate) < new Date()) return true;
  return false;
}

/**
 * Clear the `lock` flag. Called by /api/activation/unlock after the user
 * submits a valid activation code. Audit-logged by the caller.
 */
export async function clearLock(): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE activate SET \`lock\` = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [ACTIVATION_ROW_ID],
  );
}

/**
 * Set the `lock` flag. Used by future cloud sync and admin tools. Logs
 * the actor (admin user id) when provided.
 */
export async function setLock(locked: boolean, actorUserId: number | null = null): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE activate SET \`lock\` = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [locked ? 1 : 0, ACTIVATION_ROW_ID],
  );
  // Best-effort audit (no throw — caller decides what to do on audit failure)
  try {
    const { writeAudit } = await import('./audit');
    await writeAudit({
      userId: actorUserId,
      event: locked ? 'activation_lock' : 'activation_unlock',
      metadata: { source: 'cloud_or_admin' },
    });
  } catch {
    /* ignore — audit module may not be loaded in some contexts */
  }
}
