import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
// Only app/-routed files. We do NOT also write public/favicon.ico — Next.js
// 15 500s when both an app/ route and a public/ asset resolve to /favicon.ico
// ("conflicting public file and page file").
const OUTPUTS = [
  'app/icon.png',
  'app/apple-icon.png',
  'app/favicon.ico',
];

describe('scripts/build-favicon.ts', () => {
  beforeAll(() => {
    // Clean any prior outputs to ensure a fresh run
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      if (existsSync(p)) rmSync(p);
    }
    // If a stale public/favicon.ico exists from an older build, delete it
    // too so we don't leave conflicting state on disk between runs.
    const legacy = resolve(ROOT, 'public/favicon.ico');
    if (existsSync(legacy)) rmSync(legacy);
  });

  it('produces 3 favicon files at expected paths with non-zero size', () => {
    execSync('pnpm favicon:build', { cwd: ROOT, stdio: 'pipe' });
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      expect(existsSync(p), `${f} should exist after build`).toBe(true);
      expect(statSync(p).size, `${f} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('does NOT write a public/favicon.ico (would conflict with app/favicon.ico in Next.js 15)', () => {
    expect(existsSync(resolve(ROOT, 'public/favicon.ico'))).toBe(false);
  });
});
