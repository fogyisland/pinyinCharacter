import type { Metadata } from 'next';
import { countAllNotesForAdmin, listAllNotesForAdmin } from '@/lib/notes';
import { NoteDeleteButton } from '@/components/notes/NoteDeleteButton';
import { Pagination } from '@/components/admin/Pagination';
import { formatDateTimeShort } from '@/lib/format';

export const metadata: Metadata = { title: '留言笔记 · 管理' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function AdminNotesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);

  // The list and its total are independent queries, so they run together.
  const [rows, total] = await Promise.all([
    listAllNotesForAdmin({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      includeDeleted: true,
    }),
    countAllNotesForAdmin({ includeDeleted: true }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (target: number) =>
    target > 1 ? `/admin/notes?page=${target}` : '/admin/notes';

  return (
    <section>
      <h1 className="text-xl font-bold mb-3">留言笔记</h1>
      <p className="text-sm text-gray-600 mb-4">
        所有用户发布的留言。被删除的留言会留在审计日志,不会向公众展示。
      </p>

      <div className="space-y-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">#</th>
              <th>作者</th>
              <th>时间</th>
              <th>内容</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-gray-500">
                  暂无留言
                </td>
              </tr>
            )}
            {rows.map((n) => (
              <tr key={n.id} className="border-b align-top">
                <td className="py-2 pr-2">{n.id}</td>
                <td className="pr-2">
                  {n.authorName}
                  {n.authorEmail && <span className="text-gray-500"> &lt;{n.authorEmail}&gt;</span>}
                </td>
                <td className="pr-2 whitespace-nowrap">{formatDateTimeShort(n.createdAt)}</td>
                <td className="pr-2">
                  <div className="max-w-md whitespace-pre-wrap break-words">{n.content}</div>
                </td>
                <td className="pr-2">
                  {n.deletedAt ? (
                    <span className="text-red-600">已删除 {formatDateTimeShort(n.deletedAt)}</span>
                  ) : (
                    <span className="text-green-700">活跃</span>
                  )}
                </td>
                <td>
                  {!n.deletedAt && <NoteDeleteButton noteId={n.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          buildHref={buildHref}
          unit="条"
        />
      </div>
    </section>
  );
}
