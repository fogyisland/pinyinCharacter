'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { logoutRequest } from '@/lib/api-auth';

export function UserMenu() {
  const user = useAppStore(s => s.user);
  const setUser = useAppStore(s => s.setUser);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!user) return null;

  async function logout() {
    await logoutRequest();
    setUser(null);
    setOpen(false);
    window.location.href = '/';
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="text-sm px-3 py-1.5 border border-ink/20 rounded hover:bg-paper-deep text-ink"
        onClick={() => setOpen(o => !o)}
      >{user.username} ⌄</button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 card-paper rounded shadow-paper-md py-1 z-20">
          {user.isAdmin && (
            <a href="/admin/users" className="block px-3 py-1.5 hover:bg-paper-deep text-seal">管理后台</a>
          )}
          <a href="/profile" className="block px-3 py-1.5 hover:bg-paper-deep text-ink">我的主页</a>
          <a href="/history" className="block px-3 py-1.5 hover:bg-paper-deep text-ink">历史记录</a>
          <a href="/history?favorite=true" className="block px-3 py-1.5 hover:bg-paper-deep text-ink">收藏夹</a>
          <div className="border-t border-ink/10 my-1" />
          <button type="button" onClick={logout} className="block w-full text-left px-3 py-1.5 hover:bg-seal/10 text-seal">退出登录</button>
        </div>
      )}
    </div>
  );
}
