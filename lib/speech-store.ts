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
 *
 * ## 为什么 `countAssessmentsToday` 故意**不**吞异常
 *
 * 它和 `recordAssessment` 的容错方向相反，是有意的：
 *
 * - **写**失败只是丢一条给运维看账单的记录，学生已经拿到分数了，不能因此
 *   报「评测失败」→ 只 warn。
 * - **读**失败意味着配额**数不出来**。如果这时返回 0，就等于告诉调用方
 *   「今天还没用过」——付费路径会完全失去上限，正好是配额要防的事。
 *   所以它把异常抛出去，由路由翻译成 503 + 「请跑迁移」。
 *
 * 缺表（迁移没跑）是最常见的那种读失败，见 `lib/speech-schema-error.ts`。
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

/** What the operator's panel shows about the paid path. */
export interface SpeechUsage {
  /** Assessments scored today, across every user. */
  todayCount: number;
  /** Distinct users who scored something today. */
  todayUsers: number;
  /** Average pronunciation score over the last seven days, or null. */
  avgScore: number | null;
  /** The most recent assessments, newest first. */
  recent: Array<{
    id: number;
    username: string | null;
    userId: number;
    reference: string;
    recognised: string;
    pronunciation: number;
    createdAt: Date;
  }>;
}

/** One row of the recent list. */
interface RecentRow extends RowDataPacket {
  id: number | string;
  user_id: number | string;
  username: string | null;
  reference: string;
  recognised: string;
  pronunciation: string | number;
  created_at: Date | string;
}

/** One aggregate row. */
interface UsageRow extends RowDataPacket {
  today_count: number | string | null;
  today_users: number | string | null;
  avg_score: string | number | null;
}

/** How many recent assessments the panel lists. */
const RECENT_LIMIT = 20;

/**
 * Read the usage figures for the admin panel.
 *
 * ## Why this exists
 *
 * The table was written only to enforce the daily cap. An operator who pays
 * for Azure could not answer the two questions that decide whether the cap is
 * right: "is anybody using this?" and "which words keep scoring low?".
 *
 * ## What is NOT read
 *
 * No audio was ever stored, so there is nothing about a voice to read — only
 * the scores the learner already saw.
 *
 * ## Why a missing table is an empty panel, not an error
 *
 * This is a READ for a human, not a guard on a bill. A site that has not run
 * the migration should show "还没有人用过精评" on the settings page instead of
 * a red error — the operator is already being told to run the migration by
 * the assessment route when a learner hits it.
 *
 * @returns the figures; every field is a usable number or null.
 */
export async function readSpeechUsage(): Promise<SpeechUsage> {
  try {
    const pool = getPool();
    const [usageRows] = await pool.query<UsageRow[]>(
      `SELECT
         SUM(created_at >= CURDATE()) AS today_count,
         COUNT(DISTINCT CASE WHEN created_at >= CURDATE() THEN user_id END) AS today_users,
         AVG(CASE WHEN created_at >= CURDATE() - INTERVAL 7 DAY THEN pronunciation END) AS avg_score
       FROM speech_assessments`,
    );
    const usage = usageRows[0];
    const todayCount = Number(usage?.today_count ?? 0);
    const todayUsers = Number(usage?.today_users ?? 0);
    const avg = usage?.avg_score === null || usage?.avg_score === undefined ? null : Number(usage.avg_score);

    const [recentRows] = await pool.query<RecentRow[]>(
      `SELECT a.id, a.user_id, u.username, a.reference, a.recognised,
              a.pronunciation, a.created_at
       FROM speech_assessments a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC
       LIMIT ?`,
      [RECENT_LIMIT],
    );

    return {
      todayCount: Number.isFinite(todayCount) ? todayCount : 0,
      todayUsers: Number.isFinite(todayUsers) ? todayUsers : 0,
      avgScore: avg !== null && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null,
      recent: recentRows.map((row) => ({
        id: Number(row.id),
        userId: Number(row.user_id),
        username: row.username,
        reference: row.reference,
        recognised: row.recognised,
        pronunciation: Number(row.pronunciation),
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      })),
    };
  } catch (error) {
    console.warn('[speech-store] could not read the usage figures:', (error as Error).message);
    return { todayCount: 0, todayUsers: 0, avgScore: null, recent: [] };
  }
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
