import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { setConfig } from '@/lib/config';
import { DEFAULT_ERA_FONTS, getActiveEraFonts } from '@/lib/era-fonts';

// 2026-07-04: vitest doesn't load .env, so DATABASE_URL is unset in
// the test process. Skip cleanly when absent rather than failing the
// suite. To run integration tests locally: set DATABASE_URL in the
// calling shell, or `npx vitest --env-file=.env run tests/integration`.
const integrationSkip = !process.env.DATABASE_URL;

describe.skipIf(integrationSkip)('Integration: app_config era fonts reach getActiveEraFonts', () => {
  const testKey = 'era.jiaguwen.font';
  let originalValue: string | null = null;

  beforeAll(async () => {
    // Capture existing value so we can restore after the test
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = ? LIMIT 1`,
      [testKey],
    );
    if (rows.length) originalValue = rows[0].value;
  });

  afterAll(async () => {
    // Restore original value (or delete if it didn't exist)
    if (originalValue === null) {
      await getPool().query(`DELETE FROM app_config WHERE \`key\` = ?`, [testKey]);
    } else {
      await setConfig(testKey, originalValue, null);
    }
    await closePool();
  });

  it('getActiveEraFonts reflects the admin-set value within the same request lifecycle', async () => {
    // Simulate admin PUT: write OracularInverted to app_config
    await setConfig(testKey, 'OracularInverted', null);

    const fonts = await getActiveEraFonts();
    expect(fonts.jiaguwen).toBe('OracularInverted');
    // Other eras untouched (still at their default)
    expect(fonts.jinwen).toBe(DEFAULT_ERA_FONTS.jinwen);
  });

  it('rejects unknown font id at write time (KEY_VALIDATORS blocks it)', async () => {
    await expect(setConfig(testKey, 'NotARealFont', null)).rejects.toThrow();
  });
});