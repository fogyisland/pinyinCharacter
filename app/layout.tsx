import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';
import { ToastViewport } from '@/components/common/Toast';
import { ActivationGuard } from '@/components/ActivationGuard';
import { PageViewTracker } from '@/components/PageViewTracker';

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/font/fonts.css" />
        <meta name="theme-color" content="#5A4530" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        <ActivationGuard>{children}</ActivationGuard>
        <PageViewTracker />
        <ToastViewport />
      </body>
    </html>
  );
}