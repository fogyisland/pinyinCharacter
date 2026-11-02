import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The release ledger and the cleanup rule (design §4.1, §4.2).
 *
 * The ledger is a FILE, not a table: it has to travel with the repository,
 * because the copy on the server and the copy in the repo must be the same
 * one — otherwise the two sides drift and the repository keeps re-publishing
 * what the server has already deleted.
 *
 * What is under test is the RULE, and the rule has exactly one dangerous
 * failure mode: **deleting by creation time instead of by supersession
 * time** (review focus #19). A release that was superseded *yesterday* but
 * was created 90 days ago may still be referenced by a stylesheet a visitor
 * cached within the last 30 days — deleting it hands that visitor a 404 and
 * a fallback to a *different* CJK typeface. So the deletion clock is
 * `supersededAt`, never `publishedAt`, never the directory's mtime.
 *
 * Two different clocks are in play and they must not be confused:
 *
 *  - the **directory mtime** ranks "the most recent 3" (which ones are
 *    kept). The publish token is a HASH — it is not monotonic — so sorting
 *    by token would keep the wrong three;
 *  - the **supersededAt** decides whether a release is old enough to go
 *    (30 days).
 *
 * ⚠️ EVERYTHING here runs in a temporary directory. The real ledger lives at
 * `public/font/releases.json` and the real release trees at
 * `public/font/web/r<token>/` — the cleanup DELETES, and a test that points
 * at the live tree would delete the site's fonts.
 */
import {
  readReleases,
  writeReleases,
  markSuperseded,
  planCleanup,
  canCleanReleases,
  removeReleaseDirs,
  __fs,
  type ReleaseRecord,
} from '@/lib/webfont/releases';

/** A day in milliseconds — the unit every "N days ago" in this file uses. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The retention window of the stylesheet layer (design §3.5.4). */
const RETENTION_DAYS = 30;

let fontDir: string;
let webDir: string;

/** The "now" every test measures against. */
const NOW = new Date('2026-11-02T12:00:00.000Z');

/**
 * Builds a ledger record. `supersededAt` defaults to `null` — the release
 * that is currently published.
 */
function record(overrides: Partial<ReleaseRecord> & { dir: string }): ReleaseRecord {
  return {
    token: overrides.dir.slice(1),
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    deletedAt: null,
    files: 7981,
    bytes: 28236168,
    ...overrides,
  };
}

/**
 * Creates a release directory on disk and pins its mtime.
 *
 * The mtime is what "the most recent 3" is ranked by, so it has to be
 * settable — and it is the whole point of the ordering test.
 */
function makeReleaseDir(dir: string, mtime: Date, bytes = 1024): void {
  const target = join(webDir, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'a.woff2'), Buffer.alloc(bytes, 1));
  writeFileSync(join(target, 'b.woff2'), Buffer.alloc(bytes, 1));
  utimesSync(target, mtime, mtime);
}

