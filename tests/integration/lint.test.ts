import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe('lint', () => {
  it('npm run lint exits 0', () => {
    const result = execSync('npm run lint', { encoding: 'utf-8', stdio: 'pipe' });
    expect(result).toBeDefined();
    // Exit code 0 means lint passed (output captured by execSync)
  // ⚠️ The timeout is generous on purpose. `npm run lint` walks the whole
  // repository with eslint and takes about a MINUTE on this machine — and
  // it runs INSIDE the vitest run, in parallel with the other two hundred
  // test files, so it competes for the same disk and CPU. The default
  // budget of vitest (5 s) and even a two-minute one made this file fail
  // for reasons that have nothing to do with the lint result.
  //
  // ⇒ The assertion below is still the point: the lint has to exit 0.
  }, 600_000); // 10 min — the lint is a whole-repository scan
});
