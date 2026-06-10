'use client';

import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/audit', label: '审计日志' },
  { href: '/admin/stats', label: '系统统计' },
];

export function AdminNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="w-48 border-r bg-white">
      <ul className="py-4">
        {ITEMS.map(item => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <a href={item.href}
                className={`block px-4 py-2 text-sm ${active ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600' : 'text-gray-700 hover:bg-gray-50'}`}>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
