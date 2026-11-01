/**
 * Server-only: the webfont build job table (`webfont_build_jobs`).
 *
 * One row per build attempt of the admin font pipeline (design §4). The row
 * is the cross-process truth for "is a build already running?" — the
 * in-process `globalThis` mutex is only the fast path (design §3.2). It also
 * survives a process restart, which is what lets the startup sweep fail a
 * job that died mid-build instead of leaving it `running` forever.
 *
 * Two invariants this module keeps:
 *
 *  1. **One clock.** Every timestamp in this table is produced by MySQL
 *     (`NOW()`, or the column defaults) — never by JavaScript. The row
 *     mapper turns MySQL's `Date` into an ISO string on the way out, so the
 *     API shape matches the other admin endpoints.
 *  2. **The log is append-only.** `appendLog` concatenates in SQL
 *     (`log = CONCAT(log, ?)`): a read-modify-write would lose concurrent
 *     appends and cost a round trip per line.
 *
 * All SQL for this table lives here — other modules go through these
 * functions.
 */
import 'server-only';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/** The lifecycle of a build job (design §4). */
export type WebfontJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** The pipeline steps (design §3.3); `''` means "not started yet". */
export type WebfontJobStep = '' | 'download' | 'instance' | 'subset' | 'verify' | 'apply';

