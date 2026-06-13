'use client';
import { useState } from 'react';
import { Printer } from 'lucide-react';

export function PrintButton({ endpoint, label = '打印', sourceId }: {
  endpoint: string; label?: string; sourceId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (!data.ok) throw new Error(data.error?.message ?? 'print failed');
      window.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
