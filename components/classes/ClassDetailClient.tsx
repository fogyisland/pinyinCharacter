'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  deleteAssignmentRequest,
  fetchClassDetail,
  removeMemberRequest,
  type ClassDetail,
} from '@/lib/api-classes';
import { AssignmentComposer } from './AssignmentComposer';

/**
 * 一个班的详情页：邀请码、成员名单、作业列表。
 *
 * 老师多两个动作：派作业、移出成员。学生只有一个：退出班级。
 * 「解散班级」不在这一页 —— 那需要一次明确的操作，放在列表页之外的
 * 危险区域里会更容易被误点。
 */
export function ClassDetailClient({ classId }: { classId: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await fetchClassDetail(classId);
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    setDetail(result.data);
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRemove(userId: number): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await removeMemberRequest(classId, userId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
    router.refresh();
  }

  async function handleDeleteAssignment(assignmentId: number): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await deleteAssignmentRequest(classId, assignmentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  if (loadError !== null) {
    return (
      <div className="py-10 text-center">
        <p className="text-ink-soft">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded border border-seal bg-seal px-4 py-2 text-paper-soft hover:opacity-90"
        >
          重试
        </button>
      </div>
    );
  }

  if (detail === null) {
    return <p className="py-10 text-center text-ink-faint">正在打开班级…</p>;
  }

  const isTeacher = detail.role === 'teacher';

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="rounded border border-ink/15 bg-paper px-4 py-3" data-class-header>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl font-medium text-ink">{detail.name}</span>
          <span className="text-xs text-ink-faint">{detail.members.length} 人</span>
          {detail.joinCode ? (
            <span className="ml-auto text-xs text-ink-soft">
              邀请码 <span className="font-mono tracking-widest text-seal">{detail.joinCode}</span>
            </span>
          ) : null}
        </div>
        {detail.note ? <p className="mt-1 text-xs text-ink-faint">{detail.note}</p> : null}
      </div>

      {isTeacher ? (
        <div>
          {composing ? (
            <AssignmentComposer
              classId={classId}
              onDone={() => {
                setComposing(false);
                void load();
              }}
              onCancel={() => setComposing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80"
            >
              派作业
            </button>
          )}
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm text-ink-soft">作业 · {detail.assignments.length}</h2>
        {detail.assignments.length === 0 ? (
          <p className="py-4 text-sm text-ink-faint">还没有作业。</p>
        ) : (
          <ul className="space-y-2">
            {detail.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="rounded border border-ink/15 bg-paper px-3 py-2"
                data-assignment
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-ink">{assignment.title}</span>
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink-soft">
                    {assignment.kind === 'dictation' ? '听写' : '字帖'}
                  </span>
                  {assignment.dueAt ? (
                    <span className="text-xs text-ink-faint">截止 {assignment.dueAt}</span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {assignment.kind === 'worksheet' ? (
                      <Link
                        href={`/worksheet?prefill=${encodeURIComponent(assignment.payload.kind === 'worksheet' ? assignment.payload.chars.slice(0, 60).join('') : '')}`}
                        className="text-seal hover:underline"
                      >
                        打印字帖
                      </Link>
                    ) : (
                      <Link href="/dictation" className="text-seal hover:underline">
                        打开听写
                      </Link>
                    )}
                    {isTeacher ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteAssignment(assignment.id)}
                        disabled={busy}
                        className="text-ink-faint hover:text-danger disabled:opacity-40"
                      >
                        删除
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm text-ink-soft">成员 · {detail.members.length}</h2>
        <ul className="space-y-1">
          {detail.members.map((member) => {
            const isSelf = member.userId === detail.teacherId && isTeacher;
            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded border border-ink/10 bg-paper px-3 py-1.5 text-sm"
              >
                <span className="text-ink">{member.username}</span>
                {member.userId === detail.teacherId ? (
                  <span className="rounded bg-seal/10 px-1.5 py-0.5 text-xs text-seal">老师</span>
                ) : null}
                {isTeacher && !isSelf ? (
                  <button
                    type="button"
                    onClick={() => void handleRemove(member.userId)}
                    disabled={busy}
                    className="ml-auto text-xs text-ink-faint hover:text-danger disabled:opacity-40"
                  >
                    移出
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
