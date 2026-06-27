'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  id: number;
  status: string;
}

export function CampaignActions({ id, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(action: 'preview' | 'send'): Promise<void> {
    const key = action;
    setBusy(key); setMsg(null);
    try {
      const res = await fetch(`/api/admin/email/campaigns/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message ?? `${action} failed`);
      setMsg(action === 'preview' ? '预览已发到你的邮箱' : `已入队 ${data.data?.queued ?? 0} 个收件人`);
      router.refresh();
    } catch (e) {
      setMsg('失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  const canPreview = status === 'draft' || status === 'failed';
  const canSend = status === 'draft' || status === 'failed';

  return (
    <div className="border border-paper-warm rounded-md p-4 space-y-3">
      <h2 className="text-sm font-medium text-ink-soft">操作</h2>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => call('preview')}
          disabled={!canPreview || busy !== null}
          className="px-3 py-1.5 rounded-md border border-ink text-ink text-sm hover:bg-paper-warm disabled:opacity-50"
        >
          {busy === 'preview' ? '发送中…' : '预览 (发给自己)'}
        </button>
        <button
          onClick={() => call('send')}
          disabled={!canSend || busy !== null}
          className="px-3 py-1.5 rounded-md bg-ink text-paper text-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'send' ? '入队中…' : '发送 (异步)'}
        </button>
      </div>
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}
      {status === 'sending' && (
        <p className="text-xs text-ink-faint">
          提示:发送中状态由 scheduler 异步处理,每分钟处理 50 封。可刷新查看进度。
        </p>
      )}
    </div>
  );
}