import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The webfont build job table (`webfont_build_jobs`) — design §4.
 *
 * The database is mocked, so what is under test is not "what did the query
 * return" but "what question does the module ask the database" — the SQL
 * shape. That is exactly where the failure modes of this feature live:
 *
 *  - a job stuck in `running` after a process restart: the admin page would
 *    poll it forever (design §7, risk row 3);
 *  - a log purge that deletes rows instead of emptying the log column, which
 *    would throw away the metadata of old jobs;
 *  - an update that clobbers the columns the caller never mentioned.
 *
 * Mock shape copied from tests/unit/lib/admin-pageviews.test.ts.
 */

let queryResults: Record<string, unknown[]> = {};
let queryLog: Array<{ sql: string; params: unknown[] }> = [];
/** A test can hold the database to observe what happens while a query is
 *  still in flight. */
let queryGate: Promise<void> | null = null;

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryLog.push({ sql, params });
      if (queryGate) await queryGate;
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key];
      }
      return [[]];
    }),
  }),
}));

import {
  appendLog,
  clearOldJobLogs,
  createJob,
  ensureStaleJobsMarked,
  findActiveJob,
  getJob,
  listJobs,
  markStaleRunningJobsFailed,
  updateJob,
  type WebfontJob,
} from '@/lib/webfont/jobs';

/** A row as mysql2 hands it back (DATETIME columns arrive as Date). */
const JOB_ROW = {
  id: 'job-1',
  status: 'pending',
  step: '',
  step_progress: '',
  message: '',
  error: null,
  log: '',
  manifest_version: '',
  release_dir: '',
  started_by: 7,
  created_at: new Date('2026-11-01T08:00:00.000Z'),
  updated_at: new Date('2026-11-01T08:00:00.000Z'),
  finished_at: null,
};

beforeEach(() => {
  queryResults = {};
  queryLog = [];
  queryGate = null;
  // The stale-job sweep is cached on globalThis (per process), so a test
  // that exercises it has to start from a clean slate.
  delete (globalThis as { __pinyinWebfontStaleJobsSweep?: Promise<void> })
    .__pinyinWebfontStaleJobsSweep;
});

