import type { Metadata } from 'next';
import { listActiveNotes } from '@/lib/notes';
import { getCurrentUser } from '@/lib/auth';
import { NotesWall, type ClientNote } from '@/components/notes/NotesWall';

export const metadata: Metadata = {
  title: '留言笔记 · 汉字·韵',
  description: '分享建议与想法 — 汉字·韵用户反馈墙',
};

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
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">留言笔记</h1>
      <p className="text-gray-600 text-sm">
        欢迎留下你的建议、功能想法或使用感受。每条留言都会发送到管理员邮箱,我们会认真阅读。
        {user ? ` 已识别为 ${user.username}。` : ' 匿名留言也可,只需填个昵称即可。'}
      </p>
      <NotesWall initial={initial} defaultName={user ? '' : undefined} />
    </main>
  );
}
