import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/font/fonts.css" />
      </head>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}