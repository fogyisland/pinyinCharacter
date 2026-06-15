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
};

export default config;
