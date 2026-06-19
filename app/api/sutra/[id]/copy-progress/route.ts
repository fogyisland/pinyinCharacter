import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getSutra } from '@/lib/sutras';
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const sutraId = Number(idStr);
    if (!Number.isInteger(sutraId) || sutraId <= 0) return badRequest('bad_id', 'invalid sutra id');

    const chunkIdx = parseChunkIdx(req.url);
    if (chunkIdx === null) return badRequest('bad_chunk', 'chunk query param required');

    const sutra = await getSutra(sutraId);
    if (!sutra) return notFound('sutra_not_found', 'sutra not found');
    if (chunkIdx >= sutra.chunks.length) return badRequest('bad_chunk', 'chunk out of range');

    const progress = await getProgress(auth.user.id, sutraId, chunkIdx);
    return NextResponse.json({ ok: true, data: { progress } });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const sutraId = Number(idStr);
    if (!Number.isInteger(sutraId) || sutraId <= 0) return badRequest('bad_id', 'invalid sutra id');

    const body = await req.json().catch(() => ({} as any));
    const chunkIdx = Number(body?.chunkIdx);
    if (!Number.isInteger(chunkIdx) || chunkIdx < 0) return badRequest('bad_chunk', 'chunkIdx invalid');

    const sutra = await getSutra(sutraId);
    if (!sutra) return notFound('sutra_not_found', 'sutra not found');
    if (chunkIdx >= sutra.chunks.length) return badRequest('bad_chunk', 'chunk out of range');

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
