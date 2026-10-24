import { readSchedulerConfig } from '@/lib/scheduler-config';
import { SchedulerPanel } from '@/components/admin/SchedulerPanel';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminSchedulerPage() {
  const initial = await readSchedulerConfig();
  return (
    <div>
      <PageHeader
        title="定期后台更新"
        description={
          <>
            在服务器进程内启一个 <code>setInterval</code>,按设定的间隔跑任务。可同时配合外部 cron (如 crontab /
            GitHub Actions) 调用 <code>POST /api/admin/scheduler/trigger</code> 来兜底。
          </>
        }
      />
      {/* SchedulerPanel brings its own panels — wrapping it again would stack
          a card inside a card. */}
      <SchedulerPanel initial={initial} />
    </div>
  );
}
