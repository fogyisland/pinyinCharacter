/**
 * Scheduler task implementations.
 *
 * Each task returns a TaskResult so the runner can build a human-readable
 * summary. Tasks must be idempotent and never throw out — the runner
 * catches per-task errors and records them via recordSchedulerRun().
 *
 * The 3 default tasks (controlled by scheduler.task_* keys):
 *   - contentRefresh:    re-runs contentSync in --missing mode (light-touch)
 *   - dailyCharRefresh:  pre-warms today's daily-char + tomorrow's
 *   - statsRefresh:      runs getSystemStats to validate DB connectivity
 */
import { contentSync } from '../scripts/content-sync';
import { getDailyChar } from './rare-chars';
import { getSystemStats } from './admin';

export type TaskName = 'content-refresh' | 'daily-char' | 'stats-refresh';

export interface TaskResult {
  name: TaskName;
  ok: boolean;
  summary: string;
  error?: string;
}

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tomorrowStr(d = new Date()): string {
  const t = new Date(d.getTime() + 86400_000);
  return todayStr(t);
}

export async function runContentRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const stats = await contentSync({ missing: true, writeDb: false, concurrency: 2 });
  const ms = Date.now() - t0;
  const ok = stats.errors === 0;
  return {
    name: 'content-refresh',
    ok,
    summary: `scanned=${stats.scanned} generated=${stats.generated} skipped=${stats.skipped} errors=${stats.errors} (${ms}ms)`,
    ...(ok ? {} : { error: `${stats.errors} field(s) failed` }),
  };
}

export async function runDailyCharRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const today = await getDailyChar(todayStr());
  const tomorrow = await getDailyChar(tomorrowStr());
  const ms = Date.now() - t0;
  if (!today || !tomorrow) {
    return {
      name: 'daily-char',
      ok: false,
      summary: `missing daily char (today=${today?.char ?? '?'} tomorrow=${tomorrow?.char ?? '?'})`,
      error: 'rare_chars table empty or pickDailyChar failed',
    };
  }
  return {
    name: 'daily-char',
    ok: true,
    summary: `today=${today.char} (${today.pinyin}) tomorrow=${tomorrow.char} (${tomorrow.pinyin}) (${ms}ms)`,
  };
}

export async function runStatsRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const s = await getSystemStats();
  const ms = Date.now() - t0;
  return {
    name: 'stats-refresh',
    ok: true,
    summary: `users=${s.users} admins=${s.admins} history=${s.history} favorites=${s.favorites} audit=${s.audit} (${ms}ms)`,
  };
}

export async function runTask(name: TaskName): Promise<TaskResult> {
  switch (name) {
    case 'content-refresh': return runContentRefresh();
    case 'daily-char':      return runDailyCharRefresh();
    case 'stats-refresh':   return runStatsRefresh();
  }
}

export const ALL_TASKS: TaskName[] = ['content-refresh', 'daily-char', 'stats-refresh'];
