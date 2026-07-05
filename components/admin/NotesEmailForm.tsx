'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

export interface NotesEmailFormInitial {
  adminEmails: string;
}

export function NotesEmailForm({ initial }: { initial: NotesEmailFormInitial }) {
  const router = useRouter();
  const [value, setValue] = useState(initial.adminEmails);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await fetch('/api/admin/settings/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminEmails: value }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '保存失败');
      setOk(`已保存 (${j.data.count} 个收件人)`);
      setValue(j.data.adminEmails);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
      {err && <p className="text-sm text-seal">{err}</p>}
      {ok && (
        <p className="text-sm text-green-700 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />{ok}
        </p>
      )}

      <div>
        <label className="text-sm font-medium">通知邮箱</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="admin@example.com, dev@example.com"
          className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
        <p className="text-xs text-ink-soft mt-1">
          新留言的邮件通知会发到这里。多个邮箱用英文逗号分隔。留空则回退到「发件人地址」。
        </p>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50"
      >
        {busy ? '保存中…' : '保存'}
      </button>
    </form>
  );
}