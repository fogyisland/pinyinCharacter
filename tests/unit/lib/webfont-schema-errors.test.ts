import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The webfont job table is created by a migration, so a server can run the
 * code before the schema has caught up. When that happens every read of the
 * table fails with MySQL's `ER_NO_SUCH_TABLE`, and the admin page used to
 * die with an RSC render error whose message a production build strips.
 *
 * These tests cover the recognition of that failure — the part that has to
 * be right, because a mistake in either direction is bad:
 *
 *  - recognise too little ⇒ the page keeps dying with a stack trace;
 *  - recognise too much ⇒ the page says "run the migration" when the
 *    database is actually unreachable, which sends the operator down the
 *    wrong path.
 *
 * The mock shape is copied from tests/unit/lib/webfont-jobs.test.ts.
 */

let queryError: Error | null = null;

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async () => {
      if (queryError) throw queryError;
      return [[]];
    }),
  }),
}));

import {
  listJobs,
  getJob,
  createJob,
  findActiveJob,
  clearOldJobLogs,
  markStaleRunningJobsFailed,
} from '@/lib/webfont/jobs';
import {
  isTableMissingError,
  isSpecificTableMissing,
  isWebfontJobsTableMissing,
  WebfontSchemaMissingError,
  MYSQL_TABLE_MISSING,
} from '@/lib/webfont/schema-errors';

/** The error mysql2 raises for a missing table. */
function missingTableError(table = 'webfont_build_jobs'): Error & { code?: string; errno?: number } {
  const error = new Error(`Table 'piyin.${table}' doesn't exist`) as Error & {
    code?: string;
    errno?: number;
    sqlMessage?: string;
  };
  error.code = MYSQL_TABLE_MISSING;
  error.errno = 1146;
  error.sqlMessage = `Table 'piyin.${table}' doesn't exist`;
  return error;
}

/** A connection failure — the error that must NOT be read as "no table". */
function connectionError(): Error & { code?: string } {
  const error = new Error('connect ECONNREFUSED 127.0.0.1:3306') as Error & { code?: string };
  error.code = 'ECONNREFUSED';
  return error;
}

beforeEach(() => {
  queryError = null;
  delete (globalThis as { __pinyinWebfontStaleJobsSweep?: Promise<void> })
    .__pinyinWebfontStaleJobsSweep;
});

describe('isTableMissingError', () => {
  it('recognises the driver error by its code', () => {
    expect(isTableMissingError({ code: 'ER_NO_SUCH_TABLE' })).toBe(true);
  });

  it('recognises the driver error by its errno', () => {
    expect(isTableMissingError({ errno: 1146 })).toBe(true);
  });

  it('recognises the driver error by its message', () => {
    expect(isTableMissingError({ message: 'ER_NO_SUCH_TABLE: no such table' })).toBe(true);
  });

  it('does not recognise a connection failure', () => {
    expect(isTableMissingError(connectionError())).toBe(false);
  });

  it('does not recognise a value that is not an error', () => {
    expect(isTableMissingError(null)).toBe(false);
    expect(isTableMissingError(undefined)).toBe(false);
    expect(isTableMissingError('ER_NO_SUCH_TABLE')).toBe(false);
    expect(isTableMissingError(42)).toBe(false);
  });
});

describe('isSpecificTableMissing', () => {
  it('names the table that is missing', () => {
    expect(isSpecificTableMissing(missingTableError('webfont_build_jobs'), 'webfont_build_jobs')).toBe(
      true,
    );
  });

  it('refuses to blame the webfont table for another missing table', () => {
    // The same MySQL code covers every table in the schema. A missing
    // `users` table must not be reported as "run the webfont migration".
    expect(isSpecificTableMissing(missingTableError('users'), 'webfont_build_jobs')).toBe(false);
  });

  it('needs a table name — a bare code is not enough', () => {
    // Without a name in the message the check cannot tell which table is
    // missing, so it must not claim it knows.
    expect(isSpecificTableMissing({ code: 'ER_NO_SUCH_TABLE' }, 'webfont_build_jobs')).toBe(false);
  });

  it('reads the table name out of a backtick-quoted message', () => {
    const error = new Error('Table `piyin`.`webfont_build_jobs` doesn\'t exist') as Error & {
      code?: string;
    };
    error.code = MYSQL_TABLE_MISSING;
    expect(isSpecificTableMissing(error, 'webfont_build_jobs')).toBe(true);
  });

  it('reads a bare (unquoted) table name', () => {
    const error = new Error('Table piyin.webfont_build_jobs does not exist') as Error & {
      code?: string;
    };
    error.code = MYSQL_TABLE_MISSING;
    expect(isSpecificTableMissing(error, 'webfont_build_jobs')).toBe(true);
  });

  it('does not match a table whose name merely starts with ours', () => {
    // `webfont_build_jobs_extra` is a different table. Matching it would
    // tell the operator to run the migration for the wrong reason.
    const error = new Error("Table 'piyin.webfont_build_jobs_extra' doesn't exist") as Error & {
      code?: string;
    };
    error.code = MYSQL_TABLE_MISSING;
    expect(isSpecificTableMissing(error, 'webfont_build_jobs')).toBe(false);
  });

  it('falls back to a whole-word match for an unfamiliar wording', () => {
    const error = new Error('no such table: pinyin.webfont_build_jobs') as Error & {
      code?: string;
    };
    error.code = MYSQL_TABLE_MISSING;
    expect(isSpecificTableMissing(error, 'webfont_build_jobs')).toBe(true);
  });
});

describe('isWebfontJobsTableMissing', () => {
  it('is true for the webfont table', () => {
    expect(isWebfontJobsTableMissing(missingTableError())).toBe(true);
  });

  it('is false for another table', () => {
    expect(isWebfontJobsTableMissing(missingTableError('users'))).toBe(false);
  });

  it('is false for a connection failure', () => {
    expect(isWebfontJobsTableMissing(connectionError())).toBe(false);
  });
});

describe('the job table is read defensively', () => {
  it('listJobs turns a missing table into a named error', async () => {
    queryError = missingTableError();
    await expect(listJobs(10)).rejects.toBeInstanceOf(WebfontSchemaMissingError);
  });

  it('the named error says which table and what to run', async () => {
    queryError = missingTableError();
    const error = await listJobs(10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebfontSchemaMissingError);
    const named = error as WebfontSchemaMissingError;
    expect(named.table).toBe('webfont_build_jobs');
    expect(named.message).toContain('webfont_build_jobs');
    expect(named.message).toContain('scripts/migrate.ts');
  });

  it('a connection failure is NOT turned into a missing table', async () => {
    // This is the distinction that matters: telling the operator to run a
    // migration when the database is unreachable sends them to fix the
    // wrong thing.
    queryError = connectionError();
    const error = await listJobs(10).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(WebfontSchemaMissingError);
    expect((error as Error).message).toContain('ECONNREFUSED');
  });

  it('every read of the table is guarded, not just listJobs', async () => {
    queryError = missingTableError();
    await expect(getJob('job-1')).rejects.toBeInstanceOf(WebfontSchemaMissingError);
    await expect(findActiveJob()).rejects.toBeInstanceOf(WebfontSchemaMissingError);
    await expect(clearOldJobLogs(5)).rejects.toBeInstanceOf(WebfontSchemaMissingError);
    await expect(markStaleRunningJobsFailed()).rejects.toBeInstanceOf(
      WebfontSchemaMissingError,
    );
    await expect(createJob({ id: 'job-1', startedBy: 7 })).rejects.toBeInstanceOf(
      WebfontSchemaMissingError,
    );
  });
});
