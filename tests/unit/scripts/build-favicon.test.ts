import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const OUTPUTS = [
  'app/icon.png',
  'app/apple-icon.png',
  'app/favicon.ico',
  'public/favicon.ico',
];

describe('scripts/build-favicon.ts', () => {
  beforeAll(() => {
    // Clean any prior outputs to ensure a fresh run
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      if (existsSync(p)) rmSync(p);
    }
  });

  it('produces 4 favicon files at expected paths with non-zero size', () => {
    execSync('pnpm favicon:build', { cwd: ROOT, stdio: 'pipe' });
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      expect(existsSync(p), `${f} should exist after build`).toBe(true);
      expect(statSync(p).size, `${f} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('favicon.ico bytes are identical at app/ and public/ paths', () => {
    const a = statSync(resolve(ROOT, 'app/favicon.ico')).size;
    const b = statSync(resolve(ROOT, 'public/favicon.ico')).size;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});
