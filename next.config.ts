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
};

export default config;