/** The days-ago timestamp of a day offset from NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** The absolute Date of a day offset from NOW. */
function daysAgoDate(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

beforeEach(() => {
  fontDir = mkdtempSync(join(tmpdir(), 'webfont-releases-'));
  webDir = join(fontDir, 'web');
  mkdirSync(webDir, { recursive: true });
});

afterEach(() => {
  rmSync(fontDir, { recursive: true, force: true });
});

describe('readReleases', () => {
  it('returns an empty array when the ledger file does not exist', () => {
    // The ledger does not exist until the first apply publishes a release.
    // "No ledger yet" is the normal state of a fresh tree, not an error.
    expect(existsSync(join(fontDir, 'releases.json'))).toBe(false);

    const releases = readReleases(fontDir);

    expect(releases).toEqual([]);
  });

  it('reads the releases array out of the ledger file', () => {
    const releases = [
      record({ dir: 'r3f2a1b0c9d8', supersededAt: null }),
      record({ dir: 'r9a8b7c6d5e4f', supersededAt: '2026-11-01T10:00:00.000Z' }),
    ];
    writeReleases(releases, fontDir);

    expect(readReleases(fontDir)).toEqual(releases);
  });

  it('throws with the path and the reason when the ledger is not a releases object', () => {
    // Silently treating a corrupt ledger as "no releases" would make the
    // next apply publish on top of a history nobody can see — and the
    // cleanup would happily delete directories that are still referenced.
    writeFileSync(join(fontDir, 'releases.json'), JSON.stringify({ nope: [] }));

    expect(() => readReleases(fontDir)).toThrow(/releases\.json/);
  });

  it('throws with the path and the reason when the ledger is not JSON at all', () => {
    writeFileSync(join(fontDir, 'releases.json'), '{ this is not json');

    expect(() => readReleases(fontDir)).toThrow(/releases\.json/);
  });

  it('treats a missing deletedAt as null', () => {
    // The spec's own example omits `deletedAt` on the first record.
    writeFileSync(
      join(fontDir, 'releases.json'),
      JSON.stringify({
        releases: [
          {
            dir: 'r3f2a1b0c9d8',
            token: '3f2a1b0c9d8',
            publishedAt: '2026-11-01T10:00:00.000Z',
            supersededAt: null,
            files: 7981,
            bytes: 28236168,
          },
        ],
      }),
    );

    expect(readReleases(fontDir)[0].deletedAt).toBeNull();
  });

  it('throws with the ledger path when an entry names a directory outside the tree', () => {
    // ⚠️ The ledger is under `public/` — anybody can read it. A `dir` of
    // `../../victim` is corrupt (or hostile) data and must never reach the
    // delete path. The read refuses loudly, with the path in the message.
    // ⚠️ Written by hand: `writeReleases` does not validate, and the point
    // is to prove the READER rejects it.
    writeFileSync(
      join(fontDir, 'releases.json'),
      JSON.stringify({
        releases: [
          {
            dir: '../../victim',
            token: 'victim',
            publishedAt: '2026-11-01T10:00:00.000Z',
            supersededAt: null,
            files: 1,
            bytes: 1,
          },
        ],
      }),
    );

    expect(() => readReleases(fontDir)).toThrow(/releases\.json/);
    expect(() => readReleases(fontDir)).toThrow(/not a release directory/);
  });

  it('throws when an entry names a live font directory of release 0', () => {
    // `sans` is a real directory in `web/` — the one the site serves its
    // fonts from. It matches no release pattern, so it can never be a
    // ledger entry.
    writeFileSync(
      join(fontDir, 'releases.json'),
      JSON.stringify({
        releases: [
          {
            dir: 'sans',
            token: 'sans',
            publishedAt: '2026-11-01T10:00:00.000Z',
            supersededAt: null,
            files: 1,
            bytes: 1,
          },
        ],
      }),
    );

    expect(() => readReleases(fontDir)).toThrow(/not a release directory/);
  });
});

describe('writeReleases', () => {
  it('writes the releases under the "releases" key', () => {
    // The on-disk shape is pinned by design §4.1 — it is a file that
    // travels with the repository and other tools read it.
    writeReleases([record({ dir: 'r3f2a1b0c9d8' })], fontDir);

    const raw = JSON.parse(
      readFileSync(join(fontDir, 'releases.json'), 'utf8'),
    ) as { releases: unknown[] };

    expect(Array.isArray(raw.releases)).toBe(true);
    expect(raw.releases).toHaveLength(1);
  });

  it('keeps the old ledger intact when the write fails half way', () => {
    // The atomicity contract (design §4.1): a crash in the middle of the
    // write must not leave half a JSON behind. A half-written ledger is
    // worse than no ledger — the next read would throw, and the admin
    // could not tell a corrupt file from a fresh tree.
    const before = [record({ dir: 'r3f2a1b0c9d8' })];
    writeReleases(before, fontDir);

    const originalWrite = __fs.writeFileSync;
    __fs.writeFileSync = () => {
      throw new Error('disk full');
    };
    try {
      expect(() =>
        writeReleases([record({ dir: 'r000000000000' }), record({ dir: 'r111111111111' })], fontDir),
      ).toThrow(/disk full/);
    } finally {
      __fs.writeFileSync = originalWrite;
    }

    // The old ledger is still there, byte for byte, and still parses.
    expect(readReleases(fontDir)).toEqual(before);
  });

  it('leaves no temporary file behind when the rename fails', () => {
    writeReleases([record({ dir: 'r3f2a1b0c9d8' })], fontDir);

    const originalRename = __fs.renameSync;
    __fs.renameSync = () => {
      throw new Error('rename refused');
    };
    try {
      expect(() => writeReleases([record({ dir: 'r000000000000' })], fontDir)).toThrow(
        /rename refused/,
      );
    } finally {
      __fs.renameSync = originalRename;
    }

    const leftovers = readdirSync(fontDir).filter(
      (name) => name !== 'releases.json' && name !== 'web',
    );
    expect(leftovers).toEqual([]);
    // And the old ledger survived.
    expect(readReleases(fontDir)[0].dir).toBe('r3f2a1b0c9d8');
  });
});

describe('markSuperseded', () => {
  it('stamps the superseded time on the matching record', () => {
    writeReleases(
      [
        record({ dir: 'r3f2a1b0c9d8', supersededAt: null }),
        record({ dir: 'r9a8b7c6d5e4f', supersededAt: null }),
      ],
      fontDir,
    );

    markSuperseded('r9a8b7c6d5e4f', '2026-11-01T10:00:00.000Z', fontDir);

    const releases = readReleases(fontDir);
    expect(releases[0].supersededAt).toBeNull();
    expect(releases[1].supersededAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it('changes nothing at all when the directory is not in the ledger', () => {
    // apply must not invent a record: the ledger is a history of releases
    // that were actually published.
    const before = [record({ dir: 'r3f2a1b0c9d8', supersededAt: null })];
    writeReleases(before, fontDir);
    const rawBefore = readFileSync(join(fontDir, 'releases.json'), 'utf8');

    markSuperseded('r9a8b7c6d5e4f', '2026-11-01T10:00:00.000Z', fontDir);

    const rawAfter = readFileSync(join(fontDir, 'releases.json'), 'utf8');
    expect(rawAfter).toBe(rawBefore);
    expect(readReleases(fontDir)).toEqual(before);
  });
});

describe('planCleanup', () => {
  it('keeps a release that was superseded yesterday, even though it was created 90 days ago', () => {
    // ⚠️ THIS IS THE CASE THE WHOLE TASK EXISTS FOR (review focus #19).
    // The release has been on disk for 90 days, but it was superseded only
    // yesterday — a stylesheet cached in the last 30 days still points at
    // it. Deleting it now hands that visitor a 404 and a fallback to a
    // different CJK typeface. The clock is `supersededAt`, NOT the
    // creation time.
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(90));
    writeReleases(
      [
        record({
          dir: 'raaaaaaaaaaaa',
          publishedAt: daysAgo(90),
          supersededAt: daysAgo(1),
        }),
        // Three newer directories, so the old one is outside the kept 3.
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null }),
      ],
      fontDir,
    );
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));
    makeReleaseDir('rcccccccccccc', daysAgoDate(2));
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));

    const plan = planCleanup(NOW, fontDir);

    expect(plan.map((r) => r.dir)).not.toContain('raaaaaaaaaaaa');
  });

  it('plans the removal of a release superseded 40 days ago and outside the kept 3', () => {
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(100));
    writeReleases(
      [
        record({
          dir: 'raaaaaaaaaaaa',
          publishedAt: daysAgo(100),
          supersededAt: daysAgo(40),
        }),
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null }),
      ],
      fontDir,
    );
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));
    makeReleaseDir('rcccccccccccc', daysAgoDate(2));
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));

    const plan = planCleanup(NOW, fontDir);

    expect(plan.map((r) => r.dir)).toEqual(['raaaaaaaaaaaa']);
  });

  it('keeps every one of the most recent 3, however old they are', () => {
    // The stylesheet layer has a 30-day TTL, but a release that is still
    // among the 3 most recent is kept regardless of its age — the rule is
    // "not among the kept 3 AND superseded more than 30 days ago".
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(500));
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(400));
    makeReleaseDir('rcccccccccccc', daysAgoDate(300));
    writeReleases(
      [
        record({ dir: 'raaaaaaaaaaaa', publishedAt: daysAgo(500), supersededAt: daysAgo(400) }),
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(400), supersededAt: daysAgo(300) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(300), supersededAt: daysAgo(200) }),
      ],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    expect(plan).toEqual([]);
  });

  it('keeps the release that has not been superseded yet', () => {
    // `supersededAt === null` means "this is the one currently published".
    // It is never a candidate — there is no clock to measure it against.
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));
    writeReleases(
      [record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null })],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    expect(plan).toEqual([]);
  });

  it('never lists release 0', () => {
    // Release 0 is `web/sans/`, `web/serif/`, `web/wenkai/` — the family
    // directories without an `r` prefix. It is never in the ledger, and
    // the disk scan must not mistake those directories for releases.
    mkdirSync(join(webDir, 'sans'), { recursive: true });
    mkdirSync(join(webDir, 'serif'), { recursive: true });
    mkdirSync(join(webDir, 'wenkai'), { recursive: true });
    writeFileSync(join(webDir, 'sans', 'x.woff2'), 'x');

    const plan = planCleanup(NOW, fontDir);

    expect(plan).toEqual([]);
  });

  it('ranks the kept 3 by directory mtime, not by the publish token', () => {
    // The publish token is a HASH — it is not monotonic. Sorting by token
    // would keep the wrong three and delete a directory somebody still
    // has cached (review focus #11).
    // `rffffffffffff` sorts LAST as a string but is the NEWEST on disk.
    makeReleaseDir('r000000000000', daysAgoDate(100));
    makeReleaseDir('rffffffffffff', daysAgoDate(1));
    makeReleaseDir('r111111111111', daysAgoDate(2));
    makeReleaseDir('r222222222222', daysAgoDate(3));
    writeReleases(
      [
        record({ dir: 'r000000000000', publishedAt: daysAgo(100), supersededAt: daysAgo(90) }),
        record({ dir: 'rffffffffffff', publishedAt: daysAgo(1), supersededAt: null }),
        record({ dir: 'r111111111111', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'r222222222222', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
      ],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    // `r000000000000` is the OLDEST on disk ⇒ it is outside the kept 3 ⇒
    // it is the only candidate (it was superseded 90 days ago).
    expect(plan.map((r) => r.dir)).toEqual(['r000000000000']);
  });

  it('does not treat the family directories of release 0 as release directories', () => {
    // `sans` / `serif` / `wenkai` match no release pattern ⇒ they are
    // never candidates and never occupy a slot of the kept 3. If they
    // counted, they would push a real release out of the kept three and
    // that release would be deleted.
    mkdirSync(join(webDir, 'sans'), { recursive: true });
    writeFileSync(join(webDir, 'sans', 'x.woff2'), 'x');
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(100));
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));
    makeReleaseDir('rcccccccccccc', daysAgoDate(2));
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));
    writeReleases(
      [
        record({ dir: 'raaaaaaaaaaaa', publishedAt: daysAgo(100), supersededAt: daysAgo(90) }),
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null }),
      ],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    // `sans` is not a release ⇒ it does not count towards the kept 3 ⇒
    // `raaaaaaaaaaaa` is a candidate.
    expect(plan.map((r) => r.dir)).toEqual(['raaaaaaaaaaaa']);
  });

  it('does not list a release that was already cleaned', () => {
    // The ledger is a history: a cleaned entry keeps its row, but it is
    // never a candidate again.
    makeReleaseDir('r000000000000', daysAgoDate(100));
    writeReleases(
      [
        record({
          dir: 'r000000000000',
          publishedAt: daysAgo(100),
          supersededAt: daysAgo(90),
          deletedAt: daysAgo(5),
        }),
      ],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    expect(plan).toEqual([]);
  });

  it('keeps a release that was superseded exactly 30 days ago', () => {
    // "超过 30 天" is strictly more than 30 days.
    makeReleaseDir('r000000000000', daysAgoDate(100));
    writeReleases(
      [
        record({
          dir: 'r000000000000',
          publishedAt: daysAgo(100),
          supersededAt: daysAgo(RETENTION_DAYS),
        }),
      ],
      fontDir,
    );

    const plan = planCleanup(NOW, fontDir);

    expect(plan).toEqual([]);
  });

  it('still plans a ledger entry whose directory is no longer on disk', () => {
    // A directory that somebody removed by hand cannot be ranked, so it
    // cannot be among the kept three — it still qualifies on the 30-day
    // rule. The cleanup then finds nothing to delete for it and moves on
    // instead of crashing.
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));
    makeReleaseDir('rcccccccccccc', daysAgoDate(2));
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));
    writeReleases(
      [
        record({
          dir: 'r000000000000',
          publishedAt: daysAgo(100),
          supersededAt: daysAgo(90),
        }),
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null }),
      ],
      fontDir,
    );
    // `r000000000000` has no directory on disk.

    const plan = planCleanup(NOW, fontDir);

    expect(plan.map((r) => r.dir)).toEqual(['r000000000000']);
  });
});

