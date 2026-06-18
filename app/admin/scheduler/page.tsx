import { readSchedulerConfig } from '@/lib/scheduler-config';
import { SchedulerPanel } from '@/components/admin/SchedulerPanel';

export const dynamic = 'force-dynamic';

export default async function AdminSchedulerPage() {
  const initial = await readSchedulerConfig();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">定期后台更新</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        在服务器进程内启一个 <code>setInterval</code>,按设定的间隔跑任务。可同时配合外部 cron
        (如 crontab / GitHub Actions) 调用 <code>POST /api/admin/scheduler/trigger</code>
        来兜底。
      </p>
      <SchedulerPanel initial={initial} />
    </div>
  );
}
