import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { writeEnvVars, reloadProcessEnvFromFile } from '@/lib/setup';

// Skip cleanly when no DATABASE_URL — mirrors other integration tests.
const integrationSkip = !process.env.DATABASE_URL;
const SCRATCH_DB = 'piyin_wizard_test';

describe.skipIf(integrationSkip)('Integration: /init wizard 3-stage flow', () => {
  // Safety: capture original DATABASE_URL at describe scope so afterAll can
  // restore it. writeEnvVars() writes to project-root .env on disk, so a
  // failed test would otherwise leave the developer's .env pointing at the
  // dropped scratch DB and break the next `npm run dev`.
  let ORIGINAL_DATABASE_URL: string;

  beforeAll(async () => {
    // Drop + recreate scratch DB so test is hermetic.
    ORIGINAL_DATABASE_URL = process.env.DATABASE_URL!;
    const adminUrl = ORIGINAL_DATABASE_URL.replace(/\/[^/]+$/, '');
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(adminUrl);
    await admin.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
    await admin.query(`CREATE DATABASE \`${SCRATCH_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();

    // Point the running test process at the scratch DB.
    const newUrl = ORIGINAL_DATABASE_URL.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);
    writeEnvVars({ DATABASE_URL: newUrl });
    reloadProcessEnvFromFile();
    await closePool();
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup. ALWAYS restore .env even if the drop or any
    // earlier step threw — a broken .env is worse than a leftover scratch DB.
    let dropError: unknown;
    try {
      const adminUrl = (process.env.DATABASE_URL ?? ORIGINAL_DATABASE_URL).replace(/\/[^/]+$/, '');
      const mysql = await import('mysql2/promise');
      const admin = await mysql.createConnection(adminUrl);
      await admin.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
      await admin.end();
    } catch (e) {
      dropError = e;
    }
    try {
      writeEnvVars({ DATABASE_URL: ORIGINAL_DATABASE_URL });
      reloadProcessEnvFromFile();
    } finally {
      await closePool();
    }
    if (dropError) throw dropError;
  }, 60_000);

  it('runs the full 9-phase chain and sets setup_completed + cookie', async () => {
    // Phase 1: init-tables (creates 25 tables)
    const { POST: initTables } = await import('@/app/api/init/init-tables/route');
    let res = await initTables();
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.tablesNow).toBeGreaterThanOrEqual(20);

    // Phase 2: init-app-config
    const { POST: initAppConfig } = await import('@/app/api/init/init-app-config/route');
    res = await initAppConfig();
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.totalRows).toBeGreaterThan(0);

    // Phase 3-5: poems / sutras / chars
    for (const endpoint of ['init-poems', 'init-sutras', 'init-chars']) {
      const { POST } = await import(`@/app/api/init/${endpoint}/route`);
      const r = await POST();
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(b.ok).toBe(true);
    }

    // Phase 6: stash-admin (valid) → consume token → create-admin (token-based)
    const { POST: stashAdmin } = await import('@/app/api/init/stash-admin/route');
    const { NextRequest } = await import('next/server');
    const stashRes = await stashAdmin(
      new NextRequest('http://localhost/api/init/stash-admin', {
        method: 'POST',
        body: JSON.stringify({ username: 'wizardtest', password: 'supersecret', email: 'w@x.com' }),
      })
    );
    expect(stashRes.status).toBe(200);
    const stashBody = await stashRes.json();
    expect(stashBody.ok).toBe(true);
    expect(stashBody.data.token).toMatch(/^[0-9a-f]{32}$/);

    const { POST: createAdmin } = await import('@/app/api/init/create-admin/route');
    res = await createAdmin(
      new NextRequest('http://localhost/api/init/create-admin', {
        method: 'POST',
        body: JSON.stringify({ token: stashBody.data.token }),
      })
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBeGreaterThan(0);
    expect(body.data.username).toBe('wizardtest');

    // Re-using the same token must fail (one-shot)
    const replayRes = await createAdmin(
      new NextRequest('http://localhost/api/init/create-admin', {
        method: 'POST',
        body: JSON.stringify({ token: stashBody.data.token }),
      })
    );
    expect(replayRes.status).toBe(401);

    // Phase 7: activate
    const { POST: initActivate } = await import('@/app/api/init/init-activate/route');
    res = await initActivate();
    expect(res.status).toBe(200);

    // Phase 8: migrate
    const { POST: migrate } = await import('@/app/api/init/migrate/route');
    res = await migrate();
    expect(res.status).toBe(200);

    // Phase 9: mark-complete — must set setup.completed=true
    const { POST: markComplete } = await import('@/app/api/init/mark-complete/route');
    res = await markComplete();
    expect(res.status).toBe(200);
    // Inspect Set-Cookie header
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/setup_completed=1/);

    // Verify the app_config flag
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = 'setup.completed' LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe('true');
  }, 120_000);
});