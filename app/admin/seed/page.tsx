import { Database, PackageCheck, TriangleAlert } from 'lucide-react';
import { SEED_DATASETS } from '@/lib/seed-registry';
import { readSeedCounts } from '@/lib/seed-runner';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatCard } from '@/components/admin/StatCard';
import { SeedManager, type SeedDatasetRow } from '@/components/admin/SeedManager';

export const dynamic = 'force-dynamic';

/**
 * The content seed screen.
 *
 * Every content dataset the project ships is listed here with what the
 * repository holds and what the database holds. A dataset that is short
 * can be filled from this page — the same runner the server uses on boot,
 * so the screen and the boot path can never disagree.
 *
 * The expected counts come from `lib/seed-registry.ts`, which reads the
 * repository's own data files. That file is the single source of truth
 * shared with `scripts/init-db.ts` and the CLI.
 */
export default async function AdminSeedPage() {
  const counts = await readSeedCounts();

  const rows: SeedDatasetRow[] = SEED_DATASETS.map((dataset) => {
    const actual = counts[dataset.id] ?? 0;
    return {
      id: dataset.id,
      label: dataset.label,
      table: dataset.table,
      dependsOn: dataset.dependsOn,
      expected: dataset.expected,
      actual,
      missing: Math.max(0, dataset.expected - actual),
      complete: actual >= dataset.expected,
      manualCommand: dataset.manualCommand,
    };
  });

  const complete = rows.filter((r) => r.complete).length;
  const missing = rows.length - complete;
  const missingRows = rows.reduce((sum, r) => sum + r.missing, 0);

  return (
    <div>
      <PageHeader
        title="内容种子 / 导入"
        description={
          <>
            所有内容数据都是 seed —— 服务器启动时会自动补齐缺口,这里也可以手动触发。
            期望值来自仓库自身的数据文件(
            <code className="text-xs">
              data/hsk-vocab.json · data/general-standard-chinese-characters.json · data/content/
            </code>
            )。
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="数据集总数" value={rows.length} icon={Database} />
        <StatCard label="已就绪" value={complete} icon={PackageCheck} />
        <StatCard label="待补齐行数" value={missingRows.toLocaleString('en-US')} icon={TriangleAlert} />
      </div>

      <Panel
        title="数据集"
        description="每个数据集都列出了「仓库有多少」与「库里有多少」"
        className="mb-4"
      >
        <SeedManager datasets={rows} />
      </Panel>

      <Panel title="命令行等价操作" description="服务器上没有后台权限时,用这些命令">
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-ink-soft mb-1">查看所有数据集与缺口(只读)</div>
            <code className="block rounded bg-paper-warm/60 px-2 py-1.5 overflow-x-auto">
              npm run seed:run -- --dry-run
            </code>
          </div>
          <div>
            <div className="text-ink-soft mb-1">补齐全部缺口</div>
            <code className="block rounded bg-paper-warm/60 px-2 py-1.5 overflow-x-auto">
              npm run seed:run
            </code>
          </div>
          <div>
            <div className="text-ink-soft mb-1">只补某一个数据集</div>
            <code className="block rounded bg-paper-warm/60 px-2 py-1.5 overflow-x-auto">
              npm run seed:run -- --only=hsk-grading
            </code>
          </div>
          <div>
            <div className="text-ink-soft mb-1">列出全部数据集</div>
            <code className="block rounded bg-paper-warm/60 px-2 py-1.5 overflow-x-auto">
              npm run seed:run -- --list
            </code>
          </div>
        </div>
      </Panel>
    </div>
  );
}
