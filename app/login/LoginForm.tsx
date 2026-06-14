'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';
import { validateUsername, validatePassword } from '@/lib/auth-client';

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const setUser = useAppStore(s => s.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) { setError(uErr || pErr); return; }
    setBusy(true);
    const r = await loginRequest(username, password);
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    const next = search.get('next') || '/';
    router.push(next);
  }

  return (
    <div className="mx-auto max-w-sm card-paper p-6 mt-8">
      <div className="font-kai text-ink-faint tracking-[0.3em] text-xs text-center mb-4">字 · 韵</div>
      <h1 className="font-serif text-2xl text-ink text-center mb-6">登录</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          placeholder="用户名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
        />
        {error && <p className="text-sm text-seal">{error}</p>}
        <button type="submit" disabled={busy} className="w-full btn-seal disabled:opacity-50">
          {busy ? '...' : '登录'}
        </button>
      </form>
      <div className="flex justify-between text-xs text-ink-faint mt-4">
        <Link href="/forgot-password" className="text-seal hover:underline">忘记密码</Link>
        <Link href="/register" className="hover:underline">没有账号？去注册</Link>
      </div>
    </div>
  );
}