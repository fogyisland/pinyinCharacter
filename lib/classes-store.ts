/**
 * 班级与作业 — 存储层。
 *
 * ## 职责
 *
 * 这一层只做三件事：写对的 SQL、把行映射成领域对象、把权限写进 WHERE。
 * 不在这里判权限（「老师才能派作业」是路由的事），但**必须**把
 * class_id 写进每一条 WHERE —— 忘了它，一次猜 id 就能读到别的班的作业。
 *
 * ## 两个容易写错的地方
 *
 * 1. **DATE 列**。mysql2 把 `DATE` 读成本地午夜的 `Date` 对象；
 *    `JSON.stringify` 会把它变成一个 UTC 时间戳，于是东八区的老师看到
 *    的截止日期比实际早一天。所以 due_at 一律在这里格式化成
 *    `YYYY-MM-DD` 字符串，出了这一层就看不到 `Date`。
 *
 * 2. **JSON 列**。写的时候传字符串（mysql2 的 JSON 类型从字符串序列化，
 *    传对象的行为取决于驱动版本）。读的时候 JSON.parse，然后交给
 *    `parseAssignmentPayload` 验到底 —— 坏行当没有，不猜。
 *
 * ## 邀请码
 *
 * `join_code` 上有唯一索引。撞码时 MySQL 报 ER_DUP_ENTRY，重试一次
 * 换一个码即可；其它错误一律不重试（数据库连不上时重试六次只会让故障
 * 更响、恢复更慢）。
 */
import { getPool } from './db';
import {
  MAX_JOIN_CODE_TRIES,
  generateJoinCode,
  normalizeClassName,
  isJoinCode,
  parseAssignmentPayload,
  type AssignmentPayload,
} from './classes';

/** 一个班级 + 当前用户在这个班里的身份。 */
export interface ClassWithRole {
  id: number;
  teacherId: number;
  name: string;
  joinCode: string;
  note: string;
  role: 'teacher' | 'student';
}

/** 老师视角的班级列表行。 */
export interface TeacherClassRow {
  id: number;
  name: string;
  joinCode: string;
  note: string;
  memberCount: number;
}

/** 学生视角的班级列表行。 */
export interface StudentClassRow {
  id: number;
  name: string;
  note: string;
  teacherName: string;
  memberCount: number;
}

/** 班级成员。 */
export interface ClassMember {
  userId: number;
  username: string;
  joinedAt: string;
}

/** 一份作业。 */
export interface Assignment {
  id: number;
  title: string;
  kind: 'worksheet' | 'dictation';
  payload: AssignmentPayload;
  /** YYYY-MM-DD，或 null。 */
  dueAt: string | null;
  createdAt: string;
}

/** 一个学生对一份作业的完成记录。 */
export interface Submission {
  userId: number;
  username: string;
  note: string;
  completedAt: string;
}

/** 一份作业 + 它的完成情况。 */
export interface AssignmentProgress {
  /** 已完成的用户 id。 */
  completedUserIds: number[];
  /** 班里一共多少学生（不含老师）。 */
  total: number;
}

/** 把 DATE / DATETIME 转成字符串，不吃时区。 */
function toDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

/** 把 DATETIME 转成 ISO 字符串（时间部分有意义）。 */
function toTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

/**
 * 找一个班级里「当前用户是谁」。
 *
 * 一次查询判完两种情况：teacher_id 命中 → 老师；class_members 命中 →
 * 学生。分开查两次会让「老师也是成员」时返回两条，还得在 JS 里挑。
 *
 * @param classId 班级 id。
 * @param userId 当前用户 id。
 * @returns 班级与角色；不是这个班的人返回 null。
 */
