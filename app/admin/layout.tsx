import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth';
import { Header } from '@/components/Header';
import { AdminNav } from '@/components/AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    else redirect('/?error=forbidden');
  }
  return (
    <div className="min-h-screen flex flex-col">
      <Suspense>
        <Header />
      </Suspense>
      <div className="flex-1 flex">
        <AdminNav />
        <main className="flex-1 p-6 bg-gray-50">{children}</main>
      </div>
    </div>
  );
}
