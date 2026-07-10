'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const EXCLUDE_PREFIXES = ['/admin', '/api', '/_next'];

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    if (EXCLUDE_PREFIXES.some(p => pathname.startsWith(p))) return;
    fetch('/api/track/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}