export async function getClassForUser(
  classId: number,
  userId: number,
): Promise<ClassWithRole | null> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT c.id, c.teacher_id, c.name, c.join_code, c.note,
            CASE WHEN c.teacher_id = ? THEN 'teacher' ELSE 'student' END AS role
       FROM classes c
       LEFT JOIN class_members m ON m.class_id = c.id AND m.user_id = ?
      WHERE c.id = ? AND (c.teacher_id = ? OR m.user_id IS NOT NULL)
      LIMIT 1`,
    [userId, userId, classId, userId],
  );
  const list = rows as Array<Record<string, unknown>>;
  const row = list[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    teacherId: Number(row.teacher_id),
    name: String(row.name),
    joinCode: String(row.join_code),
    note: String(row.note ?? ''),
    role: row.role === 'teacher' ? 'teacher' : 'student',
  };
}

/**
 * 建一个班。
 *
 * 邀请码撞码时换一个重试；其它错误直接抛。重试次数由
 * `MAX_JOIN_CODE_TRIES` 决定 —— 与 lib/classes.ts 里的常量是同一个，
 * 测试钉住它。
 *
 * @param args 老师 id、班级名、备注。
 * @returns 新班级的 id 与邀请码。
 */
export async function createClass(args: {
  teacherId: number;
  name: string;
  note: string;
}): Promise<{ id: number; joinCode: string }> {
  const name = normalizeClassName(args.name);
  if (name === '') throw new Error('class name is required');
  const pool = getPool();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_JOIN_CODE_TRIES; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const [result] = await pool.query(
        `INSERT INTO classes (teacher_id, name, join_code, note) VALUES (?, ?, ?, ?)`,
        [args.teacherId, name, joinCode, args.note.trim()],
      );
      const insertId = Number((result as { insertId?: number }).insertId ?? 0);
      return { id: insertId, joinCode };
    } catch (error) {
      lastError = error;
      // 只有撞码才值得重试。其它错误（连接断了、表不存在）重试只会
      // 让故障更响、恢复更慢。
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new Error(
    `could not allocate a unique join code after ${MAX_JOIN_CODE_TRIES} attempts: ${String(lastError)}`,
  );
}

/** True when the error is MySQL's duplicate-key error. */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

/**
 * 用邀请码找班级。
 *
 * 形状不对的码直接返回 null，不查库 —— 学生输入到一半按了回车，不该
 * 变成一次数据库查询。
 *
 * @param code 学生输入的邀请码（大小写不敏感）。
 */
export async function findClassByJoinCode(code: string): Promise<ClassWithRole | null> {
  const normalized = code.trim().toUpperCase();
  if (!isJoinCode(normalized)) return null;
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, teacher_id, name, join_code, note FROM classes WHERE join_code = ? LIMIT 1`,
    [normalized],
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    teacherId: Number(row.teacher_id),
    name: String(row.name),
    joinCode: String(row.join_code),
    note: String(row.note ?? ''),
    role: 'student',
  };
}

/**
 * 加入班级。
 *
 * `INSERT IGNORE`：重复加入不是错误，只是「不是新成员」。返回 false 让
 * 调用方能说「你已经在这个班里了」，而不是报 500。
 *
 * @returns true 表示这次是新加入。
 */
