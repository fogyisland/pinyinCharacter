import 'server-only';

import type { ErrorTranslation } from '@/lib/api-handler';
import { isWebfontJobsTableMissing } from '@/lib/webfont/schema-errors';

/**
 * The API's answer when the job table is missing from the schema.
 *
 * ## Why the caller needs a code and not just "server error"
 *
 * The generic 500 says "something went wrong" and stops there. The
 * administrator who sees it cannot tell a bug from a missing migration,
 * so the only sensible next step is to file a bug report. But the actual
 * cause — a server whose code is newer than its database — is fixed by
 * running one command.
 *
 * So this failure gets its own code (`schema_migration_pending`) and a
 * message that says which command to run. The status is 503: the server
 * is fine, the database is not ready for this feature yet, and a retry
 * after the migration will succeed. That is what "Service Unavailable"
 * means, and it tells a well-behaved client not to give up.
 */
export const SCHEMA_MIGRATION_PENDING = 'schema_migration_pending';

/** The message the caller sees, with the remedy in it. */
export const SCHEMA_MIGRATION_PENDING_MESSAGE =
  '数据库尚未升级：缺少 webfont_build_jobs 表。请在服务器上运行 npx tsx scripts/migrate.ts 后重试。';

/**
 * Translates "the job table is missing" into an answer that says so.
 *
 * Every other error is left alone — it returns `null`, and the route's
 * generic 500 handles it. A translator that claimed errors it does not
 * understand would tell the administrator the wrong thing, which is worse
 * than telling them nothing.
 */
export function translateWebfontSchemaError(error: unknown): ErrorTranslation | null {
  if (!isWebfontJobsTableMissing(error)) return null;
  return {
    code: SCHEMA_MIGRATION_PENDING,
    message: SCHEMA_MIGRATION_PENDING_MESSAGE,
    status: 503,
  };
}
