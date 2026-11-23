/**
 * 班级作业 → 听写工具的链接约定。
 *
 * ## 为什么带「作业编号」而不是把词表塞进 URL
 *
 * 第一版想法是把 10 个词（连同拼音）编码进 `?items=`。实测 60 个词是
 * 5480 个字符 —— 因为在 URL 里每个汉字要写成 9 个字符的 `%E5%AD%A6`。
 * 代理会在 2 KB 左右开始拒绝或截断，而一份班级听写作业可以有 200 条。
 * 于是「老师派了 30 个词，学生点进去只看到 12 个」就会成为常态，而且
 * 没有任何提示。
 *
 * 带两个编号（`classId` + `assignmentId`）只有几十个字符，**永远完整**，
 * 而且词表只有一份真相 —— 班级库里那一份。权限由已有的
 * `/api/classes/[id]` 判断（非本班成员拿不到），所以链接本身不泄露内容。
 *
 * ## 为什么解析永不抛
 *
 * 这两个值来自学生可以手改的地址栏。抛错会让页面在渲染表单之前崩掉；
 * 正确行为是当成「没有链接」，也就是这个功能存在之前的状态：空表单。
 */

/** A resolved link from a class assignment to the dictation tool. */
export interface AssignmentLink {
  classId: number;
  assignmentId: number;
}

/**
 * A positive integer id, or null.
 *
 * @param raw whatever the query string carried.
 */
function toId(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Read `?classId=&assignmentId=` off a search-params object.
 *
 * @param params the page's `searchParams` (already decoded by Next.js).
 * @returns both ids when the link is well-formed, otherwise null.
 */
export function parseAssignmentLink(
  params: { classId?: string; assignmentId?: string } | null | undefined,
): AssignmentLink | null {
  if (!params) return null;
  const classId = toId(params.classId);
  const assignmentId = toId(params.assignmentId);
  if (classId === null || assignmentId === null) return null;
  return { classId, assignmentId };
}

/**
 * The link a class assignment points at.
 *
 * Both ids are always present: a link with only one of them cannot resolve
 * anything, so it would be a link to an empty form with a broken address bar.
 *
 * @param classId the class the assignment belongs to.
 * @param assignmentId the assignment.
 */
export function buildAssignmentDictationHref(classId: number, assignmentId: number): string {
  return `/dictation?classId=${classId}&assignmentId=${assignmentId}`;
}
