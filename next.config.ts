import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Keep `ws` (and its native `bufferutil` binding) out of the bundler —
  // webpack otherwise stubs `bufferutil.mask` and tts-edge's ws.send() throws
  // "bufferUtil.mask is not a function" on first frame.
  // Also keep `edge-tts-universal` + `axios` external — they reach into Node
  // internals (tls, http.Agent) and break when bundled.
  serverExternalPackages: [
    'ws',
    'bufferutil',
    'edge-tts-universal',
    'axios',
    'isomorphic-ws',
    'cross-fetch',
    'xml-escape',
  ],
  // @react-pdf/renderer ships ESM-only ("type":"module") and imports
  // Node-only modules in its main entry. transpilePackages lets webpack
  // handle the ESM imports; combined with `dynamic({ ssr: false })` for
  // PDFDownloadLink in PracticeTemplate, this avoids the "PDFDownloadLink
  // is a web specific API" throw on SSR.
  transpilePackages: ['@react-pdf/renderer'],
  // Image Optimization fallback (2026-07-09): when sharp is missing or the
  // wrong platform binary (e.g. prod Linux without `sharp-linux-x64` after
  // `npm ci` from a Windows-built lockfile), `/_next/image` returns 400
  // "The requested resource isn't a valid image". `unoptimized: true` makes
  // <Image> render the raw src instead — no resize, no WebP/AVIF, just the
  // original file. Trade-off: more bytes on the wire, but no native deps
  // and the page actually loads. Long-term: install sharp properly via
  // `rm -rf node_modules && npm ci --legacy-peer-deps` on the target
  // platform, then flip this back to false.
  images: {
    unoptimized: true,
  },
  // Long-lived caching for the static assets that are content-addressed or
  // effectively immutable. Without this, Next serves everything in public/
  // with `Cache-Control: public, max-age=0`, so the browser revalidates the
  // 136 KB font stylesheet (and every font subset) on EVERY page load.
  //
  //   /font/    — Google Fonts subsets. The file names are content hashes,
  //               and the generated stylesheets carry a `?v=<hash>` query, so
  //               `immutable` can never serve a stale file.
  //   /fonts/   — the hard-pen / brush fonts. Fixed names, replaced when the
  //               fonts are rebuilt, so they get a long but finite TTL.
  //   /strokes/ — one JSON per character, never changes for a given char.
  async headers() {
    const year = 'public, max-age=31536000, immutable';
    const month = 'public, max-age=2592000';
    return [
      { source: '/font/:path*', headers: [{ key: 'Cache-Control', value: year }] },
      { source: '/fonts/:path*', headers: [{ key: 'Cache-Control', value: month }] },
      { source: '/strokes/:path*', headers: [{ key: 'Cache-Control', value: month }] },
    ];
  },
  // Dev-only: keep webpack's file watcher out of the large data directories.
  // The app reads data/ at runtime through the filesystem and public/strokes/
  // is served statically, so neither belongs in the module graph — but the
  // default watcher crawls all 20 000+ of them on every rebuild. With these
  // exclusions the webpack dev server is ready in 7 s instead of 14 s.
  webpack: (config, { dev }) => {
    if (!dev) return config;
    const ignored = [
      '**/data/**',
      '**/public/strokes/**',
      '**/public/font/**',
      '**/Up/**',
      '**/backups/**',
    ];
    config.watchOptions = { ...config.watchOptions, ignored };
    return config;
  },
  // Turbopack is the dev bundler (`npm run dev`). The alias mirrors the
  // `@/*` path mapping in tsconfig.json so both bundlers resolve imports
  // identically; declaring it here also tells Next.js that the Turbopack
  // pipeline is configured, which silences the "Webpack is configured while
  // Turbopack is not" warning that the `webpack` hook above would raise.
  turbopack: {
    resolveAlias: {
      '@': './',
    },
  },
};

export default config;
