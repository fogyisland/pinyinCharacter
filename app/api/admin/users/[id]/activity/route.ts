import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';

interface Ctx { params: Promise<{ id: string }>; }

interface UnifiedLogEntry {
  id: string;
  source: 'audit' | 'download' | 'ai_call';
  event: string;
  userId: number;
  username: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

function safeParse(s: unknown): Record<string, unknown> {
  if (s == null) return {};
  if (typeof s !== 'string') return s as Record<string, unknown>;
  try { return JSON.parse(s); } catch { return {}; }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: idStr } = await ctx.params;
    const userId = Number(idStr);
    if (!Number.isInteger(userId) || userId <= 0) {
      return badRequest('bad_id', 'invalid id');
    }

    const url = new URL(req.url);
    const after = url.searchParams.get('after');

    const pool = getPool();
    const auditArgs: any[] = [userId];
    let auditWhere = '';
    if (after) { auditWhere = 'AND created_at > ?'; auditArgs.push(after); }
    const [audit] = await pool.query<any[]>(
      `SELECT id, event, metadata, ip, created_at FROM audit_log
       WHERE user_id = ? ${auditWhere} ORDER BY created_at DESC LIMIT 100`,
      auditArgs,
    );

    const dlArgs: any[] = [userId];
    let dlWhere = '';
    if (after) { dlWhere = 'AND created_at > ?'; dlArgs.push(after); }
    const [downloads] = await pool.query<any[]>(
      `SELECT id, source_type, source_id, status, format, duration_ms, created_at
       FROM downloads WHERE user_id = ? ${dlWhere} ORDER BY created_at DESC LIMIT 100`,
      dlArgs,
    );

    const aiArgs: any[] = [userId];
    let aiWhere = '';
    if (after) { aiWhere = 'AND created_at > ?'; aiArgs.push(after); }
    const [aiCalls] = await pool.query<any[]>(
      `SELECT id, feature, model, status, duration_ms, error, metadata, created_at
       FROM ai_calls WHERE user_id = ? ${aiWhere} ORDER BY created_at DESC LIMIT 100`,
      aiArgs,
    );

    const items: UnifiedLogEntry[] = [
      ...audit.map(r => ({
        id: `audit:${r.id}`,
        source: 'audit' as const,
        event: r.event,
        userId,
        username: null,
        ip: r.ip,
        createdAt: String(r.created_at),
        metadata: safeParse(r.metadata),
      })),
      ...downloads.map(r => ({
        id: `download:${r.id}`,
        source: 'download' as const,
        event: 'download_logged',
        userId,
        username: null,
        ip: null,
        createdAt: String(r.created_at),
        metadata: {
          sourceType: r.source_type,
          sourceId: r.source_id,
          status: r.status,
          format: r.format,
          durationMs: r.duration_ms,
        },
      })),
      ...aiCalls.map(r => ({
        id: `ai_call:${r.id}`,
        source: 'ai_call' as const,
        event: r.feature,
        userId,
        username: null,
        ip: null,
        createdAt: String(r.created_at),
        metadata: {
          model: r.model,
          status: r.status,
          durationMs: r.duration_ms,
          error: r.error,
          ...safeParse(r.metadata),
        },
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, data: { items: items.slice(0, 100) } });
  });
}
