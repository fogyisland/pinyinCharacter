/**
 * The release ledger and the cleanup rule (design §4.1, §4.2).
 *
 * ## What this module is for
 *
 * Every apply publishes a NEW release directory (`public/font/web/r<token>/`)
 * and rewrites the three stylesheets to point at it. The old directories stay
 * on disk — deletion is irreversible, so it is a SEPARATE, EXPLICIT admin
 * action (design §4.2), never a side effect of applying.
 *
 * This module owns two things and nothing else:
 *
 *  1. the ledger FILE (`<fontDir>/releases.json`) — the history of every
 *     release that was published, with the moment it was superseded;
 *  2. the cleanup RULE — which releases may be deleted, and when.
 *
 * It owns no HTTP and no database. The two routes under
 * `app/api/admin/webfonts/releases/` call into it.
 *
 * ## The one rule that matters
 *
 * A release directory may only be deleted when BOTH hold:
 *
 *  1. it is not among the **three most recent** (the current one plus the
 *     previous two), ranked by the **mtime of the directory on disk**; and
 *  2. its **superseded time** (`supersededAt`) is **more than 30 days** ago.
 *
 * ⚠️ The clock in condition 2 is the **superseded time**, NEVER the
 * creation time. A release can sit on disk for months before it is
 * superseded (nothing changed in the corpus, so the apply was refused; or
 * several publishes in a row). Deleting by creation time would remove a
 * release that was superseded *yesterday* — and the stylesheet a visitor
 * cached within the last 30 days still points at it. That visitor would get
 * a 404 and fall back to a *different* CJK typeface (design §3.5.4).
 *
 * ⚠️ The publish token is a HASH — it is **not** monotonic. Sorting by the
 * token would keep the wrong three. The mtime is the only honest ranking.
 *
 * ## Why the ledger is a file and not a table
 *
 * The ledger has to travel with the repository: on the next `rsync` the copy
 * in the repo would otherwise overwrite the server's copy, and the two would
 * drift — the server deletes a directory the repo still publishes.
 *
 * ⚠️ `releases.json` sits under `public/`, so **anyone** can read it over
 * HTTP. It therefore carries nothing but directory names, timestamps and
 * byte counts — no tokens, no keys, no absolute paths.
 *
 * ## Why every function takes a `fontDir`
 *
 * The ledger must live in the tree it describes. The live tree is
 * `public/font` (`LIVE_FONT_DIR`), but a test must never write there — the
 * cleanup DELETES. Hence the optional trailing parameter: the default is the
 * live tree, and a test passes a temporary directory.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { LIVE_FONT_DIR } from './paths';

/** One published release, as the ledger records it (design §4.1). */
export type ReleaseRecord = {
  /** The release directory name — `r` plus the publish token. */
  dir: string;
  /** The publish token, without the `r` prefix. */
  token: string;
  /** ISO timestamp of the moment the release went live. */
  publishedAt: string;
  /**
   * ISO timestamp of the moment the NEXT release replaced this one.
   * `null` means "not superseded yet" — this is the release that is
   * currently published, and it is never a cleanup candidate.
   */
  supersededAt: string | null;
  /**
   * ISO timestamp of the moment the directory was removed.
   * `null` means "still on disk". A cleaned entry KEEPS its row — the
   * ledger is a history, not a listing of what currently exists.
   */
  deletedAt: string | null;
  /** How many woff2 files the release holds. */
  files: number;
  /** How many bytes the release occupies. */
  bytes: number;
};

/** How many releases are kept regardless of their age (design §3.5.4). */
export const KEEP_RECENT = 3;

/** How long a superseded release is kept (design §3.5.4). */
export const RETENTION_DAYS = 30;

/** The name of the ledger file inside the font root. */
const LEDGER_FILE = 'releases.json';

/**
 * The release-directory pattern: `r` followed by lowercase hex.
 *
 * ⚠️ It is deliberately narrow. `public/font/web/` also holds release 0's
 * family directories (`sans`, `serif`, `wenkai`) — they match nothing here,
 * so release 0 can never be a candidate and can never occupy one of the
 * three kept slots. The pattern is the same one the verifier's
 * `parseFaceUrl()` accepts for the release segment of a font URL.
 */
const RELEASE_DIR_PATTERN = /^r[0-9a-f]+$/;

/**
 * The filesystem seam.
 *
 * The atomic write has to be provable: a test must be able to make the
 * write fail half way and show that the previous ledger survived. The
 * obvious tool — `vi.spyOn(fs, 'writeFileSync')` — does NOT work here:
 * the `node:fs` namespace object is frozen, and Vitest answers
 * `Cannot redefine property: writeFileSync`.
 *
 * ⇒ So the seam is this exported object. The module calls `__fs.writeFileSync`
 * and `__fs.renameSync`, and a test swaps in a throwing implementation for
 * the duration of one call and puts the original back afterwards.
 */
