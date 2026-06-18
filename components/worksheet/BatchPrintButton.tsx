'use client';

import { useState } from 'react';
import { useToastStore } from '@/lib/toast-store';
import { BatchPrintPreview, type BatchPrintItem } from './BatchPrintPreview';

interface Props {
  selectedIds: number[];
  hasFeature: boolean;
}

export function BatchPrintButton({ selectedIds, hasFeature }: Props) {
  const push = useToastStore((s) => s.push);
  const [items, setItems] = useState<BatchPrintItem[]>([]);
  const [busy, setBusy] = useState(false);

  const count = selectedIds.length;
  const label = hasFeature
    ? `批量打印 (${count})`
    : `批量打印 (${count}) — 需会员`;

  if (!hasFeature) {
    return (
      <a
        href="/membership"
        className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
      >
        {label} →
      </a>
    );
  }

  const onClick = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/worksheets/print-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worksheetIds: selectedIds }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data?.error?.code === 'membership_required') {
          push('error', '升级会员后可批量/多页打印');
        } else {
          push('error', data?.error?.message || '批量打印失败');
        }
        return;
      }
      setItems(data.data.worksheets);
      setTimeout(() => window.print(), 50);
    } catch {
      push('error', '网络错误');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={count === 0 || busy}
        className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/90 disabled:opacity-50"
      >
        {busy ? '准备中…' : label}
      </button>
      {items.length > 0 && <BatchPrintPreview items={items} />}
    </>
  );
}