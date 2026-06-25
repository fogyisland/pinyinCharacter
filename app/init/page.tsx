'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2, Database, User, Rocket } from 'lucide-react';

type Step = 'db' | 'admin' | 'seed' | 'done';
type StepStatus = 'idle' | 'running' | 'done' | 'failed';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DEFAULT_DB: DbConfig = {
  host: '',
  port: 3306,
  user: '',
  password: '',
  database: 'pinyin',
};

const TOP_STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'db', label: '数据库', icon: <Database className="h-4 w-4" /> },
  { id: 'admin', label: '管理员', icon: <User className="h-4 w-4" /> },
  { id: 'seed', label: '初始化数据', icon: <Rocket className="h-4 w-4" /> },
];

// Sub-steps shown live during /init step 3. Each maps to one API call so the
// UI can flip its color the moment the server confirms success.
interface SubStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

const INITIAL_SUB_STEPS: SubStep[] = [
  { id: 'tables', label: '创建表结构 (18 张)', status: 'idle' },
  { id: 'app_config', label: '写入 app_config 默认值', status: 'idle' },
  { id: 'poems', label: '导入古诗 (从 data/poems/)', status: 'idle' },
  { id: 'sutras', label: '导入佛经 (从 data/sutras/)', status: 'idle' },
  { id: 'chars', label: '导入字典 (7909 字)', status: 'idle' },
  { id: 'mark_complete', label: '标记 setup.completed', status: 'idle' },
];

