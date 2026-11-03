/**
 * lib/db-error.ts — turning a database error into an instruction.
 *
 * The seeders catch their errors so one broken import does not stop the
 * boot path. A raw MySQL message does not say what to DO, and the
 * symptom an operator sees is a count that never moves.
 */
import { describe, it, expect } from 'vitest';

import { describeDbError } from '@/lib/db-error';

/** A MySQL-style error. */
function dbError(code: string, sqlMessage: string): Error {
  const error = new Error(sqlMessage) as Error & { code: string };
  error.code = code;
  return error;
}

describe('db-error — a missing table', () => {
  it('names the migration command', () => {
    const message = describeDbError(
      dbError('ER_NO_SUCH_TABLE', "Table 'ziyun.chars' doesn't exist"),
    );

    expect(message).toContain('ER_NO_SUCH_TABLE');
    expect(message).toContain('npm run db:migrate');
  });
});

describe('db-error — a missing column', () => {
  it('says the database is older than the code', () => {
    const message = describeDbError(
      dbError('ER_BAD_FIELD_ERROR', "Unknown column 'unicode_codepoint' in 'field list'"),
    );

    expect(message).toContain('ER_BAD_FIELD_ERROR');
    expect(message).toContain('missing a column');
    expect(message).toContain('npm run db:migrate');
  });

  it('keeps the original message', () => {
    const message = describeDbError(
      dbError('ER_BAD_FIELD_ERROR', "Unknown column 'unicode_codepoint' in 'field list'"),
    );

    expect(message).toContain('unicode_codepoint');
  });
});

describe('db-error — the connection failures', () => {
  it('says the credentials were rejected', () => {
    const message = describeDbError(
      dbError('ER_ACCESS_DENIED_ERROR', "Access denied for user 'ziyun'@'localhost'"),
    );

    expect(message).toContain('DATABASE_URL');
  });

  it('says the database refused the connection', () => {
    const message = describeDbError(dbError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306'));

    expect(message).toContain('MySQL');
  });
});

describe('db-error — an unknown error', () => {
  it('still reports the original message', () => {
    const message = describeDbError(dbError('SOMETHING_ELSE', 'something went wrong'));

    expect(message).toContain('something went wrong');
  });

  it('handles a plain Error', () => {
    expect(describeDbError(new Error('boom'))).toContain('boom');
  });

  it('handles a value that is not an error at all', () => {
    expect(() => describeDbError(undefined)).not.toThrow();
    expect(describeDbError(undefined)).toBeTruthy();
  });

  it('never returns an empty string', () => {
    for (const value of [undefined, null, '', new Error('')]) {
      expect(describeDbError(value).length).toBeGreaterThan(0);
    }
  });
});
