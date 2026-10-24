import { getAllConfig } from '@/lib/config';
import { SmtpConfigForm } from '@/components/admin/SmtpConfigForm';
import { EmailHistory } from '@/components/admin/EmailHistory';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminEmailPage() {
  const all = await getAllConfig();
  // Mask the password (return '' if set) — UI uses "leave empty to keep".
  const initial = {
    transport: (all['smtp.transport'] ?? 'console') as 'console' | 'smtp',
    host: all['smtp.host'] ?? '',
    port: all['smtp.port'] ?? '587',
    secure: all['smtp.secure'] === 'true',
    user: all['smtp.user'] ?? '',
    passSet: !!all['smtp.pass'],
    from: all['smtp.from'] ?? '',
    fromName: all['smtp.from_name'] ?? '',
  };
  return (
    <div>
      <PageHeader
        title="邮件"
        description="邮件发送配置与发送历史。配置写入 app_config 表,优先级高于 SMTP_* 环境变量。"
      />
      <div className="space-y-4">
        <SmtpConfigForm initial={initial} />
        <EmailHistory />
      </div>
    </div>
  );
}
