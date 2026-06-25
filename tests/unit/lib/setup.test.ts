import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use relative path — repo has no vitest config to resolve @/ alias at
// runtime. Test infra was removed 2026-06-24 (abad83d9), so this is the
// only test file. Keep imports relative so it works without config.
const importSetup = () => import('../../../lib/setup');

// We have to override process.cwd() before importing the module, so use a
// dynamic import + vi.resetModules to get a fresh module instance bound to
// the new cwd.
describe('loadEnvFromFile / reloadProcessEnvFromFile', () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.resetModules();
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'setup-test-'));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    delete process.env.TEST_LOADED_VAR;
    delete process.env.DATABASE_URL;
  });

  it('returns empty record when .env is missing', async () => {
    const { loadEnvFromFile } = await importSetup();
    expect(loadEnvFromFile()).toEqual({});
  });

  it('parses KEY=VALUE pairs, skipping blank lines and comments', async () => {
    writeFileSync(join(tmp, '.env'), [
      '# Top comment',
      '',
      'DATABASE_URL=mysql://u:p@host:3306/db',
      'JWT_SECRET=abc123',
      '   COOKIE_SECURE=true   ',
      '# trailing comment',
      '',
    ].join('\n'));
    const { loadEnvFromFile } = await importSetup();
    expect(loadEnvFromFile()).toEqual({
      DATABASE_URL: 'mysql://u:p@host:3306/db',
      JWT_SECRET: 'abc123',
      COOKIE_SECURE: 'true',  // leading + trailing whitespace trimmed (whole-line trim)
    });
  });

  it('preserves equals signs in values', async () => {
    writeFileSync(join(tmp, '.env'), 'URL=https://x?a=1&b=2\n');
    const { loadEnvFromFile } = await importSetup();
    expect(loadEnvFromFile().URL).toBe('https://x?a=1&b=2');
  });

  it('reloadProcessEnvFromFile writes all keys to process.env', async () => {
    writeFileSync(join(tmp, '.env'), 'TEST_LOADED_VAR=hello\nDATABASE_URL=mysql://x\n');
    const { reloadProcessEnvFromFile } = await importSetup();
    expect(process.env.TEST_LOADED_VAR).toBeUndefined();
    reloadProcessEnvFromFile();
    expect(process.env.TEST_LOADED_VAR).toBe('hello');
    expect(process.env.DATABASE_URL).toBe('mysql://x');
  });

  it('overrides existing process.env values with file values', async () => {
    process.env.DATABASE_URL = 'old-value';
    writeFileSync(join(tmp, '.env'), 'DATABASE_URL=new-value\n');
    const { reloadProcessEnvFromFile } = await importSetup();
    reloadProcessEnvFromFile();
    expect(process.env.DATABASE_URL).toBe('new-value');
  });
});
