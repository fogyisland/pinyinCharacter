import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorizedForLogin } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getClassForUser } from '@/lib/classes-store';
import {
  clearDictationResult,
  listDictationResults,
  recordDictationResult,
} from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

const ResultSchema = z.object({
  total: z.number().int().min(1).max(200),
  correct: z.number().int().min(0).max(200),
  wrongWords: z.array(z.string().min(1).max(64)).max(200).default([]),
});

function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: { code: 'not_found', message } }, { status: 404 });
}

/**
 * POST /api/classes/[id]/assignments/[assignmentId]/result
 * 学生提交听写自报成绩。只有本班成员能提交，作业必须是听写类型。
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const { id, assignmentId } = await context.params;
    const classId = toId(id);
    const targetId = toId(assignmentId);
    if (classId === null || targetId === null) return badRequest('bad_input', 'id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) return notFound('班级不存在');

    const parsed = ResultSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const { total, correct, wrongWords } = parsed.data;
    if (correct > total) {
      return badRequest('bad_input', '答对数不能超过总条数');
    }

    const recorded = await recordDictationResult({
      assignmentId: targetId,
      classId,
      userId: user.id,
      total,
      correct,
      wrongWords: wrongWords.slice(0, total),
    });
    if (!recorded) return notFound('这份听写作业不属于这个班');

    return NextResponse.json({ ok: true, data: { recorded: true, total, correct } });
  });
}

/** GET — 老师看到全班成绩，学生只看到自己的。 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const { id, assignmentId } = await context.params;
    const classId = toId(id);
    const targetId = toId(assignmentId);
    if (classId === null || targetId === null) return badRequest('bad_input', 'id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) return notFound('班级不存在');

    const all = await listDictationResults(targetId);
    const results = found.role === 'teacher' ? all : all.filter((row) => row.userId === user.id);
    return NextResponse.json({ ok: true, data: { results } });
  });
}

/** DELETE — 学生撤销自己提交的成绩。 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorizedForLogin();
    const { id, assignmentId } = await context.params;
    const classId = toId(id);
    const targetId = toId(assignmentId);
    if (classId === null || targetId === null) return badRequest('bad_input', 'id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) return notFound('班级不存在');

    const cleared = await clearDictationResult(targetId, user.id);
    return NextResponse.json({ ok: true, data: { cleared } });
  });
}
