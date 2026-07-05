'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X } from 'lucide-react';
import { SafeModeToggle } from './SafeModeToggle';
import { UserMenu } from './UserMenu';
import { HeaderNavDropdown } from './HeaderNavDropdown';
import { useAppStore } from '@/lib/store';
import { BRAND, filterNavGroups, type NavGroup } from '@/lib/design';

export function Header() {
  const safeMode = useAppStore((s) => s.safeMode);
  const user = useAppStore((s) => s.user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleGroups: readonly NavGroup[] = filterNavGroups(safeMode);

  return (
    <header className="border-b border-ink/10 bg-paper-soft/95">
      <div className="max-w-6xl mx-auto px-4 h-[72px] flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 md:gap-6 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
            aria-label={BRAND.name}
          >
            <Image
              src="/logo.png"
              alt={BRAND.name}
              width={40}
              height={40}
              className="rounded-full shrink-0"
            />
            <span className="font-kai text-xl text-ink tracking-wide truncate">
              {BRAND.name}
            </span>
          </Link>
          {/* Desktop nav: grouped with hover dropdowns */}
          <nav className="hidden md:flex items-center gap-5 text-sm">
            {visibleGroups.map((group) => (
              <HeaderNavDropdown key={group.numeral} group={group} />
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {safeMode && (
            <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-success/15 text-success">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
          {user ? (
            <UserMenu />
          ) : (
            <>
              <Link href="/login" className="btn-seal text-sm">
                登录
              </Link>
              <Link href="/register" className="hidden sm:inline text-sm text-ink-soft hover:text-seal">
                注册
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1 text-ink"
            aria-label="打开菜单"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-20 bg-ink/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-72 max-w-[calc(100vw-2rem)] bg-paper-soft p-4 shadow-paper-lg overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <span className="font-kai text-xl flex items-center gap-2">
                <Image
                  src="/logo.png"
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
            {/* Mobile nav: groups expanded inline (no dropdowns) */}
            <nav className="flex flex-col gap-5">
              {visibleGroups.map((group) => (
                <div key={group.numeral} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 px-1">
                    <span className="font-kai text-xs text-ink-soft/70">
                      {group.numeral}
                    </span>
                    <span className="text-sm font-medium text-ink">
                      {group.label}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className="text-base text-ink-soft hover:text-ink py-2 pl-4 border-b border-ink/10 last:border-b-0"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              {!user && (
                <div className="flex flex-col gap-1 pt-4 border-t border-ink/10">
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
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}