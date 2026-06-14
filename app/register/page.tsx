'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useAppStore(s => s.setUser);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) {
      setError('用户名仅支持 3-32 位字母数字下划线短横线');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('邮箱格式不正确');
      return;
    }
    if (password.length < 8) { setError('密码至少 8 位'); return; }
    if (password !== passwordConfirm) { setError('两次密码不一致'); return; }

    setBusy(true);
    const r = await registerRequest(username, email, password);
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    router.push('/');
  }

  return (
    <div className="mx-auto max-w-sm card-paper p-6 mt-8">
      <div className="font-kai text-ink-faint tracking-[0.3em] text-xs text-center mb-4">字 · 韵</div>
      <h1 className="font-serif text-2xl text-ink text-center mb-6">注册</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          placeholder="用户名 (3-32 字符)"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="密码 (≥ 8 字符)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="再次输入密码"
          value={passwordConfirm}
          onChange={e => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
        />
        {error && <p className="text-sm text-seal">{error}</p>}
        <button type="submit" disabled={busy} className="w-full btn-seal disabled:opacity-50">
          {busy ? '...' : '注册'}
        </button>
      </form>
      <p className="text-xs text-ink-faint mt-4 text-center">
        已有账号？<Link href="/login" className="text-seal hover:underline">去登录</Link>
      </p>
    </div>
  );
}