export default function InitPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('db');
  const [dbConfig, setDbConfig] = useState<DbConfig>(DEFAULT_DB);
  const [dbInfo, setDbInfo] = useState<{ host: string; database: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // null = unknown (still probing), true = setup is locked, false = fresh
  const [alreadyDone, setAlreadyDone] = useState<boolean | null>(null);

  // On mount, check whether /init is enabled. If setup is complete and the
  // wizard is locked out, show a "go to login" card instead of the form
  // (the API would reject any submission anyway with setup_disabled).
  useEffect(() => {
    fetch('/api/init/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.data?.setupComplete && !d.data?.routeEnabled) {
          setAlreadyDone(true);
        } else {
          setAlreadyDone(false);
        }
      })
      .catch(() => setAlreadyDone(false));
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  // Sub-step state for /init step 3 live progress.
  const [subSteps, setSubSteps] = useState<SubStep[]>(INITIAL_SUB_STEPS);

  function updateSubStep(id: string, patch: Partial<SubStep>) {
    setSubSteps((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function handleDbSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbConfig),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '数据库连接失败');
        return;
      }
      setDbInfo({ host: data.data.host, database: data.data.database });
      setStep('admin');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '创建管理员失败');
        return;
      }
      setStep('seed');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSeed() {
    setBusy(true);
    setErr(null);
    // Reset all sub-steps to idle so the user sees a clean progress run.
    setSubSteps(INITIAL_SUB_STEPS.map((s) => ({ ...s, status: 'idle', detail: undefined })));

    // initDb creates the full schema (latest ENUM values, all tables) in
    // one shot. Migrations are for upgrading older DBs and are NOT run
    // during /init — they reference tables that may not exist yet.
    const initDbSteps = ['tables', 'app_config', 'poems', 'sutras', 'chars'];
    for (const id of initDbSteps) updateSubStep(id, { status: 'running' });
    try {
      const r = await fetch('/api/init/init-db', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        const detail = d.error?.message ?? '失败';
        // Mark all initDb sub-steps as failed since we don't know how far it got.
        for (const id of initDbSteps) updateSubStep(id, { status: 'failed', detail });
        setErr(detail);
        setBusy(false);
        return;
      }
      // All initDb sub-steps succeeded.
      updateSubStep('tables', { status: 'done' });
      updateSubStep('app_config', { status: 'done' });
      updateSubStep('poems', { status: 'done' });
      updateSubStep('sutras', { status: 'done' });
      updateSubStep('chars', { status: 'done' });
    } catch (e) {
      const detail = (e as Error).message;
      for (const id of initDbSteps) updateSubStep(id, { status: 'failed', detail });
      setErr(detail);
      setBusy(false);
      return;
    }

    // Mark setup complete.
    updateSubStep('mark_complete', { status: 'running' });
    try {
      const r = await fetch('/api/init/mark-complete', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        updateSubStep('mark_complete', { status: 'failed', detail: d.error?.message ?? '失败' });
        setErr(d.error?.message ?? 'mark-complete 失败');
        setBusy(false);
        return;
      }
      updateSubStep('mark_complete', { status: 'done' });
      setStep('done');
    } catch (e) {
      updateSubStep('mark_complete', { status: 'failed', detail: (e as Error).message });
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const currentIdx = TOP_STEPS.findIndex((s) => s.id === step);
  const allSubDone = subSteps.every((s) => s.status === 'done');

  // While probing setup status, show a neutral loader to avoid a brief
  // flash of the wizard form when setup is actually already complete.
  if (alreadyDone === null) {
    return (
      <div className="mx-auto max-w-2xl py-8 text-center text-sm text-ink-soft">
        检查初始化状态…
      </div>
    );
  }

  // Locked state: setup is complete and the route is disabled. Show a
  // "go to login" card instead of the wizard — submitting any step would
  // fail with setup_disabled anyway.
  if (alreadyDone === true) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-md border border-green-300 bg-green-50 p-6 text-center">
          <Check className="mx-auto h-12 w-12 text-green-700" />
          <h2 className="mt-3 text-lg font-medium text-ink">系统已初始化完成</h2>
          <p className="mt-1 text-sm text-ink-soft">
            首次部署已完成,此页面已自动锁定。
          </p>
          <button
            type="button" onClick={() => router.push('/login')}
            className="mt-4 rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80"
          >
            前往登录 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">首次部署 — 初始化向导</h1>
        <p className="mt-2 text-sm text-ink-soft">
          按顺序完成三步:配置数据库连接 → 创建管理员账号 → 写入种子数据。
          完成后此页面将自动锁定。
        </p>
      </div>

      {/* Top-level step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {TOP_STEPS.map((s, i) => {
          const completed = i < currentIdx || step === 'done';
          const active = s.id === step;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                  completed ? 'border-green-600 bg-green-50 text-green-700'
                    : active ? 'border-seal bg-seal text-white'
                    : 'border-ink/20 bg-paper-soft text-ink-faint'
                }`}
              >
                {completed ? <Check className="h-4 w-4" /> : s.icon}
              </div>
              <span className={`text-sm ${active || completed ? 'text-ink font-medium' : 'text-ink-faint'}`}>
                {s.label}
              </span>
              {i < TOP_STEPS.length - 1 && <span className="mx-2 text-ink-faint">→</span>}
            </div>
          );
        })}
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}

      {/* Step 1: DB config */}
      {step === 'db' && (
        <form onSubmit={handleDbSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
          <h2 className="text-lg font-medium text-ink">第 1 步 — 数据库连接</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-ink-soft">主机</label>
              <input
                type="text" required value={dbConfig.host}
                onChange={(e) => setDbConfig({ ...dbConfig, host: e.target.value })}
                placeholder="例如 127.0.0.1 或 db.example.com"
                className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft">端口</label>
              <input
                type="number" required min={1} max={65535} value={dbConfig.port}
                onChange={(e) => setDbConfig({ ...dbConfig, port: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft">Schema</label>
              <input
                type="text" required value={dbConfig.database}
                onChange={(e) => setDbConfig({ ...dbConfig, database: e.target.value })}
                placeholder="pinyin"
                className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft">用户名</label>
              <input
                type="text" required value={dbConfig.user}
                onChange={(e) => setDbConfig({ ...dbConfig, user: e.target.value })}
                className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft">密码</label>
              <input
                type="password" value={dbConfig.password}
                onChange={(e) => setDbConfig({ ...dbConfig, password: e.target.value })}
                className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            连接测试会自动创建 schema (如果不存在)。生产环境请使用专用账号,不要 root。
          </p>
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
          >
            {busy ? '测试连接…' : '测试连接并保存'}
          </button>
        </form>
      )}

      {/* Step 2: Admin */}
      {step === 'admin' && dbInfo && (
        <form onSubmit={handleAdminSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
          <h2 className="text-lg font-medium text-ink">第 2 步 — 管理员账号</h2>
          <p className="text-sm text-ink-soft">
            数据库已连接至 <code className="rounded bg-ink/5 px-1">{dbInfo.host}/{dbInfo.database}</code>。
            创建第一个管理员账号。
          </p>
          <div>
            <label className="block text-sm font-medium text-ink-soft">用户名 (3-32 字符)</label>
            <input
              type="text" required minLength={3} maxLength={32} value={username}
              onChange={(e) => setUsername(e.target.value)}
              pattern="[a-zA-Z0-9_]+"
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">密码 (≥8 字符)</label>
            <input
              type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">邮箱 (可选)</label>
            <input
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep('db')} className="rounded-md border border-ink/20 px-4 py-2 text-sm hover:bg-paper-deep">
              ← 上一步
            </button>
            <button type="submit" disabled={busy} className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50">
              {busy ? '创建…' : '创建管理员'}
            </button>
          </div>
        </form>
      )}

      {/* Step 3: Seed — live progress with green/red cards per sub-step */}
      {step === 'seed' && (
        <div className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
          <h2 className="text-lg font-medium text-ink">第 3 步 — 写入种子数据</h2>
          <p className="text-sm text-ink-soft">
            点击下方按钮开始初始化。系统会依次执行以下步骤,每步状态实时显示。
          </p>

          <div className="space-y-2">
            {subSteps.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-md border-2 p-3 transition-colors ${
                  s.status === 'done' ? 'border-green-300 bg-green-50'
                    : s.status === 'failed' ? 'border-red-300 bg-red-50'
                    : s.status === 'running' ? 'border-blue-300 bg-blue-50'
                    : 'border-ink/15 bg-paper-soft'
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center">
                  {s.status === 'done' && <Check className="h-5 w-5 text-green-700" />}
                  {s.status === 'failed' && <X className="h-5 w-5 text-red-700" />}
                  {s.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                  {s.status === 'idle' && <span className="h-2 w-2 rounded-full bg-ink/20" />}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${
                    s.status === 'done' ? 'text-green-900'
                      : s.status === 'failed' ? 'text-red-900'
                      : s.status === 'running' ? 'text-blue-900'
                      : 'text-ink-soft'
                  }`}>
                    {s.label}
                  </div>
                  {s.detail && (
                    <div className={`mt-0.5 text-xs ${
                      s.status === 'failed' ? 'text-red-700' : 'text-ink-faint'
                    }`}>
                      {s.detail}
                    </div>
                  )}
                </div>
                <span className={`text-xs ${
                  s.status === 'done' ? 'text-green-700'
                    : s.status === 'failed' ? 'text-red-700'
                    : s.status === 'running' ? 'text-blue-600'
                    : 'text-ink-faint'
                }`}>
                  {s.status === 'done' && '完成'}
                  {s.status === 'failed' && '失败'}
                  {s.status === 'running' && '进行中'}
                  {s.status === 'idle' && '等待'}
                </span>
              </div>
            ))}
          </div>

          {!allSubDone && subSteps.every((s) => s.status === 'idle') && (
            <button
              type="button" onClick={handleSeed} disabled={busy}
              className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
            >
              开始初始化
            </button>
          )}
          {!allSubDone && subSteps.some((s) => s.status === 'failed') && (
            <button
              type="button" onClick={handleSeed} disabled={busy}
              className="rounded-md bg-amber-600 px-6 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? '重试中…' : '重试失败步骤'}
            </button>
          )}
          {allSubDone && (
            <button
              type="button" onClick={() => router.push('/login')}
              className="rounded-md bg-green-700 px-6 py-2 text-white hover:bg-green-800"
            >
              完成 — 前往登录 →
            </button>
          )}
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="rounded-md border border-green-300 bg-green-50 p-6 text-center">
          <Check className="mx-auto h-12 w-12 text-green-700" />
          <h2 className="mt-3 text-lg font-medium text-ink">初始化完成</h2>
          <p className="mt-1 text-sm text-ink-soft">
            数据库已就绪,管理员账号已创建,种子数据已写入。
          </p>
        </div>
      )}
    </div>
  );
}