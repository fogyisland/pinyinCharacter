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
 *  1. **One clock.** Every timestamp in this table — the row columns *and*
 *     the per-line timestamps in the log — is produced by MySQL (`NOW()`,
 *     `DATE_FORMAT(NOW(), …)`, or the column defaults), never by
 *     JavaScript. The row mapper turns MySQL's `Date` into an ISO string on
 *     the way out, so the API shape matches the other admin endpoints.
 *  2. **The log is append-only.** `appendLog` concatenates in SQL
 *     (`log = CONCAT(log, DATE_FORMAT(NOW(), …), ' ', ?)`): a
 *     read-modify-write would lose concurrent appends and cost a round trip
 *     per line.
 *
 * All SQL for this table lives here — other modules go through these
 * functions.
 */
import 'server-only';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  isWebfontJobsTableMissing,
  WebfontSchemaMissingError,
} from '@/lib/webfont/schema-errors';

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

/**
 * Runs one statement against the job table and translates a missing table
 * into a named error.
 *
 * Every read and write of this table goes through here, so the
 * "the schema has not caught up" case is recognised in exactly one place.
 * Without it, `ER_NO_SUCH_TABLE` escapes as a driver error and — on the
 * admin page, which is a server component — becomes an RSC render error
 * whose message a production build strips, leaving the administrator with
 * "An error occurred in the Server Components render" and no way to act.
 *
 * Any other driver error is re-thrown untouched: this is a translation,
 * not a filter, and a caller must still see a connection failure as a
 * connection failure.
 */
async function runJobQuery<T extends ResultSetHeader | RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
): Promise<[T, unknown]> {
  try {
    return (await getPool().query<T>(sql, params)) as [T, unknown];
  } catch (error) {
    if (isWebfontJobsTableMissing(error)) {
      throw new WebfontSchemaMissingError(TABLE);
    }
    throw error;
  }
}

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
 *
 * It is a `Map`, not a plain object: a plain object's lookup walks
 * `Object.prototype`, so `PATCH_COLUMNS['constructor']` hands back the
 * inherited function and would put `function Object() { [native code] }`
 * into the SQL as a column name. The whitelist has to be complete, not
 * merely type-checked.
 */
const PATCH_COLUMNS = new Map<string, string>([
  ['status', 'status'],
  ['step', 'step'],
  ['stepProgress', 'step_progress'],
  ['message', 'message'],
  ['error', 'error'],
  ['log', 'log'],
  ['manifestVersion', 'manifest_version'],
  ['releaseDir', 'release_dir'],
  ['startedBy', 'started_by'],
  ['updatedAt', 'updated_at'],
  ['finishedAt', 'finished_at'],
]);

/**
 * The columns the database cannot hold as they are, by column name: the
 * maximum number of code points the column can store.
 *
 * `step_progress` is `VARCHAR(8)` and `message` is `VARCHAR(500)`, and
 * MySQL runs in strict mode: a longer value is not truncated, it raises
 * `ER_DATA_TOO_LONG` and the whole update fails. The pipeline's own
 * example text（「切分第 2/3 族」）is 9 code points, so this is not
 * hypothetical.
 *
 * One table, one mechanism: every column listed here is clamped by the
 * same loop in `updateJob`, so a column added later is covered as soon as
 * it is listed here.
 */
const COLUMN_MAX_CODE_POINTS = new Map<string, number>([
  ['step_progress', 8],
  ['message', 500],
]);

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

/**
 * The cached stale-job sweep.
 *
 * It lives on `globalThis`, not in a module-level variable: in `next dev`
 * a module-level variable is re-initialised on every Fast Refresh, so the
 * sweep would run again on every hot reload. `globalThis` is per-process,
 * so the cache survives a recompile — the same fix the /init wizard's
 * credential store needed.
 */
