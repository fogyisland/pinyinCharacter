'use client';

import { useState } from 'react';
import { loginRequest, registerRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';
import { validateUsername, validatePassword } from '@/lib/auth-client';

type Mode = 'login' | 'register';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setUser = useAppStore(s => s.setUser);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) { setError(uErr || pErr); return; }

    setBusy(true);
    const r = mode === 'login'
      ? await loginRequest(username, password)
      : await registerRequest(username, password);
    setBusy(false);

    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card-paper rounded shadow-paper-lg w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="font-kai text-ink-faint tracking-[0.3em] text-xs text-center mb-4">字 · 韵</div>
        <div className="flex gap-2 mb-4 border-b border-ink/10">
          <button
            type="button"
            className={`px-3 py-2 font-kai ${mode === 'login' ? 'border-b-2 border-seal text-ink font-semibold' : 'text-ink-faint'}`}
            onClick={() => setMode('login')}
          >登录</button>
          <button
            type="button"
            className={`px-3 py-2 font-kai ${mode === 'register' ? 'border-b-2 border-seal text-ink font-semibold' : 'text-ink-faint'}`}
            onClick={() => setMode('register')}
          >注册</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
            placeholder="用户名 (3-32 字符)"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete={mode === 'login' ? 'username' : 'username'}
            disabled={busy}
          />
          <input
            className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
            type="password"
            placeholder="密码 (≥ 8 字符)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={busy}
          />
          {error && <p className="text-sm text-seal">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full btn-seal disabled:opacity-50"
          >
            {busy ? '...' : (mode === 'login' ? '登录' : '注册')}
          </button>
        </form>
        {mode === 'login' && (
          <p className="text-xs text-ink-faint mt-3 text-center">
            <a href="/forgot-password" className="text-seal hover:underline">忘记密码</a>
          </p>
        )}
      </div>
    </div>
  );
}
