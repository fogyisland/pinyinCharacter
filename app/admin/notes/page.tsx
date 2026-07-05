import type { Metadata } from 'next';
import { listAllNotesForAdmin } from '@/lib/notes';
import { NotesAdminClient, type AdminNoteRow } from '@/components/notes/NotesAdminClient';

export const metadata: Metadata = { title: '留言笔记 · 管理' };
export const dynamic = 'force-dynamic';

export default async function AdminNotesPage() {
  const rows = await listAllNotesForAdmin({ limit: 200, includeDeleted: true });
  const initial: AdminNoteRow[] = rows.map((r) => ({
    id: r.id, authorName: r.authorName, authorEmail: r.authorEmail,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }));
  return (
    <section>
      <h1 className="text-xl font-bold mb-3">留言笔记</h1>
      <p className="text-sm text-gray-600 mb-4">所有用户发布的留言。被删除的留言会留在审计日志,不会向公众展示。</p>
      <NotesAdminClient initial={initial} />
    </section>
  );
}
