/**
 * lib/env.ts — Rule 3, the DATABASE_URL check.
 *
 * 2026-11-03 (R-228): the production server logged
 *
 *     [env] ERROR [DATABASE_URL] DATABASE_URL points to a dev/local DB
 *     (127.0.0.1, localhost, or piyin_dev schema) — production would
 *     corrupt dev state
 *
 * on a deployment that was NOT pointing at a development database. The
 * production `chars` table holds 7909 rows and the repository's content
 * set is 7905 files, so that database was seeded from this repository by
 * `chars:import` — it is a real production database. The server simply
 * runs its own MySQL on the same machine, and the old rule read any local
 * socket as "a developer's laptop database".
 *
 * The check cannot see a credential, so it cannot know which machine it is
 * running on. What it CAN see reliably is the SCHEMA NAME. That is what
 * this file pins down.
 *
 * The check must keep its original purpose: a `piyin_dev` schema in
 * production is always wrong, and that case stays an error.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { classifyDatabaseUrl, validateEnv } from '@/lib/env';

/** A complete, valid production environment. */
function prodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-secret-that-is-at-least-32-chars',
    COOKIE_SECURE: 'true',
    DATABASE_URL: 'mysql://root:pw@db.internal:3306/piyin',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

/** The issue for one variable, or undefined. */
function issueFor(env: NodeJS.ProcessEnv, varName: string) {
  return validateEnv(env).issues.find((i) => i.var === varName);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyDatabaseUrl', () => {
  it('calls a development schema an error, local or remote', () => {
    for (const url of [
      'mysql://root:pw@127.0.0.1:3306/piyin_dev',
      'mysql://root:pw@localhost:3306/piyin_dev',
      'mysql://root:pw@db.internal:3306/piyin_dev',
    ]) {
      const verdict = classifyDatabaseUrl(url);
      expect(verdict.level, url).toBe('error');
      expect(verdict.isDevSchema, url).toBe(true);
    }
  });

  it('calls a test schema an error too', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306/piyin_test');
    expect(verdict.level).toBe('error');
  });

  it('warns, not errors, for a local socket with a production schema', () => {
    // This is the production deployment that produced the false positive:
    // the server runs its own MySQL, and that is legitimate.
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306/piyin');
    expect(verdict.level).toBe('warn');
    expect(verdict.isLocalHost).toBe(true);
    expect(verdict.isDevSchema).toBe(false);
  });

  it('warns for a local socket with an unknown schema', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306/piyin_deploy_test');
    expect(verdict.level).toBe('warn');
    expect(verdict.schema).toBe('piyin_deploy_test');
  });

  it('says nothing about a remote host', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@db.internal:3306/piyin');
    expect(verdict.level).toBe('ok');
    expect(verdict.isLocalHost).toBe(false);
  });

  it('recognises the IPv6 loopback', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@[::1]:3306/piyin');
    expect(verdict.isLocalHost).toBe(true);
  });

  it('reads the schema out of a URL with a query string', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306/piyin?charset=utf8mb4');
    expect(verdict.schema).toBe('piyin');
    expect(verdict.level).toBe('warn');
  });

  it('does not mistake a password containing "piyin_dev" for the schema', () => {
    // The schema comes from the PATH, not from a substring search of the
    // whole URL — a password may legitimately contain the word.
    const verdict = classifyDatabaseUrl('mysql://root:piyin_dev_secret@db.internal:3306/piyin');
    expect(verdict.level).toBe('ok');
    expect(verdict.schema).toBe('piyin');
  });

  it('does not mistake a user name containing the schema for the schema', () => {
    const verdict = classifyDatabaseUrl('mysql://piyin_dev:secret@db.internal:3306/piyin');
    expect(verdict.level).toBe('ok');
    expect(verdict.schema).toBe('piyin');
  });

  it('handles a URL with no schema', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306');
    expect(verdict.schema).toBeNull();
    // Unknown schema on a local socket — a warning, not an error.
    expect(verdict.level).toBe('warn');
  });

  it('is case-insensitive about the dev schema', () => {
    const verdict = classifyDatabaseUrl('mysql://root:pw@127.0.0.1:3306/PIYIN_DEV');
    expect(verdict.level).toBe('error');
  });
});

describe('validateEnv — Rule 3', () => {
  it('reports no DATABASE_URL issue for a remote production host', () => {
    expect(issueFor(prodEnv(), 'DATABASE_URL')).toBeUndefined();
  });

  it('reports a development schema as an error', () => {
    const issue = issueFor(
      prodEnv({ DATABASE_URL: 'mysql://root:pw@db.internal:3306/piyin_dev' }),
      'DATABASE_URL',
    );
    expect(issue?.level).toBe('error');
  });

  it('reports a local socket with a production schema as a warning', () => {
    // The false positive, fixed: this is a warning, so it does not make
    // `ok` false and does not block the admin checklist's "ready" state.
    const issue = issueFor(
      prodEnv({ DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin' }),
      'DATABASE_URL',
    );
    expect(issue?.level).toBe('warn');
  });

  it('keeps `ok` true for a warning but not for an error', () => {
    const warned = validateEnv(
      prodEnv({ DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin' }),
    );
    expect(warned.ok).toBe(true);

    const errored = validateEnv(
      prodEnv({ DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin_dev' }),
    );
    expect(errored.ok).toBe(false);
  });

  it('still reports a missing DATABASE_URL as an error', () => {
    const env = prodEnv();
    delete env.DATABASE_URL;
    const issue = issueFor(env, 'DATABASE_URL');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('not set');
  });

  it('does not complain about the database in development', () => {
    // In dev the local database is the expected state; validateEnv is a
    // no-op there (see the module docstring).
    const result = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'mysql://root:pw@127.0.0.1:3306/piyin_dev',
    } as NodeJS.ProcessEnv);
    expect(result.issues).toEqual([]);
  });

  it('does not leak the password into the message', () => {
    const issue = issueFor(
      prodEnv({ DATABASE_URL: 'mysql://root:sup3rs3cret@127.0.0.1:3306/piyin_dev' }),
      'DATABASE_URL',
    );
    expect(issue?.message).not.toContain('sup3rs3cret');
  });
});
