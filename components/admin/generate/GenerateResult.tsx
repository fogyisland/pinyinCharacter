'use client';

import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import {
  ALL_BATCH_FIELDS,
  type BatchProgress,
  type BatchStatus,
  type GenerateResponse,
} from './generate-types';

const STATUS_LABEL: Record<BatchStatus, string> = {
  idle: '未开始',
  running: '运行中',
  paused: '已暂停',
  done: '全部完成',
  error: '已停止',
};

const STATUS_TONE: Record<BatchStatus, BadgeTone> = {
  idle: 'neutral',
  running: 'info',
  paused: 'warning',
  done: 'success',
  error: 'danger',
};

const STATUS_TEXT: Record<BatchStatus, string> = {
  idle: '',
  running: '运行中…',
  paused: '已暂停',
  done: '✓ 全部完成',
  error: '已停止(出错)',
};

/**
 * The outcome of a single-character generation.
 *
 * The old markup used `bg-paper-warm` for both the success and the failure
 * box and coloured the failure text with the seal red — the same red the
 * primary button uses — so a failure looked like a heading rather than an
 * error.
 */
export function GenerateResult({
  result,
  error,
  fieldLabels,
}: {
  result: GenerateResponse | null;
  error: string | null;
  fieldLabels: Record<string, string>;
}) {
  if (error) {
    return (
      <div className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
        ✗ {error}
      </div>
    );
  }
  if (!result) return null;
  const { totals } = result;
  return (
    <div className="rounded border border-ink/15 bg-paper-deep/30 px-3 py-2 text-sm space-y-2">
      <div className="text-success">
        ✓ 已生成 <span className="font-semibold tabular-nums">{totals.generated}</span> 个
      </div>
      {totals.skipped > 0 && (
        <div className="text-ink-soft">↷ 跳过 {totals.skipped} 个(字段已有值)</div>
      )}
      {totals.errors.length > 0 && (
        <div className="text-danger">
          <div>✗ 失败 {totals.errors.length} 个:</div>
          <ul className="mt-1 ml-4 text-xs space-y-0.5">
            {totals.errors.map((e, i) => (
              <li key={i}>
                {e.char} ({fieldLabels[e.char] ?? '未知'}): {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The live progress of a batch run.
 *
 * The counters are per field, so a reader can see at a glance which field
 * the run is stuck on. The error list shows the newest ten errors out of
 * the full count — a long run can produce thousands.
 */
export function BatchProgressView({
  progress,
  status,
  pct,
  etaMs,
  fmtTime,
}: {
  progress: BatchProgress;
  status: BatchStatus;
  pct: number;
  etaMs: number;
  fmtTime: (ms: number) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-ink">
          {progress.processed} / {progress.totalChars} ({pct}%)
        </span>
        <span className="flex items-center gap-2 text-ink-soft">
          <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
          {status === 'running' && `剩余约 ${fmtTime(etaMs)}`}
          {status !== 'running' && STATUS_TEXT[status]}
        </span>
      </div>
      <div
        className="w-full h-2 bg-paper-deep/60 rounded overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="批量生成进度"
      >
        <div className="h-full bg-seal transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-xs">
        {ALL_BATCH_FIELDS.map((f) => {
          const r = progress.perField[f.key] ?? {
            generated: 0,
            skipped: 0,
            errorCount: 0,
            errors: [],
          };
          return (
            <div
              key={f.key}
              className="flex justify-between border-b border-ink/10 py-1 text-ink"
            >
              <span>{f.label}</span>
              <span className="space-x-2 tabular-nums">
                <span className="text-success">✓ {r.generated}</span>
                {r.skipped > 0 && <span className="text-ink-soft">↷ {r.skipped}</span>}
                {r.errorCount > 0 && <span className="text-danger">✗ {r.errorCount}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <RecentErrors progress={progress} />
    </div>
  );
}

function RecentErrors({ progress }: { progress: BatchProgress }) {
  const fields = Object.values(progress.perField);
  const totalErrors = fields.reduce((sum, r) => sum + r.errorCount, 0);
  if (totalErrors === 0) return null;
  // The newest error of a field sits at the end of its list, so the
  // most recent ones come from the tail — walked newest field first.
  const show = fields
    .slice()
    .reverse()
    .flatMap((r) => r.errors.slice(-10))
    .slice(0, 10)
    .reverse();
  return (
    <div className="text-xs text-danger">
      <div>最近错误(共 {totalErrors}):</div>
      <ul className="mt-1 ml-4 space-y-0.5">
        {show.map((e, i) => (
          <li key={i}>
            {e.char}: {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
