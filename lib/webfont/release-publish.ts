/**
 * The release publisher — the disk half of the publish step.
 *
 * Everything here WRITES to the live tree. It is the part of the apply
 * that has side effects, so it is kept apart from the orchestration
 * (`apply.ts`) and from the pure text helpers (`release-text.ts`).
 *
 * ## WHAT THIS MODULE MAY DO
 *
 *   - publish a NEW release directory (`web/r<token>/`);
 *   - build a candidate tree the gate reads;
 *   - remove the candidate tree;
 *   - roll back the release directory it created itself.
 *
 * ## WHAT IT MUST NEVER DO
 *
 * It must never delete a release that is not the one it created in this
 * run. A visitor who cached the OLD stylesheet must never get a 404, so
 * the cleanup of the old releases is a separate, explicit action with its
 * own gates (design §4.2) — an apply that "just happens to tidy up" would
 * walk straight through them.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readReleases, writeReleases, markSuperseded, type ReleaseRecord } from './releases';

/** The three families of the site. */
export const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/**
 * The six stylesheets, by their file name — the key of the V hash.
 *
 * Every family has TWO stylesheets since the ext tier was split out of
 * the render-blocking one: the hot tier and the ext tier. Both are
 * released together — a release with only the hot sheet would leave the
 * ext characters of the site without a font.
 */
export const STYLESHEETS = [
  'fonts-sans-hot.css',
  'fonts-sans-ext.css',
  'fonts-serif-hot.css',
  'fonts-serif-ext.css',
  'fonts-wenkai-hot.css',
  'fonts-wenkai-ext.css',
] as const;

/** The woff2 files of a tree, with their bytes. */
export function woff2FilesOf(root: string): Array<{ path: string; bytes: number }> {
  if (!existsSync(root)) return [];
  const found: Array<{ path: string; bytes: number }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith('.woff2')) found.push({ path: full, bytes: stat.size });
    }
  };
  walk(root);
  return found;
}

/** The recursive byte size of a directory tree. */
export function directoryBytes(path: string): number {
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
 * Copies the staged release into a NEW release directory of the live tree.
 *
 * ⚠️ The directory is NEW: an apply never overwrites a release that is
 * already on the disk, because a stylesheet a visitor cached may still
 * point at it.
 *
 * @returns how many woff2 files the release holds, and how many bytes
 */
export function publishRelease(
  stagedFontDir: string,
  liveFontDir: string,
  releaseDir: string,
): { files: number; bytes: number } {
  const target = join(liveFontDir, 'web', releaseDir);
  mkdirSync(target, { recursive: true });

  const stagedWeb = join(stagedFontDir, 'web');
  let files = 0;
  let bytes = 0;

  for (const family of FAMILIES) {
    const source = join(stagedWeb, family);
    if (!existsSync(source)) continue;
    const destination = join(target, family);
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) {
      const from = join(source, name);
      const to = join(destination, name);
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true });
        continue;
      }
      cpSync(from, to);
      if (name.endsWith('.woff2')) {
        files += 1;
        bytes += statSync(to).size;
      }
    }
  }

  // ⚠️ The licences go in TWO places, exactly like wave-2 does: on the root
  // of the release and inside the directory of the family. "A subset of an
  // OFL font is still an OFL font" — the licence has to travel with it.
  for (const family of FAMILIES) {
    const licence = join(stagedWeb, `OFL-${family}.txt`);
    if (!existsSync(licence)) continue;
    cpSync(licence, join(target, `OFL-${family}.txt`));
  }

  return { files, bytes };
}

/**
 * Builds the candidate tree the gate reads.
 *
 * The candidate holds the three REWRITTEN stylesheets, a manifest whose
 * version is V, and `web/r<T>/` — the release that was just published.
 *
 * ⚠️ `web/r<T>/` is a JUNCTION to the live release directory when the
 * platform allows it: a copy of 41 MB per gate run would be wasteful, and a
 * junction needs no elevation on Windows. When it cannot be created, the
 * directory is copied instead — the gate then reads the same bytes either
 * way, and the test asserts the BEHAVIOUR, not the mechanism.
 *
 * @returns the candidate directory, and whether a junction was used
 */
