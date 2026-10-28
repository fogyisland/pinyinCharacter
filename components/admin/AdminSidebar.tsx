'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Menu, X } from 'lucide-react';
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
 * doing (概览), what the site offers the outside world through AI (AI 与
 * MCP), what keeps it running (运维), who uses it (用户), what it holds
 * (内容), how the site itself is set up (站点) and how it talks to the
 * outside world (通讯). Every entry carries an icon, because a
 * twenty-item list of identical text is slow to scan — and the icon is
 * what tells two same-length labels apart at a glance.
 *
 * The MCP service has a group of its own, next to the AI settings. It is
 * not one user's page: it is the site's own machine-readable surface,
 * and the operator's job there is not "manage a user" but "manage the
 * service and the tokens that reach it".
 */
export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: '概览',
    items: [{ href: '/admin', label: '仪表盘', exact: true, icon: LayoutDashboard }],
  },
  {
    label: 'AI 与 MCP',
    items: [
      { href: '/admin/ai', label: 'AI', icon: Sparkles },
      { href: '/admin/mcp', label: 'MCP 管理', icon: KeyRound },
    ],
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
            data-testid={`admin-nav-item-${item.href}`}
            className={
              'flex items-center gap-2 px-3 py-2 rounded-md text-[15px] whitespace-nowrap ' +
              (isActive ? 'bg-ink text-paper' : 'hover:bg-paper-deep/50 text-ink')
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * One group of the navigation, folded by its title.
 *
 * The groups are the headings of the sidebar, and a heading that cannot
 * be folded is a heading that always costs the same space. Twenty-one
 * entries over seven groups is a column that has to be scrolled; folded,
 * it is seven lines, and the operator opens the one group they need.
 *
 * The group holding the page the operator is looking at is the one that
 * is open — see `AdminSidebar`.
 */
function Section({
  group,
  index,
  currentPath,
  isOpen,
  onToggle,
  onNavigate,
  idPrefix,
}: {
  group: NavGroup;
  index: number;
  currentPath: string;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  idPrefix: string;
}) {
  const panelId = `${idPrefix}-group-${index}`;
  return (
    <div className="flex flex-col gap-0.5 mb-1">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        data-testid={`admin-nav-group-${group.label}`}
        className="flex items-center gap-1.5 px-3 pt-3.5 pb-1.5 text-[13px] font-medium text-ink-soft/70 select-none hover:text-ink-soft"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {group.label}
      </button>
      {isOpen ? (
        <div id={panelId} className="flex flex-col gap-0.5">
          <NavLinks items={group.items} currentPath={currentPath} onNavigate={onNavigate} />
        </div>
      ) : null}
    </div>
  );
}

export function AdminSidebar({ currentPath }: { currentPath: string }) {
  const isProd = process.env.NODE_ENV === 'production';
  const groups = useMemo(
    () =>
      ADMIN_NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((item) => !item.devOnly || !isProd),
      })).filter((g) => g.items.length > 0),
    [isProd],
  );

  /**
   * The group that holds the page being looked at.
   *
   * The operator must never have to hunt for where they are: the group
   * of the current page is open, whatever the operator has folded.
   */
  const activeGroupLabel = useMemo(() => {
    for (const group of groups) {
      if (group.items.some((item) => isNavItemActive(item, currentPath))) return group.label;
    }
    return null;
  }, [groups, currentPath]);

  // The groups that are open. The list starts with the current page's
  // group and nothing else: the sidebar is folded, like the catalogue
  // on the MCP page.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(activeGroupLabel ? [activeGroupLabel] : []),
  );

  // Moving to another page opens the group of that page. The state is
  // adjusted during the render rather than in an effect, so the new
  // group is already open in the same frame — an effect would show the
  // folded sidebar for one frame first.
  const [lastActiveLabel, setLastActiveLabel] = useState(activeGroupLabel);
  if (lastActiveLabel !== activeGroupLabel) {
    setLastActiveLabel(activeGroupLabel);
    if (activeGroupLabel) {
      setOpenGroups((previous) =>
        previous.has(activeGroupLabel) ? previous : new Set([...previous, activeGroupLabel]),
      );
    }
  }

  const toggleGroup = (label: string) => {
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const openAll = () => setOpenGroups(new Set(groups.map((group) => group.label)));
  const closeAll = () => setOpenGroups(new Set<string>());

  const [mobileOpen, setMobileOpen] = useState(false);

  const sections = (idPrefix: string, onNavigate?: () => void) => (
    <>
      <div className="flex items-center justify-end gap-1.5 px-3 pt-3 pb-1 text-xs">
        <button
          type="button"
          onClick={openAll}
          className="text-seal/80 hover:underline"
          disabled={openGroups.size >= groups.length}
        >
          展开全部
        </button>
        <span className="text-ink-faint/60" aria-hidden="true">
          /
        </span>
        <button
          type="button"
          onClick={closeAll}
          className="text-seal/80 hover:underline"
          disabled={openGroups.size === 0}
        >
          折叠全部
        </button>
      </div>
      {groups.map((group, index) => (
        <Section
          key={group.label}
          group={group}
          index={index}
          currentPath={currentPath}
          isOpen={openGroups.has(group.label)}
          onToggle={() => toggleGroup(group.label)}
          onNavigate={onNavigate}
          idPrefix={idPrefix}
        />
      ))}
    </>
  );

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
      <nav className="hidden md:flex flex-col w-56 shrink-0 border-r border-ink/10 min-h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] overflow-y-auto p-2">
        {sections('desktop')}
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
              {sections('mobile', () => setMobileOpen(false))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
