import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import {
  getProgress,
  upsertProgress,
  markComplete,
  deleteProgress,
} from '@/lib/sutra-copy-progress';

interface SutraRow extends RowDataPacket {
  id: number;
  chunk_count: number | null;
}

/** Read a single field off an untrusted (JSON) request body. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** True when every element of the array is a boolean. */
function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'boolean');
}

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

    const [rows] = await getPool().query<SutraRow[]>(
      `SELECT id, JSON_LENGTH(chunks) AS chunk_count FROM sutras WHERE slug = ? LIMIT 1`,
      [slug],
    );
    const row = rows[0];
    if (!row) return notFound('sutra_not_found', 'sutra not found');
    const chunkCount = Number(row.chunk_count ?? 0);
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

    const body: unknown = await req.json().catch(() => ({}));
    const chunkIdx = Number(readField(body, 'chunkIdx'));
    if (!Number.isInteger(chunkIdx) || chunkIdx < 0)
      return badRequest('bad_chunk', 'chunkIdx invalid');

    const [rows] = await getPool().query<SutraRow[]>(
      `SELECT id, JSON_LENGTH(chunks) AS chunk_count FROM sutras WHERE slug = ? LIMIT 1`,
      [slug],
    );
    const row = rows[0];
    if (!row) return notFound('sutra_not_found', 'sutra not found');
    const chunkCount = Number(row.chunk_count ?? 0);
    const sutraId = Number(row.id);
    if (chunkIdx >= chunkCount) return badRequest('bad_chunk', 'chunk out of range');

    if (readField(body, 'reset') === true) {
      await deleteProgress(auth.user.id, sutraId, chunkIdx);
      return NextResponse.json({ ok: true, data: { saved: true, reset: true } });
    }

    const writtenChars = readField(body, 'writtenChars');
    if (!Array.isArray(writtenChars) || writtenChars.length === 0) {
      return badRequest('bad_written', 'writtenChars must be a non-empty array');
    }
    if (!isBooleanArray(writtenChars)) {
      return badRequest('bad_written', 'writtenChars must be all booleans');
    }

    await upsertProgress(auth.user.id, sutraId, chunkIdx, writtenChars);
    if (readField(body, 'completed') === true) {
      await markComplete(auth.user.id, sutraId, chunkIdx);
    }
    return NextResponse.json({ ok: true, data: { saved: true } });
  });
}
