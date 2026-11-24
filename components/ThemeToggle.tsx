'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_KEY } from '@/lib/site-theme';

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    function sync() {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch (error) {
        console.debug('无法读取主题偏好', error);
      }
      const dark = saved === 'dark' || (saved !== 'light' && system.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      setIsDark(dark);
    }
    sync();
    system.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      system.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  function toggle() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    setIsDark(theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.debug('主题偏好仅在当前页面生效', error);
    }
  }
  return (
    <button
      type="button"
      aria-label="夜间模式"
      aria-pressed={isDark}
      title={isDark ? '切换到白天' : '切换到黑夜'}
      onClick={toggle}
      className="grid size-11 place-items-center rounded-full text-ink hover:bg-paper-deep focus-visible:outline-seal"
    >
      {isDark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  );
}
