'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SafeModeToggle } from './SafeModeToggle';
import { UserMenu } from './UserMenu';
import { AuthModal } from './AuthModal';
import { useAppStore } from '@/lib/store';

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  const user = useAppStore(s => s.user);
  const [authOpen, setAuthOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('auth') === 'login' && !user) setAuthOpen(true);
  }, [searchParams, user]);

  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/rare-chars" className="text-gray-700 hover:text-blue-600">
              罕见字库
            </Link>
            <Link href="/worksheet" className="text-gray-700 hover:text-blue-600">
              字帖
            </Link>
            <Link href="/game" className="text-gray-700 hover:text-blue-600">
              游戏
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
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
              className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
            >登录 / 注册</button>
          )}
        </div>
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}