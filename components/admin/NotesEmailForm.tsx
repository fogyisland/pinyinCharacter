'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { parseNotesAdminEmails, isValidEmail } from '@/lib/notes-email-config';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

export interface NotesEmailFormInitial {
  adminEmails: string;
}

export function NotesEmailForm({ initial }: { initial: NotesEmailFormInitial }) {
  const router = useRouter();
  const [value, setValue] = useState(initial.adminEmails);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Compute parsed email count using the same logic as the server.
  const trimmed = value.trim();
  const allParts = parseNotesAdminEmails(value);
  const validCount = allParts.filter(isValidEmail).length;
  const hasInvalid = trimmed !== '' && validCount === 0;
  const submitDisabled = busy || hasInvalid;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
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
    <Panel
      title="通知邮箱"
      description="新留言的邮件通知会发到这里。多个邮箱用英文逗号分隔,留空则回退到「发件人地址」。"
    >
      <form onSubmit={save} className="space-y-3 max-w-xl">
        {err && (
          <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
            {err}
          </p>
        )}
        {ok && (
          <p className="text-sm text-success inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />
            {ok}
          </p>
        )}

        <FormField
          label="通知邮箱"
          htmlFor="notes-admin-emails"
          error={hasInvalid ? '请检查邮箱格式,当前 0 个有效地址' : undefined}
          hint={
            !hasInvalid && trimmed !== '' && validCount > 0 ? `将通知 ${validCount} 个邮箱` : undefined
          }
        >
          <input
            id="notes-admin-emails"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="admin@example.com, dev@example.com"
            className="adm-input"
          />
        </FormField>

        <AdminButton type="submit" variant="primary" disabled={submitDisabled}>
          {busy ? '保存中…' : '保存'}
        </AdminButton>
      </form>
    </Panel>
  );
}
