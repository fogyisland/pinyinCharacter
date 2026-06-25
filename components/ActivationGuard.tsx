import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { isLocked } from '@/lib/activation';

/**
 * Server-component gate for platform activation lock.
 *
 * Sits inside the root layout, after the fresh-deploy middleware has
 * already verified DATABASE_URL is set. Reads the singleton activate row
 * on every server-rendered request (cheap — single row by PK) and
 * redirects to /activate when the cloud has paused this install.
 *
 * Loop-prevention: pathname-based check, so /activate renders through
 * without redirect. /api/* paths also pass through — API callers (e.g.
 * the /activate page polling /api/activation/status) need to work even
 * when locked.
 *
 * Defensive: any DB error allows the request through. The lock is a
 * soft control, not a hard security boundary — losing availability on
 * a transient blip is worse than letting one request through.
 */
export async function ActivationGuard({ children }: { children: ReactNode }) {
  // Read pathname from request headers (Next.js exposes this in server components)
  const h = await headers();
  const pathname = h.get('x-invoke-path') ?? h.get('x-pathname') ?? h.get('next-url') ?? '';
  // /activate and /api/activation/* are always allowed
  if (pathname === '/activate' || pathname.startsWith('/api/activation/')) {
    return <>{children}</>;
  }
  // Skip the lock check for API routes — most APIs serve their own
  // auth/role checks and shouldn't be blocked by a platform-level lock.
  // (The cloud pause affects human users, not service-to-service calls.)
  if (pathname.startsWith('/api/')) {
    return <>{children}</>;
  }
  try {
    if (await isLocked()) {
      redirect('/activate');
    }
  } catch {
    /* allow through on error */
  }
  return <>{children}</>;
}
