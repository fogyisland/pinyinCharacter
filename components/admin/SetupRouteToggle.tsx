'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminButton } from '@/components/admin/AdminButton';

interface Props {
  initial: { completed: boolean; enabled: boolean };
}

export function SetupRouteToggle({ initial }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setMsg(null);
    try {
      const next = !enabled;
      const res = await fetch('/api/admin/setup/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error?.message ?? 'Failed');
        return;
      }
      setEnabled(next);
      setMsg(next ? '/init 路由已开启' : '/init 路由已关闭');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-ink/10 bg-paper-soft p-6 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-kai text-base text-ink">/init 路由状态</h2>
          <p className="mt-1 text-xs text-ink-faint">
            初始化状态: {initial.completed ? '✓ 已完成' : '✗ 未完成'} · 路由访问:{' '}
            {enabled ? '✓ 允许' : '✗ 锁定'}
          </p>
        </div>
        <AdminButton
          onClick={toggle}
          disabled={busy}
          variant={enabled ? 'danger' : 'primary'}
        >
          {busy ? '处理中…' : enabled ? '关闭路由' : '开启路由'}
        </AdminButton>
      </div>
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}
    </div>
  );
}
