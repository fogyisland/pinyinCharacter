import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { createAssignmentSchema } from '@/lib/classes-schema';
import { buildAssignmentPayload, sortAssignments } from '@/lib/classes';
import {
  createAssignment,
  getClassForUser,
  listAssignments,
} from '@/lib/classes-store';

export const dynamic = 'force-dynamic';

function toId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * GET /api/classes/[id]/assignments — 这个班派了什么作业。
 *
 * 老师与学生都看得到；不是这个班的人 404。
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await context.params;
    const classId = toId(id);
    if (classId === null) return badRequest('bad_input', '班级 id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }
    const assignments = await listAssignments(classId);
    return NextResponse.json({
      ok: true,
      data: { assignments: sortAssignments(assignments), role: found.role },
    });
  });
}

/**
 * POST /api/classes/[id]/assignments — 派作业（仅老师）。
 *
 * 权限看的是「你是不是这个班的老师」，不是「你是不是登录了」：一个学生
 * 完全可能是另一个班的老师，但在这个班里他没有派作业的权力。
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await context.params;
    const classId = toId(id);
    if (classId === null) return badRequest('bad_input', '班级 id 不合法');

    const found = await getClassForUser(classId, user.id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'class_not_found', message: '班级不存在' } },
        { status: 404 },
      );
    }
    if (found.role !== 'teacher') {
      return NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '只有老师能派作业' } },
        { status: 403 },
      );
    }

    const parsed = createAssignmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }

    const payload =
      parsed.data.kind === 'worksheet'
        ? buildAssignmentPayload({
            kind: 'worksheet',
            title: parsed.data.title,
            worksheetId: parsed.data.worksheetId,
            chars: parsed.data.chars,
          })
        : buildAssignmentPayload({
            kind: 'dictation',
            title: parsed.data.title,
            items: parsed.data.items,
          });

    const created = await createAssignment({
      classId,
      title: parsed.data.title,
      kind: parsed.data.kind,
      payload,
      dueAt: parsed.data.dueAt ?? null,
    });

    await logUserAction(req, user.id, 'class_assignment_created', {
      classId,
      assignmentId: created.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
    });

    return NextResponse.json({ ok: true, data: created });
  });
}
