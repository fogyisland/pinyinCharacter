/**
 * Tests for lib/init-checklist.ts — the 12-step system health check
 * used by /admin/init. Covers ok/warn/fail paths for every step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: (...a: any[]) => mockExistsSync(...a),
}));

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: (...a: any[]) => mockQuery(...a) }),
}));

const mockGetConfig = vi.fn();
vi.mock('../../../lib/config', () => ({
  getConfig: (...a: any[]) => mockGetConfig(...a),
}));

const mockGetRuntimeSiteUrl = vi.fn();
vi.mock('../../../lib/seo/config', () => ({
  getRuntimeSiteUrl: (...a: any[]) => mockGetRuntimeSiteUrl(...a),
}));

vi.mock('../../../lib/env', () => ({
  isProd: (env: NodeJS.ProcessEnv) => env.NODE_ENV === 'production',
}));

import { runInitChecks, parseDbUrl } from '@/lib/init-checklist';

describe('parseDbUrl', () => {
  it('parses a standard mysql:// URL', () => {
    const r = parseDbUrl('mysql://user:pass@db.example.com:3306/piyin');
    expect(r).toEqual({
      user: 'user', password: '***', host: 'db.example.com', port: '3306', database: 'piyin',
    });
  });
  it('defaults port to 3306 when missing', () => {
    const r = parseDbUrl('mysql://u:p@h/db');
    expect(r?.port).toBe('3306');
  });
  it('returns null for unparseable input', () => {
    expect(parseDbUrl('not a url')).toBeNull();
    expect(parseDbUrl('postgres://foo')).toBeNull();
  });
});

describe('runInitChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'mysql://root:***@127.0.0.1:3306/piyin_dev');
    vi.stubEnv('JWT_SECRET', 'a'.repeat(40));
    // Default: db-ok, table-ok, admin-ok, site-url-ok, no SMTP, no AI, all manifests present
    mockQuery
      .mockResolvedValueOnce([[{ ok: 1 }]])                              // SELECT 1
      .mockResolvedValueOnce([[{ n: 22 }]])                              // table count
      .mockResolvedValueOnce([[{ id: 1, username: 'admin', created_at: new Date('2026-01-01') }]]) // first admin
      .mockResolvedValueOnce([[{ n: 1 }]]);                             // admin count
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'smtp.transport') return null;
      if (k === 'smtp.from') return null;
      if (k === 'ai.api_key') return 'sk-test';
      if (k === 'ai.model') return 'MiniMax-M3';
      return null;
    });
    mockGetRuntimeSiteUrl.mockResolvedValue('https://pinyin.example.com');
    mockExistsSync.mockReturnValue(true);
  });

  it('returns a report with context and 12 steps when all green', async () => {
    const r = await runInitChecks();
    expect(r.context.adminCount).toBe(1);
    expect(r.context.firstAdmin?.username).toBe('admin');
    expect(r.context.tableCount).toBe(22);
    expect(r.context.expectedTableCount).toBe(22);
    expect(r.context.jwtSecretLength).toBe(40);
    expect(r.context.jwtSecretIsDevDefault).toBe(false);
    expect(r.steps).toHaveLength(12);
    // With all green, no fail steps
    expect(r.steps.every(s => s.status !== 'fail')).toBe(true);
  });

  it('step db-connection fails when SELECT 1 returns null', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce([null]);
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'db-connection')!;
    expect(s.status).toBe('fail');
    expect(s.required).toBe(true);
  });

  it('step db-tables fails when count < expected', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce([[{ ok: 1 }]])
      .mockResolvedValueOnce([[{ n: 10 }]])    // too few
      .mockResolvedValueOnce([[{ id: 1, username: 'admin', created_at: new Date() }]])
      .mockResolvedValueOnce([[{ n: 1 }]]);
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'db-tables')!;
    expect(s.status).toBe('fail');
    expect(s.details).toContain('10');
    expect(s.details).toContain('22');
  });

  it('step admin-user fails when 0 admins', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce([[{ ok: 1 }]])
      .mockResolvedValueOnce([[{ n: 22 }]])
      .mockResolvedValueOnce([[]])              // no first admin
      .mockResolvedValueOnce([[{ n: 0 }]]);     // 0 admins
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'admin-user')!;
    expect(s.status).toBe('fail');
    expect(s.required).toBe(true);
  });

  it('step site-url is required in prod and fails on localhost', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockGetRuntimeSiteUrl.mockResolvedValue('http://localhost:3000');
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return null;
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'site-url')!;
    expect(s.status).toBe('fail');
    expect(s.required).toBe(true);
  });

  it('step site-url is warn (not fail) in dev when localhost', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetRuntimeSiteUrl.mockResolvedValue('http://localhost:3000');
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return null;
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'site-url')!;
    expect(s.status).toBe('warn');
    expect(s.required).toBe(false);
  });

  it('step site-url ok when set to real domain', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      return null;
    });
    mockGetRuntimeSiteUrl.mockResolvedValue('https://pinyin.example.com');
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'site-url')!;
    expect(s.status).toBe('ok');
  });

  it('step smtp-transport warns when not "smtp"', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'smtp.transport') return 'console';
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'smtp-transport')!;
    expect(s.status).toBe('warn');
  });

  it('step smtp-transport ok when "smtp"', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'smtp.transport') return 'smtp';
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'smtp-transport')!;
    expect(s.status).toBe('ok');
  });

  it('step smtp-from warns when null', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'smtp.from') return null;
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'smtp-from')!;
    expect(s.status).toBe('warn');
  });

  it('step ai-key warns when missing', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'ai.api_key') return null;
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'ai-key')!;
    expect(s.status).toBe('warn');
  });

  it('step ai-model warns when missing', async () => {
    mockGetConfig.mockImplementation(async (k: string) => {
      if (k === 'site.url') return 'https://pinyin.example.com';
      if (k === 'ai.model') return null;
      return null;
    });
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'ai-model')!;
    expect(s.status).toBe('warn');
  });

  it('manifest steps warn when file missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const r = await runInitChecks();
    expect(r.steps.find(s => s.id === 'content-manifest')!.status).toBe('warn');
    expect(r.steps.find(s => s.id === 'poems-manifest')!.status).toBe('warn');
    expect(r.steps.find(s => s.id === 'classics-manifest')!.status).toBe('warn');
  });

  it('manifest steps ok when file present', async () => {
    mockExistsSync.mockReturnValue(true);
    const r = await runInitChecks();
    expect(r.steps.find(s => s.id === 'content-manifest')!.status).toBe('ok');
    expect(r.steps.find(s => s.id === 'poems-manifest')!.status).toBe('ok');
    expect(r.steps.find(s => s.id === 'classics-manifest')!.status).toBe('ok');
  });

  it('step jwt-secret fails in prod when too short', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'short');
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'jwt-secret')!;
    expect(s.status).toBe('fail');
    expect(s.required).toBe(true);
  });

  it('step jwt-secret fails in prod when dev default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'local-dev-secret-must-be-32-chars-long-1234');
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'jwt-secret')!;
    expect(s.status).toBe('fail');
  });

  it('step jwt-secret ok in prod with strong secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'a'.repeat(40));
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'jwt-secret')!;
    expect(s.status).toBe('ok');
  });

  it('step jwt-secret warns (not fail) in dev with dev default', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', 'local-dev-secret-must-be-32-chars-long-1234');
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'jwt-secret')!;
    expect(s.status).toBe('warn');
    expect(s.required).toBe(false);
  });

  it('safeQuery swallows DB errors and produces fail status', async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const r = await runInitChecks();
    const s = r.steps.find(s => s.id === 'db-connection')!;
    expect(s.status).toBe('fail');
  });

  it('isolates failures: a config error does not crash the report', async () => {
    mockGetConfig.mockImplementation(async () => { throw new Error('config boom'); });
    const r = await runInitChecks();
    // Should still have 12 steps; SMTP/AI steps will be warn since getConfig threw
    expect(r.steps).toHaveLength(12);
    expect(r.steps.find(s => s.id === 'smtp-transport')!.status).toBe('warn');
  });
});