/** A build job as the admin API exposes it. */
export interface WebfontJob {
  id: string;
  status: WebfontJobStatus;
  step: WebfontJobStep;
  stepProgress: string;
  message: string;
  error: string | null;
  log: string;
  manifestVersion: string;
  releaseDir: string;
  startedBy: number | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** A row as mysql2 hands it back (the DATETIME columns arrive as Date). */
interface WebfontJobRow extends RowDataPacket {
  id: string;
  status: WebfontJobStatus;
  step: WebfontJobStep;
  step_progress: string;
  message: string;
  error: string | null;
  log: string;
  manifest_version: string;
  release_dir: string;
  started_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

/** A row of the id-only projection used by the log purge. */
interface JobIdRow extends RowDataPacket {
  id: string;
}

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

const TABLE = 'webfont_build_jobs';

/** The columns every read of the table selects, in the interface's order. */
const JOB_COLUMNS =
  'id, status, step, step_progress, message, error, log, ' +
  'manifest_version, release_dir, started_by, created_at, updated_at, finished_at';

/**
 * The columns a caller may patch, by their interface name.
 *
 * This is the whitelist that keeps a caller-supplied key out of the SQL
 * text: the values always travel as placeholders, the column names only
 * come from here.
 */
const PATCH_COLUMNS: Record<string, string> = {
  status: 'status',
  step: 'step',
  stepProgress: 'step_progress',
  message: 'message',
  error: 'error',
  log: 'log',
  manifestVersion: 'manifest_version',
  releaseDir: 'release_dir',
  startedBy: 'started_by',
  updatedAt: 'updated_at',
  finishedAt: 'finished_at',
};

/**
 * The columns that hold a point in time.
 *
 * Their value comes from MySQL (`NOW()`), never from JavaScript: MySQL 5.7
 * cannot parse an ISO-8601 string into a DATETIME column, and one clock for
 * the whole table keeps `created_at` (a column default) and `finished_at`
 * (written here) comparable. A patch therefore says *whether* the column is
 * set, not *when*: a non-null value stamps it with the current time, `null`
 * clears it.
 */
const TIMESTAMP_COLUMNS = new Set(['updated_at', 'finished_at']);

/** The job list endpoint shows the last 10 jobs (design §5). */
const DEFAULT_JOB_LIST_LIMIT = 10;

/** Upper bound for a caller-supplied limit, so a typo cannot pull the table. */
const MAX_JOB_LIST_LIMIT = 200;

/** What the admin page shows when a job died with the process. */
const STALE_JOB_MESSAGE = '构建因进程中断而终止';

/** The error text of a job that died with the process (design §7, risk 3). */
const STALE_JOB_ERROR =
  '进程中断：服务进程在构建过程中被重启，作业已被标记为失败，请重新开始构建。';

/** Matches a timestamp prefix this module (or the caller) already added. */
const LOG_TIMESTAMP_PREFIX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/;

/**
 * The "stale jobs already swept" flag.
 *
 * It lives on `globalThis`, not in a module-level variable: in `next dev`
 * a module-level flag is re-initialised on every Fast Refresh, so the
 * sweep would run again on every hot reload. `globalThis` is per-process,
 * so the flag survives a recompile — the same fix the /init wizard's
 * credential store needed.
 */
interface WebfontGlobal {
  __pinyinWebfontStaleJobsMarked?: boolean;
}

const globalScope = globalThis as typeof globalThis & WebfontGlobal;

/**
 * Creates a job row. The id is a short random string supplied by the caller
 * (it shows up in URLs and in the log); `startedBy` is the admin who asked
 * for the build.
 *
 * `created_at` / `updated_at` are left to the column defaults — the
 * database stamps them.
 */
export async function createJob(input: {
  id: string;
  startedBy: number | null;
}): Promise<WebfontJob> {
  await getPool().query(
    `INSERT INTO ${TABLE} (id, status, step, step_progress, message, log, started_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.id, 'pending', '', '', '', '', input.startedBy],
  );
  const job = await getJob(input.id);
  if (!job) {
    throw new Error(`Webfont job ${input.id} was inserted but could not be read back`);
  }
  return job;
}

/** Reads one job, or null when there is no such row. */
export async function getJob(id: string): Promise<WebfontJob | null> {
  const [rows] = await getPool().query<WebfontJobRow[]>(
    `SELECT ${JOB_COLUMNS} FROM ${TABLE} WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length ? rowToJob(rows[0]) : null;
}

/** The most recent jobs, newest first. */
export async function listJobs(limit: number = DEFAULT_JOB_LIST_LIMIT): Promise<WebfontJob[]> {
  const [rows] = await getPool().query<WebfontJobRow[]>(
    `SELECT ${JOB_COLUMNS} FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`,
    [normalizeLimit(limit, DEFAULT_JOB_LIST_LIMIT, MAX_JOB_LIST_LIMIT)],
  );
  return rows.map(rowToJob);
}

/**
 * Appends one line to the job's log.
 *
 * The concatenation happens in SQL, so two concurrent appends cannot lose
 * each other's line. The line is stamped with a timestamp and terminated by
 * a newline; a line that already carries a timestamp is left as it is, so
 * the caller may stamp it itself.
 */
export async function appendLog(id: string, line: string): Promise<void> {
  await getPool().query(`UPDATE ${TABLE} SET log = CONCAT(log, ?) WHERE id = ?`, [
    stampLogLine(line),
    id,
  ]);
}

/**
 * Updates the fields the caller passed — and only those.
 *
 * The `SET` clause is built from the keys of `patch`, so a caller that
 * only moves the job to the next step can never wipe the status (or any
 * other column it did not mention).
 */
export async function updateJob(
  id: string,
  patch: Partial<Omit<WebfontJob, 'id' | 'createdAt'>>,
): Promise<void> {
  const sets: string[] = [];
  const params: SqlParam[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = PATCH_COLUMNS[key];
    if (!column) {
      throw new Error(`Unknown webfont job field: ${key}`);
    }
    if (TIMESTAMP_COLUMNS.has(column)) {
      sets.push(value === null ? `${column} = NULL` : `${column} = NOW()`);
      continue;
    }
    sets.push(`${column} = ?`);
    params.push(value);
  }

  if (sets.length === 0) return;
  params.push(id);
  await getPool().query(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * The active job, if there is one.
 *
 * `pending` and `running` are active; `done`, `failed` and `cancelled` are
 * history. This is the database half of the "one build at a time" gate
 * (design §3.2) — the API answers 409 with this job's id.
 */
export async function findActiveJob(): Promise<WebfontJob | null> {
  const [rows] = await getPool().query<WebfontJobRow[]>(
    `SELECT ${JOB_COLUMNS} FROM ${TABLE}
      WHERE status IN ('pending','running')
      ORDER BY created_at DESC LIMIT 1`,
  );
  return rows.length ? rowToJob(rows[0]) : null;
}

/**
 * Empties the log of the jobs outside the retention window.
 *
 * The unit is the **job**, not the log row: the most recent `keep` jobs
 * keep their full transcript, every older job has its `log` column emptied
 * — its row stays, so the metadata (status, version, timestamps) survives.
 * The log is never deleted.
 *
 * Returns the number of jobs whose log was emptied.
 */
export async function clearOldJobLogs(keep: number): Promise<number> {
  const pool = getPool();
  const limit = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 0;

  const [rows] = await pool.query<JobIdRow[]>(
    `SELECT id FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  const keptIds = rows.map((r) => r.id);

  if (keptIds.length === 0) {
    // Nothing to keep — every log goes, no row is deleted.
    const [result] = await pool.query<ResultSetHeader>(`UPDATE ${TABLE} SET log = ''`);
    return affectedRows(result);
  }

  const placeholders = keptIds.map(() => '?').join(', ');
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE ${TABLE} SET log = '' WHERE id NOT IN (${placeholders})`,
    keptIds,
  );
  return affectedRows(result);
}

/**
 * Fails the jobs that were still running when the process died.
 *
 * A job left in `running` by a restart would keep the admin page spinning
 * forever, so the startup sweep marks it `failed` with an error that says
 * the process was interrupted. Only `running` rows are touched — a
 * `pending` job never started.
 *
 * Returns the number of jobs that were marked.
 */
export async function markStaleRunningJobsFailed(): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE ${TABLE}
        SET status = 'failed',
            message = ?,
            error = ?,
            finished_at = NOW()
      WHERE status = 'running'`,
    [STALE_JOB_MESSAGE, STALE_JOB_ERROR],
  );
  return affectedRows(result);
}

/**
 * Runs {@link markStaleRunningJobsFailed} once per process.
 *
 * The flag lives on `globalThis` (see {@link WebfontGlobal}): a
 * module-level flag would be re-initialised on every dev hot reload, and
 * the sweep would run again and again. If the sweep fails the flag is
 * cleared again — a sweep that did not happen must be retried, otherwise a
 * transient database outage at boot would leave `running` jobs stuck.
 */
export async function ensureStaleJobsMarked(): Promise<void> {
  if (globalScope.__pinyinWebfontStaleJobsMarked) return;
  globalScope.__pinyinWebfontStaleJobsMarked = true;
  try {
    await markStaleRunningJobsFailed();
  } catch (error) {
    globalScope.__pinyinWebfontStaleJobsMarked = false;
    throw error;
  }
}

/** Frames one log line: timestamp prefix, text, newline. */
function stampLogLine(line: string): string {
  const text = line.replace(/\r?\n$/, '');
  if (LOG_TIMESTAMP_PREFIX.test(text)) {
    return `${text}\n`;
  }
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `[${stamp}] ${text}\n`;
}

/** Clamps a caller-supplied row limit to a sane integer. */
function normalizeLimit(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/** The number of rows the statement touched. */
function affectedRows(result: ResultSetHeader): number {
  return Number(result?.affectedRows ?? 0);
}

/** Maps a database row to the shape the admin API returns. */
function rowToJob(row: WebfontJobRow): WebfontJob {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    stepProgress: row.step_progress,
    message: row.message,
    error: row.error,
    log: row.log,
    manifestVersion: row.manifest_version,
    releaseDir: row.release_dir,
    startedBy: row.started_by === null ? null : Number(row.started_by),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    finishedAt: row.finished_at === null ? null : toIsoString(row.finished_at),
  };
}

/**
 * MySQL's DATETIME as an ISO string. A `Date` (what mysql2 returns) is
 * converted directly; a string is parsed first, so a pool configured with
 * `dateStrings` still produces the same ISO shape.
 */
function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