export async function joinClass(classId: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(
    `INSERT IGNORE INTO class_members (class_id, user_id) VALUES (?, ?)`,
    [classId, userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** 学生退出班级。 */
export async function leaveClass(classId: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(
    `DELETE FROM class_members WHERE class_id = ? AND user_id = ?`,
    [classId, userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** 班级成员名单，最早加入的在前。 */
export async function listClassMembers(classId: number): Promise<ClassMember[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT m.user_id, u.username, m.joined_at
       FROM class_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.class_id = ?
      ORDER BY m.joined_at ASC`,
    [classId],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: Number(row.user_id),
    username: String(row.username),
    joinedAt: toTimestamp(row.joined_at),
  }));
}

/** 老师把成员移出班级。 */
export async function removeMember(classId: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(
    `DELETE FROM class_members WHERE class_id = ? AND user_id = ?`,
    [classId, userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** 老师名下的班级。 */
export async function listTeacherClasses(teacherId: number): Promise<TeacherClassRow[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.join_code, c.note,
            (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS member_count
       FROM classes c
      WHERE c.teacher_id = ?
      ORDER BY c.created_at DESC`,
    [teacherId],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    joinCode: String(row.join_code),
    note: String(row.note ?? ''),
    memberCount: Number(row.member_count ?? 0),
  }));
}

/** 学生加入的班级。 */
export async function listStudentClasses(userId: number): Promise<StudentClassRow[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.note, u.username AS teacher_name,
            (SELECT COUNT(*) FROM class_members m2 WHERE m2.class_id = c.id) AS member_count
       FROM class_members m
       JOIN classes c ON c.id = m.class_id
       JOIN users u ON u.id = c.teacher_id
      WHERE m.user_id = ?
      ORDER BY m.joined_at DESC`,
    [userId],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    note: String(row.note ?? ''),
    teacherName: String(row.teacher_name),
    memberCount: Number(row.member_count ?? 0),
  }));
}

/**
 * 派一份作业。
 *
 * 载荷的 kind 必须和列上的 kind 一致：列是 ENUM，不一致时 MySQL 会报
 * 一个看不懂的错误，这里提前拒绝并说清楚。
 *
 * @param args 班级、标题、kind、载荷、截止日期。
 * @returns 新作业的 id。
 */
export async function createAssignment(args: {
  classId: number;
  title: string;
  kind: 'worksheet' | 'dictation';
  payload: AssignmentPayload;
  dueAt: string | null;
}): Promise<{ id: number }> {
  if (args.payload.kind !== args.kind) {
    throw new Error(
      `assignment kind mismatch: the column says ${args.kind}, the payload says ${args.payload.kind}`,
    );
  }
  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO class_assignments (class_id, title, kind, payload, due_at) VALUES (?, ?, ?, ?, ?)`,
    [args.classId, args.title.trim(), args.kind, JSON.stringify(args.payload), args.dueAt],
  );
  return { id: Number((result as { insertId?: number }).insertId ?? 0) };
}

/**
 * 一个班的作业列表。
 *
 * 载荷坏掉的行被跳过而不是让整个列表失败 —— 一行坏数据不该让老师看不到
 * 其余九份作业。
 */
export async function listAssignments(classId: number): Promise<Assignment[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, title, kind, payload, due_at, created_at
       FROM class_assignments
      WHERE class_id = ?
      ORDER BY created_at DESC`,
    [classId],
  );
  const out: Assignment[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    let parsed: unknown;
    try {
      parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    } catch (error) {
      console.warn(
        `[classes-store] assignment ${String(row.id)} has an unreadable payload:`,
        error,
      );
      continue;
    }
    const payload = parseAssignmentPayload(parsed);
    if (!payload) {
      console.warn(`[classes-store] assignment ${String(row.id)} has an invalid payload, skipped`);
      continue;
    }
    out.push({
      id: Number(row.id),
      title: String(row.title),
      kind: payload.kind,
      payload,
      dueAt: toDateString(row.due_at),
      createdAt: toTimestamp(row.created_at),
    });
  }
  return out;
}

/** 删一份作业。一个班不能删另一个班的作业。 */
export async function deleteAssignment(classId: number, assignmentId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(`DELETE FROM class_assignments WHERE id = ? AND class_id = ?`, [
    assignmentId,
    classId,
  ]);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * 解散班级。
 *
 * 成员与作业由外键的 ON DELETE CASCADE 一并删除；这里只删 classes 一行。
 * 这是「误建的班」的退路，不是常规操作 —— 老师退出自己的班等于解散，
 * 所以 DELETE 成员的路由拒绝老师删自己（见 app/api/classes/[id]/members）。
 */
export async function deleteClass(classId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(`DELETE FROM classes WHERE id = ?`, [classId]);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * 学生标记一份作业「我练完了」。
 *
 * 用 `ON DUPLICATE KEY UPDATE` 而不是 INSERT：同一个学生点两次不是错误，
 * 第二次是更新留言与时间。唯一索引在 (assignment_id, user_id) 上。
 *
 * **作业必须属于这个学生所在的班** —— 这条检查无法只靠 WHERE 完成（作业
 * 与班级的关联在另一张表），所以调用方（路由）必须先确认班级归属。
 * 存储层再做一次 Join 校验，防止路由层的疏漏变成一个能跨班交作业的漏洞。
 *
 * @param assignmentId 作业 id。
 * @param classId 这个作业应该所属的班级。
 * @param userId 学生 id。
 * @param note 可选留言（最长 512，超出截断）。
 * @returns true 表示记录被写入；false 表示作业不属于这个班。
 */
export async function recordSubmission(
  assignmentId: number,
  classId: number,
  userId: number,
  note: string,
): Promise<boolean> {
  const pool = getPool();
  // 归属校验：作业的 class_id 必须是这个班，且提交人必须是这个班的成员。
  const [guards] = await pool.query(
    `SELECT a.id
       FROM class_assignments a
       JOIN class_members m ON m.class_id = a.class_id AND m.user_id = ?
      WHERE a.id = ? AND a.class_id = ?
      LIMIT 1`,
    [userId, assignmentId, classId],
  );
  if ((guards as unknown[]).length === 0) return false;

  await pool.query(
    `INSERT INTO class_submissions (assignment_id, user_id, note)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE note = VALUES(note), completed_at = CURRENT_TIMESTAMP`,
    [assignmentId, userId, note.slice(0, 512)],
  );
  return true;
}

/** 学生撤销「我练完了」（勾错了、或者想重练）。 */
export async function clearSubmission(assignmentId: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(
    `DELETE FROM class_submissions WHERE assignment_id = ? AND user_id = ?`,
    [assignmentId, userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** 一份作业的所有完成记录（含留言），最早完成的在前。 */
export async function listSubmissions(assignmentId: number): Promise<Submission[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT s.user_id, u.username, s.note, s.completed_at
       FROM class_submissions s
       JOIN users u ON u.id = s.user_id
      WHERE s.assignment_id = ?
      ORDER BY s.completed_at ASC`,
    [assignmentId],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: Number(row.user_id),
    username: String(row.username),
    note: String(row.note ?? ''),
    completedAt: toTimestamp(row.completed_at),
  }));
}

