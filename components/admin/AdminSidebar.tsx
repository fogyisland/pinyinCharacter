'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Crown,
  Download,
  KeyRound,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Route,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Type,
  Users,
  Volume2,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  /** Match the path exactly — used by the pages that have sub-pages. */
  exact?: boolean;
  /** Only shown outside production. */
  devOnly?: boolean;
  /** The icon shown before the label. */
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The admin's navigation.
 *
 * The groups are the sections an operator thinks in: what is the site
 * doing (概览), what keeps it running (运维), who uses it (用户), what it
 * holds (内容), how the site itself is set up (站点) and how it talks to
 * the outside world (通讯). Every entry carries an icon, because a
 * twenty-item list of identical text is slow to scan — and the icon is
 * what tells two same-length labels apart at a glance.
 */
export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: '概览',
    items: [{ href: '/admin', label: '仪表盘', exact: true, icon: LayoutDashboard }],
  },
  {
    label: '运维',
    items: [
      { href: '/admin/init', label: '初始化检查', icon: ClipboardCheck },
      { href: '/admin/settings/setup', label: '初始化路由', icon: Route },
      { href: '/admin/scheduler', label: '定期更新', exact: true, icon: CalendarClock },
      { href: '/admin/logs', label: '日志', icon: ScrollText },
      { href: '/admin/audit', label: '审计日志', icon: ShieldCheck },
      { href: '/admin/analytics', label: '访问分析', icon: BarChart3 },
    ],
  },
  {
    label: '用户',
    items: [
      { href: '/admin/users', label: '用户', icon: Users },
      { href: '/admin/memberships', label: '会员', icon: Crown },
      { href: '/admin/mcp', label: 'MCP 管理', icon: KeyRound },
    ],
  },
  {
    label: '内容',
    items: [
      { href: '/admin/chars', label: '字典 / 字源', icon: BookOpen },
      { href: '/admin/settings/fonts', label: '字源字体', icon: Type },
      { href: '/admin/settings/audio', label: '佛经音频', icon: AudioLines },
    ],
  },
  {
    label: '站点',
    items: [
      { href: '/admin/settings/site-url', label: '站点设置', icon: Settings },
      { href: '/admin/downloads', label: '下载', icon: Download },
      { href: '/admin/tts', label: '语音设置', icon: Volume2 },
      { href: '/admin/ai', label: 'AI', icon: Sparkles },
    ],
  },
  {
    label: '通讯',
    items: [
      { href: '/admin/email', label: '邮件', exact: true, icon: Mail },
      { href: '/admin/email/campaigns', label: '营销邮件', icon: Send },
      { href: '/admin/notes', label: '留言笔记', icon: MessageSquare },
      { href: '/admin/settings/notes', label: '留言通知邮箱', icon: Bell },
    ],
  },
];

/**
 * Whether a nav entry is the one the operator is looking at.
 *
 * The prefix match is bound to a path segment: `/admin/mcp` lights up for
 * `/admin/mcp` and for `/admin/mcp/anything`, but not for
 * `/admin/mcp-something` — a plain `startsWith` would light up the wrong
 * entry there. An entry marked `exact` only lights up for itself, which is
 * what a page with sub-pages needs (`/admin/email` against
 * `/admin/email/campaigns`).
 *
 * The rule lives here, in one place, so the test can assert against it
 * instead of against a copy of it.
 */
export function isNavItemActive(item: NavItem, currentPath: string): boolean {
  if (item.exact) return currentPath === item.href;
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

function NavLinks({
  items,
  currentPath,
  onNavigate,
}: {
  items: NavItem[];
  currentPath: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        const isActive = isNavItemActive(item, currentPath);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap ' +
              (isActive ? 'bg-ink text-paper' : 'hover:bg-paper-deep/50 text-ink')
            }
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function Section({
  group,
  currentPath,
  onNavigate,
}: {
  group: NavGroup;
  currentPath: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 mb-1">
      <div className="px-3 pt-3 pb-1 text-[10px] font-medium text-ink-soft/50 select-none">
        {group.label}
      </div>
      <NavLinks items={group.items} currentPath={currentPath} onNavigate={onNavigate} />
    </div>
  );
}

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  const isProd = process.env.NODE_ENV === 'production';
  const groups = ADMIN_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.devOnly || !isProd),
  })).filter((g) => g.items.length > 0);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      {/* 移动端汉堡按钮(放在 nav 之外,父容器 flex 会把它推右) */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-ink/10 bg-paper-soft">
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
      <nav className="hidden md:flex flex-col w-48 shrink-0 border-r border-ink/10 min-h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] overflow-y-auto p-2">
        {groups.map((group) => (
          <Section key={group.label} group={group} currentPath={currentPath} />
        ))}
      </nav>

      {/* 移动端全屏抽屉(md 以下) */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-ink/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-64 max-w-[calc(100vw-2rem)] bg-paper-soft p-4 shadow-paper-lg overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <span className="font-kai text-lg text-ink">管理后台</span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="关闭菜单"
                className="p-2 -mr-2 text-ink"
              >
                <X size={22} />
              </button>
            </div>
            <nav className="flex flex-col">
              {groups.map((group) => (
                <Section
                  key={group.label}
                  group={group}
                  currentPath={currentPath}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
