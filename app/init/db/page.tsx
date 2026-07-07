import { redirect } from 'next/navigation';
import { InitDbForm } from './InitDbForm';

export const dynamic = 'force-dynamic';

export default function InitDbPage() {
  if (process.env.DATABASE_URL) {
    // DB already configured → skip straight to admin step
    redirect('/init/admin');
  }
  return (
    <div className="mx-auto max-w-2xl py-8">
      <InitDbForm />
    </div>
  );
}
