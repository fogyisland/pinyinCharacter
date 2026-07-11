/**
 * Recent activity feed for /admin overview (Wave 3).
 *
 * Merges three independent sources (audit_log + downloads + ai_calls) via
 * 3 parallel queries + JS-side sort/slice. Per-source LIMIT is
 * max(10, limit*2) so any single source can't squeeze the others out of
 * the top-N after merge.
 *
 * Chinese summaries:
 *   audit  → reuse lib/audit-format.ts::formatLogMessage (already produces
 *             Chinese for ~70 audit events)
 *   download → "下载 <source_type> #<source_id>"
 *   ai     → "AI <feature 中文> <ok/失败>"
 *
 * Adding new audit events: lib/audit-format.ts handles them automatically;
 * adding new ai features: update AI_FEATURE_ZH below.
 */

import { getPool } from './db';
import { formatLogMessage } from './audit-format';

export type ActivityType = 'audit' | 'download' | 'ai';

export interface ActivityItem {
  at: Date;
  type: ActivityType;
  summary: string;
  href?: string;
}

interface AuditRow {
  id: number;
  event: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

interface DownloadRow {
  id: number;
  source_type: string;
  source_id: string | null;
  created_at: Date;
}

interface AiRow {
  id: number;
  feature: string;
  status: 'ok' | 'error' | 'rate-limited';
  created_at: Date;
}

const AI_FEATURE_ZH: Record<string, string> = {
  explain: '字义解释',
  stroke: '笔顺',
  etymology: '字源',
  story: '汉字故事',
  pinyin: '拼音',
  translation: '翻译',
};

function auditToItem(row: AuditRow): ActivityItem {
  return {
    at: row.created_at,
    type: 'audit',
    summary: formatLogMessage(row.event, row.metadata),
    href: `/admin/audit?focus=${row.id}`,
  };
}

function downloadToItem(row: DownloadRow): ActivityItem {
  const target = row.source_id
    ? `${row.source_type} #${row.source_id}`
    : row.source_type;
  return {
    at: row.created_at,
    type: 'download',
    summary: `下载 ${target}`,
    href: `/admin/downloads`,
  };
}

function aiToItem(row: AiRow): ActivityItem {
  const featureZh = AI_FEATURE_ZH[row.feature] ?? row.feature;
  const statusZh = row.status === 'ok' ? '成功' : '失败';
  return {
    at: row.created_at,
    type: 'ai',
    summary: `AI ${featureZh} ${statusZh}`,
    href: `/admin/ai?focus=${row.id}`,
  };
}

function rowToActivityItem(row: AuditRow | DownloadRow | AiRow): ActivityItem {
  if ('event' in row) return auditToItem(row as AuditRow);
  if ('source_type' in row) return downloadToItem(row as DownloadRow);
  return aiToItem(row as AiRow);
}

export async function getRecentActivity(limit: number = 10): Promise<ActivityItem[]> {
  const pool = getPool();
  const perSourceLimit = Math.max(10, limit * 2);

  const [audits, downloads, ais] = await Promise.all([
    pool.query<any[]>(
      `SELECT id, event, metadata, created_at
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT ?`,
      [perSourceLimit],
    ) as Promise<[AuditRow[], any]>,
    pool.query<any[]>(
      `SELECT id, source_type, source_id, created_at
       FROM downloads
       ORDER BY created_at DESC
       LIMIT ?`,
      [perSourceLimit],
    ) as Promise<[DownloadRow[], any]>,
    pool.query<any[]>(
      `SELECT id, feature, status, created_at
       FROM ai_calls
       ORDER BY created_at DESC
       LIMIT ?`,
      [perSourceLimit],
    ) as Promise<[AiRow[], any]>,
  ]);

  const merged = [...audits[0], ...downloads[0], ...ais[0]]
    .sort((a, b) => +b.created_at - +a.created_at)
    .slice(0, limit)
    .map(rowToActivityItem);

  return merged;
}
