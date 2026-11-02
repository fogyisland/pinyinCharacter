import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GET /api/admin/webfonts/releases and POST /api/admin/webfonts/releases/cleanup
 *
 * The two routes of the release ledger (design §4.1, §4.2, §5).
 *
 * What is under test is the CONTRACT, because the admin page (Task 8)
 * reads it:
 *
 *  - the body is FLAT, with `ok` at the TOP LEVEL — the page reads
 *    `data.releases` / `data.removed`, not `data.data.releases`;
 *  - `canClean` is DERIVED per release and never stored on disk;
 *  - the cleanup POST takes NO body — an empty body must work, and an
 *    unknown field must be a 400;
 *  - "nothing to clean" is a 409, not a 200 with an empty list;
 *  - the cleanup writes an audit entry and says out loud that the
 *    repository's copy has to be `git rm -r`'d as well.
 *
 * ⚠️ THE CLEANUP DELETES ⇒ the routes are pointed at a TEMPORARY font
 * tree. `lib/webfont/paths` is mocked so that `LIVE_FONT_DIR` — the
 * default every ledger function falls back to — points into a temporary
 * directory. The real `public/font/` is never touched.
 */

const paths = vi.hoisted(() => ({ liveFontDir: '' }));

vi.mock('@/lib/webfont/paths', () => ({
  get LIVE_FONT_DIR() {
    return paths.liveFontDir;
  },
  REPO_ROOT: process.cwd(),
  SOURCE_DIR: '',
  BUILD_DIR: '',
  buildDirFor: (jobId: string) => jobId,
}));

const requireAdminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}));

const writeAuditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (entry: unknown) => writeAuditMock(entry),
}));

import { GET } from '@/app/api/admin/webfonts/releases/route';
import { POST } from '@/app/api/admin/webfonts/releases/cleanup/route';
import { readReleases } from '@/lib/webfont/releases';

const ADMIN = { id: 7, username: 'admin', isAdmin: true };

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-02T12:00:00.000Z');

let fontDir: string;
let webDir: string;

/** A request with no body at all — what a "no parameters" button sends. */
function emptyReq(): NextRequest {
  return new NextRequest('http://localhost/api/admin/webfonts/releases/cleanup', {
    method: 'POST',
  });
}

/** A request with a JSON body. */
function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/webfonts/releases/cleanup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** A request with a body that is not JSON at all. */
function garbageReq(): NextRequest {
  return new NextRequest('http://localhost/api/admin/webfonts/releases/cleanup', {
    method: 'POST',
    body: 'not json at all',
    headers: { 'content-type': 'application/json' },
  });
}

/** Creates a release directory on disk with a pinned mtime. */
function makeReleaseDir(dir: string, mtime: Date): void {
  const target = join(webDir, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'a.woff2'), 'x');
  utimesSync(target, mtime, mtime);
}

/**
 * Puts a ledger on disk: one expired release, three kept ones.
 *
 * The expired one is superseded 90 days ago and its directory is the
 * oldest ⇒ it is the only candidate.
 */