describe('canCleanReleases', () => {
  it('agrees with the cleanup plan, directory for directory', () => {
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(100));
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));
    makeReleaseDir('rcccccccccccc', daysAgoDate(2));
    makeReleaseDir('rdddddddddddd', daysAgoDate(1));
    writeReleases(
      [
        record({ dir: 'raaaaaaaaaaaa', publishedAt: daysAgo(100), supersededAt: daysAgo(90) }),
        record({ dir: 'rbbbbbbbbbbb', publishedAt: daysAgo(3), supersededAt: daysAgo(2) }),
        record({ dir: 'rcccccccccccc', publishedAt: daysAgo(2), supersededAt: daysAgo(1) }),
        record({ dir: 'rdddddddddddd', publishedAt: daysAgo(1), supersededAt: null }),
      ],
      fontDir,
    );

    const planDirs = planCleanup(NOW, fontDir).map((r) => r.dir);
    const canClean = canCleanReleases(NOW, fontDir);

    expect([...canClean].sort()).toEqual(planDirs.sort());
  });
});

describe('removeReleaseDirs', () => {
  it('deletes the release directories and reports their size', () => {
    makeReleaseDir('raaaaaaaaaaaa', daysAgoDate(100));
    makeReleaseDir('rbbbbbbbbbbb', daysAgoDate(3));

    const removed = removeReleaseDirs(['raaaaaaaaaaaa'], fontDir);

    expect(removed).toHaveLength(1);
    expect(removed[0].dir).toBe('raaaaaaaaaaaa');
    expect(removed[0].removed).toBe(true);
    expect(removed[0].bytes).toBeGreaterThan(0);
    expect(existsSync(join(webDir, 'raaaaaaaaaaaa'))).toBe(false);
    // The other release is untouched.
    expect(existsSync(join(webDir, 'rbbbbbbbbbbb'))).toBe(true);
  });

  it('does not crash when the directory is already gone', () => {
    // ⚠️ The name has to be a legal release directory name (`r` + lowercase
    // hex) — otherwise the refusal gate would throw instead of reporting
    // "already gone". The old fixture `rnotthere00000` carried letters that
    // are not hex; `rdeadbeefcafe` is the same shape, spelled legally.
    const removed = removeReleaseDirs(['rdeadbeefcafe'], fontDir);

    expect(removed).toEqual([{ dir: 'rdeadbeefcafe', bytes: 0, removed: false }]);
  });

  it('refuses a directory that escapes the release root, and deletes nothing', () => {
    // ⚠️ THE WHOLE POINT OF THIS FIX. The ledger sits under `public/`, so
    // anybody can read it — and a `dir` of `../outside` used to delete a
    // directory OUTSIDE the font tree, irreversibly.
    const outside = join(fontDir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'important');

    expect(() => removeReleaseDirs(['../outside'], fontDir)).toThrow(
      /outside the release root/,
    );

    // ★ The victim must still be there: "it threw" is not enough.
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(outside, 'victim.txt'))).toBe(true);
  });

  it('refuses a directory that escapes two levels up, and deletes nothing', () => {
    const victim = join(fontDir, '..', 'victim');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'victim.txt'), 'important');

    try {
      expect(() => removeReleaseDirs(['../../victim'], fontDir)).toThrow(
        /outside the release root/,
      );

      // ★ The victim and the file inside it must still be there.
      expect(existsSync(victim)).toBe(true);
      expect(existsSync(join(victim, 'victim.txt'))).toBe(true);
    } finally {
      rmSync(victim, { recursive: true, force: true });
    }
  });

  it('refuses the release root itself, and does not delete the whole tree', () => {
    // ⚠️ `''` and `'.'` resolve to the root ITSELF — they do not escape it.
    // The refusal says so, because "outside the release root" would be a
    // lie about a path that is exactly the root.
    expect(() => removeReleaseDirs([''], fontDir)).toThrow(/release root itself/);
    expect(() => removeReleaseDirs(['.'], fontDir)).toThrow(/release root itself/);

    // ★ `web/` must still be there — an empty name would otherwise have
    // wiped every release at once.
    expect(existsSync(webDir)).toBe(true);
  });

  it('refuses a live font directory of release 0, and keeps it', () => {
    // ⚠️ `web/sans` IS inside the release root ⇒ a path check alone would
    // let it through ⇒ the site would lose its fonts. Only the name
    // pattern can see this one.
    mkdirSync(join(webDir, 'sans'), { recursive: true });
    writeFileSync(join(webDir, 'sans', 'x.woff2'), 'x');

    expect(() => removeReleaseDirs(['sans'], fontDir)).toThrow(
      /not a release directory name/,
    );

    // ★ The live font must still be there.
    expect(existsSync(join(webDir, 'sans'))).toBe(true);
    expect(existsSync(join(webDir, 'sans', 'x.woff2'))).toBe(true);
  });

  it('reports the two refusals with the reason that is actually true', () => {
    // ⚠️ `sans` is INSIDE the release root — only the name gate can see it.
    // `../outside` is OUTSIDE — only the path gate can see it. Both gates
    // must be reachable, and each must name its own reason.
    expect(() => removeReleaseDirs(['sans'], fontDir)).toThrow(
      /not a release directory name/,
    );
    expect(() => removeReleaseDirs(['../outside'], fontDir)).toThrow(
      /outside the release root/,
    );
    // ⚠️ And the refusal must NOT claim "outside" for a name that is
    // inside — that sentence was false and would mislead the admin.
    expect(() => removeReleaseDirs(['sans'], fontDir)).not.toThrow(
      /outside the release root/,
    );
  });
});