/**
 * 一个班所有作业的完成情况（一次查询，N 份作业）。
 *
 * 老师的班级页要显示「已完成 8 / 12 人」× N 份作业 —— 逐份作业查一次是
 * N 次往返。这里用一条 GROUP BY 拿到全部，再按作业 id 建索引。
 *
 * @param classId 班级 id。
 * @returns assignmentId → 已完成的用户 id 列表。
 */
export async function listClassProgress(classId: number): Promise<Record<number, number[]>> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT s.assignment_id, s.user_id
       FROM class_submissions s
       JOIN class_assignments a ON a.id = s.assignment_id
      WHERE a.class_id = ?
      ORDER BY s.assignment_id, s.completed_at`,
    [classId],
  );
  const out: Record<number, number[]> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    const id = Number(row.assignment_id);
    (out[id] ??= []).push(Number(row.user_id));
  }
  return out;
}

/**
 * 当前用户在一个班里交过哪些作业（含留言）。
 *
 * 学生打开班级页要看到「我练完了」的状态与自己的留言 —— 逐份作业查一次
 * 是 N 次往返，这里一条语句拿全部。
 *
 * @param classId 班级 id。
 * @param userId 当前用户。
 * @returns assignmentId → 留言与完成时间。
 */
export async function listMySubmissions(
  classId: number,
  userId: number,
): Promise<Record<number, { note: string; completedAt: string }>> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT s.assignment_id, s.note, s.completed_at
       FROM class_submissions s
       JOIN class_assignments a ON a.id = s.assignment_id
      WHERE a.class_id = ? AND s.user_id = ?`,
    [classId, userId],
  );
  const out: Record<number, { note: string; completedAt: string }> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    out[Number(row.assignment_id)] = {
      note: String(row.note ?? ''),
      completedAt: toTimestamp(row.completed_at),
    };
  }
  return out;
}

/** 学生自报的听写成绩。 */
export interface DictationResult {
  userId: number;
  username: string;
  total: number;
  correct: number;
  wrongWords: string[];
  submittedAt: string;
  /** 同一份作业的学生留言（来自 class_submissions，可能为空）。 */
  note: string;
}

