/**
 * Recognising a schema that has not caught up with the code.
 *
 * ## Why this module exists
 *
 * The webfont pipeline stores its state in one table,
 * `webfont_build_jobs`, created by
 * `scripts/migrations/2026-10-31-webfont-build-jobs.sql`. A deployment
 * that ships the code before the migration has run leaves the server
 * without that table — and every read of it fails with MySQL's
 * `ER_NO_SUCH_TABLE`.
 *
 * On the admin page that failure used to be fatal: the page is a server
 * component, so the throw escaped as an RSC render error. In a production
 * build the message is stripped, so the administrator saw
 * "An error occurred in the Server Components render" and nothing else —
 * no table name, no hint about the migration, no way to act on it.
 *
 * A page that says "run the migration" is worth far more than a stack
 * trace that says "something went wrong", so the failure is given a name
 * and a shape that a caller can catch.
 *
 * ## Why it lives in its own file
 *
 * The check is pure — it looks at an error value and answers a question —
 * and it must be importable from a **client** component without dragging
 * `mysql2` into the browser bundle. `lib/webfont/jobs.ts` is
 * `server-only`, so this module cannot live there.
 */

/** The MySQL error code for "the table does not exist". */
export const MYSQL_TABLE_MISSING = 'ER_NO_SUCH_TABLE';

/** The table this feature needs. */
export const WEBFONT_JOBS_TABLE = 'webfont_build_jobs';

/**
 * The shape mysql2 gives a driver error.
 *
 * Only the fields this module reads are declared; the driver error carries
 * more (`errno`, `sqlState`, `sqlMessage`, the `fatal` flag), and TypeScript
 * is happy with a structural subset.
 */
interface MysqlDriverError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  message?: string;
}

/**
 * The error thrown when the webfont job table is missing from the schema.
 *
 * It carries the message the administrator needs to see, so a caller that
 * catches it can render that message verbatim.
 */
export class WebfontSchemaMissingError extends Error {
  /** The table that is missing. */
  readonly table: string;

  /** The migration file that creates it — the actual remedy. */
  readonly migration: string;

  constructor(table: string = WEBFONT_JOBS_TABLE) {
    super(
      `数据库缺少 ${table} 表 —— 请先运行迁移：npx tsx scripts/migrate.ts`,
    );
    this.name = 'WebfontSchemaMissingError';
    this.table = table;
    this.migration = 'scripts/migrations/2026-10-31-webfont-build-jobs.sql';
  }
}

/**
 * Whether an error is MySQL's "no such table".
 *
 * The check looks at `code` first (that is the field mysql2 sets, and it
 * is stable across versions), then falls back to the errno and the message
 * text — a caller may have serialised the error through JSON on the way
 * here, and `code` survives that, but `errno` does not always.
 */
export function isTableMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const driverError = error as MysqlDriverError;
  if (driverError.code === MYSQL_TABLE_MISSING) return true;
  // 1146 is ER_NO_SUCH_TABLE's errno.
  if (driverError.errno === 1146) return true;
  const text = driverError.sqlMessage ?? driverError.message ?? '';
  return typeof text === 'string' && text.includes(MYSQL_TABLE_MISSING);
}

/**
 * Whether an error says that a SPECIFIC table is missing.
 *
 * `ER_NO_SUCH_TABLE` alone is not enough to conclude that the *webfont*
 * table is the missing one: the same code covers every table in the
 * schema. The table name is checked as well, so a failure somewhere else
 * is not misreported as "run the webfont migration".
 *
 * MySQL puts the table name in the message as `db.table` or as a bare
 * `table`, and it is quoted with single quotes or backticks depending on
 * the version — so the check strips the quotes and the schema prefix
 * before comparing.
 */
export function isSpecificTableMissing(error: unknown, table: string): boolean {
  if (!isTableMissingError(error)) return false;
  const driverError = error as MysqlDriverError;
  const text = driverError.sqlMessage ?? driverError.message ?? '';
  if (typeof text !== 'string' || text.length === 0) return false;

  // MySQL writes the table in several shapes:
  //   Table 'piyin.webfont_build_jobs' doesn't exist     (single quotes)
  //   Table `piyin`.`webfont_build_jobs` doesn't exist    (backticks, per part)
  //   Table piyin.webfont_build_jobs doesn't exist         (bare)
  //
  // The name always sits between the word "Table" and the word
  // "doesn't", so that span is what gets examined — nothing else in the
  // message can be mistaken for the table's name.
  const span = /table\s+(.*?)\s+doesn'?t\s+exist/i.exec(text);
  if (span) {
    const named = span[1].replace(/['`]/g, '').trim();
    // The span is "schema.table" or just "table".
    const parts = named.split('.').map((part) => part.trim()).filter((part) => part.length > 0);
    return parts.includes(table);
  }

  // Fallback for a message whose wording this module does not know. The
  // table name must appear as a WHOLE word — `webfont_build_jobs_extra`
  // must not match a query about `webfont_build_jobs`.
  const word = new RegExp(`(^|[^0-9A-Za-z_])${table}([^0-9A-Za-z_]|$)`, 'i');
  return word.test(text);
}

/**
 * Whether an error means "the webfont job table is missing".
 *
 * A caller that asks this question and gets `false` should treat the
 * failure as an ordinary error — the table might be missing for a reason
 * this module cannot see, or the error might be something else entirely.
 */
export function isWebfontJobsTableMissing(error: unknown): boolean {
  // The named error first: `lib/webfont/jobs.ts` translates the driver
  // error into it, and a caller that catches the translation and asks
  // this question again must get "yes". Without this check the answer
  // would be "no" — the named error carries no driver `code`, so the
  // driver-shape test below would not recognise it.
  if (error instanceof WebfontSchemaMissingError) return true;
  return isSpecificTableMissing(error, WEBFONT_JOBS_TABLE);
}
