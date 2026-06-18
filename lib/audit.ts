import type { NextRequest } from 'next/server';
import { getPool } from './db';
import type { AuditEvent } from './audit-format';
export type { AuditEvent } from './audit-format';

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

/**
 * Convenience wrapper: pulls IP + UA off a NextRequest and writes the audit
 * row. Saves a few lines at every call site.
 */
export async function logUserAction(
  req: NextRequest,
  userId: number | null,
  event: AuditEvent,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event, metadata, ip, userAgent: ua });
}
