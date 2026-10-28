import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export interface MembershipStats {
  total: number;
  active: number;
  newThisMonth: number;
  revenueThisMonth: number; // sum of amount in USD equivalent — for v1 we sum raw amounts
  bySource: { manual: number; paypal: number };
}

interface CountRow extends RowDataPacket {
  n: number;
}

interface RevenueRow extends RowDataPacket {
  /** SUM() over a DECIMAL column comes back as a string. */
  s: string | number;
}

interface SourceCountRow extends RowDataPacket {
  source: 'manual' | 'paypal';
  n: number;
}

export async function getMembershipStats(): Promise<MembershipStats> {
  const pool = getPool();
  const [totals] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS n FROM memberships`);
  const [active] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM memberships WHERE revoked_at IS NULL AND expires_at > NOW()`,
  );
  const [newM] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM memberships WHERE granted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
  );
  const [rev] = await pool.query<RevenueRow[]>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM memberships
     WHERE granted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND source = 'paypal' AND currency = 'USD'`,
  );
  const [bySrc] = await pool.query<SourceCountRow[]>(
    `SELECT source, COUNT(*) AS n FROM memberships GROUP BY source`,
  );
  const bySource: MembershipStats['bySource'] = { manual: 0, paypal: 0 };
  for (const r of bySrc) bySource[r.source] = Number(r.n);
  return {
    total: Number(totals[0].n),
    active: Number(active[0].n),
    newThisMonth: Number(newM[0].n),
    revenueThisMonth: Number(rev[0].s),
    bySource,
  };
}
