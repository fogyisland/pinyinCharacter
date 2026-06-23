import { describe, it, expect } from 'vitest';
import { validateEnv, isProd } from '@/lib/env';

const SAFE_SECRET = 'x'.repeat(40);
const PROD_DB = 'mysql://app:pw@db.example.com:3306/piyin_prod';

function baseProd(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: SAFE_SECRET,
    COOKIE_SECURE: 'true',
    DATABASE_URL: PROD_DB,
    NEXT_PUBLIC_SITE_URL: 'https://example.com',
    ...overrides,
  };
}

function baseDev(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'development',
    JWT_SECRET: 'local-dev-secret-must-be-32-chars-long-1234',
    COOKIE_SECURE: 'false',
    DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin_dev',
    ...overrides,
  };
}

describe('isProd', () => {
  it('returns true when NODE_ENV=production', () => {
    expect(isProd({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('returns false when NODE_ENV=development', () => {
    expect(isProd({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('returns false when NODE_ENV is unset', () => {
    expect(isProd({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('validateEnv in dev (NODE_ENV != production)', () => {
  it('is a no-op: does not throw on the dev default JWT_SECRET', () => {
    expect(() => validateEnv(baseDev() as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('is a no-op on COOKIE_SECURE=false (local dev uses HTTP)', () => {
    expect(() => validateEnv(baseDev() as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('is a no-op on a local DATABASE_URL (127.0.0.1 + piyin_dev)', () => {
    expect(() => validateEnv(baseDev() as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('returns no issues in dev mode (every "rule" is expected local-dev state)', () => {
    const r = validateEnv(baseDev() as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });
  it('is a no-op even when JWT_SECRET is missing in dev (login will fail on use, but boot is fine)', () => {
    const r = validateEnv({ NODE_ENV: 'development', DATABASE_URL: PROD_DB } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });
});

describe('validateEnv in prod (NODE_ENV=production)', () => {
  describe('JWT_SECRET', () => {
    it('throws if JWT_SECRET is the known dev default', () => {
      expect(() =>
        validateEnv(baseProd({ JWT_SECRET: 'local-dev-secret-must-be-32-chars-long-1234' }) as NodeJS.ProcessEnv),
      ).toThrow(/dev default/);
    });
    it('throws if JWT_SECRET is too short', () => {
      expect(() => validateEnv(baseProd({ JWT_SECRET: 'too-short' }) as NodeJS.ProcessEnv)).toThrow(/at least 32/);
    });
    it('throws if JWT_SECRET is missing', () => {
      expect(() => validateEnv(baseProd({ JWT_SECRET: undefined }) as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    });
    it('accepts a JWT_SECRET exactly 32 chars', () => {
      const r = validateEnv(baseProd({ JWT_SECRET: 'a'.repeat(32) }) as NodeJS.ProcessEnv);
      expect(r.ok).toBe(true);
    });
  });

  describe('COOKIE_SECURE', () => {
    it('throws if COOKIE_SECURE is "false"', () => {
      expect(() => validateEnv(baseProd({ COOKIE_SECURE: 'false' }) as NodeJS.ProcessEnv)).toThrow(/COOKIE_SECURE/);
    });
    it('throws if COOKIE_SECURE is "1" (only the literal "true" is accepted)', () => {
      expect(() => validateEnv(baseProd({ COOKIE_SECURE: '1' }) as NodeJS.ProcessEnv)).toThrow(/COOKIE_SECURE/);
    });
    it('throws if COOKIE_SECURE is missing entirely', () => {
      expect(() => validateEnv(baseProd({ COOKIE_SECURE: undefined }) as NodeJS.ProcessEnv)).toThrow(/COOKIE_SECURE/);
    });
  });

  describe('DATABASE_URL', () => {
    it('throws if DATABASE_URL points to 127.0.0.1', () => {
      expect(() =>
        validateEnv(baseProd({ DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin_prod' }) as NodeJS.ProcessEnv),
      ).toThrow(/dev\/local DB/);
    });
    it('throws if DATABASE_URL points to localhost', () => {
      expect(() =>
        validateEnv(baseProd({ DATABASE_URL: 'mysql://root:pw@localhost:3306/piyin_prod' }) as NodeJS.ProcessEnv),
      ).toThrow(/dev\/local DB/);
    });
    it('throws if DATABASE_URL contains piyin_dev schema on a real host', () => {
      expect(() =>
        validateEnv(baseProd({ DATABASE_URL: 'mysql://root:pw@db.example.com:3306/piyin_dev' }) as NodeJS.ProcessEnv),
      ).toThrow(/dev\/local DB/);
    });
    it('throws if DATABASE_URL is missing', () => {
      expect(() => validateEnv(baseProd({ DATABASE_URL: undefined }) as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    });
    it('accepts a remote prod DB with a different schema name', () => {
      const r = validateEnv(
        baseProd({ DATABASE_URL: 'mysql://app:pw@db.example.com:3306/piyin' }) as NodeJS.ProcessEnv,
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('NEXT_PUBLIC_SITE_URL', () => {
    it('warns (does not throw) if NEXT_PUBLIC_SITE_URL is missing in prod', () => {
      const r = validateEnv(baseProd({ NEXT_PUBLIC_SITE_URL: undefined }) as NodeJS.ProcessEnv);
      expect(r.ok).toBe(true);
      expect(r.issues.some((i) => i.var === 'NEXT_PUBLIC_SITE_URL' && i.level === 'warn')).toBe(true);
    });
    it('does not warn when NEXT_PUBLIC_SITE_URL is set', () => {
      const r = validateEnv(baseProd() as NodeJS.ProcessEnv);
      expect(r.issues.some((i) => i.var === 'NEXT_PUBLIC_SITE_URL')).toBe(false);
    });
  });

  describe('aggregate', () => {
    it('passes clean prod config', () => {
      const r = validateEnv(baseProd() as NodeJS.ProcessEnv);
      expect(r.ok).toBe(true);
      expect(r.issues).toEqual([]);
    });
    it('reports all errors at once (not just the first)', () => {
      expect(() =>
        validateEnv(
          baseProd({
            JWT_SECRET: 'local-dev-secret-must-be-32-chars-long-1234',
            COOKIE_SECURE: 'false',
            DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin_dev',
          }) as NodeJS.ProcessEnv,
        ),
      ).toThrow(/JWT_SECRET[\s\S]*COOKIE_SECURE[\s\S]*DATABASE_URL/);
    });
  });
});