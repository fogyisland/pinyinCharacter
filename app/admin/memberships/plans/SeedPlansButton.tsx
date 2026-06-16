'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { seedAdminPlansRequest } from '@/lib/api-admin';

export function SeedPlansButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = useCallback(async () => {
    setBusy(true);
    const r = await seedAdminPlansRequest();
    setBusy(false);
    if (r.ok) router.refresh();
  }, [router]);
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
      {busy ? '初始化中…' : '初始化 4 档套餐'}
    </button>
  );
}
