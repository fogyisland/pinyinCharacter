import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';
import { ToastViewport } from '@/components/common/Toast';
import { ActivationGuard } from '@/components/ActivationGuard';
import { PageViewTracker } from '@/components/PageViewTracker';
import { buildOrganization, buildWebSite } from '@/lib/seo/jsonld';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const baseUrl = await getRuntimeSiteUrl();
  const siteJsonLd = [
    await buildOrganization(),
    // No /search route exists; the dictionary's `?q=` is the real search.
    await buildWebSite(`${baseUrl}/dictionary?q={search_term_string}`),
  ];
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/font/fonts.css" />
        <meta name="theme-color" content="#5A4530" />
        <link rel="manifest" href="/manifest.json" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
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
