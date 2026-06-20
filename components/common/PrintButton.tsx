'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { useToastStore } from '@/lib/toast-store';
import { useAppStore } from '@/lib/store';

interface Props {
  endpoint: string;
  label?: string;
  sourceId?: string;
  gate?: 'multi_page' | null;
  loginRedirect?: string;
}

export function PrintButton({ endpoint, label = '打印', sourceId, gate = null, loginRedirect }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canPrint, setCanPrint] = useState<boolean | null>(null);
  const user = useAppStore((s) => s.user);
  const push = useToastStore((s) => s.push);

  useEffect(() => {
    if (gate !== 'multi_page') return;
    const m = endpoint.match(/\/api\/worksheets\/(\d+)\/print/);
    if (!m) return;
    const id = Number(m[1]);
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/worksheets/${id}/can-print`);
        const data = await r.json();
        if (cancelled) return;
        if (data?.ok && data?.data) {
          setCanPrint(data.data.canPrint !== false);
        } else {
          setCanPrint(true);
        }
      } catch {
        if (!cancelled) setCanPrint(true);
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint, gate]);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === 'membership_required') {
          push('error', '升级会员后可批量/多页打印');
        }
        throw new Error(data?.error?.message ?? 'print failed');
      }
      window.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (gate === 'multi_page' && canPrint === false) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        本字帖超过 1 页，升级会员可打印全部页面 ·{' '}
        <Link href="/membership" className="text-seal underline">
          升级 →
        </Link>
      </div>
    );
  }

  if (!user) {
    const href = loginRedirect
      ? `/login?redirect=${encodeURIComponent(loginRedirect)}`
      : '/login';
    return (
      <Link
        href={href}
        className="rounded-md border border-ink/20 bg-paper px-4 py-2 text-sm text-ink hover:bg-paper-warm inline-flex items-center gap-1.5"
      >
        <Printer className="h-4 w-4" />
        登录后{label}
      </Link>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-ink/20 bg-paper px-4 py-2 text-sm text-ink hover:bg-paper-warm disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Printer className="h-4 w-4" />
        {busy ? '准备中…' : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}