import type { Metadata } from 'next';
import { countAllNotesForAdmin, listAllNotesForAdmin } from '@/lib/notes';
import { NoteDeleteButton } from '@/components/notes/NoteDeleteButton';
import { DataTable } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/PageHeader';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { MessageSquare } from 'lucide-react';
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
    <div>
      <PageHeader
        title="留言笔记"
        description="所有用户发布的留言。被删除的留言会留在审计日志,不会向公众展示。"
      />

      <DataTable
        rows={rows}
        rowKey={(n) => n.id}
        caption="用户留言列表"
        empty={
          <EmptyState
            icon={MessageSquare}
            title="还没有留言"
            description="访客在站点的留言会出现在这里。"
          />
        }
        columns={[
          { key: 'id', header: '#', numeric: true },
          { key: 'author', header: '作者', mobileTitle: true },
          { key: 'createdAt', header: '时间', numeric: true },
          { key: 'content', header: '内容' },
          { key: 'status', header: '状态' },
          { key: 'actions', header: '操作', mobileHide: true },
        ]}
      >
        {(n) => (
          <>
            <span className="text-ink-faint tabular-nums">{n.id}</span>
            <span className="min-w-0">
              <span className="block text-ink">{n.authorName}</span>
              {n.authorEmail ? (
                <span className="block text-xs text-ink-faint truncate">{n.authorEmail}</span>
              ) : null}
            </span>
            <span className="text-xs text-ink-soft whitespace-nowrap">
              {formatDateTimeShort(n.createdAt)}
            </span>
            <span className="block max-w-md whitespace-pre-wrap break-words">{n.content}</span>
            {n.deletedAt ? (
              <StatusBadge tone="danger">已删除 {formatDateTimeShort(n.deletedAt)}</StatusBadge>
            ) : (
              <StatusBadge tone="success">活跃</StatusBadge>
            )}
            <span className="text-right">
              {!n.deletedAt ? <NoteDeleteButton noteId={n.id} /> : null}
            </span>
          </>
        )}
      </DataTable>

      <div className="mt-4">
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          buildHref={buildHref}
          unit="条"
        />
      </div>
    </div>
  );
}
