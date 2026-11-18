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

    // The file is removed on a best-effort basis: the row is gone either
    // way, and a failure here must not fail the request.
    //
    // But the failure is NOT silent. ENOENT means the file was already
    // gone — fine, nothing to do. Any other error (EACCES, EPERM, EISDIR)
    // means the file is still on disk while its row is gone: an orphan
    // that will never be cleaned up. That is worth a line in the log.
    const filePath = join(AUDIO_DIR, removed.filename);
    try {
      await unlink(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error(
          `[admin.audio.delete] could not remove ${filePath}: ${code ?? 'unknown error'} — ` +
            'the row is gone but the file is still on disk',
        );
      }
    }

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.audio.delete',
      metadata: { id, title: '(已删除)', filename: removed.filename },
    });

    return NextResponse.json({ ok: true });
  });
}
