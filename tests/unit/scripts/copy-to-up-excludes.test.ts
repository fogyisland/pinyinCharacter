import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The exclusion rules of the deploy packager (`scripts/copy-to-up.py`).
 *
 * This is the gate for what the production server receives, and it had a
 * real bug: the rules were matched by BARE DIRECTORY NAME, so the rule
 * `coverage` excluded every directory called `coverage` at any depth —
 * including `app/api/admin/chars/coverage/`, which holds a production API
 * route (the admin's per-character coverage statistics). That route was
 * never shipped, and nothing noticed, because nothing asserted that the
 * routes in the source tree are present in the bundle.
 *
 * The rules are now matched as PATHS relative to the repository root: the
 * root-level `coverage/` is still excluded, a nested `app/.../coverage/`
 * is not.
 *
 * The packager itself is not run here — it copies 25 000 files and takes
 * minutes. The rules are evaluated BY PYTHON, out of the script's own
 * source, so this test cannot drift away from what the packager does.
 */

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'copy-to-up.py');
const PYTHON = process.env.PYTHON ?? 'python';

/** The Python driver that evaluates the packager's own rules. */
const DRIVER = `
import io, json, os, sys

source = io.open(sys.argv[1], encoding="utf-8").read()
start = source.index("EXCLUDE_DIRS = {")
end = source.index("def should_gzip")
block = source[start:end]

namespace = {"os": os}
exec(block, namespace)

cases = json.loads(sys.argv[2])
out = []
for case in cases:
    kind = case[0]
    if kind == "dir":
        out.append(bool(namespace["should_exclude_dir"](case[1], case[2])))
    elif kind == "path":
        out.append(bool(namespace["should_exclude_path"](case[2])))
    else:
        out.append(bool(namespace["should_exclude_file"](case[1], case[2])))
print(json.dumps(out))
`;

type RuleKind = 'dir' | 'path' | 'file';

/** Ask the packager's rules for every verdict at once, in order. */
function verdict(entries: Array<[RuleKind, string, string]>): boolean[] {
  const stdout = execFileSync(PYTHON, ['-c', DRIVER, SCRIPT, JSON.stringify(entries)], {
    encoding: 'utf-8',
    cwd: REPO,
  });
  return JSON.parse(stdout) as boolean[];
}

/** Every directory in the source tree, relative to the given root. */
function listDirectories(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.next' || entry === 'Up') {
      continue;
    }
    const full = path.join(root, entry);
    if (!statSync(full).isDirectory()) continue;
    const rel = prefix ? `${prefix}/${entry}` : entry;
    found.push(rel);
    found.push(...listDirectories(full, rel));
  }
  return found;
}

const dirs = (rels: string[]) => verdict(rels.map((rel) => ['dir', path.basename(rel), rel] as [RuleKind, string, string]));
const paths = (rels: string[]) => verdict(rels.map((rel) => ['path', '', rel] as [RuleKind, string, string]));
const files = (names: string[]) => verdict(names.map((name) => ['file', name, name] as [RuleKind, string, string]));

describe('the deploy packager exclusion rules', () => {
  it('excludes the root-level folders that must never ship', () => {
    const rels = ['node_modules', '.next', '.git', 'docs', 'tests', 'coverage', 'Up'];
    expect(dirs(rels)).toEqual(rels.map(() => true));
  });

  it('excludes the tool-output folders wherever they appear', () => {
    // These are never source, at any depth.
    expect(dirs(['app/node_modules', 'app/.next', 'lib/node_modules'])).toEqual([true, true, true]);
  });

  it('does NOT exclude a source directory that merely shares a name', () => {
    // ⚠️ The regression. `app/api/admin/chars/coverage/route.ts` is a
    // production API route — the admin's per-character coverage
    // statistics. Excluding it by name meant it never shipped.
    expect(
      verdict([
        ['dir', 'coverage', 'app/api/admin/chars/coverage'],
        ['dir', 'chars', 'app/api/admin/chars'],
        ['dir', 'api', 'app/api'],
      ]),
    ).toEqual([false, false, false]);
  });

  it('excludes nothing that the source tree needs under app/', () => {
    // Every directory under app/ must be shippable — app/ is the
    // application itself.
    const rels = listDirectories(path.join(REPO, 'app'));
    const results = dirs(rels.map((rel) => `app/${rel}`));
    expect(rels.filter((_, i) => results[i])).toEqual([]);
  });

  it('excludes nothing that the source tree needs under lib/, components/ or scripts/', () => {
    for (const top of ['lib', 'components', 'scripts']) {
      const dir = path.join(REPO, top);
      if (!existsSync(dir)) continue;
      const rels = listDirectories(dir);
      const results = dirs(rels.map((rel) => `${top}/${rel}`));
      expect(`${top}: ${rels.filter((_, i) => results[i]).join(', ')}`).toBe(`${top}: `);
    }
  });

  it('keeps the path-based excludes working', () => {
    // These are matched by path, not by name, and they are deeper.
    expect(paths(['scripts/fonts/staging', 'assets/fonts', 'scripts/fonts', 'assets'])).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('never ships a .env or a test file', () => {
    // The first five are excluded; .env.example IS the operator's
    // template and must ship.
    expect(files(['.env', '.env.local', 'foo.test.ts', 'foo.test.tsx', 'foo.spec.ts', '.env.example'])).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});
