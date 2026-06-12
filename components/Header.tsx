'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { SafeModeToggle } from './SafeModeToggle';
import { UserMenu } from './UserMenu';
import { AuthModal } from './AuthModal';
import { useAppStore } from '@/lib/store';
import { BRAND, NAV_LINKS } from '@/lib/design';

function AuthAutoOpen({ onOpen }: { onOpen: () => void }) {
  const user = useAppStore(s => s.user);
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('auth') === 'login' && !user) onOpen();
  }, [searchParams, user, onOpen]);
  return null;
}

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  const user = useAppStore(s => s.user);
  const [authOpen, setAuthOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b border-ink/10 bg-paper-soft/95">
      <div className="max-w-5xl mx-auto px-4 h-[72px] flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label={BRAND.name}>
            <Image src="/logo.png" alt={BRAND.name} width={40} height={40} className="rounded-full" />
            <span className="font-kai text-xl text-ink tracking-wide">{BRAND.name}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-soft hover:text-seal transition-colors border-b-2 border-transparent hover:border-seal pb-0.5"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-success/15 text-success">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="btn-seal text-sm"
            >
              登录 / 注册
            </button>
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
        <div className="md:hidden fixed inset-0 z-20 bg-ink/40" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute right-0 top-0 h-full w-64 bg-paper-soft p-4 shadow-paper-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <span className="font-kai text-xl flex items-center gap-2">
                <Image src="/logo.png" alt={BRAND.name} width={28} height={28} className="rounded-full" />
                {BRAND.name}
              </span>
              <button onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
                <X size={22} />
              </button>
            </div>
            <nav className="flex flex-col gap-3">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="text-base text-ink py-2 border-b border-ink/10"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <AuthAutoOpen onOpen={() => setAuthOpen(true)} />
      </Suspense>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}
