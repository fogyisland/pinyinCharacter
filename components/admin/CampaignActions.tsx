'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Panel } from '@/components/admin/Panel';
import { AdminButton } from '@/components/admin/AdminButton';

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
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/email/campaigns/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message ?? `${action} failed`);
      setMsg(
        action === 'preview' ? '预览已发到你的邮箱' : `已入队 ${data.data?.queued ?? 0} 个收件人`,
      );
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
    <Panel title="操作" description="预览会发到你自己的邮箱,发送走异步队列。">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <AdminButton
            type="button"
            variant="secondary"
            onClick={() => call('preview')}
            disabled={!canPreview || busy !== null}
          >
            {busy === 'preview' ? '发送中…' : '预览 (发给自己)'}
          </AdminButton>
          <AdminButton
            type="button"
            variant="primary"
            onClick={() => call('send')}
            disabled={!canSend || busy !== null}
          >
            {busy === 'send' ? '入队中…' : '发送 (异步)'}
          </AdminButton>
        </div>
        {msg && <p className="text-sm text-ink-soft">{msg}</p>}
        {status === 'sending' && (
          <p className="text-xs text-ink-faint">
            提示:发送中状态由 scheduler 异步处理,每分钟处理 50 封。可刷新查看进度。
          </p>
        )}
      </div>
    </Panel>
  );
}
