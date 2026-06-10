'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { resetPasswordRequest } from '@/lib/api-auth';
import { validatePasswordConfirmation } from '@/lib/auth-client';

export function ResetForm({ token, username }: { token: string; username: string }) {
  const setUser = useAppStore(s => s.setUser);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cErr = validatePasswordConfirmation(pw, pw2);
    if (cErr) { setError(cErr); return; }
    if (pw.length < 8) { setError('密码至少 8 位'); return; }
    setSubmitting(true);
    const r = await resetPasswordRequest(token, pw);
    if (r.ok) {
      setUser(r.data.user);
      setTimeout(() => { window.location.href = '/'; }, 1000);
    } else {
      setSubmitting(false);
      setError(r.error.message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-gray-700">你好,{username}。请输入新密码 (至少 8 位)。</p>
      <div>
        <label className="block text-sm mb-1">新密码</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)}
          className="w-full border rounded px-3 py-2" required minLength={8} maxLength={72} />
      </div>
      <div>
        <label className="block text-sm mb-1">再次输入</label>
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
          className="w-full border rounded px-3 py-2" required minLength={8} maxLength={72} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50">
        {submitting ? '提交中…' : '重置密码'}
      </button>
    </form>
  );
}