describe('createJob', () => {
  it('inserts one row carrying the given id and started_by', async () => {
    queryResults['FROM webfont_build_jobs'] = [[JOB_ROW]];
    await createJob({ id: 'job-1', startedBy: 7 });

    const insert = queryLog.find((q) => q.sql.includes('INSERT INTO webfont_build_jobs'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toMatch(/INSERT INTO webfont_build_jobs/i);
    expect(insert!.params).toContain('job-1');
    expect(insert!.params).toContain(7);
    // A new job starts out pending, with nothing to report yet.
    expect(insert!.params).toContain('pending');
  });

  it('lets MySQL stamp created_at / updated_at instead of JavaScript', async () => {
    queryResults['FROM webfont_build_jobs'] = [[JOB_ROW]];
    await createJob({ id: 'job-1', startedBy: null });

    const insert = queryLog.find((q) => q.sql.includes('INSERT INTO webfont_build_jobs'));
    expect(insert!.sql).not.toMatch(/created_at/);
    expect(insert!.sql).not.toMatch(/updated_at/);
    expect(insert!.params).toContain(null);
  });

  it('returns the job it just created', async () => {
    queryResults['FROM webfont_build_jobs'] = [[JOB_ROW]];
    const job = await createJob({ id: 'job-1', startedBy: 7 });
    expect(job.id).toBe('job-1');
    expect(job.status).toBe('pending');
  });
});

describe('getJob', () => {
  it('maps the row to the WebfontJob shape, with ISO timestamps', async () => {
    queryResults['FROM webfont_build_jobs'] = [[JOB_ROW]];
    const job = await getJob('job-1');
    expect(job).toEqual({
      id: 'job-1',
      status: 'pending',
      step: '',
      stepProgress: '',
      message: '',
      error: null,
      log: '',
      manifestVersion: '',
      releaseDir: '',
      startedBy: 7,
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
      finishedAt: null,
    });
  });

  it('returns null when the job does not exist', async () => {
    queryResults['FROM webfont_build_jobs'] = [[]];
    expect(await getJob('nope')).toBeNull();
  });

  it('looks the job up by id', async () => {
    await getJob('job-1');
    expect(queryLog[0].sql).toContain('WHERE id = ?');
    expect(queryLog[0].params).toEqual(['job-1']);
  });
});

describe('listJobs', () => {
  it('lists the newest jobs first and honours the limit', async () => {
    await listJobs(10);
    const q = queryLog[0];
    expect(q.sql).toContain('ORDER BY created_at DESC');
    expect(q.sql).toContain('LIMIT ?');
    expect(q.params).toEqual([10]);
  });

  it('defaults to the last 10 jobs', async () => {
    await listJobs();
    expect(queryLog[0].params).toEqual([10]);
  });
});

describe('appendLog', () => {
  it('appends in SQL (CONCAT) instead of reading the log back and rewriting it', async () => {
    await appendLog('job-1', '切分第 1/3 族');
    const q = queryLog[0];
    expect(q.sql).toContain('log = CONCAT(log,');
    // No read-modify-write: the statement must not read the column first.
    expect(q.sql).not.toMatch(/SELECT/i);
    expect(q.params[0]).toContain('切分第 1/3 族');
    expect(q.params[1]).toBe('job-1');
  });

  it('stamps the line with the database clock, not with a JavaScript timestamp', async () => {
    await appendLog('job-1', 'hello');
    const q = queryLog[0];
    // The timestamp is part of the SQL, so it comes from MySQL — the same
    // clock that stamps the row's columns.
    expect(q.sql).toContain("DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')");
    expect(q.params[0]).toBe('hello\n');
    expect(q.params[0]).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

describe('updateJob', () => {
  it('updates only the fields the caller passed', async () => {
    await updateJob('job-1', { step: 'subset' });
    const q = queryLog[0];
    expect(q.sql).toContain('UPDATE webfont_build_jobs');
    expect(q.sql).toContain('step = ?');
    // The columns the caller did not mention must stay untouched — updating
    // the step may never wipe the status.
    expect(q.sql).not.toContain('status');
    expect(q.sql).not.toContain('message');
    expect(q.sql).not.toContain('step_progress');
    expect(q.params).toEqual(['subset', 'job-1']);
  });

  it('updates every field the caller passed, in one statement', async () => {
    await updateJob('job-1', { status: 'running', step: 'download', message: '开始下载' });
    const q = queryLog[0];
    expect(q.sql).toContain('status = ?');
    expect(q.sql).toContain('step = ?');
    expect(q.sql).toContain('message = ?');
    expect(q.params).toEqual(['running', 'download', '开始下载', 'job-1']);
  });

  it('never puts a caller-supplied key into the SQL text', async () => {
    await expect(
      updateJob('job-1', { 'status = 1, log': 'x' } as unknown as Partial<WebfontJob>),
    ).rejects.toThrow();
    expect(queryLog).toHaveLength(0);
  });

  it('refuses a key that only exists on Object.prototype', async () => {
    // A plain-object whitelist would answer 'constructor' with the
    // inherited function and put it into the SQL as a column name.
    await expect(
      updateJob('job-1', { constructor: 'x' } as unknown as Partial<WebfontJob>),
    ).rejects.toThrow(/Unknown webfont job field/);
    await expect(
      updateJob('job-1', { toString: 'x' } as unknown as Partial<WebfontJob>),
    ).rejects.toThrow(/Unknown webfont job field/);
    expect(queryLog).toHaveLength(0);
  });

  it('clamps step_progress to the 8 code points the column can hold', async () => {
    // The pipeline's own example text is 9 code points; VARCHAR(8) plus
    // MySQL's strict mode would reject the whole update.
    await updateJob('job-1', { stepProgress: '切分第 2/3 族' });
    const update = queryLog.find((q) => q.sql.includes('step_progress = ?'));
    expect(update).toBeDefined();
    expect(Array.from(update!.params[0] as string)).toHaveLength(8);
  });

  it('records the truncation in the run log instead of doing it silently', async () => {
    await updateJob('job-1', { stepProgress: '切分第 2/3 族' });
    const append = queryLog.find((q) => q.sql.includes('CONCAT(log'));
    expect(append).toBeDefined();
    expect(append!.params[0]).toContain('截断');
    expect(append!.params[0]).toContain('step_progress');
  });

  it('clamps by code point, so a surrogate pair is never cut in half', async () => {
    await updateJob('job-1', { stepProgress: '😀😀😀😀😀😀😀😀😀' });
    const update = queryLog.find((q) => q.sql.includes('step_progress = ?'));
    // String.prototype.slice would have kept four emoji (8 UTF-16 units).
    expect(update!.params[0]).toBe('😀😀😀😀😀😀😀😀');
  });

  it('clamps message with the same mechanism', async () => {
    await updateJob('job-1', { message: 'x'.repeat(600) });
    const update = queryLog.find((q) => q.sql.includes('message = ?'));
    expect(update!.params[0] as string).toHaveLength(500);
    const append = queryLog.find((q) => q.sql.includes('CONCAT(log'));
    expect(append!.params[0]).toContain('截断');
  });

  it('does nothing for an empty patch', async () => {
    await updateJob('job-1', {});
    expect(queryLog).toHaveLength(0);
  });

  it('stamps the timestamp columns with the database clock', async () => {
    await updateJob('job-1', { status: 'done', finishedAt: '2026-11-01T09:00:00.000Z' });
    const q = queryLog[0];
    expect(q.sql).toContain('finished_at = NOW()');
    // MySQL's clock, never a JavaScript timestamp string.
    expect(q.params).not.toContain('2026-11-01T09:00:00.000Z');
  });
});

describe('findActiveJob', () => {
  it('looks for a pending or running job', async () => {
    queryResults["status IN ('pending','running')"] = [[JOB_ROW]];
    const job = await findActiveJob();
    expect(queryLog[0].sql).toContain("status IN ('pending','running')");
    expect(job?.id).toBe('job-1');
  });

  it('returns null when no job is active', async () => {
    queryResults["status IN ('pending','running')"] = [[]];
    expect(await findActiveJob()).toBeNull();
  });
});

describe('markStaleRunningJobsFailed', () => {
  it('only touches the rows that are still running', async () => {
    queryResults["SET status = 'failed'"] = [{ affectedRows: 2 }];
    const marked = await markStaleRunningJobsFailed();
    const q = queryLog[0];
    // Review Focus #8: the job really becomes `failed`.
    expect(q.sql).toContain("SET status = 'failed'");
    expect(q.sql).toContain("WHERE status = 'running'");
    // A pending job has not started yet — it must not be failed here.
    expect(q.sql).not.toContain("'pending'");
    expect(marked).toBe(2);
  });

  it('writes an error message that says the process was interrupted', async () => {
    await markStaleRunningJobsFailed();
    const q = queryLog[0];
    expect(q.params.join(' ')).toContain('进程中断');
    expect(q.sql).toContain('finished_at = NOW()');
  });
});

describe('clearOldJobLogs', () => {
  it('empties the log of the jobs outside the retention window, keeping their rows', async () => {
    queryResults['ORDER BY created_at DESC'] = [[{ id: 'job-20' }, { id: 'job-19' }]];
    queryResults["SET log = ''"] = [{ affectedRows: 7 }];
    const cleared = await clearOldJobLogs(20);

    const select = queryLog.find((q) => q.sql.includes('ORDER BY created_at DESC'));
    expect(select!.params).toEqual([20]);

    const update = queryLog.find((q) => q.sql.includes("SET log = ''"));
    expect(update).toBeDefined();
    // The metadata (status, version, timestamps) must survive the purge.
    expect(update!.sql).not.toMatch(/DELETE/i);
    expect(update!.sql).toContain('WHERE id NOT IN');
    expect(update!.params).toEqual(['job-20', 'job-19']);
    expect(cleared).toBe(7);
  });

  it('never deletes a row', async () => {
    queryResults['ORDER BY created_at DESC'] = [[{ id: 'job-20' }]];
    await clearOldJobLogs(20);
    expect(queryLog.every((q) => !/DELETE/i.test(q.sql))).toBe(true);
  });
});

describe('ensureStaleJobsMarked', () => {
  it('sweeps the stale running jobs once per process', async () => {
    queryResults["SET status = 'failed'"] = [{ affectedRows: 1 }];
    await ensureStaleJobsMarked();
    await ensureStaleJobsMarked();

    const sweeps = queryLog.filter((q) => q.sql.includes("SET status = 'failed'"));
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].params.join(' ')).toContain('进程中断');
  });

  it('makes a concurrent caller wait for the same sweep', async () => {
    let release: () => void = () => {};
    queryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queryResults["SET status = 'failed'"] = [{ affectedRows: 1 }];

    try {
      let secondResolved = false;
      const first = ensureStaleJobsMarked();
      const second = ensureStaleJobsMarked().then(() => {
        secondResolved = true;
      });

      // The sweep is gated inside the database. A caller that returned
      // early would leave a stale job in 'running' — the "the page spins
      // forever" failure mode — so it must still be waiting here.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(secondResolved).toBe(false);

      release();
      await Promise.all([first, second]);
      expect(secondResolved).toBe(true);

      const sweeps = queryLog.filter((q) => q.sql.includes("SET status = 'failed'"));
      expect(sweeps).toHaveLength(1);
    } finally {
      queryGate = null;
    }
  });
});
