import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';

export const metadata = {
  title: '字↔拼音 工具',
  description: '在线汉字与拼音互转工具',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
