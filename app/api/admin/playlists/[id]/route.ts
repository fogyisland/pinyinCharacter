import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { getPlaylist, updatePlaylist, deletePlaylist } from '@/lib/playlists';
import { writeAudit } from '@/lib/audit';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'invalid id');
    const playlist = await getPlaylist(id);
    if (!playlist) return notFound('not_found', 'playlist not found');
    return NextResponse.json({ ok: true, data: { playlist } });
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'invalid id');

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest('validation', 'invalid JSON');
    }

    const update: { title?: string; isDefault?: boolean } = {};
    if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim();
    if (typeof body.isDefault === 'boolean') update.isDefault = body.isDefault;
    if (Object.keys(update).length === 0) return badRequest('empty', 'no fields to update');

    const existing = await getPlaylist(id);
    if (!existing) return notFound('not_found', 'playlist not found');

    await updatePlaylist(id, update);

    const changes: string[] = [];
    if (update.title !== undefined && update.title !== existing.title) {
      changes.push(`title: ${existing.title} → ${update.title}`);
    }
    if (update.isDefault !== undefined && update.isDefault !== existing.isDefault) {
      changes.push(update.isDefault ? '设为默认' : '取消默认');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.update',
      metadata: { id, title: update.title ?? existing.title, changes: changes.join('; ') },
    });

    const playlist = await getPlaylist(id);
    return NextResponse.json({ ok: true, data: { playlist } });
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'invalid id');

    const existing = await getPlaylist(id);
    if (!existing) return notFound('not_found', 'playlist not found');

    await deletePlaylist(id);

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.delete',
      metadata: { id, title: existing.title },
    });

    return NextResponse.json({ ok: true });
  });
}