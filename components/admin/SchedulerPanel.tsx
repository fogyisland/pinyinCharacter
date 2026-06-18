'use client';

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Power, Play, Check, AlertTriangle, Clock } from 'lucide-react';
import type { SchedulerConfig } from '@/lib/scheduler-config';

const INTERVAL_OPTIONS = [
  { value: 5,    label: '5 分钟' },
  { value: 15,   label: '15 分钟' },
  { value: 30,   label: '30 分钟' },
  { value: 60,   label: '1 小时' },
  { value: 180,  label: '3 小时' },
  { value: 360,  label: '6 小时' },
  { value: 720,  label: '12 小时' },
  { value: 1440, label: '24 小时' },
];

const TASK_LABELS: Record<keyof Pick<SchedulerConfig,
  'taskContentRefresh' | 'taskDailyChar' | 'taskStatsRefresh'>, string> = {
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
  const [triggerResults, setTriggerResults] = useState<null | Array<{ name: string; ok: boolean; summary: string; error?: string }>>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

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
    setBusy('save'); setMsg(null);
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
    setBusy('trigger'); setMsg(null); setTriggerResults(null);
    try {
      const d = await postJson<{ results: typeof triggerResults; ranAt: string }>(
        '/api/admin/scheduler/trigger', {});
      setTriggerResults(d.results);
      setMsg({ kind: 'ok', text: `已跑完,记录于 ${new Date(d.ranAt).toLocaleString('zh-CN')}` });
      // Reload config to update lastRunAt / lastResult.
      try {
        const refreshed = await fetch('/api/admin/scheduler').then((r) => r.json());
        if (refreshed.ok) setCfg(refreshed.data);
      } catch { /* swallow */ }
      refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const taskKeys = Object.keys(TASK_LABELS) as Array<keyof typeof TASK_LABELS>;
  const lastRunAt = cfg.lastRunAt ? new Date(cfg.lastRunAt).toLocaleString('zh-CN') : '—';
  const lastResult = cfg.lastResult ?? '—';
  const hasError = cfg.lastResult && cfg.lastResult.includes('✗');

  return (
    <div className="space-y-4 max-w-2xl">
      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-green-700' : 'text-seal'}`}>
          {msg.text}
        </p>
      )}

      {/* Status */}
      <div className="card-paper rounded-lg p-4 space-y-2">
        <h2 className="text-sm font-semibold text-ink-soft">状态</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-faint">开关</div>
            <div className="font-mono">
              {cfg.enabled
                ? <span className="text-green-700 inline-flex items-center gap-1"><Power className="h-3.5 w-3.5" />运行中</span>
                : <span className="text-ink-soft inline-flex items-center gap-1"><Power className="h-3.5 w-3.5" />已停止</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">上次执行</div>
            <div className="font-mono text-xs">{lastRunAt}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">执行结果</div>
            <div className={`text-xs break-all ${hasError ? 'text-seal' : 'text-ink-soft'}`}>
              {lastResult}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="card-paper rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-soft">启用定时器</h2>
            <p className="text-xs text-ink-faint">
              启动后,服务器进程会按所选间隔自动跑下面勾选的任务。
            </p>
          </div>
          <ToggleSwitch
            checked={cfg.enabled}
            disabled={busy !== null}
            onChange={(v) => void update({ enabled: v })}
          />
        </div>

        <div>
          <label className="text-sm font-medium flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />间隔
          </label>
          <select
            value={cfg.intervalMin}
            onChange={(e) => void update({ intervalMin: Number(e.target.value) })}
            disabled={busy !== null}
            className="ml-2 mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {INTERVAL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-ink-soft mb-2">启用任务</h2>
          <div className="space-y-2">
            {taskKeys.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg[k]}
                  disabled={busy !== null}
                  onChange={(e) => void update({ [k]: e.target.checked } as Partial<SchedulerConfig>)}
                  className="h-4 w-4"
                />
                {TASK_LABELS[k]}
              </label>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-paper-warm">
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={busy !== null}
            className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            {busy === 'trigger' ? '执行中…' : '立即跑一次'}
          </button>
        </div>
      </div>

      {/* Trigger results */}
      {triggerResults && (
        <div className="card-paper rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-semibold text-ink-soft">本次执行结果</h2>
          {triggerResults.length === 0 && <p className="text-xs text-ink-faint">无任务可执行 (未勾选任何任务)</p>}
          <ul className="space-y-1 text-sm">
            {triggerResults.map((r) => (
              <li key={r.name} className="font-mono text-xs">
                <span className={r.ok ? 'text-green-700' : 'text-seal'}>{r.ok ? '✓' : '✗'}</span>
                {' '}<span className="text-ink-soft">{r.name}:</span> {r.summary}
                {r.error && <span className="text-seal"> — {r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* External cron hint */}
      <div className="card-paper rounded-lg p-4 space-y-1 text-xs text-ink-soft">
        <h2 className="text-sm font-semibold text-ink-soft">外部 cron 兜底</h2>
        <p>在 Vercel / serverless 部署中,setInterval 不一定生效。请用外部 cron 调:</p>
        <pre className="bg-paper-deep p-2 rounded text-xs overflow-x-auto">
{`curl -X POST https://YOUR_DOMAIN/api/admin/scheduler/trigger \\
  -H "Cookie: <admin session>"`}
        </pre>
        <p>需要登录态。生产环境建议配合 admin Bearer Token (未来扩展)。</p>
      </div>

      {hasError && (
        <p className="text-xs text-seal inline-flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />上次执行有任务失败,见上方「执行结果」。
        </p>
      )}
      {!hasError && cfg.lastResult && (
        <p className="text-xs text-green-700 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />上次执行全部成功。
        </p>
      )}
    </div>
  );
}

function ToggleSwitch({ checked, disabled, onChange }: {
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
        checked ? 'bg-green-600' : 'bg-ink-faint/40'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-paper transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
