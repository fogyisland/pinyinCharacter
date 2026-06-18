/**
 * Scheduler config + history. All values live in the app_config table as
 * stringified scalars. We use a fixed schema (no KEY_VALIDATORS) because
 * the scheduler is opt-in and not part of the user-facing KEY_VALIDATORS
 * set in lib/config.ts (which would reject these keys on dashboard save).
 */
import { getPool } from './db';

export const SCHEDULER_KEYS = {
  enabled: 'scheduler.enabled',
  intervalMin: 'scheduler.interval_min',
  lastRunAt: 'scheduler.last_run_at',
  lastResult: 'scheduler.last_result',
  taskContentRefresh: 'scheduler.task_content_refresh',
  taskDailyChar: 'scheduler.task_daily_char',
  taskStatsRefresh: 'scheduler.task_stats_refresh',
} as const;

export interface SchedulerConfig {
  enabled: boolean;
  intervalMin: number;
  lastRunAt: string | null;
  lastResult: string | null;
  taskContentRefresh: boolean;
  taskDailyChar: boolean;
  taskStatsRefresh: boolean;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMin: 60,
  lastRunAt: null,
  lastResult: null,
  taskContentRefresh: true,
  taskDailyChar: true,
  taskStatsRefresh: true,
};

const DEFAULTS: Record<string, string> = {
  [SCHEDULER_KEYS.enabled]: '0',
  [SCHEDULER_KEYS.intervalMin]: '60',
  [SCHEDULER_KEYS.taskContentRefresh]: '1',
  [SCHEDULER_KEYS.taskDailyChar]: '1',
  [SCHEDULER_KEYS.taskStatsRefresh]: '1',
};

export async function readSchedulerConfig(): Promise<SchedulerConfig> {
  const [rows] = await getPool().query<any[]>(
    `SELECT \`key\`, value FROM app_config WHERE \`key\` LIKE 'scheduler.%'`,
  );
  const out: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return {
    enabled: out[SCHEDULER_KEYS.enabled] === '1',
    intervalMin: Math.max(1, Math.min(24 * 60, parseInt(out[SCHEDULER_KEYS.intervalMin], 10) || 60)),
    lastRunAt: out[SCHEDULER_KEYS.lastRunAt] || null,
    lastResult: out[SCHEDULER_KEYS.lastResult] || null,
    taskContentRefresh: out[SCHEDULER_KEYS.taskContentRefresh] !== '0',
    taskDailyChar: out[SCHEDULER_KEYS.taskDailyChar] !== '0',
    taskStatsRefresh: out[SCHEDULER_KEYS.taskStatsRefresh] !== '0',
  };
}

export async function writeSchedulerConfig(
  updates: Partial<Pick<SchedulerConfig, 'enabled' | 'intervalMin' | 'taskContentRefresh' | 'taskDailyChar' | 'taskStatsRefresh'>>,
  byUserId: number | null,
): Promise<void> {
  const pool = getPool();
  const set = (key: string, value: string) =>
    pool.query(
      `INSERT INTO app_config (\`key\`, value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [key, value, byUserId],
    );
  if (updates.enabled !== undefined) await set(SCHEDULER_KEYS.enabled, updates.enabled ? '1' : '0');
  if (updates.intervalMin !== undefined) {
    const n = Math.max(1, Math.min(24 * 60, Math.floor(updates.intervalMin)));
    await set(SCHEDULER_KEYS.intervalMin, String(n));
  }
  if (updates.taskContentRefresh !== undefined) await set(SCHEDULER_KEYS.taskContentRefresh, updates.taskContentRefresh ? '1' : '0');
  if (updates.taskDailyChar !== undefined) await set(SCHEDULER_KEYS.taskDailyChar, updates.taskDailyChar ? '1' : '0');
  if (updates.taskStatsRefresh !== undefined) await set(SCHEDULER_KEYS.taskStatsRefresh, updates.taskStatsRefresh ? '1' : '0');
}

export async function recordSchedulerRun(summary: string, at: Date = new Date()): Promise<void> {
  const pool = getPool();
  const set = (key: string, value: string) =>
    pool.query(
      `INSERT INTO app_config (\`key\`, value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, value, null],
    );
  // Truncate summary to keep app_config tidy.
  const trimmed = summary.length > 512 ? summary.slice(0, 509) + '...' : summary;
  await set(SCHEDULER_KEYS.lastRunAt, at.toISOString());
  await set(SCHEDULER_KEYS.lastResult, trimmed);
}
