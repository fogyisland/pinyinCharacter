import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import {
  getProgress,
  upsertProgress,
  markComplete,
  deleteProgress,
} from '@/lib/sutra-copy-progress';

function parseChunkIdx(url: string): number | null {
  const u = new URL(url);
  const raw = u.searchParams.get('chunk');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { slug } = await params;
    if (!slug) return badRequest('bad_slug', 'slug required');

    const chunkIdx = parseChunkIdx(req.url);
    if (chunkIdx === null) return badRequest('bad_chunk', 'chunk query param required');

    const [rows] = await getPool().query<any[]>(
      `SELECT id, chunks FROM sutras WHERE slug = ? LIMIT 1`,
      [slug]
    );
    const row = rows[0];
    if (!row) return notFound('sutra_not_found', 'sutra not found');
    const rawChunks: any[] = typeof row.chunks === 'string' ? JSON.parse(row.chunks) : row.chunks;
    const chunkCount = Array.isArray(rawChunks) ? rawChunks.length : 0;
    const sutraId = Number(row.id);
    if (chunkIdx >= chunkCount) return badRequest('bad_chunk', 'chunk out of range');

    const progress = await getProgress(auth.user.id, sutraId, chunkIdx);
    return NextResponse.json({ ok: true, data: { progress } });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { slug } = await params;
    if (!slug) return badRequest('bad_slug', 'slug required');

    const body = await req.json().catch(() => ({} as any));
    const chunkIdx = Number(body?.chunkIdx);
    if (!Number.isInteger(chunkIdx) || chunkIdx < 0) return badRequest('bad_chunk', 'chunkIdx invalid');

    const [rows] = await getPool().query<any[]>(
      `SELECT id, chunks FROM sutras WHERE slug = ? LIMIT 1`,
      [slug]
    );
    const row = rows[0];
    if (!row) return notFound('sutra_not_found', 'sutra not found');
    const rawChunks: any[] = typeof row.chunks === 'string' ? JSON.parse(row.chunks) : row.chunks;
    const chunkCount = Array.isArray(rawChunks) ? rawChunks.length : 0;
    const sutraId = Number(row.id);
    if (chunkIdx >= chunkCount) return badRequest('bad_chunk', 'chunk out of range');

    if (body?.reset === true) {
      await deleteProgress(auth.user.id, sutraId, chunkIdx);
      return NextResponse.json({ ok: true, data: { saved: true, reset: true } });
    }

    if (!Array.isArray(body?.writtenChars) || body.writtenChars.length === 0) {
      return badRequest('bad_written', 'writtenChars must be a non-empty array');
    }
    if (!body.writtenChars.every((v: unknown) => typeof v === 'boolean')) {
      return badRequest('bad_written', 'writtenChars must be all booleans');
    }

    await upsertProgress(auth.user.id, sutraId, chunkIdx, body.writtenChars);
    if (body?.completed === true) {
      await markComplete(auth.user.id, sutraId, chunkIdx);
    }
    return NextResponse.json({ ok: true, data: { saved: true } });
  });
}