/**
 * 保存学生自报的听写成绩。与 recordSubmission 一样做班级归属 Join 校验，
 * 防止跨班提交；重复提交按唯一索引更新为最新一次。
 */
export async function recordDictationResult(args: {
  assignmentId: number;
  classId: number;
  userId: number;
  total: number;
  correct: number;
  wrongWords: string[];
}): Promise<boolean> {
  const pool = getPool();
  const [guards] = await pool.query(
    `SELECT a.id
       FROM class_assignments a
       JOIN class_members m ON m.class_id = a.class_id AND m.user_id = ?
      WHERE a.id = ? AND a.class_id = ? AND a.kind = 'dictation'
      LIMIT 1`,
    [args.userId, args.assignmentId, args.classId],
  );
  if ((guards as unknown[]).length === 0) return false;

  await pool.query(
    `INSERT INTO class_dictation_results
       (assignment_id, user_id, total, correct, wrong_words)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total = VALUES(total), correct = VALUES(correct),
       wrong_words = VALUES(wrong_words), submitted_at = CURRENT_TIMESTAMP`,
    [
      args.assignmentId,
      args.userId,
      args.total,
      args.correct,
      JSON.stringify(args.wrongWords.slice(0, 200)),
    ],
  );
  return true;
}

/** 删除听写成绩（撤销提交，或作业被删时由外键级联）。 */
export async function clearDictationResult(assignmentId: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const [result] = await pool.query(
    `DELETE FROM class_dictation_results WHERE assignment_id = ? AND user_id = ?`,
    [assignmentId, userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** 某份听写作业的全部成绩（老师视图）。 */
export async function listDictationResults(assignmentId: number): Promise<DictationResult[]> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT r.user_id, u.username, r.total, r.correct, r.wrong_words, r.submitted_at,
            COALESCE(s.note, '') AS note
       FROM class_dictation_results r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN class_submissions s
         ON s.assignment_id = r.assignment_id AND s.user_id = r.user_id
      WHERE r.assignment_id = ?
      ORDER BY r.correct / GREATEST(r.total, 1) DESC, r.submitted_at ASC`,
    [assignmentId],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => {
    let wrongWords: string[] = [];
    try {
      const parsed =
        typeof row.wrong_words === 'string' ? JSON.parse(row.wrong_words) : row.wrong_words;
      if (Array.isArray(parsed)) wrongWords = parsed.map(String).slice(0, 200);
    } catch {
      wrongWords = [];
    }
    return {
      userId: Number(row.user_id),
      username: String(row.username),
      total: Number(row.total),
      correct: Number(row.correct),
      wrongWords,
      submittedAt: toTimestamp(row.submitted_at),
      note: String(row.note ?? ''),
    };
  });
}

/** 一个班中当前用户自己的全部听写成绩（学生视图）。 */
export async function listMyDictationResults(
  classId: number,
  userId: number,
): Promise<Record<number, Omit<DictationResult, 'username'>>> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT r.assignment_id, r.total, r.correct, r.wrong_words, r.submitted_at,
            COALESCE(s.note, '') AS note
       FROM class_dictation_results r
       JOIN class_assignments a ON a.id = r.assignment_id
       LEFT JOIN class_submissions s
         ON s.assignment_id = r.assignment_id AND s.user_id = r.user_id
      WHERE a.class_id = ? AND r.user_id = ?`,
    [classId, userId],
  );
  const out: Record<number, Omit<DictationResult, 'username'>> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    let wrongWords: string[] = [];
    try {
      const parsed =
        typeof row.wrong_words === 'string' ? JSON.parse(row.wrong_words) : row.wrong_words;
      if (Array.isArray(parsed)) wrongWords = parsed.map(String).slice(0, 200);
    } catch {
      wrongWords = [];
    }
    out[Number(row.assignment_id)] = {
      userId,
      total: Number(row.total),
      correct: Number(row.correct),
      wrongWords,
      submittedAt: toTimestamp(row.submitted_at),
      note: String(row.note ?? ''),
    };
  }
  return out;
}
