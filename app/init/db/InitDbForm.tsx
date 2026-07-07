'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DEFAULT_DB: DbConfig = { host: '', port: 3306, user: '', password: '', database: 'pinyin' };

export function InitDbForm() {
  const router = useRouter();
  const [cfg, setCfg] = useState<DbConfig>(DEFAULT_DB);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '数据库连接失败');
        return;
      }
      // Clear password from state so a back-nav doesn't render the value.
      setCfg({ ...DEFAULT_DB, host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, password: '' });
      router.push('/init/admin');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 1 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        配置数据库连接。测试通过后会写入 .env 并自动跳到下一步。
      </p>
      {err && (
        <div className="mb-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-ink-soft">主机</label>
            <input
              type="text" required autoComplete="off" value={cfg.host}
              onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
              placeholder="例如 127.0.0.1 或 db.example.com"
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">端口</label>
            <input
              type="number" required min={1} max={65535} autoComplete="off" value={cfg.port}
              onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">Schema</label>
            <input
              type="text" required autoComplete="off" value={cfg.database}
              onChange={(e) => setCfg({ ...cfg, database: e.target.value })}
              placeholder="pinyin"
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">用户名</label>
            <input
              type="text" required autoComplete="off" value={cfg.user}
              onChange={(e) => setCfg({ ...cfg, user: e.target.value })}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">密码</label>
            <input
              type="password" autoComplete="current-password" value={cfg.password}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
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
    </>
  );
}
