'use client';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './AdminSidebar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/admin';
  return (
    <div className="flex flex-col md:flex-row gap-4 max-w-7xl mx-auto p-4">
      <AdminSidebar currentPath={path} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
