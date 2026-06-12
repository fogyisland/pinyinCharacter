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
    <nav className="w-48 border-r bg-paper">
      <ul className="py-4">
        {ITEMS.map(item => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <a href={item.href}
                className={`block px-4 py-2 text-sm ${active ? 'bg-seal/10 text-seal border-r-2 border-seal' : 'text-ink-soft hover:bg-paper-deep'}`}>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
