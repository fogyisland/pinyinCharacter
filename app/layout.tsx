import './globals.css';
import { THEME_INIT } from '@/lib/site-theme';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';
import { ToastViewport } from '@/components/common/Toast';
import { ActivationGuard } from '@/components/ActivationGuard';
import { SetupGuard } from '@/components/SetupGuard';
import { PageViewTracker } from '@/components/PageViewTracker';
import { buildOrganization, buildWebSite, serializeJsonLd } from '@/lib/seo/jsonld';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { getFontCssLinks } from '@/lib/font-css';
import { ASYNC_STYLESHEET_FLIP } from '@/lib/font-css-flip';

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const baseUrl = await getRuntimeSiteUrl();
  const fontCss = getFontCssLinks();
  const siteJsonLd = [
    await buildOrganization(),
    // No /search route exists; the dictionary's `?q=` is the real search.
    await buildWebSite(`${baseUrl}/dictionary?q={search_term_string}`),
  ];
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Body typeface — render-blocking, every glyph of every page uses it. */}
        <link rel="stylesheet" href={fontCss.sans} />
        {/*
          The ext tier of the body typeface — one face per six characters,
          2458 of them for the sans family. It is loaded without blocking:
          `media="print"` keeps it off the critical path and the inline
          script below promotes it once it arrives.

          ⚠️ THE TRADE: until this stylesheet arrives, the browser does not
          know that a character lives in an ext block, so the first paint of
          such a character waits for it. That is ONE extra round trip for
          the characters outside the hot tier — paid once per cold load.
          The alternative, one 608 KB blocking stylesheet, cost the SAME
          parse on EVERY page load for characters the page almost never
          paints. This trade is deliberate.

          The `suppressHydrationWarning` is the same escape hatch the
          brand and serif faces use below: the promotion script rewrites
          `media` before hydration, so React would find `media="all"` in
          the DOM while its own tree says `media="print"`.
        */}
        <link
          rel="stylesheet"
          href={fontCss.sansExt}
          media="print"
          suppressHydrationWarning
        />
        {/*
          Brand + serif typefaces — fetched without blocking the first paint.

          `media="print"` keeps them off the critical path: the browser still
          downloads them, but never waits for them before the first paint. The
          inline script below promotes them to `media="all"` once they arrive.

          That promotion rewrites the `media` attribute of a React-rendered
          element BEFORE hydration, so React would find `media="all"` in the
          DOM while its own tree says `media="print"` and report a hydration
          mismatch ("A tree hydrated but some attributes of the server rendered
          HTML didn't match the client properties"). `suppressHydrationWarning`
          is React's documented escape hatch for exactly this case: the
          attribute is intentionally controlled by the script, and React only
          warns about attribute differences — it never patches them back.
        */}
        <link
          rel="stylesheet"
          href={fontCss.wenkai}
          media="print"
          suppressHydrationWarning
        />
        <link
          rel="stylesheet"
          href={fontCss.serif}
          media="print"
          suppressHydrationWarning
        />
        {/*
          The ext tiers of the brand and serif typefaces. Same deal as the
          body typeface's ext tier: the hot tiers above carry the
          characters the brand mark and the section titles use, and these
          carry the rest — without them the brand and serif faces would
          fall back to the system font for every character outside their
          hot tier.
        */}
        <link
          rel="stylesheet"
          href={fontCss.wenkaiExt}
          media="print"
          suppressHydrationWarning
        />
        <link
          rel="stylesheet"
          href={fontCss.serifExt}
          media="print"
          suppressHydrationWarning
        />
        <script dangerouslySetInnerHTML={{ __html: ASYNC_STYLESHEET_FLIP }} />
        <meta name="theme-color" content="#23372e" />
        <link rel="manifest" href="/manifest.json" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd) }}
        />
      </head>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        <SetupGuard>
          <ActivationGuard>{children}</ActivationGuard>
        </SetupGuard>
        <PageViewTracker />
        <ToastViewport />
      </body>
    </html>
  );
}
