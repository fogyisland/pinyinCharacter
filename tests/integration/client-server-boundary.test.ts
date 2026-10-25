import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Architectural guard: **no server file may import a non-component export from
 * a `'use client'` module.**
 *
 * Why: in the App Router every export of a `'use client'` module becomes a
 * *client reference* on the server. A component export renders; a **data**
 * export does not — the server receives a proxy whose named export keys resolve
 * but whose array indices do not. Reading `TTS_MALE_VOICES[0].value` in
 * `app/admin/tts/page.tsx` therefore threw `TypeError: Cannot read properties of
 * undefined (reading 'value')` on every request.
 *
 * Detection rules:
 * - a *client module* is a file under `app/`, `components/` or `lib/` whose
 *   first line is the `'use client'` directive;
 * - a *server file* is `app/**\/page.tsx`, `app/**\/layout.tsx` or
 *   `app/**\/route.ts` without that directive;
 * - a *non-component export* is a top-level `export const`, or a top-level
 *   `export function` / `export let` / `export var` whose name is not a
 *   component name — a component name is `PascalCase`; a `SCREAMING_CASE`
 *   constant, a camelCase helper and a snake_case helper are all data;
 * - a *named import* of such a name is a violation;
 * - a *namespace import* (`import * as voices from '…'`) is a violation only
 *   when the server file reads a member that is a non-component export — the
 *   alias's member accesses are intersected with the module's non-component
 *   exports.
 *
 * What this guard does **not** cover — it is a structural check over a
 * named-import subset, **not** a proof that no server file can ever touch a
 * client module's data:
 * - `export default` of plain data in a client module, default-imported by a
 *   server file;
 * - a **default import** of a client module (`import X from '…'`) in general;
 * - `export { X } from '…'` is handled, but `export * from '…'` (a wildcard
 *   re-export) is not;
 * - server files other than `app/**\/page.tsx`, `app/**\/layout.tsx` and
 *   `app/**\/route.ts` (a `loading.tsx`, or a server component that is not a
 *   page) are not scanned;
 * - a runtime crash is not simulated — the tree assertion is static.
 */
const REPO_ROOT = findRepoRoot();

/** The source trees that may hold a client module. */
const SCAN_ROOTS = ['app', 'components', 'lib'] as const;

/** The file extensions that can hold a client module. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** The file names that make an `app/**` file a server file. */
const SERVER_FILE_NAMES = ['page.tsx', 'layout.tsx', 'route.ts'] as const;

/** A named import list, possibly spanning several lines. */
const NAMED_IMPORT_RE =
  /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** A named re-export (`export { A } from '…'`) behaves like an import. */
const NAMED_REEXPORT_RE = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * `export const NAME = …` and `export const NAME: Type = …`.
 *
 * The type annotation has to be part of the match: `export const X: T = …` puts a
 * `:` between the name and the `=`, and a pattern that stops at the name silently
 * skips the whole export — a data export the guard would then never see. The
 * initializer is captured by the pattern rather than sliced out of the line
 * afterwards, so a `=` inside the type annotation cannot shift the slice.
 */
const CONST_EXPORT_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(.*)$/;

/** `export function NAME(…)` / `export async function NAME(…)` */
const FUNCTION_EXPORT_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;

/** `export let NAME` / `export var NAME` */
const VARIABLE_EXPORT_RE = /^export\s+(?:let|var)\s+([A-Za-z_$][\w$]*)/;

/** A namespace import: `import * as NAME from '…'`. */
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;

interface ClientModule {
  /** Repo-relative path with POSIX separators — used in the failure message. */
  readonly relativePath: string;
  /** Absolute path — used to resolve relative import specifiers. */
  readonly absolutePath: string;
  /** The non-component export names of the module. */
  readonly nonComponentExports: readonly string[];
}

interface Violation {
  readonly serverFile: string;
  readonly clientModule: string;
  readonly importedName: string;
  readonly kind: 'named-import' | 'namespace-member';
}

function isDirectory(target: string): boolean {
  if (!existsSync(target)) return false;
  return statSync(target).isDirectory();
}

/**
 * Locate the repository root by walking up from the working directory until a
 * folder holding both `app/` and `components/` is found.
 */
function findRepoRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 12; depth += 1) {
    const hasApp = isDirectory(path.join(current, 'app'));
    const hasComponents = isDirectory(path.join(current, 'components'));
    if (hasApp && hasComponents) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    'Could not locate the repository root: no folder with both app/ and components/ above the working directory.',
  );
}

/** Recursively collect the files of a directory that carry a source extension. */
function collectSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(fullPath);
    }
  }
  return found;
}

/** Repo-relative path with POSIX separators. */
function toRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

/** The first line of a source file, without its line terminator. */
function firstLineOf(source: string): string {
  return source.split(/\r?\n/, 1)[0] ?? '';
}

/** True when the file carries the `'use client'` directive on its first line. */
function isClientModule(source: string): boolean {
  const directive = firstLineOf(source).trim().replace(/;$/, '').trim();
  return directive === "'use client'" || directive === '"use client"';
}

/**
 * A `PascalCase` name is a component. Anything else is data or a helper: a
 * `SCREAMING_CASE` constant (`RADICALS`), a camelCase helper (`useSubmit`) and a
 * snake_case helper (`use_app_store`) are all non-components.
 */
export function looksLikeComponentName(name: string): boolean {
  if (!/^[A-Z]/.test(name)) return false;
  return /[a-z]/.test(name);
}

/**
 * True when the initializer is a function value.
 *
 * `memo(`, `forwardRef(` and their `React.`-prefixed forms count: a `PascalCase`
 * const initialised with `memo(…)` is a component, and calling it data would make
 * the guard report a legal import as a violation. An empty initializer means the
 * value is on the next line — the shape is unknown, so treat it as a function
 * value: that is the safe direction, a `PascalCase` name then stays a component
 * (no false positive) while a lowercase name is still data.
 */
export function isFunctionValue(initializer: string): boolean {
  if (initializer === '') return true;
  return (
    initializer.startsWith('(') ||
    initializer.startsWith('async') ||
    initializer.startsWith('function') ||
    initializer.startsWith('memo(') ||
    initializer.startsWith('forwardRef(') ||
    initializer.startsWith('React.memo(') ||
    initializer.startsWith('React.forwardRef(')
  );
}

/**
 * Collect the export names of a client module that are **not** renderable
 * components. `export const NAME` is data — unless it is initialised with a
 * function value *and* uses a component name, in which case it is a component
 * and therefore a legal client reference.
 */
export function collectNonComponentExports(source: string): string[] {
  const names: string[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    const constMatch = CONST_EXPORT_RE.exec(line);
    if (constMatch) {
      const name = constMatch[1];
      const initializer = constMatch[2].trim();
      if (!(isFunctionValue(initializer) && looksLikeComponentName(name))) {
        names.push(name);
      }
      continue;
    }

    const functionMatch = FUNCTION_EXPORT_RE.exec(line);
    if (functionMatch) {
      const name = functionMatch[1];
      if (!looksLikeComponentName(name)) names.push(name);
      continue;
    }

    const variableMatch = VARIABLE_EXPORT_RE.exec(line);
    if (variableMatch) {
      const name = variableMatch[1];
      if (!looksLikeComponentName(name)) names.push(name);
    }
  }

  return names;
}

/** Every client module under `app/`, `components/` and `lib/`. */
function collectClientModules(): ClientModule[] {
  const modules: ClientModule[] = [];

  for (const root of SCAN_ROOTS) {
    const rootPath = path.join(REPO_ROOT, root);
    if (!isDirectory(rootPath)) continue;
    for (const absolutePath of collectSourceFiles(rootPath)) {
      const source = readFileSync(absolutePath, 'utf-8');
      if (!isClientModule(source)) continue;
      modules.push({
        relativePath: toRelative(absolutePath),
        absolutePath,
        nonComponentExports: collectNonComponentExports(source),
      });
    }
  }

  return modules;
}

