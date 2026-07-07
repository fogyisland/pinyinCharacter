'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'piyin.init.admin.creds';

export function InitAdminForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/stash-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '提交失败');
        return;
      }
      // Store token + display info. NO password — server holds it for 30s.
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          username,
          email: email || undefined,
          token: data.data.token,
        }),
      );
      setPassword(''); // wipe from component state
      router.push('/init/execute');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 2 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        创建第一个管理员账号。密码仅在服务端内存中临时保存 (30 秒),不会写入客户端存储。
      </p>
      {err && (
        <div className="mb-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
        <div>
          <label className="block text-sm font-medium text-ink-soft">
            用户名 (3-32 字符,a-z A-Z 0-9 _)
          </label>
          <input
            type="text" required minLength={3} maxLength={32} autoComplete="username"
            value={username} onChange={(e) => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_]+"
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">密码 (≥8 字符)</label>
          <input
            type="password" required minLength={8} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">邮箱 (可选)</label>
          <input
            type="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <button
          type="submit" disabled={busy}
          className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
        >
          {busy ? '提交中…' : '下一步'}
        </button>
      </form>
    </>
  );
}
