import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { ClassesClient } from '@/components/classes/ClassesClient';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '班级与作业 | 字·韵',
    description: '老师建班、派字帖与听写作业，学生用邀请码进班，查看本周任务。',
    path: '/classes',
    ogType: 'website',
  });
}

export default async function ClassesPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  // 班级页对未登录用户没有意义（没有身份就没有「我的班」），直接回首页
  // 打开登录框，而不是显示一个灰掉的空页面。
  if (!session) redirect('/?auth=login');

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <SectionTitle subtitle="建班 · 邀请码进班 · 派作业">
          班级与作业
        </SectionTitle>
        <ClassesClient />
      </PageContainer>
      <Footer />
    </>
  );
}
