import { notFound } from 'next/navigation';
import { getUserDetail } from '@/lib/admin';
import { getCurrentUserWithAdmin } from '@/lib/auth';
import { UserDetailClient } from './UserDetailClient';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const me = await getCurrentUserWithAdmin();
  return (
    <UserDetailClient
      user={detail.user}
      recentHistory={detail.recentHistory}
      isSelf={me?.id === id}
    />
  );
}