/** Every `app/**` page, layout or route that does not carry `'use client'`. */
function collectServerFiles(): string[] {
  const appRoot = path.join(REPO_ROOT, 'app');
  if (!isDirectory(appRoot)) return [];

  return collectSourceFiles(appRoot).filter((absolutePath) => {
    const isServerFile = SERVER_FILE_NAMES.some((name) =>
      absolutePath.endsWith(`${path.sep}${name}`),
    );
    if (!isServerFile) return false;
    return !isClientModule(readFileSync(absolutePath, 'utf-8'));
  });
}

/** Resolve an import specifier to an absolute path, or `null` for a package. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('@/')) {
    return path.join(REPO_ROOT, specifier.slice(2));
  }
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  return null;
}

/** The candidate file names a specifier may resolve to. */
function candidatePaths(absoluteBase: string): string[] {
  return [
    absoluteBase,
    `${absoluteBase}.tsx`,
    `${absoluteBase}.ts`,
    path.join(absoluteBase, 'index.tsx'),
    path.join(absoluteBase, 'index.ts'),
  ];
}

/** The client module a specifier points at, or `null`. */
function findClientModule(
  specifier: string,
  fromFile: string,
  clientModules: readonly ClientModule[],
): ClientModule | null {
  const resolved = resolveSpecifier(specifier, fromFile);
  if (resolved === null) return null;
  const found = clientModules.find((candidate) =>
    candidatePaths(resolved).includes(candidate.absolutePath),
  );
  return found ?? null;
}

/** The names a `{ … }` clause imports, with inline `type` markers removed. */
function parseImportedNames(clause: string): string[] {
  return clause
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => !entry.startsWith('type '))
    .map((entry) => entry.replace(/\s+as\s+.*$/, '').trim())
    .filter((entry) => entry.length > 0);
}

/** Every named import and named re-export of a source file. */
function parseNamedBindings(source: string): Array<{ clause: string; specifier: string }> {
  const bindings: Array<{ clause: string; specifier: string }> = [];
  for (const pattern of [NAMED_IMPORT_RE, NAMED_REEXPORT_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      bindings.push({ clause: match[1], specifier: match[2] });
      match = pattern.exec(source);
    }
  }
  return bindings;
}

/** Every namespace import of a source file. */
function parseNamespaceImports(source: string): Array<{ alias: string; specifier: string }> {
  const namespaces: Array<{ alias: string; specifier: string }> = [];
  NAMESPACE_IMPORT_RE.lastIndex = 0;
  let match = NAMESPACE_IMPORT_RE.exec(source);
  while (match !== null) {
    namespaces.push({ alias: match[1], specifier: match[2] });
    match = NAMESPACE_IMPORT_RE.exec(source);
  }
  return namespaces;
}

/** The members a namespace alias is used with, e.g. `voices.TTS_VOICES`. */
function collectMemberAccesses(source: string, alias: string): string[] {
  const members = new Set<string>();
  const pattern = new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g');
  let match = pattern.exec(source);
  while (match !== null) {
    members.add(match[1]);
    match = pattern.exec(source);
  }
  return [...members];
}

/** The violations a server file commits through named imports. */
function collectNamedImportViolations(
  serverFile: string,
  source: string,
  clientModules: readonly ClientModule[],
): Violation[] {
  const violations: Violation[] = [];

  for (const { clause, specifier } of parseNamedBindings(source)) {
    const clientModule = findClientModule(specifier, serverFile, clientModules);
    if (clientModule === null) continue;

    for (const name of parseImportedNames(clause)) {
      if (!clientModule.nonComponentExports.includes(name)) continue;
      violations.push({
        serverFile: toRelative(serverFile),
        clientModule: clientModule.relativePath,
        importedName: name,
        kind: 'named-import',
      });
    }
  }

  return violations;
}

/** The violations a server file commits through namespace imports. */
function collectNamespaceViolations(
  serverFile: string,
  source: string,
  clientModules: readonly ClientModule[],
): Violation[] {
  const violations: Violation[] = [];

  for (const { alias, specifier } of parseNamespaceImports(source)) {
    const clientModule = findClientModule(specifier, serverFile, clientModules);
    if (clientModule === null) continue;

    for (const member of collectMemberAccesses(source, alias)) {
      if (!clientModule.nonComponentExports.includes(member)) continue;
      violations.push({
        serverFile: toRelative(serverFile),
        clientModule: clientModule.relativePath,
        importedName: `${alias}.${member}`,
        kind: 'namespace-member',
      });
    }
  }

  return violations;
}