export const __fs = {
  writeFileSync,
  renameSync,
};

/** The path of the ledger inside a font root. */
export function ledgerPath(fontDir: string = LIVE_FONT_DIR): string {
  return join(fontDir, LEDGER_FILE);
}

/** The path of the release directories inside a font root. */
export function webDir(fontDir: string = LIVE_FONT_DIR): string {
  return join(fontDir, 'web');
}

/**
 * Reads the ledger.
 *
 * A ledger that does not exist yet is the normal state of a fresh tree ⇒ an
 * empty array, no throw. A ledger that exists but does not hold a releases
 * array is CORRUPT ⇒ throw with the path and the reason, because silently
 * treating it as empty would make the next apply publish on top of a
 * history nobody can see — and would let the cleanup delete directories
 * that are still referenced.
 */
export function readReleases(fontDir: string = LIVE_FONT_DIR): ReleaseRecord[] {
  const path = ledgerPath(fontDir);
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `[webfont] cannot read the release ledger at ${path}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[webfont] the release ledger at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `[webfont] the release ledger at ${path} is not an object with a releases array`,
    );
  }
  const releases = (parsed as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) {
    throw new Error(
      `[webfont] the release ledger at ${path} is not an object with a releases array`,
    );
  }

  return releases.map((entry) => normalizeRecord(entry, path));
}

/**
 * Normalizes one ledger entry.
 *
 * A missing `deletedAt` means "not cleaned" — the spec's own example omits
 * it on the current release.
 */
function normalizeRecord(entry: unknown, path: string): ReleaseRecord {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`[webfont] the release ledger at ${path} holds an entry that is not an object`);
  }
  const raw = entry as Record<string, unknown>;
  if (typeof raw.dir !== 'string' || raw.dir.length === 0) {
    throw new Error(`[webfont] the release ledger at ${path} holds an entry without a directory name`);
  }
  return {
    dir: raw.dir,
    token: typeof raw.token === 'string' ? raw.token : raw.dir.slice(1),
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
    supersededAt: typeof raw.supersededAt === 'string' ? raw.supersededAt : null,
    deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
    files: typeof raw.files === 'number' ? raw.files : 0,
    bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
  };
}

/**
 * Writes the ledger ATOMICALLY.
 *
 * The write goes to a temporary file in the SAME directory as the target and
 * is then renamed over it — a rename inside one directory is atomic on
 * Windows, a rename across directories is not. A crash in the middle
 * therefore leaves the previous ledger intact instead of half a JSON file.
 *
 * ⚠️ The temporary file is removed when the rename fails.
 */
export function writeReleases(
  releases: ReleaseRecord[],
  fontDir: string = LIVE_FONT_DIR,
): void {
  const path = ledgerPath(fontDir);
  mkdirSync(fontDir, { recursive: true });

  // The temp file lives beside the target and carries a unique suffix, so
  // two concurrent writes cannot collide on it.
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify({ releases }, null, 2)}\n`;

  try {
    __fs.writeFileSync(tmpPath, payload, 'utf8');
    __fs.renameSync(tmpPath, path);
  } catch (err) {
    // A leftover temp file would be published by the next `public/` scan.
    try {
      rmSync(tmpPath, { force: true });
    } catch (cleanupErr) {
      throw new Error(
        `[webfont] cannot write the release ledger at ${path}: ${(err as Error).message}; ` +
          `and the temporary file ${tmpPath} could not be removed: ${(cleanupErr as Error).message}`,
      );
    }
    throw new Error(
      `[webfont] cannot write the release ledger at ${path}: ${(err as Error).message}`,
    );
  }
}

/**
 * Stamps the superseded time on the ledger entry of `previousDir`.
 *
 * The moment a release is superseded is the moment the NEXT release went
 * live and the stylesheets started pointing at it (design §3.5.2, step 8) —
 * that is the instant the 30-day clock starts running.
 *
 * A directory that is not in the ledger changes NOTHING: apply must not
 * invent a release that was never published.
 */
export function markSuperseded(
  previousDir: string,
  at: string,
  fontDir: string = LIVE_FONT_DIR,
): void {
  const releases = readReleases(fontDir);
  const index = releases.findIndex((release) => release.dir === previousDir);
  if (index === -1) return;

  const updated = releases.map((release, i) =>
    i === index ? { ...release, supersededAt: at } : release,
  );
  writeReleases(updated, fontDir);
}

/**
 * The release directories that are on disk, ranked by mtime, newest first.
 *
 * Only directories whose name matches the release pattern are considered —
 * release 0's `sans` / `serif` / `wenkai` match nothing.
 */