function seedLedger(): void {
  makeReleaseDir('raaaaaaaaaaaa', new Date(NOW.getTime() - 100 * DAY_MS));
  makeReleaseDir('rbbbbbbbbbbb', new Date(NOW.getTime() - 3 * DAY_MS));
  makeReleaseDir('rcccccccccccc', new Date(NOW.getTime() - 2 * DAY_MS));
  makeReleaseDir('rdddddddddddd', new Date(NOW.getTime() - 1 * DAY_MS));

  writeFileSync(
    join(fontDir, 'releases.json'),
    JSON.stringify({
      releases: [
        {
          dir: 'raaaaaaaaaaaa',
          token: 'aaaaaaaaaaaa',
          publishedAt: '2026-01-01T00:00:00.000Z',
          supersededAt: new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
          files: 10,
          bytes: 100,
        },
        {
          dir: 'rbbbbbbbbbbb',
          token: 'bbbbbbbbbbbb',
          publishedAt: '2026-11-01T00:00:00.000Z',
          supersededAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
          files: 10,
          bytes: 100,
        },
        {
          dir: 'rcccccccccccc',
          token: 'cccccccccccc',
          publishedAt: '2026-11-01T00:00:00.000Z',
          supersededAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
          files: 10,
          bytes: 100,
        },
        {
          dir: 'rdddddddddddd',
          token: 'dddddddddddd',
          publishedAt: '2026-11-01T00:00:00.000Z',
          supersededAt: null,
          files: 10,
          bytes: 100,
        },
      ],
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  writeAuditMock.mockResolvedValue(undefined);
  fontDir = mkdtempSync(join(tmpdir(), 'webfont-releases-api-'));
  webDir = join(fontDir, 'web');
  mkdirSync(webDir, { recursive: true });
  paths.liveFontDir = fontDir;
});

afterEach(() => {
  rmSync(fontDir, { recursive: true, force: true });
});

describe('GET /api/admin/webfonts/releases', () => {
  it('answers with a flat body whose ok sits at the top level', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    // ⚠️ NOT `data.ok` — the admin page branches on `data.ok` directly.
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('releases');
    expect(body).toHaveProperty('bytes');
    expect(body).toHaveProperty('keep');
    expect(body).not.toHaveProperty('data');
  });

  it('never lets the browser cache the answer', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));

    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('describes the retention policy instead of answering with a bare boolean', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));
    const body = (await res.json()) as { keep: unknown };

    expect(typeof body.keep).toBe('string');
    expect(String(body.keep).length).toBeGreaterThan(0);
  });

  it('marks the expired release as cleanable and the kept ones as not', async () => {
    seedLedger();

    const res = await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));
    const body = (await res.json()) as {
      releases: Array<{ dir: string; canClean: boolean }>;
    };

    const verdicts = Object.fromEntries(
      body.releases.map((release) => [release.dir, release.canClean]),
    );
    expect(verdicts['raaaaaaaaaaaa']).toBe(true);
    expect(verdicts['rbbbbbbbbbbb']).toBe(false);
    expect(verdicts['rcccccccccccc']).toBe(false);
    expect(verdicts['rdddddddddddd']).toBe(false);
  });

  it('never writes canClean into the ledger on disk', async () => {
    seedLedger();

    await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));

    const raw = readReleases(fontDir);
    expect(raw.every((release) => !('canClean' in release))).toBe(true);
  });

  it('refuses a request that is not an administrator', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: new Response(null, { status: 403 }),
    });

    const res = await GET(new NextRequest('http://localhost/api/admin/webfonts/releases'));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/webfonts/releases/cleanup', () => {
  it('answers 409 when there is nothing to clean', async () => {
    const res = await POST(emptyReq());
    const body = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    // The message is user-facing copy ⇒ Chinese.
    expect(body.error?.message).toContain('没有可清理的 release');
  });

  it('accepts an empty body', async () => {
    // The endpoint takes no parameters, and a button that sends no body
    // must not be answered with a 400.
    const res = await POST(emptyReq());

    // 409 (nothing to clean) or 200 (something was cleaned) — but never
    // a 400.
    expect(res.status).not.toBe(400);
  });

  it('accepts a body that is not JSON at all', async () => {
    const res = await POST(garbageReq());

    expect(res.status).not.toBe(400);
  });

  it('rejects an unknown field with a 400', async () => {
    const res = await POST(jsonReq({ somethingElse: true }));
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_input');
  });

  it('refuses a request that is not an administrator', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: new Response(null, { status: 401 }),
    });

    const res = await POST(emptyReq());

    expect(res.status).toBe(401);
  });

  it('removes the expired directory, keeps the others, and audits the cleanup', async () => {
    seedLedger();

    const res = await POST(emptyReq());
    const body = (await res.json()) as {
      ok: boolean;
      removed: Array<{ dir: string }>;
      kept: string[];
      repoHint: string;
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.removed.map((entry) => entry.dir)).toEqual(['raaaaaaaaaaaa']);
    // The kept ones are the current release and the two predecessors.
    expect(body.kept.sort()).toEqual([
      'rbbbbbbbbbbb',
      'rcccccccccccc',
      'rdddddddddddd',
    ]);
    // The directory is really gone.
    expect(existsSync(join(webDir, 'raaaaaaaaaaaa'))).toBe(false);
    expect(existsSync(join(webDir, 'rdddddddddddd'))).toBe(true);
    // ⚠️ The response has to say that the repository's copy needs the
    // same treatment — the backend never runs git.
    expect(body.repoHint).toContain('git rm -r');
  });

  it('stamps only the cleaned entry and leaves every other record untouched', async () => {
    seedLedger();
    const before = readReleases(fontDir);

    await POST(emptyReq());

    const after = readReleases(fontDir);
    expect(after).toHaveLength(before.length);
    for (const original of before) {
      const current = after.find((release) => release.dir === original.dir);
      expect(current).toBeDefined();
      if (original.dir === 'raaaaaaaaaaaa') {
        expect(current?.deletedAt).not.toBeNull();
      } else {
        // Every other record is byte-identical.
        expect(current).toEqual(original);
      }
    }
  });

  it('writes an audit entry that carries the removed directories and a readable title', async () => {
    seedLedger();

    await POST(emptyReq());

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditMock.mock.calls[0][0] as {
      userId: number;
      event: string;
      metadata: Record<string, unknown>;
    };
    expect(entry.event).toBe('admin_webfont_releases_cleaned');
    expect(entry.userId).toBe(ADMIN.id);
    expect(entry.metadata.removed).toEqual(['raaaaaaaaaaaa']);
    // The project's audit convention: the metadata carries a title.
    expect(typeof entry.metadata.title).toBe('string');
    expect(String(entry.metadata.title).length).toBeGreaterThan(0);
  });
});