/**
 * Every violation of the rule: a server file importing a non-component export
 * of a `'use client'` module.
 */
function collectViolations(): Violation[] {
  const clientModules = collectClientModules();
  const violations: Violation[] = [];

  for (const serverFile of collectServerFiles()) {
    const source = readFileSync(serverFile, 'utf-8');
    violations.push(...collectNamedImportViolations(serverFile, source, clientModules));
    violations.push(...collectNamespaceViolations(serverFile, source, clientModules));
  }

  return violations;
}

describe('client/server boundary — tree', () => {
  it('finds no server file importing a non-component export from a use-client module', () => {
    const violations = collectViolations();
    const named = violations.filter((violation) => violation.kind === 'named-import');
    const namespaced = violations.filter((violation) => violation.kind === 'namespace-member');

    if (named.length > 0) {
      const details = named
        .map(
          (violation) =>
            `${violation.serverFile} imports { ${violation.importedName} } from '${violation.clientModule}'`,
        )
        .join('\n');
      throw new Error(
        `A server component must not import a non-component export from a 'use client' module ` +
          `— the server only receives a client reference proxy for it. Offenders:\n${details}`,
      );
    }

    if (namespaced.length > 0) {
      const details = namespaced
        .map(
          (violation) =>
            `${violation.serverFile} reads ${violation.importedName} from '${violation.clientModule}'`,
        )
        .join('\n');
      throw new Error(
        `A server component must not read a non-component export of a 'use client' module through ` +
          `a namespace import — the server only receives a client reference proxy for it. Offenders:\n${details}`,
      );
    }

    expect(violations).toEqual([]);
  });
});

/**
 * The detection cases of the guard.
 *
 * The tree assertion alone cannot tell a right rule from a wrong one — it
 * passes either way. These cases are what make the detector itself verifiable.
 */
type DetectionCase = readonly [note: string, source: string, expected: readonly string[]];

const DETECTION_CASES: readonly DetectionCase[] = [
  ['a typed data export', 'export const VOICES: VoiceOption[] = [];', ['VOICES']],
  ['an untyped data export', 'export const PLAIN = 1;', ['PLAIN']],
  ['a PascalCase arrow const is a component', 'export const Foo = () => null;', []],
  ['a memo()-wrapped PascalCase const is a component', 'export const Foo = memo(() => null);', []],
  ['a typed PascalCase const is a component', 'export const Foo: React.FC = () => null;', []],
  ['a lowercase arrow const is a helper', 'export const helper = () => 1;', ['helper']],
  ['a lowercase function export is a helper', 'export function helper() { return 1; }', ['helper']],
  ['a PascalCase function export is a component', 'export function Helper() { return null; }', []],
  ['a SCREAMING_CASE const on the next line is data', 'export const FOO =', ['FOO']],
];

describe('client/server boundary — detector', () => {
  it.each(DETECTION_CASES)('classifies %s', (_note, source, expected) => {
    expect(collectNonComponentExports(source)).toEqual(expected);
  });

  it('treats an empty initializer as a function value', () => {
    expect(isFunctionValue('')).toBe(true);
  });

  it('treats memo() and forwardRef() as function values', () => {
    expect(isFunctionValue('memo(() => null)')).toBe(true);
    expect(isFunctionValue('forwardRef(() => null)')).toBe(true);
    expect(isFunctionValue('React.memo(() => null)')).toBe(true);
    expect(isFunctionValue('React.forwardRef(() => null)')).toBe(true);
  });

  it('does not treat a plain value as a function value', () => {
    expect(isFunctionValue('[]')).toBe(false);
    expect(isFunctionValue('1')).toBe(false);
    expect(isFunctionValue('create<AppState>()(')).toBe(false);
  });

  it('classifies names by their shape', () => {
    expect(looksLikeComponentName('Foo')).toBe(true);
    expect(looksLikeComponentName('FOO')).toBe(false);
    expect(looksLikeComponentName('helper')).toBe(false);
    expect(looksLikeComponentName('use_app_store')).toBe(false);
  });
});