function releaseDirsOnDisk(fontDir: string): Array<{ dir: string; mtimeMs: number }> {
  const root = webDir(fontDir);
  if (!existsSync(root)) return [];

  let names: string[];
  try {
    names = readdirSync(root);
  } catch (err) {
    throw new Error(`[webfont] cannot list the release directories at ${root}: ${(err as Error).message}`);
  }

  const found: Array<{ dir: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!RELEASE_DIR_PATTERN.test(name)) continue;
    const stat = statSync(join(root, name), { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) continue;
    found.push({ dir: name, mtimeMs: stat.mtimeMs });
  }
  // Newest first. The token is a hash and must never be the sort key.
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found;
}

/**
 * The releases that a cleanup would remove — COMPUTED, not removed.
 *
 * A release qualifies when BOTH hold:
 *
 *  1. it is not among the three most recent directories on disk; and
 *  2. it was superseded more than 30 days ago.
 *
 * ⚠️ A ledger entry whose directory is no longer on disk cannot be ranked
 * ⇒ it is not among the kept three ⇒ it can still qualify on condition 2.
 * The cleanup then finds nothing to delete for it and moves on.
 */
export function planCleanup(now: Date, fontDir: string = LIVE_FONT_DIR): ReleaseRecord[] {
  const releases = readReleases(fontDir);
  if (releases.length === 0) return [];

  const keptDirs = new Set(
    releaseDirsOnDisk(fontDir)
      .slice(0, KEEP_RECENT)
      .map((entry) => entry.dir),
  );

  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return releases.filter((release) => {
    // The current release has no supersession time — there is no clock to
    // measure it against.
    if (!release.supersededAt) return false;
    // A cleaned entry keeps its row but is never a candidate again.
    if (release.deletedAt) return false;
    // The three most recent stay, however old they are.
    if (keptDirs.has(release.dir)) return false;
    // "超过 30 天" is strictly more than 30 days.
    const supersededMs = Date.parse(release.supersededAt);
    if (!Number.isFinite(supersededMs)) return false;
    return supersededMs < cutoff;
  });
}

/**
 * The directories a cleanup would remove — the same answer as
 * {@link planCleanup}, expressed as a set of directory names.
 *
 * ⚠️ `canClean` is a VERDICT ABOUT NOW, not a property of a release: a
 * release that is not cleanable today becomes cleanable in 31 days. It is
 * therefore never written to the ledger — the ledger on disk keeps exactly
 * the shape design §4.1 pins.
 */
export function canCleanReleases(now: Date, fontDir: string = LIVE_FONT_DIR): Set<string> {
  return new Set(planCleanup(now, fontDir).map((release) => release.dir));
}

/**
 * The bytes the release directories occupy on disk.
 *
 * This is the number the admin page shows — the disk usage of the fonts
 * the site serves (design §3.5.4: about 41 MB per release).
 */
export function releaseBytesOnDisk(fontDir: string = LIVE_FONT_DIR): number {
  const root = webDir(fontDir);
  if (!existsSync(root)) return 0;

  let names: string[];
  try {
    names = readdirSync(root);
  } catch (err) {
    throw new Error(`[webfont] cannot list the release directories at ${root}: ${(err as Error).message}`);
  }

  let total = 0;
  for (const name of names) {
    if (!RELEASE_DIR_PATTERN.test(name)) continue;
    total += directoryBytes(join(root, name));
  }
  return total;
}

/** The recursive byte size of one directory tree. */
function directoryBytes(path: string): number {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;

  let total = 0;
  for (const name of readdirSync(path)) {
    total += directoryBytes(join(path, name));
  }
  return total;
}

/**
 * Deletes the release directories of a cleanup plan.
 *
 * ⚠️ This is the only destructive function in the module, and it is called
 * by exactly one route — the explicit cleanup action (design §4.2).
 *
 * A directory that is already gone is not an error: the plan may name a
 * release whose directory somebody removed by hand.
 *
 * ⚠️ The repository's copy of the same directories is NOT touched here —
 * the backend never runs git (design §9, rule 5). The administrator has to
 * `git rm -r` them in the same commit that re-imports the release.
 */
export function removeReleaseDirs(
  dirs: string[],
  fontDir: string = LIVE_FONT_DIR,
): Array<{ dir: string; bytes: number; removed: boolean }> {
  const root = webDir(fontDir);
  return dirs.map((dir) => {
    const path = join(root, dir);
    const bytes = directoryBytes(path);
    if (!existsSync(path)) {
      return { dir, bytes: 0, removed: false };
    }
    rmSync(path, { recursive: true, force: false });
    return { dir, bytes, removed: true };
  });
}
