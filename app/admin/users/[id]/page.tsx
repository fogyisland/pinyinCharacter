import { notFound } from 'next/navigation';
import { getUserDetail } from '@/lib/admin';
import { getCurrentUserWithAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/admin/PageHeader';
import { UserDetailClient } from './UserDetailClient';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const me = await getCurrentUserWithAdmin();
  return (
    <div>
      <PageHeader
        eyebrow="用户"
        title={detail.user.username}
        description={`注册于 ${formatDateTime(detail.user.createdAt)} · 历史 ${detail.user.historyCount} 条 · 收藏 ${detail.user.favoriteCount} 个`}
      />
      <UserDetailClient
        user={detail.user}
        recentHistory={detail.recentHistory}
        isSelf={me?.id === id}
        disabledAt={detail.user.disabledAt}
      />
    </div>
  );
}
