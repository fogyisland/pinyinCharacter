import { getPool } from './db';

export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote'
  | 'worksheet_saved' | 'worksheet_deleted';

export interface AuditEntry {
  userId: number | null;
  event: AuditEvent;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO audit_log (user_id, event, metadata, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.event,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ip ?? null,
      entry.userAgent ?? null,
    ]
  );
}
