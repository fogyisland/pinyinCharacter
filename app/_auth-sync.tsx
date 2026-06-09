'use client';

import { useEffect } from 'react';
import { meRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';

export function AuthSync() {
  const setUser = useAppStore(s => s.setUser);
  useEffect(() => {
    let cancelled = false;
    meRequest().then(r => {
      if (cancelled) return;
      if (r.ok) setUser(r.data.user);
      else setUser(null);
    }).catch(() => { /* 网络错误保持 store 原值 */ });
    return () => { cancelled = true; };
  }, [setUser]);
  return null;
}
