import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listJobs } from '@/lib/webfont/jobs';
import { isWebfontJobsTableMissing } from '@/lib/webfont/schema-errors';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import WebfontPipelinePanel from '@/components/admin/WebfontPipelinePanel';

export const dynamic = 'force-dynamic';

/**
 * The admin font pipeline page.
 *
 * ⚠️ The page does NOT render `<AdminShell>` — `app/admin/layout.tsx`
 * already wraps every admin page in it, and a second one would put a second
 * sidebar on the screen.
 *
 * The last ten jobs are read on the server and handed over as
 * `initialJobs`, so the first paint needs no extra round trip.
 *
 * ## Why the job list is read defensively
 *
 * The job list comes from `webfont_build_jobs`, a table that a migration
 * creates. A server that runs the code before the migration has run has no
 * such table, and the read fails with MySQL's `ER_NO_SUCH_TABLE`.
 *
 * This is a server component, so an uncaught throw used to escape as an
 * RSC render error — and a production build strips the message, leaving
 * the administrator with "An error occurred in the Server Components
 * render" and no idea what to do about it. That happened on production.
 *
 * So the missing table is caught here and turned into a page that says
 * what is wrong and what to run. **Only that one failure is caught**: every
 * other error still propagates, because "the page failed to load" and
 * "the schema is behind" are different problems and a page must not
 * pretend that a broken query is a missing table.
 */
export default async function AdminWebfontsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');

  let jobs;
  try {
    jobs = await listJobs(10);
  } catch (error) {
    if (!isWebfontJobsTableMissing(error)) throw error;
    // Logged, not swallowed: the server log is where the operator looks
    // when the page tells them the schema is behind.
    console.error(
      '[webfonts] the job table is missing — the admin page is degraded until the migration runs:',
      error,
    );
    return <SchemaMissingNotice />;
  }

  return (
    <div>
      <PageHeader
        title="网站字体"
        description="把「下载 → 裁轴 → 切分 → 校验」这一条流水线跑起来，然后把产物发布到服务器。发布只改服务器上的文件，回灌仓库要人工来做。"
      />
      <WebfontPipelinePanel initialJobs={jobs} />
    </div>
  );
}

/**
 * The page shown when the job table is missing.
 *
 * It states the problem and the remedy, and nothing else: a panel that
 * pretends the pipeline has never run would be a lie — the pipeline may
 * well have runs, and its history is in the table we cannot read.
 */
function SchemaMissingNotice() {
  return (
    <div>
      <PageHeader
        title="网站字体"
        description="把「下载 → 裁轴 → 切分 → 校验」这一条流水线跑起来，然后把产物发布到服务器。发布只改服务器上的文件，回灌仓库要人工来做。"
      />
      <Panel
        title="数据库尚未升级"
        description="这一页需要 webfont_build_jobs 表，而当前数据库里没有它。"
      >
        <div className="text-sm text-ink-soft space-y-3">
          <p>
            服务器上的代码比数据库新：字体流水线在运行时会把每一次构建记进
            <code className="px-1 rounded bg-paper-warm/60">webfont_build_jobs</code>
            表，而当前数据库里还没有这张表。
          </p>
          <p>在服务器上执行下面这条命令即可补上（迁移是幂等的，可以重复运行）：</p>
          <pre className="overflow-x-auto rounded bg-paper-warm/50 px-3 py-2 font-mono text-xs text-ink">
            npx tsx scripts/migrate.ts
          </pre>
          <p className="text-xs text-ink-faint">
            执行完刷新本页即可。已有的构建记录在迁移完成后会重新显示出来。
          </p>
        </div>
      </Panel>
    </div>
  );
}
