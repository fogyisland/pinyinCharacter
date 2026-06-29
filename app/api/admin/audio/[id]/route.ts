import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { getTrack, updateTrack, deleteTrack } from '@/lib/audio-tracks';
import { writeAudit } from '@/lib/audit';

const AUDIO_DIR = join(process.cwd(), 'public', 'audio');

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

    const existing = await getTrack(id);
    if (!existing) return notFound('not_found', 'audio track not found');

    await updateTrack(id, update);

    const changes: string[] = [];
    if (update.title !== undefined && update.title !== existing.title) {
      changes.push(`title: ${existing.title} → ${update.title}`);
    }
    if (update.isDefault !== undefined && update.isDefault !== existing.isDefault) {
      changes.push(update.isDefault ? '设为默认' : '取消默认');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'admin.audio.update',
      metadata: { id, title: update.title ?? existing.title, changes: changes.join('; ') },
    });

    const t = await getTrack(id);
    return NextResponse.json({ ok: true, data: { track: t } });
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'invalid id');

    const removed = await deleteTrack(id);
    if (!removed) return notFound('not_found', 'audio track not found');

    // Best-effort unlink — don't fail the request if file is already gone.
    const filePath = join(AUDIO_DIR, removed.filename);
    try {
      await unlink(filePath);
    } catch {
      // swallow ENOENT and other fs errors
    }

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.audio.delete',
      metadata: { id, title: '(已删除)', filename: removed.filename },
    });

    return NextResponse.json({ ok: true });
  });
}
