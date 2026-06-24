'use client';
import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  devOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  // devOnly: 本地开发用的初始化面板(seed/mocked LLM/DDL),prod 不暴露
  { href: '/admin/chars/init', label: '⚙ 初始化', exact: true, devOnly: true },
  { href: '/admin/scheduler', label: '定期更新', exact: true },
  { href: '/admin/memberships', label: '会员' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
  { href: '/admin/email', label: '邮件' },
  { href: '/admin/settings/site-url', label: '站点设置' },
];

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  // process.env.NODE_ENV 在 next build 时被 webpack 内联为字面量,无需动态 import
  const isProd = process.env.NODE_ENV === 'production';
  const items = ITEMS.filter(item => !item.devOnly || !isProd);
  return (
    <nav className="flex md:flex-col gap-1 md:w-40 border-b md:border-b-0 md:border-r border-paper-warm md:min-h-[calc(100vh-4rem)] p-2">
      {items.map(item => {
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
