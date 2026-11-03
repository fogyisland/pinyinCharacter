/**
 * lib/db-error.ts — turn a database error into something an operator can act on.
 *
 * The seeders in `scripts/init-db.ts` catch their errors so one broken
 * import does not stop the boot path. But a raw MySQL message
 * ("ER_BAD_FIELD_ERROR: Unknown column 'unicode_codepoint' in 'field list'")
 * does not say what to DO, and the symptom an operator sees is a count
 * that never moves ("chars 0/8105"). This module turns the common
 * failures into the command that fixes them.
 *
 * It is a separate module because `scripts/init-db.ts` is already long
 * and this is a concern of its own.
 */

/** The shape of a MySQL error that carries an error code. */
interface CodedError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  message?: string;
}

/**
 * Describe a database error in terms of what the operator should run.
 *
 * The order matters: the more specific codes come first, because a
 * missing column and a missing table both surface as a failed statement
 * and only the code tells them apart.
 */
export function describeDbError(error: unknown): string {
  const err = (error ?? {}) as CodedError;
  const code = err.code ?? '';
  const message = err.sqlMessage ?? err.message ?? String(error ?? '');
  // The code is the part an operator searches for, and MySQL's message
  // does not always carry it. Prefix it so the output is greppable.
  const withCode = code && !message.includes(code) ? `${code}: ${message}` : message;
  const text = withCode.length > 0 ? withCode : 'unknown database error';

  switch (code) {
    case 'ER_NO_SUCH_TABLE':
      return (
        `${text}\n` +
        '    The table does not exist. Run `npm run db:migrate` to create ' +
        'the schema, then run the seed again.'
      );

    case 'ER_BAD_FIELD_ERROR':
      return (
        `${text}\n` +
        '    The table is missing a column the seeder writes. The database ' +
        'is older than the code. Run `npm run db:migrate` — if the column ' +
        'is still missing afterwards, the table predates the slim schema ' +
        'and has to be migrated by hand.'
      );

    case 'ER_DUP_ENTRY':
      return `${text}\n    A row with the same key already exists.`;

    case 'ER_ACCESS_DENIED_ERROR':
      return (
        `${text}\n` +
        '    The database rejected the credentials. Check DATABASE_URL in ' +
        'the server\'s .env.'
      );

    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      return (
        `${text}\n` +
        '    The database refused the connection. Check that MySQL is ' +
        'running and that the host and port in DATABASE_URL are right.'
      );

    case 'ETIMEDOUT':
      return `${text}\n    The database did not answer in time.`;

    default:
      return text;
  }
}
