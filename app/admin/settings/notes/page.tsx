import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { NotesEmailForm } from '@/components/admin/NotesEmailForm';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminNotesEmailPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const adminEmails = (await getConfig('notes.admin_emails')) ?? '';
  return (
    <div>
      <PageHeader
        title="留言通知邮箱"
        description="设置接收新留言通知的邮箱地址。写入 app_config.notes.admin_emails。"
      />
      <NotesEmailForm initial={{ adminEmails }} />
    </div>
  );
}
