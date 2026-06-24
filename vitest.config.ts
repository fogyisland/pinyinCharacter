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
    setupFiles: ['./tests/_setup/load-env.ts'],
    // Run test files sequentially to avoid UNIQUE-constraint races between
    // files that hardcode the same test user (e.g. 'dl_test', 'ext_test') in
    // beforeAll. Default worker pool runs files in parallel; same DB → race.
    fileParallelism: false,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'scripts/**/*.test.ts',
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
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
