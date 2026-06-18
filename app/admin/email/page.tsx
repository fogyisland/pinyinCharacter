import { getAllConfig } from '@/lib/config';
import { SmtpConfigForm } from '@/components/admin/SmtpConfigForm';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">邮件</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        邮件发送配置。写入 <code>app_config</code> 表,优先级高于 <code>SMTP_*</code> 环境变量。
        在 <code>smtp.transport=console</code> 时只把邮件内容打印到服务器日志(开发用)。
      </p>
      <SmtpConfigForm initial={initial} />
    </div>
  );
}
