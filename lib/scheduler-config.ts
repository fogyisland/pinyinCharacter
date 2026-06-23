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

// Per-task history. Each task in a run gets its own row; run_id groups them.

export type SchedulerHistoryTaskName = 'content-refresh' | 'daily-char' | 'stats-refresh';

export interface SchedulerHistoryRow {
  id: number;
  runId: string;
  taskName: SchedulerHistoryTaskName;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  summary: string | null;
  error: string | null;
}

export interface SchedulerRunGroup {
  runId: string;
  startedAt: string;
  tasks: SchedulerHistoryRow[];
}

export interface RecordTaskRunArgs {
  runId: string;
  taskName: SchedulerHistoryTaskName;
  startedAt: Date;
  finishedAt?: Date | null;
  ok: boolean;
  summary?: string | null;
  error?: string | null;
}

/** Insert one row per task per run. Fire-and-forget at the call site if needed. */
export async function recordTaskRun(args: RecordTaskRunArgs): Promise<void> {
  const pool = getPool();
  const truncate = (s: string | null | undefined, n: number) => {
    if (!s) return null;
    return s.length > n ? s.slice(0, n - 3) + '...' : s;
  };
  await pool.query(
    `INSERT INTO scheduler_run_history
       (run_id, task_name, started_at, finished_at, ok, summary, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      args.runId,
      args.taskName,
      args.startedAt,
      args.finishedAt ?? null,
      args.ok ? 1 : 0,
      truncate(args.summary, 512),
      truncate(args.error, 1024),
    ],
  );
}

/** Fetch the most recent N runs, each with its task rows. */
export async function getSchedulerRunHistory(limit: number = 20): Promise<SchedulerRunGroup[]> {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const [runRows] = await pool.query<any[]>(
    `SELECT run_id, MAX(started_at) AS started_at
     FROM scheduler_run_history
     GROUP BY run_id
     ORDER BY MAX(started_at) DESC
     LIMIT ?`,
    [safeLimit],
  );
  if (runRows.length === 0) return [];
  const runIds = runRows.map((r: any) => r.run_id);
  const placeholders = runIds.map(() => '?').join(',');
  const [taskRows] = await pool.query<any[]>(
    `SELECT id, run_id, task_name, started_at, finished_at, ok, summary, error
     FROM scheduler_run_history
     WHERE run_id IN (${placeholders})
     ORDER BY run_id DESC, started_at ASC`,
    runIds,
  );
  const byRun = new Map<string, SchedulerHistoryRow[]>();
  for (const r of taskRows) {
    const row: SchedulerHistoryRow = {
      id: Number(r.id),
      runId: r.run_id,
      taskName: r.task_name,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at),
      finishedAt: r.finished_at == null ? null : (r.finished_at instanceof Date ? r.finished_at.toISOString() : String(r.finished_at)),
      ok: r.ok === 1 || r.ok === true,
      summary: r.summary,
      error: r.error,
    };
    const list = byRun.get(r.run_id) ?? [];
    list.push(row);
    byRun.set(r.run_id, list);
  }
  return runRows.map((rr: any) => ({
    runId: rr.run_id,
    startedAt: rr.started_at instanceof Date ? rr.started_at.toISOString() : String(rr.started_at),
    tasks: byRun.get(rr.run_id) ?? [],
  }));
}

/** A run id unique enough for grouping — short iso timestamp + random. */
export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
