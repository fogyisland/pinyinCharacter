import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorizedForLogin } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getClassForUser, listDictationResults } from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/classes/[id]/dictation-results
 *
 * 班级页一次拿全班听写成绩（老师）或只拿自己的（学生）。逐份作业各发
 * 一个请求会让 N 份作业变成 N 次往返，这里用一条查询 + 一次遍历解决。
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const classId = Number((await context.params).id);
    if (!Number.isInteger(classId) || classId <= 0) return badRequest('bad_input', 'id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }

    const rows = await listDictationResultsForClass(classId);
    const resultsByAssignment: Record<number, typeof rows> = {};
    for (const row of rows) {
      if (found.role !== 'teacher' && row.userId !== user.id) continue;
      (resultsByAssignment[row.assignmentId] ??= []).push(row);
    }
    return NextResponse.json({ ok: true, data: { resultsByAssignment } });
  });
}

type ResultRow = Awaited<ReturnType<typeof listDictationResults>>[number] & {
  assignmentId: number;
};

async function listDictationResultsForClass(classId: number): Promise<ResultRow[]> {
  // 复用 classes-store 的分作业查询：先取本班听写作业 id，再逐份查询。
  // 班级规模是十到二十人、作业通常个位数，这里的往返次数可以接受。
  const { listAssignments, listDictationResults } = await import('@/lib/classes-store');
  const assignments = await listAssignments(classId);
  const out: ResultRow[] = [];
  for (const assignment of assignments) {
    if (assignment.kind !== 'dictation') continue;
    const results = await listDictationResults(assignment.id);
    for (const result of results) out.push({ ...result, assignmentId: assignment.id });
  }
  return out;
}
