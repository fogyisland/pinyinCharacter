// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * 缺表时的回答 —— 为什么是「503 + 一句能修的话」，而不是「当成 0 继续」。
 *
 * ## 配额只防一件事
 *
 * Azure 按音频秒数计费。配额存在的**唯一理由**是挡住「重试循环 → 无上限账单」。
 * 而配额只能数 `speech_assessments` 里的行。表不存在时，能数到的永远是 0 ——
 * 「0 次」在配额判断里等于「还没用完」。若缺表时返回 0，付费路径会**完全失去
 * 上限**，正好是配额想防的那件事。
 *
 * 所以这里选择 **fail closed**：回 503，并告诉运维要跑哪条命令。学生不受影响
 * ——`跟读`根本不碰这张表。
 *
 * ## 为什么还要核对表名
 *
 * `isMissingTableError` 匹配**任何**缺表。如果缺的是 `users`，全站都挂了，
 * 这时把原因说成 `speech_assessments` 会让运维找一个不存在的迁移问题。
 * 所以只有错误信息里真的点名这张表，才认领。
 */

import {
  SPEECH_SCHEMA_PENDING,
  SPEECH_SCHEMA_PENDING_MESSAGE,
  isSpeechTableMissing,
  translateSpeechSchemaError,
} from '@/lib/speech-schema-error';

/** The shape mysql2 throws when a table is absent. */
function missingTable(table: string): Error & { code: string; errno: number } {
  return Object.assign(new Error(`ER_NO_SUCH_TABLE: Table 'pinyin_test.${table}' doesn't exist`), {
    code: 'ER_NO_SUCH_TABLE',
    errno: 1146,
  });
}

describe('isSpeechTableMissing', () => {
  it('claims the missing assessment table', () => {
    expect(isSpeechTableMissing(missingTable('speech_assessments'))).toBe(true);
  });

  it('checks errno even when the code is absent', () => {
    // A driver that only populates errno must still be caught — the predicate
    // in lib/db-error.ts accepts code, errno or SQLSTATE.
    const error = Object.assign(new Error("Table 'pinyin_test.speech_assessments' doesn't exist"), {
      errno: 1146,
    });
    expect(isSpeechTableMissing(error)).toBe(true);
  });

  it('does NOT claim a different missing table', () => {
    // If `users` is missing the whole site is down; blaming this feature's
    // table would send the operator after the wrong migration.
    expect(isSpeechTableMissing(missingTable('users'))).toBe(false);
  });

  it('does not claim an ordinary database error', () => {
    expect(isSpeechTableMissing(new Error('ER_DUP_ENTRY: duplicate'))).toBe(false);
  });

  it('does not claim a missing table whose message never names it', () => {
    // ER_NO_SUCH_TABLE with an empty message: the code says "a table is
    // missing" but not which one, so this feature must not put its name on it.
    const bare = Object.assign(new Error('ER_NO_SUCH_TABLE'), { code: 'ER_NO_SUCH_TABLE' });
    expect(isSpeechTableMissing(bare)).toBe(false);
  });

  it('tolerates non-Error values', () => {
    expect(isSpeechTableMissing(null)).toBe(false);
    expect(isSpeechTableMissing('boom')).toBe(false);
  });
});

describe('translateSpeechSchemaError', () => {
  it('answers 503 with a code the panel can branch on', () => {
    const translation = translateSpeechSchemaError(missingTable('speech_assessments'));
    expect(translation).not.toBeNull();
    expect(translation!.code).toBe(SPEECH_SCHEMA_PENDING);
    // 503, not 500: the server is fine, the database is behind the code, and
    // a retry after the migration will succeed.
    expect(translation!.status).toBe(503);
  });

  it('puts the command in the message', () => {
    const translation = translateSpeechSchemaError(missingTable('speech_assessments'));
    expect(translation!.message).toContain('db:migrate');
    expect(translation!.message).toContain('speech_assessments');
  });

  it('says the free path still works', () => {
    // The learner is not the one who can fix a migration. Telling them the
    // 跟读 button still works is the one useful thing to say.
    expect(SPEECH_SCHEMA_PENDING_MESSAGE).toContain('跟读');
  });

  it('leaves every other error to the generic 500', () => {
    expect(translateSpeechSchemaError(new Error('boom'))).toBeNull();
    expect(translateSpeechSchemaError(missingTable('users'))).toBeNull();
  });
});
