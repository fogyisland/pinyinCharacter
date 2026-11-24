'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { SafeModeToggle } from './SafeModeToggle';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { useAppStore } from '@/lib/store';
import { BRAND, filterNavLinks, NAV_GROUPS, type NavGroupId, type NavLink } from '@/lib/design';

const GROUP_ORDER = Object.keys(NAV_GROUPS) as NavGroupId[];

function DesktopNav({ links, currentPath }: { links: readonly NavLink[]; currentPath: string }) {
  const [open, setOpen] = useState<NavGroupId | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <nav
      aria-label="主导航"
      className="hidden lg:flex flex-1 min-w-0 items-center justify-center gap-2 xl:gap-4 whitespace-nowrap text-sm"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(null);
          trigger.current?.focus();
        }
      }}
    >
      {GROUP_ORDER.map((id) => {
        const items = links.filter((item) => item.group === id);
        const first = items[0];
        if (!first) return null;
        const label = NAV_GROUPS[id].label;
        if (items.length === 1 && (label === first.label || id === 'teach')) {
          return (
            <Link
              key={id}
              href={first.href}
              aria-current={currentPath === first.href ? 'page' : undefined}
              className="py-2 hover:text-seal aria-[current=page]:text-seal"
            >
              {label}
            </Link>
          );
        }
        return (
          <div
            key={id}
            className="relative"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
            }}
          >
            <button
              type="button"
              aria-expanded={open === id}
              aria-controls={`nav-${id}`}
              className="py-2 hover:text-seal"
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setOpen(open === id ? null : id);
              }}
            >
              {label} <span aria-hidden="true">▾</span>
            </button>
            <div
              id={`nav-${id}`}
              hidden={open !== id}
              className="absolute z-30 left-0 top-full min-w-32 rounded border border-ink/10 bg-paper-soft p-2 shadow-paper-lg"
            >
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={currentPath === item.href ? 'page' : undefined}
                  onClick={() => setOpen(null)}
                  className="block rounded px-3 py-2 hover:bg-paper-deep aria-[current=page]:text-seal"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function MobileNav({
  links,
  currentPath,
  onNavigate,
}: {
  links: readonly NavLink[];
  currentPath: string;
  onNavigate: () => void;
}) {
  const byGroup = new Map<NavGroupId, NavLink[]>();
  for (const id of GROUP_ORDER) byGroup.set(id, []);
  for (const l of links) byGroup.get(l.group)?.push(l);
  return (
    <nav className="flex flex-col gap-4">
      {GROUP_ORDER.map((gid) => {
        const items = byGroup.get(gid) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={gid} className="flex flex-col gap-1">
            <div className="px-1 text-xs font-medium text-ink-soft/50 select-none">
              {NAV_GROUPS[gid].label}
            </div>
            <div className="flex flex-col">
              {items.map((item) => {
                const isActive =
                  currentPath === item.href || currentPath.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      'text-base py-2 pl-3 border-b border-ink/10 last:border-b-0 ' +
                      (isActive ? 'text-seal font-medium' : 'text-ink-soft hover:text-ink')
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function Header() {
  const safeMode = useAppStore((s) => s.safeMode);
  const user = useAppStore((s) => s.user);
  const currentPath = usePathname() ?? '';
  const links = filterNavLinks(safeMode);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-t-[3px] border-t-ink border-b border-b-ink/20 bg-paper-soft">
      <div className="max-w-6xl xl:max-w-7xl mx-auto px-6 h-[72px] flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
          aria-label={BRAND.name}
        >
          <Image
            src="/logo-sm.webp"
            alt={BRAND.name}
            width={40}
            height={40}
            className="rounded-full shrink-0"
          />
          <span className="font-kai text-xl text-ink tracking-wide truncate hidden sm:inline">
            {BRAND.name}
          </span>
        </Link>
        <DesktopNav links={links} currentPath={currentPath} />
        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          <ThemeToggle />
          <SafeModeToggle />
          {user ? (
            <UserMenu />
          ) : (
            <>
              <Link href="/login" className="btn-seal text-sm">
                登录
              </Link>
              {/* 注册 lives in the mobile drawer and on the login page; in the
                  header row it was the 28px that decided whether the nav
                  wrapped. */}
            </>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-1 text-ink"
            aria-label="打开菜单"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-20 bg-ink/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-80 max-w-[calc(100vw-2rem)] bg-paper-soft p-5 shadow-paper-lg overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <span className="font-kai text-xl flex items-center gap-2">
                <Image
                  src="/logo-sm.webp"
                  alt={BRAND.name}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
                {BRAND.name}
              </span>
              <button onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
                <X size={22} />
              </button>
            </div>
            <MobileNav
              links={links}
              currentPath={currentPath}
              onNavigate={() => setMobileOpen(false)}
            />
            {!user && (
              <div className="mt-6 pt-4 border-t border-ink/10 flex flex-col gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="text-base text-seal py-2"
                >
                  登录
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="text-base text-ink-soft py-2"
                >
                  注册
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
