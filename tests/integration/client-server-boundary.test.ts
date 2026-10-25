import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  collectMemberAccesses,
  collectNonComponentExports,
  isFunctionValue,
  looksLikeComponentName,
  parseImportedNames,
  parseNamedBindings,
  parseNamespaceImports,
} from './client-server-boundary-helpers';

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
 * - a runtime crash is not simulated — the tree assertion is static;
 * - the **classification bias** — a `PascalCase` const in a client module whose
 *   initializer is not one of the recognised function forms (`export const Foo =
 *   styled(Foo)`, a class expression) is classified as **data**, so a server
 *   file importing it would be a false positive. No client module in this repo
 *   has a `PascalCase` const export and the convention is `SCREAMING_CASE` for
 *   data, but the bias is stated so the next reader knows it;
 * - an **intermediate re-export** — a server-side module (not a client module)
 *   that re-exports a client module's data (`export { speak } from '@/lib/tts'`)
 *   and is then imported by a page is not seen; the guard only resolves the
 *   module a server file imports **directly**.
 */
const REPO_ROOT = findRepoRoot();

/** The source trees that may hold a client module. */
const SCAN_ROOTS = ['app', 'components', 'lib'] as const;

/** The file extensions that can hold a client module. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** The file names that make an `app/**` file a server file. */
const SERVER_FILE_NAMES = ['page.tsx', 'layout.tsx', 'route.ts'] as const;

export interface ClientModule {
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

/** The violations a server file commits through named imports. */
export function collectNamedImportViolations(
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
export function collectNamespaceViolations(
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

/**
 * The namespace path of the guard.
 *
 * The namespace member scan reads the source **text**, so it must not read a
 * property of an unrelated object, a comment, or a string literal as a member
 * access of the alias — those are legal code, and a guard that flags legal code
 * gets deleted.
 *
 * The cases run against a synthetic client module: the collectors take the
 * server file and the client modules as parameters, so no fixture tree is
 * needed.
 */
const NAMESPACE_IMPORT_LINE = "import * as sidebar from '@/components/dictionary/RadicalSidebar';";

/** A client module with one non-component export, `RADICALS`. */
const RADICALS_MODULE: ClientModule = {
  relativePath: 'components/dictionary/RadicalSidebar.tsx',
  absolutePath: path.join(REPO_ROOT, 'components/dictionary/RadicalSidebar.tsx'),
  nonComponentExports: ['RADICALS'],
};

/** The synthetic server file the cases are driven against. */
const PROBE_SERVER_FILE = path.join(REPO_ROOT, 'app/boundary-probe/page.tsx');

type NamespaceCase = readonly [
  note: string,
  body: readonly string[],
  expectedImportedNames: readonly string[],
];

const NAMESPACE_CASES: readonly NamespaceCase[] = [
  [
    'N1 a real member access is a violation',
    ['const n = sidebar.RADICALS.length;'],
    ['sidebar.RADICALS'],
  ],
  [
    'N2 a property chain of an unrelated object is not',
    ['const payload = { sidebar: { RADICALS: 1 } };', 'payload.sidebar.RADICALS;'],
    [],
  ],
  [
    'N3 a comment that mentions the member is not',
    ['// sidebar.RADICALS is the radical table'],
    [],
  ],
  ['N4 a string that contains the member is not', ["const label = 'sidebar.RADICALS';"], []],
  ['N5 a namespace used only for a component is clean', ['String(sidebar.RadicalSidebar)'], []],
  [
    'N6 the real access is still caught next to the property chain',
    [
      'const n = sidebar.RADICALS.length;',
      'const payload = { sidebar: { RADICALS: 1 } };',
      'payload.sidebar.RADICALS;',
    ],
    ['sidebar.RADICALS'],
  ],
];

describe('client/server boundary — namespace path', () => {
  it.each(NAMESPACE_CASES)('%s', (_note, body, expectedImportedNames) => {
    const source = [NAMESPACE_IMPORT_LINE, ...body].join('\n');
    const violations = collectNamespaceViolations(PROBE_SERVER_FILE, source, [RADICALS_MODULE]);

    expect(violations.map((violation) => violation.importedName)).toEqual(expectedImportedNames);
    for (const violation of violations) {
      expect(violation.kind).toBe('namespace-member');
      expect(violation.clientModule).toBe(RADICALS_MODULE.relativePath);
      expect(violation.serverFile).toBe('app/boundary-probe/page.tsx');
    }
  });

  it('M1 a named import of a client module data export is a violation', () => {
    const source = "import { RADICALS } from '@/components/dictionary/RadicalSidebar';";
    const violations = collectNamedImportViolations(PROBE_SERVER_FILE, source, [RADICALS_MODULE]);

    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('named-import');
    expect(violations[0].importedName).toBe('RADICALS');
    expect(violations[0].clientModule).toBe(RADICALS_MODULE.relativePath);
    expect(violations[0].serverFile).toBe('app/boundary-probe/page.tsx');
  });
});
