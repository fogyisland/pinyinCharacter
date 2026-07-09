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
};

export default config;
