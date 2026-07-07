import { redirect } from 'next/navigation';
import { isSetupComplete } from '@/lib/setup';
import { InitExecuteForm } from './InitExecuteForm';

export const dynamic = 'force-dynamic';

export default async function InitExecutePage() {
  if (!process.env.DATABASE_URL) redirect('/init/db');
  if (await isSetupComplete()) {
    // Bounce to orchestrator — it'll set cookie + show locked card
    redirect('/init');
  }
  return (
    <div className="mx-auto max-w-3xl py-8">
      <InitExecuteForm />
    </div>
  );
}
