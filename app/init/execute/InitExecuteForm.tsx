'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';
import { InitHeader } from '@/components/init/InitHeader';
import { StepGroup } from '@/components/init/StepGroup';

const STORAGE_KEY = 'piyin.init.admin.creds';

interface SubStep {
  id: 'tables' | 'app_config' | 'poems' | 'sutras' | 'chars' | 'create_admin' | 'activate' | 'migrations' | 'mark_complete';
  label: string;
  status: 'idle' | 'running' | 'done' | 'failed';
  detail?: string;
}

const INITIAL: SubStep[] = [
  { id: 'tables', label: '创建表结构', status: 'idle' },
  { id: 'app_config', label: '写入 app_config 默认值', status: 'idle' },
  { id: 'poems', label: '导入古诗 (data/poems/)', status: 'idle' },
  { id: 'sutras', label: '导入佛经 (data/sutras/)', status: 'idle' },
  { id: 'chars', label: '导入字典 (data/chars)', status: 'idle' },
  { id: 'create_admin', label: '创建管理员账号', status: 'idle' },
  { id: 'activate', label: '写入平台激活信息', status: 'idle' },
  { id: 'migrations', label: '应用迁移文件', status: 'idle' },
  { id: 'mark_complete', label: '标记 setup.completed', status: 'idle' },
];

