import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const setupEnabledMock = vi.fn();
const testDbConnectionMock = vi.fn();
const writeEnvVarsMock = vi.fn();
const generateJwtSecretMock = vi.fn();
const reloadEnvMock = vi.fn();

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: (...args: unknown[]) => setupEnabledMock(...args),
  testDbConnection: (...args: unknown[]) => testDbConnectionMock(...args),
  buildDatabaseUrl: () => 'mysql://root:secret@db.internal:3306/pinyin',
  writeEnvVars: (...args: unknown[]) => writeEnvVarsMock(...args),
  generateJwtSecret: (...args: unknown[]) => generateJwtSecretMock(...args),
  reloadProcessEnvFromFile: (...args: unknown[]) => reloadEnvMock(...args),
}));

vi.mock('@/lib/db', () => ({
  closePool: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/init/db-config/route';

beforeEach(() => {
  vi.clearAllMocks();
  setupEnabledMock.mockResolvedValue(true);
  testDbConnectionMock.mockResolvedValue({ ok: true });
  writeEnvVarsMock.mockReturnValue(undefined);
  reloadEnvMock.mockReturnValue(undefined);
  generateJwtSecretMock.mockReturnValue('generated-secret-that-is-long-enough-32');
  delete process.env.JWT_SECRET;
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/db-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  host: 'db.internal',
  port: 3306,
  user: 'root',
  password: 'secret',
  database: 'pinyin',
};

describe('POST /api/init/db-config — the response carries no credential', () => {
  it('does not return the assembled DATABASE_URL', async () => {
    // The URL contains the database password. Returning it would put the
    // credential into the browser's network log, into any proxy's log, and
    // into this project's own access logs — for no benefit, since the UI
    // only shows which database was configured.
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('mysql://');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('databaseUrl');
  });

  it('does not return the JWT_SECRET', async () => {
    const res = await POST(postReq(VALID_BODY));
    const raw = await res.text();
    expect(raw).not.toContain('generated-secret-that-is-long-enough-32');
    expect(raw).not.toContain('JWT_SECRET');
  });

  it('still tells the UI which host and schema were configured', async () => {
    const res = await POST(postReq(VALID_BODY));
    const body = (await res.json()) as {
      ok: boolean;
      data: { host: string; port: number; database: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.host).toBe('db.internal');
    expect(body.data.port).toBe(3306);
    expect(body.data.database).toBe('pinyin');
  });
});

describe('POST /api/init/db-config — an existing JWT_SECRET is preserved', () => {
  it('keeps the secret that is already in force', async () => {
    // Rotating the secret would invalidate every issued session AND hand
    // the new signing key to whoever called this route. On a live install
    // the secret must survive untouched.
    const existing = 'e'.repeat(40);
    process.env.JWT_SECRET = existing;

    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(generateJwtSecretMock).not.toHaveBeenCalled();
    expect(writeEnvVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({ JWT_SECRET: existing }),
    );
  });

  it('generates a secret when there is none', async () => {
    await POST(postReq(VALID_BODY));
    expect(generateJwtSecretMock).toHaveBeenCalledTimes(1);
    expect(writeEnvVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        JWT_SECRET: 'generated-secret-that-is-long-enough-32',
      }),
    );
  });

  it('generates a secret when the existing one is too short to be safe', async () => {
    // A short secret is not a secret. `JWT_SECRET` must be at least 32
    // characters to be worth keeping.
    process.env.JWT_SECRET = 'too-short';
    await POST(postReq(VALID_BODY));
    expect(generateJwtSecretMock).toHaveBeenCalledTimes(1);
    expect(writeEnvVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        JWT_SECRET: 'generated-secret-that-is-long-enough-32',
      }),
    );
  });
});

describe('POST /api/init/db-config — the setup gate still applies', () => {
  it('refuses to touch .env when the setup route is disabled', async () => {
    setupEnabledMock.mockResolvedValue(false);
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('setup_disabled');
    expect(writeEnvVarsMock).not.toHaveBeenCalled();
    expect(testDbConnectionMock).not.toHaveBeenCalled();
  });
});
