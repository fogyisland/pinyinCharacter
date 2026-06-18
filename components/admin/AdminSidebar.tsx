'use client';
import Link from 'next/link';

const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/chars/init', label: '⚙ 初始化', exact: true },
  { href: '/admin/scheduler', label: '定期更新', exact: true },
  { href: '/admin/memberships', label: '会员' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
];

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  return (
    <nav className="flex md:flex-col gap-1 md:w-40 border-b md:border-b-0 md:border-r border-paper-warm md:min-h-[calc(100vh-4rem)] p-2">
      {ITEMS.map(item => {
        const isActive = item.exact ? currentPath === item.href : currentPath.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'px-3 py-2 rounded-md text-sm ' +
              (isActive ? 'bg-ink text-paper' : 'hover:bg-paper-warm text-ink')
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
