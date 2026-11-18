'use client';

import { useState } from 'react';

/**
 * Change the signed-in user's password.
 *
 * The card is the only way to change a password without the forgot-password
 * email or an admin. The API requires the CURRENT password - without that
 * check the endpoint would be a free password reset for anyone who finds
 * an open session on a shared machine.
 *
 * ⚠️ The session cookie is dropped when the password changes. The card says
 * so, because otherwise the user lands on the login screen and thinks the
 * site broke.
 */

const ENDPOINT = '/api/auth/change-password';

interface Envelope {
  ok?: boolean;
  error?: { code?: string; message?: string };
}

type Status = 'idle' | 'submitting' | 'done';

export function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    setStatus('submitting');
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      let body: Envelope = {};
      try {
        body = (await response.json()) as Envelope;
      } catch (err) {
        console.error('[change-password] the API answer was not JSON', err);
      }

      if (!response.ok) {
        setError(body.error?.message || '修改失败,请稍后再试');
        setStatus('idle');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('done');
      setMessage('密码已修改,请重新登录。');
    } catch (err) {
      console.error('[change-password] the request failed', err);
      setError('网络错误,请稍后再试');
      setStatus('idle');
    }
  }

  return (
    <div className="mt-4 card-paper p-5">
      <h2 className="font-kai text-lg text-ink">修改密码</h2>
      <p className="text-xs text-ink-faint mt-1">
        修改成功后当前登录会失效，需要用新密码重新登录。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 max-w-sm">
        <div>
          <label htmlFor="cp-current" className="block text-xs text-ink-soft mb-1">
            当前密码
          </label>
          <input
            id="cp-current"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label htmlFor="cp-new" className="block text-xs text-ink-soft mb-1">
            新密码
          </label>
          <input
            id="cp-new"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label htmlFor="cp-confirm" className="block text-xs text-ink-soft mb-1">
            确认新密码
          </label>
          <input
            id="cp-confirm"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          />
        </div>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-xs text-success">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn-seal text-sm"
          disabled={status === 'submitting' || status === 'done'}
        >
          {status === 'submitting' ? '提交中…' : status === 'done' ? '已修改' : '修改密码'}
        </button>
      </form>
    </div>
  );
}
