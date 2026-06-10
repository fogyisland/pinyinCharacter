'use client';

import { useState } from 'react';
import { forgotPasswordRequest } from '@/lib/api-auth';

export function ForgotForm() {
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await forgotPasswordRequest(username);
    setSubmitting(false);
    if (r.ok) {
      setDone(true);
    } else if (r.error.code === 'rate_limited') {
      setError('请求过于频繁,请稍后再试');
    } else if (r.error.code === 'email_not_configured') {
      setError('邮件服务未配置,请联系管理员');
    } else {
      setError(r.error.message);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-gray-700">
        如果该用户存在,重置链接已发送。请检查邮箱。开发环境下,链接会同时打印到 server console。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block text-sm mb-1">用户名</label>
        <input
          type="text" value={username} onChange={e => setUsername(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required minLength={3} maxLength={32}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50">
        {submitting ? '提交中…' : '发送重置链接'}
      </button>
    </form>
  );
}
