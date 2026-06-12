import './globals.css';
import type { ReactNode } from 'react';
import { Noto_Sans_SC, Noto_Serif_SC, LXGW_WenKai_TC } from 'next/font/google';
import { AuthSync } from './_auth-sync';

const hanSans = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-han-sans',
});

const hanSerif = Noto_Serif_SC({
  // 不限 subsets: 让 next/font 把 Noto Serif SC 的全部字形 (含中文) 都打入构建。
  // 字帖里会用到任意汉字, 不能限定到 latin
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-han-serif',
});

const wenkai = LXGW_WenKai_TC({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-wenkai',
});

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={`${hanSans.variable} ${hanSerif.variable} ${wenkai.variable}`}>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
