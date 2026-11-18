/**
 * Module resolution — finding an entry point on the disk.
 *
 * ## WHAT THIS IS
 *
 * The admin font pipeline needs to know three things before it can build:
 *
 *   - where the FONT ROOT is (`resolveFontDir`);
 *   - where an installed PACKAGE's entry point is (`resolveModuleEntry`)
 *     — the toolchain row answers "is subset-font installed?" by looking
 *     for the file, not by asking a resolver;
 *   - the exact ARGV a command is started with (`resolveArgv`) — on
 *     Windows the `tsx` shim is a `.cmd` file that node cannot execute
 *     without a shell, so the package's own entry point is run with node
 *     instead.
 *
 * All three are "look at the disk and answer" functions, and all three
 * are used by the capability probe. They live here, apart from the
 * probes, because they are a DIFFERENT kind of thing: the probes talk to
 * the outside world (a subprocess, an HTTP HEAD, a file write), and these
 * only read the filesystem.
 *
 * ## WHY NOT `createRequire`
 *
 * Next.js bundles this module for the server, and webpack replaces
 * `createRequire` with a shim that cannot parse its argument — the build
 * says so ("module.createRequire failed parsing argument"). In the
 * production bundle the require that shim hands back is broken,
 * `resolve()` throws, the throw is caught, and the toolchain row reports
 * three packages that ARE installed as "not installed". That is a false
 * negative that sends the administrator to install what is already there,
 * so the answer is read from the disk instead: the package's own
 * `package.json` says where its entry is, and the disk says whether that
 * file is there. The same code runs in the dev server and in the bundle.
 *
 * ## THE RULES
 *
 *   - a package that is not installed — or one whose entry cannot be
 *     found — is `null`, never an exception;
 *   - `exports` takes precedence over `main` — that is node's rule;
 *   - the manifest's own key order decides which condition wins, and
 *     only the conditions that are active for a CommonJS require are
 *     taken.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * A package's manifest, as far as this module needs it.
 */
interface PackageManifest {
  main?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
}

/**
 * The conditions that are active for a CommonJS `require`.
 *
 * The order of this list does not decide anything: the manifest's own
 * key order decides which condition wins, and this list only says
 * which conditions are active at all — the same rule node uses.
 */
const ACTIVE_CONDITIONS = ['node', 'require', 'node-addons', 'default'];

/**
 * The directory that holds the application's `package.json`.
 *
 * This is the same directory `scripts/fonts/*.mjs` compute as
 * `resolve(__dirname, '..', '..')`, derived in a way that survives
 * bundling: the scripts run from the source tree, this module runs from
 * a Next.js bundle, so the root is found by walking up to the nearest
 * directory that has a `package.json`. The working directory is the
 * starting point — `next start` reads `.next/` from it, so it is the
 * application root in any deployment that works at all.
 *
 * It is NOT cached: the working directory can change under a process,
 * and a cached root would keep probing paths that belong to another
 * tree. Every path this module reports is the path it really probed.
 */
export function appRoot(): string {
  return findAppRoot(process.cwd());
}

function findAppRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/**
 * The font root: where the stylesheets, the manifest and the subsets live.
 *
 * The SAME semantics as the subsetter's own `resolveFontDir()`
 * (`scripts/fonts/build-webfont-subsets.mjs:114`): `WEBFONT_FONT_DIR`
 * overrides it, a RELATIVE path is resolved against the application root
 * and not against the working directory, and the default is
 * `<root>/public/font`.
 *
 * ⚠️ ONE environment variable names ONE thing: there is no second
 * variable for the output directory. Two names for one root are two roots
 * that drift apart, and the drift is found when a candidate is applied.
 */
export function resolveFontDir(
  root: string = appRoot(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.WEBFONT_FONT_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(root, override.trim());
  }
  return join(root, 'public', 'font');
}

/**
 * Reads a package's manifest from the disk.
 *
 * `null` when there is no manifest, or when it is not readable JSON: a
 * package that cannot be read is a package that cannot be used.
 */
