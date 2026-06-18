/**
 * Server-side scheduler singleton.
 *
 * - Reads scheduler.* keys from app_config on boot.
 * - If enabled, starts a setInterval that ticks every intervalMin minutes.
 * - On each tick, runs every enabled task and records the result via
 *   recordSchedulerRun().
 * - Re-reads config before every tick (so admin UI changes take effect
 *   within one tick, no need for a server restart).
 * - One scheduler per process; safe to call bootstrapScheduler() multiple
 *   times (idempotent).
 *
 * The setInterval pattern works in a long-running Next.js server process.
 * For serverless / Vercel deployments, callers should hit the
 * /api/admin/scheduler/trigger endpoint via external cron.
 */
import { readSchedulerConfig, recordSchedulerRun, type SchedulerConfig } from './scheduler-config';
import { ALL_TASKS, runTask, type TaskName, type TaskResult } from './scheduler-tasks';

declare global {
  // eslint-disable-next-line no-var
  var __pinYinSchedulerState:
    | { timer: NodeJS.Timeout | null; config: SchedulerConfig; running: boolean }
    | undefined;
}

function initState(): { timer: NodeJS.Timeout | null; config: SchedulerConfig; running: boolean } {
  return { timer: null, config: { ...defaultConfig() }, running: false };
}

function defaultConfig(): SchedulerConfig {
  return {
    enabled: false,
    intervalMin: 60,
    lastRunAt: null,
    lastResult: null,
    taskContentRefresh: true,
    taskDailyChar: true,
    taskStatsRefresh: true,
  };
}

function enabledTasks(cfg: SchedulerConfig): TaskName[] {
  const out: TaskName[] = [];
  if (cfg.taskContentRefresh) out.push('content-refresh');
  if (cfg.taskDailyChar) out.push('daily-char');
  if (cfg.taskStatsRefresh) out.push('stats-refresh');
  return out;
}

async function runTick(cfg: SchedulerConfig): Promise<void> {
  const tasks = enabledTasks(cfg);
  if (tasks.length === 0) {
    await recordSchedulerRun('no tasks enabled — skipped');
    return;
  }
  const results: TaskResult[] = [];
  for (const name of tasks) {
    try {
      results.push(await runTask(name));
    } catch (e) {
      results.push({
        name,
        ok: false,
        summary: 'unhandled exception',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const summary = results
    .map((r) => `${r.ok ? '✓' : '✗'} ${r.name}: ${r.summary}`)
    .join(' | ');
  await recordSchedulerRun(summary);
}

function scheduleInterval(state: { timer: NodeJS.Timeout | null; config: SchedulerConfig; running: boolean }, intervalMs: number) {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.timer = setInterval(async () => {
    if (state.running) return; // skip overlapping ticks
    state.running = true;
    try {
      // Re-read config so admin can change interval/tasks live.
      const live = await readSchedulerConfig();
      state.config = live;
      if (!live.enabled) {
        // Disabled while running — clear interval and stop.
        if (state.timer) {
          clearInterval(state.timer);
          state.timer = null;
        }
        return;
      }
      await runTick(live);
    } catch (e) {
      console.error('[scheduler] tick failed', e);
      try {
        await recordSchedulerRun(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
      } catch { /* swallow */ }
    } finally {
      state.running = false;
    }
  }, intervalMs);
  // Don't keep the Node process alive solely for the scheduler.
  state.timer.unref?.();
}

export async function bootstrapScheduler(): Promise<void> {
  if (!globalThis.__pinYinSchedulerState) {
    globalThis.__pinYinSchedulerState = initState();
  }
  const state = globalThis.__pinYinSchedulerState;
  let cfg: SchedulerConfig;
  try {
    cfg = await readSchedulerConfig();
  } catch (e) {
    console.warn('[scheduler] bootstrap read config failed — scheduler disabled:', e);
    return;
  }
  state.config = cfg;
  if (!cfg.enabled) return;
  const intervalMs = Math.max(1, cfg.intervalMin) * 60_000;
  scheduleInterval(state, intervalMs);
  console.log(`[scheduler] enabled — interval=${cfg.intervalMin}min tasks=${ALL_TASKS.join(',')}`);
}

/** Run all enabled tasks right now, regardless of interval. Used by manual trigger. */
export async function runSchedulerNow(cfg?: SchedulerConfig): Promise<TaskResult[]> {
  const state = globalThis.__pinYinSchedulerState ?? initState();
  globalThis.__pinYinSchedulerState = state;
  const useCfg = cfg ?? state.config;
  const tasks = enabledTasks(useCfg);
  const results: TaskResult[] = [];
  for (const name of tasks) {
    try {
      results.push(await runTask(name));
    } catch (e) {
      results.push({
        name,
        ok: false,
        summary: 'unhandled exception',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const summary = results
    .map((r) => `${r.ok ? '✓' : '✗'} ${r.name}: ${r.summary}`)
    .join(' | ');
  try { await recordSchedulerRun(summary); } catch { /* swallow */ }
  return results;
}
