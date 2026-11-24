import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { listActiveNotes } from '@/lib/notes';
import { getCurrentUser } from '@/lib/auth';
import { NotesWall, type ClientNote } from '@/components/notes/NotesWall';
import { buildMetadata } from '@/lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '留言笔记 | 字·韵',
    description: '分享建议与想法 — 字·韵 用户反馈墙。',
    path: '/notes',
    ogType: 'website',
  });
}

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const rows = await listActiveNotes({ limit: 50 });
  const user = await getCurrentUser();
  const initial: ClientNote[] = rows.map((r) => ({
    id: r.id,
    authorName: r.authorName,
    authorEmail: r.authorEmail,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
  return (
    <><Header /><PageContainer><div className="mx-auto max-w-4xl"><header className="publication-heading">
      <h1>留言笔记</h1>
      <p>
        欢迎留下你的建议、功能想法或使用感受。每条留言都会发送到管理员邮箱,我们会认真阅读。
        {user ? ` 已识别为 ${user.username}。` : ' 匿名留言也可,只需填个昵称即可。'}
      </p></header>
      <NotesWall initial={initial} defaultName={user ? '' : undefined} />
    </div></PageContainer><Footer /></>
  );
}
