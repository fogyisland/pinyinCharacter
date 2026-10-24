'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { seedAdminPlansRequest } from '@/lib/api-admin';
import { AdminButton } from '@/components/admin/AdminButton';

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
    <AdminButton variant="primary" size="md" onClick={onClick} disabled={busy}>
      {busy ? '初始化中…' : '初始化 4 档套餐'}
    </AdminButton>
  );
}
