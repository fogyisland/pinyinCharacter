'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  deleteAssignmentRequest,
  fetchClassDetail,
  removeMemberRequest,
  submitAssignmentRequest,
  withdrawSubmissionRequest,
  fetchDictationResultsRequest,
  submitDictationResultRequest,
  withdrawDictationResultRequest,
  type ClassDetail,
  type DictationResultView,
} from '@/lib/api-classes';
import { AssignmentComposer } from './AssignmentComposer';
import { buildAssignmentDictationHref } from '@/lib/dictation-url';

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
  /** 学生提交前的可选留言草稿，按作业 id 保存。 */
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});
  /** assignmentId → 听写成绩列表（老师看全班，学生只看自己）。 */
  const [dictationResults, setDictationResults] = useState<Record<number, DictationResultView[]>>(
    {},
  );
  /** 学生提交成绩的草稿。 */
  const [resultDraft, setResultDraft] = useState<
    Record<number, { total: string; correct: string; wrong: string }>
  >({});

  const loadResults = useCallback(async () => {
    const result = await fetchDictationResultsRequest(classId);
    if (result.ok) setDictationResults(result.data.resultsByAssignment);
  }, [classId]);

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
    void loadResults();
  }, [load, loadResults]);

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

  /** 学生勾选「我练完了」，可附一句给老师的留言。 */
  async function handleSubmit(assignmentId: number): Promise<void> {
    setBusy(true);
    setError(null);
    const note = (draftNotes[assignmentId] ?? '').trim();
    const result = await submitAssignmentRequest(classId, assignmentId, note);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDraftNotes((prev) => {
      const next = { ...prev };
      delete next[assignmentId];
      return next;
    });
    await load();
  }

  /** 学生撤销完成。 */
  async function handleWithdraw(assignmentId: number): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await withdrawSubmissionRequest(classId, assignmentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  /** 提交听写自报成绩。 */
  async function handleSubmitResult(assignmentId: number): Promise<void> {
    const draft = resultDraft[assignmentId] ?? { total: '10', correct: '', wrong: '' };
    const total = Number(draft.total);
    const correct = Number(draft.correct);
    if (!Number.isInteger(total) || total < 1 || total > 200) {
      setError('总条数需为 1–200 的整数');
      return;
    }
    if (!Number.isInteger(correct) || correct < 0 || correct > total) {
      setError('答对数需在 0 与总条数之间');
      return;
    }
    const wrongWords = draft.wrong
      .split(/[,，\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    const result = await submitDictationResultRequest(classId, assignmentId, {
      total,
      correct,
      wrongWords,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await loadResults();
  }

  async function handleWithdrawResult(assignmentId: number): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await withdrawDictationResultRequest(classId, assignmentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await loadResults();
  }

  /** 老师视图：把已完成的用户 id 换成名字。 */
  function completedNames(assignmentId: number): string {
    const ids = detail?.progress[assignmentId] ?? [];
    if (ids.length === 0) return '';
    const names = ids.map((id) => {
      const member = detail?.members.find((m) => m.userId === id);
      return member ? member.username : `#${id}`;
    });
    return names.join('、');
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
                  {/* 完成进度：老师看全班，学生看自己。 */}
                  <span className="text-xs text-ink-soft" data-testid={`progress-${assignment.id}`}>
                    已完成 {(detail.progress[assignment.id] ?? []).length} / {detail.members.length}{' '}
                    人
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {assignment.kind === 'worksheet' ? (
                      <Link
                        href={`/worksheet?prefill=${encodeURIComponent(assignment.payload.kind === 'worksheet' ? assignment.payload.chars.slice(0, 60).join('') : '')}`}
                        className="text-seal hover:underline"
                      >
                        打印字帖
                      </Link>
                    ) : (
                      <Link
                        href={buildAssignmentDictationHref(classId, assignment.id)}
                        className="text-seal hover:underline"
                      >
                        打开听写
                      </Link>
                    )}
                    {/* The learner should be able to READ the words, not just
                        trust the link. The list is what the teacher assigned. */}
                    {assignment.payload.kind === 'dictation' ? (
                      <span className="text-xs text-ink-faint">
                        {assignment.payload.items.length} 个词
                      </span>
                    ) : null}
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

                {/* 学生：勾选「我练完了」。完成的口径就是这次勾选 —— 打印
                    不作为完成条件。 */}
                {!isTeacher ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {detail.mySubmissions[assignment.id] ? (
                      <>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">
                          我练完了 · {detail.mySubmissions[assignment.id].completedAt.slice(0, 10)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleWithdraw(assignment.id)}
                          disabled={busy}
                          className="text-ink-faint hover:text-danger disabled:opacity-40"
                        >
                          撤销
                        </button>
                      </>
                    ) : (
                      <div className="flex w-full flex-wrap items-center gap-2">
                        <input
                          type="text"
                          aria-label={`给第 ${assignment.id} 项作业留言（可选）`}
                          maxLength={512}
                          value={draftNotes[assignment.id] ?? ''}
                          onChange={(event) =>
                            setDraftNotes((prev) => ({
                              ...prev,
                              [assignment.id]: event.target.value,
                            }))
                          }
                          placeholder="给老师留言（可选）"
                          disabled={busy}
                          className="min-w-0 flex-1 rounded border border-ink/15 bg-paper px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSubmit(assignment.id)}
                          disabled={busy}
                          className="rounded border border-seal px-2 py-0.5 text-seal hover:bg-seal/10 disabled:opacity-50"
                        >
                          我练完了
                        </button>
                      </div>
                    )}
                    {detail.mySubmissions[assignment.id]?.note ? (
                      <span className="text-ink-soft">
                        留言：{detail.mySubmissions[assignment.id].note}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* 听写成绩：学生填报，老师查看全班。 */}
                {assignment.kind === 'dictation' ? (
                  <div className="mt-2 border-t border-ink/10 pt-2 text-xs">
                    {!isTeacher
                      ? (() => {
                          const mine = (dictationResults[assignment.id] ?? []).find(
                            (row) => row.userId === detail.teacherId || true,
                          );
                          const draft = resultDraft[assignment.id] ?? {
                            total: String(
                              assignment.payload.kind === 'dictation'
                                ? assignment.payload.items.length
                                : 10,
                            ),
                            correct: '',
                            wrong: '',
                          };
                          return mine ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-success/15 px-2 py-0.5 text-success">
                                听写成绩 {mine.correct}/{mine.total}
                              </span>
                              {mine.wrongWords.length > 0 ? (
                                <span className="text-ink-soft">
                                  错词：{mine.wrongWords.join('、')}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void handleWithdrawResult(assignment.id)}
                                disabled={busy}
                                className="text-ink-faint hover:text-danger disabled:opacity-40"
                              >
                                撤销成绩
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="sr-only" htmlFor={`result-total-${assignment.id}`}>
                                总条数
                              </label>
                              <input
                                id={`result-total-${assignment.id}`}
                                type="number"
                                min={1}
                                max={200}
                                value={draft.total}
                                onChange={(event) =>
                                  setResultDraft((prev) => ({
                                    ...prev,
                                    [assignment.id]: { ...draft, total: event.target.value },
                                  }))
                                }
                                className="w-16 rounded border border-ink/15 bg-paper px-2 py-1"
                                aria-label="总条数"
                              />
                              <span className="text-ink-faint">条中答对</span>
                              <label
                                className="sr-only"
                                htmlFor={`result-correct-${assignment.id}`}
                              >
                                答对条数
                              </label>
                              <input
                                id={`result-correct-${assignment.id}`}
                                type="number"
                                min={0}
                                max={200}
                                value={draft.correct}
                                onChange={(event) =>
                                  setResultDraft((prev) => ({
                                    ...prev,
                                    [assignment.id]: { ...draft, correct: event.target.value },
                                  }))
                                }
                                className="w-16 rounded border border-ink/15 bg-paper px-2 py-1"
                                aria-label="答对条数"
                              />
                              <label className="sr-only" htmlFor={`result-wrong-${assignment.id}`}>
                                错词（逗号分隔）
                              </label>
                              <input
                                id={`result-wrong-${assignment.id}`}
                                type="text"
                                value={draft.wrong}
                                onChange={(event) =>
                                  setResultDraft((prev) => ({
                                    ...prev,
                                    [assignment.id]: { ...draft, wrong: event.target.value },
                                  }))
                                }
                                placeholder="错词，逗号分隔"
                                className="min-w-0 flex-1 rounded border border-ink/15 bg-paper px-2 py-1"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSubmitResult(assignment.id)}
                                disabled={busy || draft.correct === ''}
                                className="rounded border border-seal px-2 py-1 text-seal hover:bg-seal/10 disabled:opacity-50"
                              >
                                提交成绩
                              </button>
                            </div>
                          );
                        })()
                      : (() => {
                          const rows = dictationResults[assignment.id] ?? [];
                          return (
                            <div className="space-y-1">
                              <p className="font-medium text-ink-soft">
                                听写成绩 · {rows.length} 人已报
                              </p>
                              {rows.length === 0 ? (
                                <p className="text-ink-faint">还没有人提交成绩。</p>
                              ) : (
                                <ul className="space-y-0.5">
                                  {rows.map((row) => (
                                    <li key={row.userId} className="flex flex-wrap gap-2">
                                      <span className="text-ink">{row.username}</span>
                                      <span className="font-medium text-seal">
                                        {row.correct}/{row.total}
                                      </span>
                                      {row.wrongWords.length > 0 ? (
                                        <span className="text-ink-faint">
                                          错词：{row.wrongWords.join('、')}
                                        </span>
                                      ) : null}
                                      {row.note ? (
                                        <span className="text-ink-soft">留言：{row.note}</span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })()}
                  </div>
                ) : null}

                {/* 老师：谁做完了（头像式的名字列表）。 */}
                {isTeacher ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    已完成：{completedNames(assignment.id) || '还没有人'}
                  </p>
                ) : null}
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