export function buildCandidate(
  liveFontDir: string,
  releaseDir: string,
  rewrittenCss: Record<string, string>,
  manifest: unknown,
): { candidateDir: string; junction: boolean } {
  const candidateDir = mkdtempSync(join(tmpdir(), 'webfont-candidate-'));
  const candidateWeb = join(candidateDir, 'web');
  mkdirSync(candidateWeb, { recursive: true });

  for (const file of STYLESHEETS) {
    writeFileSync(join(candidateDir, file), rewrittenCss[file], 'utf8');
  }
  writeFileSync(
    join(candidateDir, 'fonts-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const liveRelease = join(liveFontDir, 'web', releaseDir);
  const candidateRelease = join(candidateWeb, releaseDir);
  let junction = false;
  try {
    // A junction on Windows, a symbolic link elsewhere. Neither needs
    // elevation on Windows; a symbolic link does on POSIX, and then the copy
    // below takes over.
    const { symlinkSync } = require('node:fs') as typeof import('node:fs');
    symlinkSync(liveRelease, candidateRelease, 'junction');
    junction = true;
  } catch {
    junction = false;
  }
  if (!junction) {
    cpSync(liveRelease, candidateRelease, { recursive: true });
  }

  return { candidateDir, junction };
}

/**
 * Removes the candidate tree.
 *
 * ⚠️ The junction is removed FIRST and WITHOUT descending into it: Node's
 * `fs.rm(path, { recursive: true })` removes a junction itself and does not
 * follow it into the live release. `force: true` makes a missing target a
 * non-event. ⇒ The live release survives the cleanup.
 */
export function removeCandidate(candidateDir: string): void {
  rmSync(candidateDir, { recursive: true, force: true });
}

/**
 * The release the live stylesheets currently point at, or `null`.
 *
 * It is the release whose directory name appears in the live stylesheet's
 * URLs — the one this apply supersedes.
 */
export function currentLiveReleaseDir(liveFontDir: string): string | null {
  for (const file of STYLESHEETS) {
    const path = join(liveFontDir, file);
    if (!existsSync(path)) continue;
    const css = readFileSync(path, 'utf8');
    const match = /\/font\/web\/(r[0-9a-f]+)\//.exec(css);
    if (match) return match[1];
  }
  return null;
}

/**
 * The release the live tree holds in its ledger that the stylesheets point
 * at, or `null` when there is none (the very first apply).
 */
export function supersededReleaseOf(liveFontDir: string): ReleaseRecord | null {
  const releases = readReleases(liveFontDir);
  const liveReleaseDir = currentLiveReleaseDir(liveFontDir);
  if (liveReleaseDir === null) return null;
  return releases.find((release) => release.dir === liveReleaseDir) ?? null;
}

/**
 * Records the new release in the ledger.
 *
 * ⚠️ The ledger lives in the tree it describes — the live tree, which is a
 * TEMPORARY directory in the tests. The repository's
 * `public/font/releases.json` is never touched by an apply that runs
 * against another tree.
 */
export function registerRelease(
  liveFontDir: string,
  releaseDir: string,
  token: string,
  published: { files: number; bytes: number },
  releaseBytes: number,
): void {
  const releases = readReleases(liveFontDir);
  const existing = releases.find((release) => release.dir === releaseDir);
  const record: ReleaseRecord = {
    dir: releaseDir,
    token,
    publishedAt: new Date().toISOString(),
    supersededAt: null,
    deletedAt: null,
    files: published.files,
    bytes: releaseBytes || published.bytes,
  };
  const updated = existing
    ? releases.map((release) => (release.dir === releaseDir ? record : release))
    : [...releases, record];
  writeReleases(updated, liveFontDir);
}

/**
 * Marks the release the live stylesheets used to point at as superseded.
 *
 * ⚠️ This happens AFTER the swap: the moment a release is superseded is
 * the moment the new stylesheets went live. Registering it earlier would
 * count a release as expired while it is still referenced.
 */
export function markReleaseSuperseded(
  liveFontDir: string,
  releaseDir: string,
  at: string,
): void {
  markSuperseded(releaseDir, at, liveFontDir);
}

/**
 * Removes the release directory this apply created.
 *
 * ⚠️ This is the ONLY deletion an apply performs, and it removes ONLY the
 * directory it created itself — the rollback of a refused candidate. It
 * never sweeps an old release: that is the cleanup's job, with its own
 * gates, and an apply must never walk around them.
 */
export function rollbackRelease(liveFontDir: string, releaseDir: string): void {
  const path = join(liveFontDir, 'web', releaseDir);
  rmSync(path, { recursive: true, force: true });
}
