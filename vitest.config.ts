import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // The `server-only` marker package throws when it is imported outside
      // a React Server Component. The tests run in plain Node, so the marker
      // is neutralised here — the same thing the `react-server` export
      // condition does in the app, and the same thing the MCP server does
      // with its `--conditions=react-server` flag.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    // Up/ is a gitignored snapshot of the repo used by the deploy bundle;
    // its tests reference the pre-TTS SutraAudioPlayer API and pollute
    // every vitest run with 17 stale failures. Excluded so the Up/ snapshot
    // stays intact for `git bundle` consumers.
    exclude: ['node_modules/**', 'Up/**', 'dist/**'],
  },
});
