import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
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