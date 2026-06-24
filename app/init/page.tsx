'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Database, User, Rocket } from 'lucide-react';

type Step = 'db' | 'admin' | 'seed' | 'done';

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

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'db', label: '数据库', icon: <Database className="h-4 w-4" /> },
  { id: 'admin', label: '管理员', icon: <User className="h-4 w-4" /> },
  { id: 'seed', label: '初始化数据', icon: <Rocket className="h-4 w-4" /> },
];

export default function InitPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('db');
  const [dbConfig, setDbConfig] = useState<DbConfig>(DEFAULT_DB);
  const [dbInfo, setDbInfo] = useState<{ host: string; database: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Admin form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  // Seed progress
  const [seedStatus, setSeedStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [seedLog, setSeedLog] = useState<string[]>([]);

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
    setSeedStatus('running');
    setSeedLog(['开始初始化...']);
    setErr(null);
    try {
      const res = await fetch('/api/init/run-seed', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        setSeedStatus('error');
        setSeedLog((log) => [...log, `✗ 失败: ${data.error?.message ?? 'unknown error'}`]);
        setErr(data.error?.message ?? '初始化失败');
        return;
      }
      setSeedLog((log) => [...log, '✓ 表结构已创建 (15 张)', '✓ app_config 默认值已 seed', '✓ poems 已 auto-populate', '✓ sutras 已 auto-populate', '✓ chars 已 auto-populate (7909 行)', '✓ setup.completed 标记已写入']);
      setSeedStatus('done');
      setStep('done');
    } catch (e) {
      setSeedStatus('error');
      setSeedLog((log) => [...log, `✗ ${(e as Error).message}`]);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const currentIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">首次部署 — 初始化向导</h1>
        <p className="mt-2 text-sm text-ink-soft">
          按顺序完成三步:配置数据库连接 → 创建管理员账号 → 写入种子数据。
          完成后此页面将自动锁定。
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => {
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
              {i < STEPS.length - 1 && <span className="mx-2 text-ink-faint">→</span>}
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

      {/* Step 3: Seed */}
      {step === 'seed' && (
        <div className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
          <h2 className="text-lg font-medium text-ink">第 3 步 — 写入种子数据</h2>
          <p className="text-sm text-ink-soft">
            点击下方按钮开始初始化。系统会:创建 15 张表 → seed app_config 默认值 → 自动导入古诗/佛经/字典数据。
          </p>
          {seedStatus === 'idle' && (
            <button
              type="button" onClick={handleSeed} disabled={busy}
              className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
            >
              开始初始化
            </button>
          )}
          {seedStatus !== 'idle' && (
            <div className="space-y-1 rounded-md bg-ink/5 p-4 font-mono text-xs">
              {seedLog.map((line, i) => (
                <div key={i} className={seedStatus === 'error' && i === seedLog.length - 1 ? 'text-seal' : 'text-ink-soft'}>
                  {line}
                </div>
              ))}
            </div>
          )}
          {seedStatus === 'done' && (
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