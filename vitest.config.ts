import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // `server-only` throws at import time when called from a non-Server
      // Component context. In Node-side unit tests, treat it as a no-op so
      // server-only modules can be imported freely.
      'server-only': path.resolve(__dirname, 'tests/_shims/server-only.ts'),
    },
  },
});
