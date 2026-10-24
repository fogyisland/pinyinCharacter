'use client';

import { useState, useCallback, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Power, Play, Check, AlertTriangle, Clock, History } from 'lucide-react';
import type { SchedulerConfig, SchedulerRunGroup } from '@/lib/scheduler-config';
import { formatDateTime } from '@/lib/format';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';
import { LoadingState } from '@/components/admin/LoadingState';

const INTERVAL_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时' },
];

const TASK_LABELS: Record<
  keyof Pick<SchedulerConfig, 'taskContentRefresh' | 'taskDailyChar' | 'taskStatsRefresh'>,
  string
> = {
  taskContentRefresh: '内容补充 (LLM)',
  taskDailyChar: '今日汉字 (预热)',
  taskStatsRefresh: '系统统计 (DB 探活)',
};

export function SchedulerPanel({ initial }: { initial: SchedulerConfig }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [triggerResults, setTriggerResults] = useState<null | Array<{
    name: string;
    ok: boolean;
    summary: string;
    error?: string;
  }>>(null);
  const [history, setHistory] = useState<SchedulerRunGroup[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/scheduler/history?limit=5');
      const j = await r.json();
      if (j?.ok) {
        setHistory(j.data.runs);
        setHistoryErr(null);
      } else {
        setHistoryErr(j?.error?.message ?? '加载失败');
      }
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function postJson<T>(url: string, body: object): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error?.message ?? '请求失败');
    return j.data as T;
  }

  async function update(patch: Partial<SchedulerConfig>) {
    setBusy('save');
    setMsg(null);
    try {
      const next = await postJson<SchedulerConfig>('/api/admin/scheduler', patch);
      setCfg(next);
      setMsg({ kind: 'ok', text: '已保存' });
      refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!confirm('确认立即跑一遍所有启用的任务?')) return;
    setBusy('trigger');
    setMsg(null);
    setTriggerResults(null);
    try {
      const d = await postJson<{ results: typeof triggerResults; ranAt: string }>(
        '/api/admin/scheduler/trigger',
        {},
      );
      setTriggerResults(d.results);
      setMsg({ kind: 'ok', text: `已跑完,记录于 ${formatDateTime(d.ranAt)}` });
      // Reload config to update lastRunAt / lastResult.
      try {
        const refreshed = await fetch('/api/admin/scheduler').then((r) => r.json());
        if (refreshed.ok) setCfg(refreshed.data);
      } catch (error) {
        // The run itself already succeeded; only the follow-up refresh failed.
        console.warn('[admin/scheduler] failed to reload the config after a run', error);
      }
      refresh();
      // Reload per-task history so the table reflects the new run.
      void fetchHistory();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const taskKeys = Object.keys(TASK_LABELS) as Array<keyof typeof TASK_LABELS>;
  const lastRunAt = cfg.lastRunAt ? formatDateTime(cfg.lastRunAt) : '—';
  const lastResult = cfg.lastResult ?? '—';
  const hasError = cfg.lastResult && cfg.lastResult.includes('✗');

  return (
    <div className="space-y-4 max-w-2xl">
      {msg && (
        <p
          className={`text-sm ${
            msg.kind === 'ok' ? 'text-success' : 'text-danger'
          } rounded border px-3 py-2 ${
            msg.kind === 'ok' ? 'border-success/30 bg-success/8' : 'border-danger/30 bg-danger/8'
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* Status */}
      <Panel title="状态" description="定时器当前的开关与最近一次执行">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-faint">开关</div>
            <div className="font-mono">
              {cfg.enabled ? (
                <span className="text-success inline-flex items-center gap-1">
                  <Power className="h-3.5 w-3.5" />
                  运行中
                </span>
              ) : (
                <span className="text-ink-soft inline-flex items-center gap-1">
                  <Power className="h-3.5 w-3.5" />
                  已停止
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">上次执行</div>
            <div className="font-mono text-xs text-ink">{lastRunAt}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">执行结果</div>
            <div
              className={`text-xs break-all ${hasError ? 'text-danger' : 'text-ink-soft'}`}
            >
              {lastResult}
            </div>
          </div>
        </div>
      </Panel>

      {/* Controls */}
      <Panel title="启用定时器" description="启动后,服务器进程会按所选间隔自动跑下面勾选的任务。">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-ink">开关</h3>
              <p className="text-xs text-ink-faint">
                关闭后定时器不再自动触发,历史记录仍然保留。
              </p>
            </div>
            <ToggleSwitch
              checked={cfg.enabled}
              disabled={busy !== null}
              onChange={(v) => void update({ enabled: v })}
            />
          </div>

          <FormField
            label={
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                间隔
              </span>
            }
            htmlFor="scheduler-interval"
          >
            <select
              id="scheduler-interval"
              value={cfg.intervalMin}
              onChange={(e) => void update({ intervalMin: Number(e.target.value) })}
              disabled={busy !== null}
              className="adm-input max-w-xs"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <div>
            <h3 className="text-sm font-medium text-ink mb-2">启用任务</h3>
            <div className="space-y-2">
              {taskKeys.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg[k]}
                    disabled={busy !== null}
                    onChange={(e) =>
                      void update({ [k]: e.target.checked } as Partial<SchedulerConfig>)
                    }
                    className="h-4 w-4"
                  />
                  {TASK_LABELS[k]}
                </label>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-ink/10">
            <AdminButton
              onClick={() => void runNow()}
              disabled={busy !== null}
              variant="primary"
              icon={<Play className="h-3.5 w-3.5" />}
            >
              {busy === 'trigger' ? '执行中…' : '立即跑一次'}
            </AdminButton>
          </div>
        </div>
      </Panel>

      {/* Trigger results */}
      {triggerResults && (
        <Panel title="本次执行结果" description="刚刚手动触发的那一轮">
          {triggerResults.length === 0 && (
            <p className="text-xs text-ink-faint">无任务可执行 (未勾选任何任务)</p>
          )}
          <ul className="space-y-1 text-sm">
            {triggerResults.map((r) => (
              <li key={r.name} className="font-mono text-xs">
                <span className={r.ok ? 'text-success' : 'text-danger'}>{r.ok ? '✓' : '✗'}</span>{' '}
                <span className="text-ink-soft">{r.name}:</span> {r.summary}
                {r.error && <span className="text-danger"> — {r.error}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Per-task history */}
      <Panel
        title={
          <span className="inline-flex items-center gap-1">
            <History className="h-3.5 w-3.5" />
            最近执行历史
          </span>
        }
        actions={
          <AdminButton
            size="sm"
            variant="ghost"
            onClick={() => void fetchHistory()}
            disabled={busy !== null}
          >
            刷新
          </AdminButton>
        }
      >
        {historyErr && <p className="text-xs text-danger">{historyErr}</p>}
        {history === null && !historyErr && <LoadingState variant="inline" label="正在读取历史记录…" />}
        {history !== null && history.length === 0 && (
          <p className="text-xs text-ink-faint">暂无历史记录 — 触发或自动跑过一次后会出现。</p>
        )}
        {history && history.length > 0 && (
          <ul className="space-y-2 text-sm">
            {history.map((run) => {
              const anyFail = run.tasks.some((t) => !t.ok);
              return (
                <li key={run.runId} className="border border-ink/15 rounded p-2">
                  <div className="flex items-center justify-between text-xs text-ink-soft">
                    <span className="font-mono">{run.runId}</span>
                    <span>{formatDateTime(run.startedAt)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {run.tasks.map((t) => (
                      <li key={t.id} className="font-mono text-xs flex items-start gap-1">
                        <span className={t.ok ? 'text-success' : 'text-danger'}>
                          {t.ok ? '✓' : '✗'}
                        </span>
                        <span className="text-ink-soft shrink-0">{t.taskName}:</span>
                        <span className="text-ink break-all flex-1">
                          {t.summary}
                          {t.error && <span className="text-danger"> — {t.error}</span>}
                        </span>
                        <span className="text-ink-faint shrink-0">
                          {t.startedAt && t.finishedAt
                            ? `${new Date(t.finishedAt).getTime() - new Date(t.startedAt).getTime()}ms`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {anyFail && (
                    <p className="text-xs text-danger mt-1">本轮有任务失败,见上方行内错误。</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* External cron hint */}
      <Panel title="外部 cron 兜底" description="serverless 部署下 setInterval 不一定生效">
        <div className="space-y-1 text-xs text-ink-soft">
          <p>在 Vercel / serverless 部署中,setInterval 不一定生效。请用外部 cron 调:</p>
          <pre className="bg-paper-deep/60 border border-ink/10 p-2 rounded text-xs overflow-x-auto text-ink">
            {`curl -X POST https://YOUR_DOMAIN/api/admin/scheduler/trigger \\
  -H "Cookie: <admin session>"`}
          </pre>
          <p>需要登录态。生产环境建议配合 admin Bearer Token (未来扩展)。</p>
        </div>
      </Panel>

      {hasError && (
        <p className="text-xs text-danger inline-flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          上次执行有任务失败,见上方「执行结果」。
        </p>
      )}
      {!hasError && cfg.lastResult && (
        <p className="text-xs text-success inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          上次执行全部成功。
        </p>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-success' : 'bg-ink-faint/40'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-paper-soft transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
