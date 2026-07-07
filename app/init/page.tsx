import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { isSetupComplete } from '@/lib/setup';
import { markSetupCompletedCookie } from './actions';
import { EnsureSetupCompletedCookie } from './EnsureSetupCompletedCookie';

export const dynamic = 'force-dynamic';

/** RSC orchestrator for /init. Decides which of 3 wizard screens to show
 *  (or the locked card).
 *
 *  Cookie-set note (Next.js 15.5+): server-component pages cannot call
 *  `cookies().set()` directly ("Cookies can only be modified in a Server
 *  Action or Route Handler"). We therefore fire the Server Action
 *  `markSetupCompletedCookie` from a tiny client-side sibling that mounts
 *  when the locked card renders. The action sets `setup_completed=1` for
 *  10 years, after which subsequent navigation passes the cookie-only
 *  middleware check (Task 3) without bouncing back to /init.
 *
 *  Without this cookie, a fresh browser landing on /init after setup was
 *  already completed elsewhere would be trapped in a redirect loop
 *  (middleware: /login → /init → /login).
 */
export default async function InitOrchestrator() {
  if (await isSetupComplete()) {
    return (
      <>
        <EnsureSetupCompletedCookie />
        <AlreadyDoneCard />
      </>
    );
  }
  // Not yet complete: drop into step 1. The /init/db page itself does
  // prerequisite checks (DATABASE_URL → redirect to /init/admin, etc).
  redirect('/init/db');
}

function AlreadyDoneCard() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="rounded-md border border-green-300 bg-green-50 p-6 text-center">
        <Check className="mx-auto h-12 w-12 text-green-700" />
        <h2 className="mt-3 text-lg font-medium text-ink">系统已初始化完成</h2>
        <p className="mt-1 text-sm text-ink-soft">
          首次部署已完成,此页面已自动锁定。
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80"
        >
          前往登录 →
        </Link>
      </div>
    </div>
  );
}