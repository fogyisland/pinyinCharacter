import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassDetailClient } from '@/components/classes/ClassDetailClient';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getClassForUser } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClassDetailPage({ params }: Props) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const { id } = await params;
  const classId = Number(id);
  if (!Number.isInteger(classId) || classId <= 0) notFound();

  // 服务端先判一次权限：不是这个班的人拿到 404，而不是先渲染页面再让
  // 客户端 404 —— 后者的首屏会闪一下空壳。
  const found = await getClassForUser(classId, session.userId);
  if (!found) notFound();

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="mb-4 flex items-center justify-between">
          <Link href="/classes" className="text-sm text-ink-soft hover:text-ink">
            ← 返回班级
          </Link>
          <span className="text-xs text-ink-faint tracking-widest">字 · 韵 · 班级</span>
        </div>
        <ClassDetailClient classId={classId} />
      </PageContainer>
      <Footer />
    </>
  );
}
