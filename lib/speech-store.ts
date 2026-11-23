/**
 * 语音评测的记账层。
 *
 * ## 为什么只存分数
 *
 * 录音是学生的声音 —— 属于个人数据，而且 Azure 那边评测完就丢。本站需要
 * 的不是声音，是**三个数字**：谁、什么时候、打了几分。存分数让这张表
 * 在泄露的情况下也不含任何可识别的东西。
 *
 * ## 为什么它必须容错
 *
 * 写失败时**不能**让学生看到「评测失败」：分数已经拿到了，这条记录只是
 * 给站长算账单用的。所以写失败只 warn，不抛。
 *
 * ## 为什么配额也靠它
 *
 * Azure 按音频秒数计费。配额 = 今天这张表里这个人的行数。没有配额，一个
 * 循环脚本就能把账单推到不可控。`0` 表示不限，和站内其它限制一致。
 */
import { getPool } from './db';
import type { RowDataPacket } from 'mysql2';
import type { Assessment } from './speech-types';

/** The recognised-text column width; longer answers are cut, not rejected. */
const RECOGNISED_MAX = 64;

/** One COUNT(*) answer. */
interface CountRow extends RowDataPacket {
  n: number | string | null;
}

/** 0–100, as DECIMAL(5,1) can hold it. */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * How many paid assessments this user has run today.
 *
 * @param userId the learner.
 * @returns the count, 0 when there is no row.
 */
export async function countAssessmentsToday(userId: number): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM speech_assessments
     WHERE user_id = ? AND created_at >= CURDATE()`,
    [userId],
  );
  const value = Number(rows[0]?.n ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Note one scored assessment, for the operator's bill.
 *
 * Never throws: the learner already has their score, and this row is not
 * theirs to lose.
 *
 * @param userId who was scored.
 * @param assessment what Azure answered.
 */
export async function recordAssessment(userId: number, assessment: Assessment): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO speech_assessments
         (user_id, reference, recognised, pronunciation, accuracy, fluency, completeness)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        assessment.reference.slice(0, 32),
        Array.from(assessment.recognised).slice(0, RECOGNISED_MAX).join(''),
        clampScore(assessment.pronunciation),
        clampScore(assessment.accuracy),
        clampScore(assessment.fluency),
        clampScore(assessment.completeness),
      ],
    );
  } catch (error) {
    console.warn('[speech-store] could not record the assessment:', (error as Error).message);
  }
}
