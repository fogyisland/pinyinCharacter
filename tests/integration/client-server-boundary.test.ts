import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Architectural guard: **no server component may import a non-component export
 * from a `'use client'` module.**
 *
 * Why this needs a test: in the App Router every export of a `'use client'`
 * module becomes a *client reference* on the server. A component export is a
 * valid client reference and renders. A **data** export is not — the server
 * receives a proxy whose named export keys resolve but whose array indices do
 * not. Reading `TTS_MALE_VOICES[0].value` in `app/admin/tts/page.tsx` therefore
 * threw `TypeError: Cannot read properties of undefined (reading 'value')` on
 * every request. This guard fails the build the moment that pattern returns.
 *
 * Detection rules:
 * - a *client module* is a file under `app/` or `components/` whose first line
 *   is the `'use client'` directive;
 * - a *server file* is `app/**\/page.tsx` or `app/**\/layout.tsx` without that
 *   directive (a server component is the default there);
 * - a *non-component export* of a client module is a top-level `export const`,
 *   or a top-level `export function` / `export let` / `export var` whose name
 *   does not start with an uppercase letter. A `PascalCase` export is a
 *   component, and a component export *is* a legal client reference.
 */
const REPO_ROOT = findRepoRoot();

/** The two source trees that hold client modules. */
const SCAN_ROOTS = ['app', 'components'] as const;

/** The file extensions that can hold a client module. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** A named import list, possibly spanning several lines. */
const NAMED_IMPORT_RE =
  /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** A named re-export (`export { A } from '…'`) behaves like an import. */
const NAMED_REEXPORT_RE = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** `export const NAME = …` */
const CONST_EXPORT_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/;

/** `export function NAME(…)` / `export async function NAME(…)` */
const FUNCTION_EXPORT_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;

/** `export let NAME` / `export var NAME` */
const VARIABLE_EXPORT_RE = /^export\s+(?:let|var)\s+([A-Za-z_$][\w$]*)/;

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
 * A `PascalCase` name is a component. Anything else (all caps, camelCase,
 * snake_case) is data or a helper.
 */
function looksLikeComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Collect the export names of a client module that are **not** renderable
 * components.
 *
 * `export const NAME` is data — unless it is initialised with an arrow function
 * or a function expression *and* uses a `PascalCase` name, in which case it is
 * a component and therefore a legal client reference.
 */
function collectNonComponentExports(source: string): string[] {
  const names: string[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    const constMatch = CONST_EXPORT_RE.exec(line);
    if (constMatch) {
      const name = constMatch[1];
      const initializer = line.slice(line.indexOf('=') + 1).trim();
      const isFunctionValue =
        initializer.startsWith('(') ||
        initializer.startsWith('async') ||
        initializer.startsWith('function');
      if (!(isFunctionValue && looksLikeComponentName(name))) {
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

/** Every client module under `app/` and `components/`. */
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

/** Every server file (`app/**\/page.tsx` and `app/**\/layout.tsx`). */
function collectServerFiles(): string[] {
  const appRoot = path.join(REPO_ROOT, 'app');
  if (!isDirectory(appRoot)) return [];

  return collectSourceFiles(appRoot).filter((absolutePath) => {
    const isPageOrLayout =
      absolutePath.endsWith(`${path.sep}page.tsx`) ||
      absolutePath.endsWith(`${path.sep}layout.tsx`);
    if (!isPageOrLayout) return false;
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

/**
 * Every violation of the rule: a server file importing a non-component export
 * of a `'use client'` module.
 */
function collectViolations(): Violation[] {
  const clientModules = collectClientModules();
  const violations: Violation[] = [];

  for (const serverFile of collectServerFiles()) {
    const source = readFileSync(serverFile, 'utf-8');
    const serverRelativePath = toRelative(serverFile);

    const matches: Array<{ clause: string; specifier: string }> = [];
    for (const pattern of [NAMED_IMPORT_RE, NAMED_REEXPORT_RE]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match !== null) {
        matches.push({ clause: match[1], specifier: match[2] });
        match = pattern.exec(source);
      }
    }

    for (const { clause, specifier } of matches) {
      const resolved = resolveSpecifier(specifier, serverFile);
      if (resolved === null) continue;

      const clientModule = clientModules.find((candidate) =>
        candidatePaths(resolved).includes(candidate.absolutePath),
      );
      if (clientModule === undefined) continue;

      for (const name of parseImportedNames(clause)) {
        if (!clientModule.nonComponentExports.includes(name)) continue;
        violations.push({
          serverFile: serverRelativePath,
          clientModule: clientModule.relativePath,
          importedName: name,
        });
      }
    }
  }

  return violations;
}

describe('client/server boundary', () => {
  it('finds no server component importing a non-component export from a use-client module', () => {
    const violations = collectViolations();

    if (violations.length > 0) {
      const details = violations
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

    expect(violations).toEqual([]);
  });
});
