'use client';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './AdminSidebar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/admin';
  return (
    // The gutter lives on the content column, not on the shell: the sidebar
    // carries its own hairline border, and a `gap` between the two pushed
    // that border away from the panel edge it was supposed to close off.
    <div className="adm-surface flex flex-col md:flex-row max-w-7xl mx-auto">
      <AdminSidebar currentPath={path} />
      <main className="flex-1 min-w-0 p-4 md:p-5">{children}</main>
    </div>
  );
}
