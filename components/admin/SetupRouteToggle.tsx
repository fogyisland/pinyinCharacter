'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <div className="space-y-3 rounded-md border border-ink/20 bg-paper-soft p-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-ink">/init 路由状态</h2>
          <p className="mt-1 text-xs text-ink-faint">
            初始化状态: {initial.completed ? '✓ 已完成' : '✗ 未完成'} ·
            路由访问: {enabled ? '✓ 允许' : '✗ 锁定'}
          </p>
        </div>
        <button
          type="button" onClick={toggle} disabled={busy}
          className={`rounded-md px-4 py-2 text-sm text-white ${
            enabled ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-700 hover:bg-green-800'
          } disabled:opacity-50`}
        >
          {busy ? '处理中…' : enabled ? '关闭路由' : '开启路由'}
        </button>
      </div>
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}
    </div>
  );
}