export function InitExecuteForm() {
  const router = useRouter();
  const [creds, setCreds] = useState<{ username: string; email?: string; token: string } | null>(null);
  const [subSteps, setSubSteps] = useState<SubStep[]>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) {
      // User skipped step 2 (or sessionStorage was cleared). Send back.
      router.replace('/init/admin');
      return;
    }
    try {
      setCreds(JSON.parse(raw));
    } catch {
      router.replace('/init/admin');
    }
  }, [router]);

  function update(id: SubStep['id'], patch: Partial<SubStep>) {
    setSubSteps((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function summarizeAutoPopulate(r: { inserted: number; skipped: boolean; failed?: string }) {
    if (r.failed) return `失败: ${r.failed}`;
    if (r.skipped) return '已跳过 (表内已有数据)';
    return `新增 ${r.inserted.toLocaleString('zh-CN')} 行`;
  }

  async function runPhases() {
    if (!creds) return;
    setBusy(true);
    setErr(null);
    setSubSteps(INITIAL.map((s) => ({ ...s, status: 'idle', detail: undefined })));

    const phases: Array<{ id: SubStep['id']; endpoint: string; body?: any; format: (d: any) => string }> = [
      { id: 'tables', endpoint: '/api/init/init-tables',
        format: (d) => `${d.statementsRun} 条 DDL 写入完成,当前 ${d.tablesNow} 张表` },
      { id: 'app_config', endpoint: '/api/init/init-app-config',
        format: (d) => `${d.totalRows} 条配置 (era 默认 + ai/tts)` },
      { id: 'poems', endpoint: '/api/init/init-poems',
        format: summarizeAutoPopulate },
      { id: 'sutras', endpoint: '/api/init/init-sutras',
        format: summarizeAutoPopulate },
      { id: 'chars', endpoint: '/api/init/init-chars',
        format: summarizeAutoPopulate },
      { id: 'create_admin', endpoint: '/api/init/create-admin',
        body: { token: creds.token },
        format: (d) => `已创建 (id=${d.userId})` },
      { id: 'activate', endpoint: '/api/init/init-activate',
        format: (d) => d.seeded ? `已写入 (short_name=${d.shortName})` : '已存在,跳过' },
      { id: 'migrations', endpoint: '/api/init/migrate',
        format: (d) => `${d.files} 个 SQL 文件 / ${d.statements} 条语句` },
    ];

    for (const phase of phases) {
      update(phase.id, { status: 'running' });
      try {
        const res = await fetch(phase.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: phase.body ? JSON.stringify(phase.body) : undefined,
        });
        const data = await res.json();
        if (!data.ok) {
          const detail = data.error?.message ?? '失败';
          update(phase.id, { status: 'failed', detail });
          setErr(`${phase.id} 失败: ${detail}`);
          setBusy(false);
          return;
        }
        update(phase.id, { status: 'done', detail: phase.format(data.data) });
      } catch (e) {
        const detail = (e as Error).message;
        update(phase.id, { status: 'failed', detail });
        setErr(`${phase.id} 失败: ${detail}`);
        setBusy(false);
        return;
      }
    }

    // mark-complete
    update('mark_complete', { status: 'running' });
    try {
      const r = await fetch('/api/init/mark-complete', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        update('mark_complete', { status: 'failed', detail: d.error?.message ?? '失败' });
        setErr(d.error?.message ?? 'mark-complete 失败');
        setBusy(false);
        return;
      }
      update('mark_complete', { status: 'done' });
      // Clean up sessionStorage — token is consumed server-side.
      sessionStorage.removeItem(STORAGE_KEY);
      // Bounce to /init orchestrator — it sets cookie + shows locked card.
      router.push('/init');
    } catch (e) {
      update('mark_complete', { status: 'failed', detail: (e as Error).message });
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!creds) {
    return <div className="text-sm text-ink-soft">加载中…</div>;
  }

  const groups: { title: string; ids: SubStep['id'][] }[] = [
    { title: '数据库结构', ids: ['tables', 'app_config', 'migrations'] },
    { title: '数据导入', ids: ['poems', 'sutras', 'chars'] },
    { title: '账号与激活', ids: ['create_admin', 'activate', 'mark_complete'] },
  ];

  function statusClass(s: SubStep['status']) {
    return s === 'done'
      ? 'border-green-300 bg-green-50'
      : s === 'failed'
      ? 'border-red-300 bg-red-50'
      : s === 'running'
      ? 'border-blue-300 bg-blue-50'
      : 'border-ink/15 bg-paper-soft';
  }

  function renderCard(s: SubStep) {
    return (
      <div
        key={s.id}
        className={`flex items-center gap-3 rounded-md border-2 p-3 ${statusClass(s.status)}`}
      >
        <div className="flex h-6 w-6 items-center justify-center">
          {s.status === 'done' && <Check className="h-5 w-5 text-green-700" />}
          {s.status === 'failed' && <X className="h-5 w-5 text-red-700" />}
          {s.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
          {s.status === 'idle' && <span className="h-2 w-2 rounded-full bg-ink/20" />}
        </div>
        <div className="flex-1">
          <div
            className={`text-sm font-medium ${
              s.status === 'done'
                ? 'text-green-900'
                : s.status === 'failed'
                ? 'text-red-900'
                : s.status === 'running'
                ? 'text-blue-900'
                : 'text-ink-soft'
            }`}
          >
            {s.label}
          </div>
          {s.detail && (
            <div className={`mt-0.5 text-xs ${s.status === 'failed' ? 'text-red-700' : 'text-ink-faint'}`}>
              {s.detail}
            </div>
          )}
        </div>
        <span
          className={`text-xs ${
            s.status === 'done'
              ? 'text-green-700'
              : s.status === 'failed'
              ? 'text-red-700'
              : s.status === 'running'
              ? 'text-blue-600'
              : 'text-ink-faint'
          }`}
        >
          {s.status === 'done' && '完成'}
          {s.status === 'failed' && '失败'}
          {s.status === 'running' && '进行中'}
          {s.status === 'idle' && '等待'}
        </span>
      </div>
    );
  }

  const allIdle = subSteps.every((s) => s.status === 'idle');
  const someFailed = subSteps.some((s) => s.status === 'failed');
  const allDone = subSteps.every((s) => s.status === 'done');

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 3 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        点击下方按钮开始初始化。系统会依次执行以下步骤,每步状态实时显示。<br />
        创建管理员:<code className="rounded bg-ink/5 px-1">{creds.username}</code>
        {creds.email ? (
          <>
            {' '}
            (<code>{creds.email}</code>)
          </>
        ) : null}
      </p>
      <InitHeader currentStep={2} />
      {err && (
        <div className="my-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <div className="space-y-4">
        {groups.map((g) => {
          const items = g.ids.map((id) => subSteps.find((s) => s.id === id)!).filter(Boolean);
          const completed = items.filter((s) => s.status === 'done').length;
          return (
            <StepGroup key={g.title} title={g.title} completedCount={completed} total={items.length}>
              {items.map(renderCard)}
            </StepGroup>
          );
        })}
      </div>
      <div className="mt-6 flex justify-center">
        {allIdle && (
          <button
            type="button" onClick={runPhases} disabled={busy}
            className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
          >
            开始初始化
          </button>
        )}
        {someFailed && (
          <button
            type="button" onClick={runPhases} disabled={busy}
            className="rounded-md bg-amber-600 px-6 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? '重试中…' : '重试失败步骤'}
          </button>
        )}
        {allDone && (
          <a
            href="/login"
            className="rounded-md bg-green-700 px-6 py-2 text-white hover:bg-green-800"
          >
            完成 — 前往登录 →
          </a>
        )}
      </div>
    </>
  );
}