interface WebfontGlobal {
  __pinyinWebfontStaleJobsSweep?: Promise<void>;
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
  await runJobQuery(
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
  const [rows] = await runJobQuery<WebfontJobRow[]>(
    `SELECT ${JOB_COLUMNS} FROM ${TABLE} WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length ? rowToJob(rows[0]) : null;
}

/** The most recent jobs, newest first. */
export async function listJobs(limit: number = DEFAULT_JOB_LIST_LIMIT): Promise<WebfontJob[]> {
  const [rows] = await runJobQuery<WebfontJobRow[]>(
    `SELECT ${JOB_COLUMNS} FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`,
    [normalizeLimit(limit, DEFAULT_JOB_LIST_LIMIT, MAX_JOB_LIST_LIMIT)],
  );
  return rows.map(rowToJob);
}

/**
 * Appends one line to the job's log.
 *
 * The concatenation happens in SQL, so two concurrent appends cannot lose
 * each other's line, and the timestamp on the line is MySQL's — the same
 * clock that stamps the row's columns. One call appends one line: a caller
 * that has a multi-line chunk calls this once per line.
 */
export async function appendLog(id: string, line: string): Promise<void> {
  await runJobQuery(
    `UPDATE ${TABLE}
        SET log = CONCAT(log, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'), ' ', ?)
      WHERE id = ?`,
    [logLineBody(line), id],
  );
}

/**
 * Updates the fields the caller passed — and only those.
 *
 * The `SET` clause is built from the keys of `patch`, so a caller that
 * only moves the job to the next step can never wipe the status (or any
 * other column it did not mention).
 *
 * A value that is longer than its column can hold is clamped to the
 * column's width (see {@link COLUMN_MAX_CODE_POINTS}) — MySQL runs in
 * strict mode and would reject the whole update with
 * `ER_DATA_TOO_LONG`. The truncation is not silent: it is written to the
 * job's run log.
 */
export async function updateJob(
  id: string,
  patch: Partial<Omit<WebfontJob, 'id' | 'createdAt'>>,
): Promise<void> {
  const sets: string[] = [];
  const params: SqlParam[] = [];
  const truncations: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = PATCH_COLUMNS.get(key);
    if (column === undefined) {
      // Thrown before any statement is sent: an unknown key must never
      // reach the SQL text.
      throw new Error(`Unknown webfont job field: ${key}`);
    }
    if (TIMESTAMP_COLUMNS.has(column)) {
      sets.push(value === null ? `${column} = NULL` : `${column} = NOW()`);
      continue;
    }

    const limit = COLUMN_MAX_CODE_POINTS.get(column);
    let finalValue = value;
    if (limit !== undefined && typeof value === 'string') {
      const codePoints = Array.from(value);
      if (codePoints.length > limit) {
        finalValue = codePoints.slice(0, limit).join('');
        truncations.push(
          `${column} 超过 ${limit} 个字符，已截断（原文 ${codePoints.length} 个字符）`,
        );
      }
    }
    sets.push(`${column} = ?`);
    params.push(finalValue);
  }

  if (sets.length === 0) return;
  params.push(id);
  await runJobQuery(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, params);

  // A truncation is never silent: it goes into the run log, which the
  // admin page shows.
  for (const note of truncations) {
    await appendLog(id, note);
  }
}

/**
 * The active job, if there is one.
 *
 * `pending` and `running` are active; `done`, `failed` and `cancelled` are
 * history. This is the database half of the "one build at a time" gate
 * (design §3.2) — the API answers 409 with this job's id.
 */
export async function findActiveJob(): Promise<WebfontJob | null> {
  const [rows] = await runJobQuery<WebfontJobRow[]>(
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
  const limit = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 0;

  const [rows] = await runJobQuery<JobIdRow[]>(
    `SELECT id FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  const keptIds = rows.map((r) => r.id);

  if (keptIds.length === 0) {
    // Nothing to keep — every log goes, no row is deleted.
    const [result] = await runJobQuery<ResultSetHeader>(`UPDATE ${TABLE} SET log = ''`);
    return affectedRows(result);
  }

  const placeholders = keptIds.map(() => '?').join(', ');
  const [result] = await runJobQuery<ResultSetHeader>(
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
  const [result] = await runJobQuery<ResultSetHeader>(
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
 * The **promise** is cached, not a boolean: a boolean that is set before
 * the sweep runs lets a concurrent caller return while the rows are still
 * `running` — exactly the "the page spins forever" failure mode. Caching
 * the promise makes concurrent callers wait for the same sweep; the sweep
 * itself still runs once per process.
 *
 * The cache lives on `globalThis` (see {@link WebfontGlobal}): a
 * module-level variable would be re-initialised on every dev hot reload.
 *
 * If the sweep fails the cache is dropped — a sweep that did not happen
 * must be retried, otherwise a transient database outage at boot would
 * leave `running` jobs stuck.
 */
export async function ensureStaleJobsMarked(): Promise<void> {
  const running = globalScope.__pinyinWebfontStaleJobsSweep;
  if (running) {
    // A sweep is already running (or has run): wait for THAT one, so this
    // caller never returns while a stale job is still `running`.
    await running;
    return;
  }
  const sweep = markStaleRunningJobsFailed().then(() => undefined);
  globalScope.__pinyinWebfontStaleJobsSweep = sweep;
  try {
    await sweep;
  } catch (error) {
    if (globalScope.__pinyinWebfontStaleJobsSweep === sweep) {
      delete globalScope.__pinyinWebfontStaleJobsSweep;
    }
    throw error;
  }
}

/**
 * One log line: the text without its trailing newline, plus the newline.
 *
 * The newline is the framing of "this is one line"; the timestamp on the
 * line is MySQL's, not ours.
 */
function logLineBody(line: string): string {
  return `${line.replace(/\r?\n$/, '')}\n`;
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
