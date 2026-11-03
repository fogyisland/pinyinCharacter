'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Wrench } from 'lucide-react';
import { AdminButton } from '@/components/admin/AdminButton';
import { StatusBadge } from '@/components/admin/StatusBadge';

/** One dataset as the API reports it. */
export interface SeedDatasetRow {
  id: string;
  label: string;
  table: string;
  dependsOn: string;
  expected: number;
  actual: number;
  missing: number;
  complete: boolean;
  manualCommand: string;
}

/** The outcome of one seed run, as the API reports it. */
interface SeedOutcome {
  datasetId: string;
  status: 'ok' | 'pending' | 'skipped' | 'failed';
  actual: number;
  inserted: number;
  message?: string;
  error?: string;
  skippedReason?: string;
}

/**
 * The content seed panel.
 *
 * It shows what the repository ships against what the database holds, and
 * lets an administrator fill the gap without a shell. The numbers come
 * from the same registry the boot path uses, so this screen cannot tell
 * an operator that the content is complete when it is not.
 */
export function SeedManager({ datasets }: { datasets: SeedDatasetRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeedOutcome[] | null>(null);

  const missing = datasets.filter((d) => !d.complete);
  const complete = datasets.length - missing.length;

  async function runSeed(only: string[], label: string) {
    setBusyId(only.length === 1 ? only[0] : '*');
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ only }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? `导入失败 (HTTP ${res.status})`);
        return;
      }
      setResult(json.data.outcomes as SeedOutcome[]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          已就绪 {complete} / {datasets.length} 个数据集
          {missing.length > 0 ? ` — ${missing.length} 个待补齐` : ' — 全部齐备'}
        </p>
        <AdminButton
          variant="primary"
          size="sm"
          icon={<Wrench size={14} />}
          disabled={busyId !== null || missing.length === 0}
          onClick={() => void runSeed([], '全部')}
        >
          {busyId === '*' ? '导入中…' : '补齐全部缺口'}
        </AdminButton>
      </div>

      {error ? (
        <div className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded border border-ink/15 bg-paper-warm/40 px-3 py-2 text-xs space-y-1">
          {result.map((outcome) => (
            <div key={outcome.datasetId} className="flex flex-wrap items-center gap-2">
              <code className="text-ink-soft">{outcome.datasetId}</code>
              {outcome.status === 'failed' ? (
                <StatusBadge tone="danger">失败</StatusBadge>
              ) : outcome.status === 'ok' ? (
                <StatusBadge tone="success">已就绪</StatusBadge>
              ) : outcome.status === 'pending' ? (
                <StatusBadge tone="warning">仍不完整</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">已跳过</StatusBadge>
              )}
              <span className="text-ink-faint">
                {outcome.status === 'failed'
                  ? (outcome.error ?? '未知错误')
                  : outcome.inserted > 0
                    ? `新增 ${outcome.inserted} 行`
                    : (outcome.skippedReason ?? outcome.message ?? '无需导入')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {datasets.map((dataset) => (
          <div
            key={dataset.id}
            className="rounded border border-ink/12 bg-paper-soft px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink">{dataset.label}</span>
                <code className="text-xs text-ink-faint">{dataset.table}</code>
                {dataset.complete ? (
                  <StatusBadge tone="success">已就绪</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">
                    缺 {dataset.missing.toLocaleString('en-US')} 行
                  </StatusBadge>
                )}
              </div>
              <p className="text-xs text-ink-faint mt-0.5">
                {dataset.actual.toLocaleString('en-US')} /{' '}
                {dataset.expected.toLocaleString('en-US')} 行 — {dataset.dependsOn}
              </p>
              {!dataset.complete ? (
                <p className="text-xs text-ink-faint mt-0.5">
                  命令行等价操作：<code>{dataset.manualCommand}</code>
                </p>
              ) : null}
            </div>
            <AdminButton
              size="sm"
              icon={<RefreshCw size={13} />}
              disabled={busyId !== null}
              onClick={() => void runSeed([dataset.id], dataset.label)}
            >
              {busyId === dataset.id ? '导入中…' : dataset.complete ? '重新校验' : '补齐'}
            </AdminButton>
          </div>
        ))}
      </div>
    </div>
  );
}
