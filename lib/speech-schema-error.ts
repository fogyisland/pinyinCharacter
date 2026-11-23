import type { ErrorTranslation } from '@/lib/api-handler';
import { isMissingTableError } from '@/lib/db-error';

/**
 * The API's answer when `speech_assessments` is missing from the schema.
 *
 * ## Why this is not just "return 0 and carry on"
 *
 * The quota exists for ONE reason: a retry loop against a service that bills
 * per audio second must not produce an unbounded bill. `speech_assessments`
 * is the only record the quota can count, so when the table is absent there
 * is nothing to count — and "nothing to count" reads as "quota never
 * reached". Silently returning 0 would leave the paid path wide open with no
 * cap at all, which is the exact failure the cap was built to prevent.
 *
 * So this fails CLOSED, with a reason the operator can act on. The learner
 * keeps the free path (`跟读`, which never touches this table), and the person
 * who can fix it is told which command to run.
 *
 * ## Why the message names the table
 *
 * `isMissingTableError` matches ANY absent table. If `users` were missing,
 * every route on the site would be down and blaming `speech_assessments`
 * would send the operator hunting for the wrong migration. The predicate
 * below therefore also checks that the error names THIS table; any other
 * missing table falls through to the generic 500.
 */
export const SPEECH_SCHEMA_PENDING = 'schema_migration_pending';

/** The sentence the caller sees, with the remedy in it. */
export const SPEECH_SCHEMA_PENDING_MESSAGE =
  '语音评测尚未初始化：数据库缺少 speech_assessments 表。请管理员运行 npm run db:migrate 后重试；跟读功能不受影响。';

/**
 * True when the error says THIS feature's table is absent.
 *
 * @param error whatever the database driver threw.
 */
export function isSpeechTableMissing(error: unknown): boolean {
  if (!isMissingTableError(error)) return false;
  const candidate = error as { sqlMessage?: unknown; message?: unknown };
  const text = `${String(candidate.sqlMessage ?? '')} ${String(candidate.message ?? '')}`;
  return text.includes('speech_assessments');
}

/**
 * Translate the missing-table error into a 503 that says what to run.
 *
 * Every other error returns `null`, so the route's generic 500 handles it —
 * a translator that claimed errors it does not understand would tell the
 * operator the wrong thing, which is worse than telling them nothing.
 *
 * @param error whatever the database driver threw.
 */
export function translateSpeechSchemaError(error: unknown): ErrorTranslation | null {
  if (!isSpeechTableMissing(error)) return null;
  return {
    code: SPEECH_SCHEMA_PENDING,
    message: SPEECH_SCHEMA_PENDING_MESSAGE,
    status: 503,
  };
}
