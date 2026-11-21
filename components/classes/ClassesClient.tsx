'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createClassRequest,
  fetchMyClasses,
  joinClassRequest,
  type StudentClass,
  type TeacherClass,
} from '@/lib/api-classes';

/**
 * 班级页 — 老师建班、所有人用邀请码进班、看到自己所在的班。
 *
 * 页面的三种状态都要看得见：加载中、加载失败（带重试）、空（还没有班）。
 * 一个「白屏 + 什么都没有」的班级页会让老师以为功能坏了。
 */
interface State {
  teaching: TeacherClass[];
  joined: StudentClass[];
}

export function ClassesClient() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await fetchMyClasses();
      if (!result.ok) {
        setLoadError(result.error.message);
        setState({ teaching: [], joined: [] });
        return;
      }
      setState(result.data);
    } catch (failure) {
      // fetchMyClasses 已经把网络异常变成错误形状，走到这里说明是意外的
      // 运行时错误 —— 仍然要让老师看到一个能重试的页面。
      setLoadError(`班级列表暂时打不开：${(failure as Error).message}`);
      setState({ teaching: [], joined: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCreatedCode(null);
    const result = await createClassRequest(name, note);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCreatedCode(result.data.joinCode);
    setNotice('建班成功。把邀请码发到群里，学生就能进来。');
    setName('');
    setNote('');
    await load();
  }

  async function handleJoin(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await joinClassRequest(code.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setNotice(
      result.data.created
        ? '已加入班级。'
        : '你本来就在这个班里 —— 不用重复加入。',
    );
    setCode('');
    await load();
    router.refresh();
  }

  if (state === null && loadError === null) {
    return <p className="py-10 text-center text-ink-faint">正在打开班级列表…</p>;
  }

  if (loadError !== null) {
    return (
      <div className="py-10 text-center">
        <p className="text-ink-soft">班级列表暂时打不开：{loadError}</p>
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

  const teaching = state?.teaching ?? [];
  const joined = state?.joined ?? [];
  const isEmpty = teaching.length === 0 && joined.length === 0;

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
          {createdCode ? (
            <span className="ml-2 font-mono text-base tracking-widest">{createdCode}</span>
          ) : null}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card-paper space-y-3 p-4">
          <h2 className="text-sm font-medium">我是老师 · 建班</h2>
          <label className="block text-xs text-ink-soft">
            班级名
            <input
              aria-label="班级名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="HSK1 周三班"
              className="mt-1 w-full rounded border border-ink/20 bg-paper px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs text-ink-soft">
            备注（可选）
            <input
              aria-label="备注"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="周五交作业"
              className="mt-1 w-full rounded border border-ink/20 bg-paper px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || name.trim() === ''}
            className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80 disabled:bg-ink/20"
          >
            建班
          </button>
        </section>

        <section className="card-paper space-y-3 p-4">
          <h2 className="text-sm font-medium">我是学生 · 用邀请码进班</h2>
          <label className="block text-xs text-ink-soft">
            邀请码
            <input
              aria-label="邀请码"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
              maxLength={6}
              className="mt-1 w-full rounded border border-ink/20 bg-paper px-2 py-1.5 font-mono text-sm tracking-widest"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={busy || code.trim().length !== 6}
            className="rounded border border-seal px-3 py-1.5 text-sm text-seal hover:bg-seal/10 disabled:opacity-50"
          >
            加入
          </button>
        </section>
      </div>

      {isEmpty ? (
        <p className="py-8 text-center text-ink-faint">
          还没有班级 —— 当老师就建一个，当学生就向老师要邀请码。
        </p>
      ) : null}

      {teaching.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm text-ink-soft">我带的班</h2>
          <ul className="space-y-2">
            {teaching.map((item) => (
              <li key={item.id} className="rounded border border-ink/15 bg-paper px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/classes/${item.id}`}
                    className="font-medium text-ink hover:text-seal"
                  >
                    {item.name}
                  </Link>
                  <span className="text-xs text-ink-faint">{item.memberCount} 人</span>
                  <span className="ml-auto text-xs text-ink-soft">
                    邀请码 <span className="font-mono tracking-widest text-seal">{item.joinCode}</span>
                  </span>
                </div>
                {item.note ? <p className="mt-1 text-xs text-ink-faint">{item.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {joined.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm text-ink-soft">我在的班</h2>
          <ul className="space-y-2">
            {joined.map((item) => (
              <li key={item.id} className="rounded border border-ink/15 bg-paper px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/classes/${item.id}`}
                    className="font-medium text-ink hover:text-seal"
                  >
                    {item.name}
                  </Link>
                  <span className="text-xs text-ink-faint">{item.memberCount} 人</span>
                  <span className="ml-auto text-xs text-ink-soft">老师：{item.teacherName}</span>
                </div>
                {item.note ? <p className="mt-1 text-xs text-ink-faint">{item.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
