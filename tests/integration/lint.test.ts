import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe('lint', () => {
  it('npm run lint exits 0', () => {
    const result = execSync('npm run lint', { encoding: 'utf-8', stdio: 'pipe' });
    expect(result).toBeDefined();
    // Exit code 0 means lint passed (output captured by execSync)
  }, 120_000); // 2 min timeout for full lint
});
