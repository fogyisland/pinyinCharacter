'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  devOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/init', label: '初始化检查' },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/scheduler', label: '定期更新', exact: true },
  { href: '/admin/memberships', label: '会员' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
  { href: '/admin/email', label: '邮件' },
  { href: '/admin/email/campaigns', label: '营销邮件' },
  { href: '/admin/notes', label: '留言笔记' },
  { href: '/admin/settings/site-url', label: '站点设置' },
  { href: '/admin/settings/fonts', label: '字源字体' },
  { href: '/admin/settings/audio', label: '佛经音频' },
  { href: '/admin/settings/notes', label: '留言通知邮箱' },
  { href: '/admin/settings/setup', label: '初始化路由' },
];

function NavLinks({ items, currentPath, onNavigate }: { items: NavItem[]; currentPath: string; onNavigate?: () => void }) {
  return (
    <>
      {items.map(item => {
        const isActive = item.exact ? currentPath === item.href : currentPath.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={
              'px-3 py-2 rounded-md text-sm ' +
              (isActive ? 'bg-ink text-paper' : 'hover:bg-paper-warm text-ink')
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  const isProd = process.env.NODE_ENV === 'production';
  const items = ITEMS.filter(item => !item.devOnly || !isProd);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      {/* 移动端汉堡按钮(放在 nav 之外,父容器 flex 会把它推右) */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-paper-warm bg-paper-soft">
        <span className="font-kai text-base text-ink">管理后台</span>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 -mr-2 text-ink"
          aria-label="打开菜单"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* 桌面端侧栏(md 及以上) */}
      <nav className="hidden md:flex flex-col gap-1 w-40 border-r border-paper-warm min-h-[calc(100vh-4rem)] p-2">
        <NavLinks items={items} currentPath={currentPath} />
      </nav>

      {/* 移动端全屏抽屉(md 以下) */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-ink/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-64 max-w-[calc(100vw-2rem)] bg-paper-soft p-4 shadow-paper-lg overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <span className="font-kai text-lg text-ink">管理后台</span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="关闭菜单"
                className="p-2 -mr-2 text-ink"
              >
                <X size={22} />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              <NavLinks items={items} currentPath={currentPath} onNavigate={() => setMobileOpen(false)} />
            </nav>
          </div>
        </div>
      )}
    </>
  );
}