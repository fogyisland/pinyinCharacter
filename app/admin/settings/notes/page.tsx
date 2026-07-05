import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { NotesEmailForm } from '@/components/admin/NotesEmailForm';

export const dynamic = 'force-dynamic';

export default async function AdminNotesEmailPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const adminEmails = (await getConfig('notes.admin_emails')) ?? '';
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">留言通知邮箱</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        设置接收新留言通知的邮箱地址。写入 <code>app_config.notes.admin_emails</code>。
      </p>
      <NotesEmailForm initial={{ adminEmails }} />
    </div>
  );
}