function readPackageManifest(packageDir: string): PackageManifest | null {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * The `node_modules` directories node would look in, from the root up.
 */
function nodeModulesDirs(root: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(root);
  for (;;) {
    dirs.push(join(dir, 'node_modules'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** A package request: the package itself, and the subpath inside it. */
interface PackageRequest {
  name: string;
  subpath: string;
}

/**
 * Splits a specifier into a package and a subpath.
 *
 * `null` for anything that is not a package name: a relative path and
 * an absolute path are not packages, and neither is an empty string.
 */
function parsePackageRequest(specifier: string): PackageRequest | null {
  if (specifier === '' || specifier.startsWith('.') || isAbsolute(specifier)) return null;
  const segments = specifier.split('/');
  let name: string;
  if (specifier.startsWith('@')) {
    // A scoped package: '@scope/name', and whatever follows is the
    // subpath.
    if (segments.length < 2 || segments[0] === '' || segments[1] === '') return null;
    name = `${segments[0]}/${segments[1]}`;
  } else {
    if (segments[0] === '') return null;
    name = segments[0];
  }
  const rest = specifier.slice(name.length);
  return { name, subpath: rest === '' ? '.' : `.${rest}` };
}

/**
 * The relative paths an `exports` field points at, in the order node
 * would try them.
 *
 * `exports` is one of three things: a path, a list of paths (node takes
 * the first one that exists), or an object. An object is either a
 * subpath map (its keys start with ".") or a map of conditions
 * ("require", "import", "default", …).
 */
function exportCandidates(exportsField: unknown, subpath: string): string[] {
  if (typeof exportsField === 'string') return [exportsField];
  if (Array.isArray(exportsField)) {
    return exportsField.flatMap((item) => exportCandidates(item, subpath));
  }
  if (typeof exportsField !== 'object' || exportsField === null) return [];

  const record = exportsField as Record<string, unknown>;
  const keys = Object.keys(record);

  // A subpath map: the keys start with ".".
  if (keys.every((key) => key.startsWith('.'))) {
    if (Object.prototype.hasOwnProperty.call(record, subpath)) {
      return exportCandidates(record[subpath], subpath);
    }
    return patternCandidates(record, subpath);
  }

  // A map of conditions. The manifest's own key order decides which
  // condition wins — the same rule node uses — and only the conditions
  // that are active for a CommonJS require are taken.
  for (const key of keys) {
    if (!ACTIVE_CONDITIONS.includes(key)) continue;
    const candidates = exportCandidates(record[key], subpath);
    if (candidates.length > 0) return candidates;
  }
  // The package IS installed even when it cannot be required, so a
  // package that only exports "import" still counts as installed.
  if (Object.prototype.hasOwnProperty.call(record, 'import')) {
    return exportCandidates(record['import'], subpath);
  }
  return [];
}

/**
 * The `*` patterns of an exports map.
 *
 * The most specific base wins — node sorts the patterns by the length of
 * their base — and the part the `*` matched is put back into the
 * target.
 */
function patternCandidates(record: Record<string, unknown>, subpath: string): string[] {
  const patternKeys = Object.keys(record)
    .filter((key) => key.includes('*'))
    .sort((left, right) => right.split('*')[0].length - left.split('*')[0].length);

  for (const key of patternKeys) {
    const star = key.indexOf('*');
    const base = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(base) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < base.length + suffix.length) continue;
    const matched = subpath.slice(base.length, subpath.length - suffix.length);
    return exportCandidates(record[key], subpath).map((candidate) =>
      candidate.split('*').join(matched),
    );
  }
  return [];
}

/**
 * The first candidate that is really on the disk.
 *
 * A `main` (and a `bin`) is often written without an extension
 * (`./lib/index`), so the ways node would resolve it are tried — and
 * which one it is, is decided by the disk and not by a guess.
 */
function firstExistingFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    join(base, 'index.js'),
    join(base, 'index.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The entry of an installed package, from its own manifest.
 */
function resolveFromManifest(
  packageDir: string,
  manifest: PackageManifest,
  subpath: string,
): string | null {
  // `exports` takes precedence over `main` — that is node's rule.
  if (manifest.exports !== undefined && manifest.exports !== null) {
    for (const candidate of exportCandidates(manifest.exports, subpath)) {
      const absolute = resolve(packageDir, candidate);
      if (existsSync(absolute)) return absolute;
    }
    return null;
  }
  if (subpath !== '.') {
    // Without an exports map, a subpath is a file inside the package.
    const direct = resolve(packageDir, subpath.slice(2));
    return existsSync(direct) ? direct : null;
  }
  if (typeof manifest.main === 'string' && manifest.main.trim() !== '') {
    return firstExistingFile(resolve(packageDir, manifest.main));
  }
  return firstExistingFile(join(packageDir, 'index'));
}

/**
 * Resolves a package the way node does — by reading the disk.
 *
 * ⚠️ See the note at the top of this file: `createRequire` is broken in
 * the Next.js bundle, so the answer comes from the disk.
 */
export function resolveModuleEntry(specifier: string, root: string = appRoot()): string | null {
  const request = parsePackageRequest(specifier);
  if (!request) return null;
  for (const nodeModules of nodeModulesDirs(root)) {
    const packageDir = join(nodeModules, request.name);
    const manifest = readPackageManifest(packageDir);
    if (!manifest) continue;
    // The package is here: whether its entry can be found decides the
    // answer, and node does not go looking in another node_modules
    // afterwards.
    return resolveFromManifest(packageDir, manifest, request.subpath);
  }
  return null;
}

/** A command, and the arguments it has to be started with. */
interface ExecutableTarget {
  file: string;
  args: string[];
}

/**
 * The JavaScript entry point of an installed package, from its own
 * `bin` field.
 *
 * `bin` is either a path or a map of command names to paths; both are
 * handled, and the map is asked for the command's own name first.
 *
 * npm's Windows shims do nothing else: they run this file with node. So
 * running it directly is what the shim would have done — without a
 * shell, which a `.cmd` shim would need.
 */
function resolveBinEntry(name: string, root: string): string | null {
  for (const nodeModules of nodeModulesDirs(root)) {
    const packageDir = join(nodeModules, name);
    const manifest = readPackageManifest(packageDir);
    if (!manifest) continue;
    const bin = manifest.bin;
    const relative =
      typeof bin === 'string' ? bin : bin ? (bin[name] ?? Object.values(bin)[0]) : undefined;
    if (!relative) return null;
    return firstExistingFile(resolve(packageDir, relative));
  }
  return null;
}

/**
 * Where a bare command name actually lives.
 *
 * A name that carries a path is used as it is. A bare name is looked for
 * in the application's own `node_modules/.bin` first — that is where
 * `tsx` lives, and a service manager's `PATH` usually does not reach
 * there — and only then on the `PATH`.
 *
 * On Windows the shim is a `.cmd` file, which node cannot execute
 * without a shell; the package's own entry point is run with node
 * instead, which is exactly what the shim does. When that entry point
 * cannot be resolved, the name is handed to the `PATH` — a `.cmd` file
 * that is handed to node would fail with `spawn EINVAL`, and the
 * extensionless shim (a shell script) would fail with `ENOEXEC`: both
 * are files that cannot run, and a file that cannot run must never be
 * returned as the answer.
 */
function resolveExecutable(bin: string, root: string): ExecutableTarget {
  if (bin.includes('/') || bin.includes('\\')) return { file: bin, args: [] };

  const binDir = join(root, 'node_modules', '.bin');
  if (process.platform === 'win32') {
    const shim = join(binDir, `${bin}.cmd`);
    if (existsSync(shim)) {
      const entry = resolveBinEntry(bin, root);
      if (entry) return { file: process.execPath, args: [entry] };
      // No entry point: fall through to the PATH rather than to a file
      // that cannot be executed.
    }
  } else {
    const plain = join(binDir, bin);
    // A POSIX shim is a script with a shebang: node runs it directly.
    if (existsSync(plain)) return { file: plain, args: [] };
  }

  return { file: bin, args: [] };
}

/**
 * The exact argv a command is started with.
 *
 * This is exported because it is the contract the toolchain row rests on:
 * on Windows the `tsx` shim is a `.cmd` file that node cannot execute
 * without a shell, so the package's own entry point is run with node
 * instead. A test has to be able to look at the ARGV — at the shape of
 * the command, not at "did it run".
 *
 * The argv is always an array: no shell is involved, on any platform.
 */
export function resolveArgv(bin: string, args: string[], root: string = appRoot()): string[] {
  const target = resolveExecutable(bin, root);
  return [target.file, ...target.args, ...args];
}
