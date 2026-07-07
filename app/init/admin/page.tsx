import { redirect } from 'next/navigation';
import { isInitWizardAdminDone } from '@/lib/setup';
import { InitAdminForm } from './InitAdminForm';

export const dynamic = 'force-dynamic';

export default async function InitAdminPage() {
  if (!process.env.DATABASE_URL) {
    redirect('/init/db');
  }
  if (await isInitWizardAdminDone()) {
    // Already submitted step 2 → skip to step 3
    redirect('/init/execute');
  }
  return (
    <div className="mx-auto max-w-2xl py-8">
      <InitAdminForm />
    </div>
  );
}
