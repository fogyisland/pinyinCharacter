import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { listPlaylists, createPlaylist } from '@/lib/playlists';
import { writeAudit } from '@/lib/audit';

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const playlists = await listPlaylists();
    return NextResponse.json({ ok: true, data: { playlists } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest('validation', 'invalid JSON');
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return badRequest('validation', 'title required');
    if (title.length > 128) return badRequest('validation', 'title too long');
    const isDefault = body.isDefault === true;

    const id = await createPlaylist({ title, isDefault });

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.create',
      metadata: { id, title, isDefault },
    });

    return NextResponse.json({ ok: true, data: { id } });
  });
}