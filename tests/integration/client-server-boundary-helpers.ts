/**
 * The pure text-analysis helpers of the client/server boundary guard.
 *
 * They live in this sibling module rather than in the test file because the
 * guard needs a lot of them and the test file has a size budget. Nothing here
 * touches the filesystem: every function takes a source string and returns a
 * result, so the whole detector can be driven by synthetic input.
 */

/**
 * A named import list, possibly spanning several lines.
 *
 * The statement is anchored to the start of a line: an `import` written inside a
 * string literal is preceded by the string's opening quote, not by the line
 * start, so it is not an import. The `m` flag is load-bearing — without it `^`
 * means "start of the string" and only the first import of a file would match.
 */
const NAMED_IMPORT_RE =
  /^\s*import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;

/**
 * A named re-export (`export { A } from '…'`) behaves like an import.
 *
 * Anchored to the start of a line, for the same reason as the import pattern.
 */
const NAMED_REEXPORT_RE = /^\s*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;

/**
 * `export const NAME = …` and `export const NAME: Type = …`.
 *
 * The type annotation has to be part of the match: `export const X: T = …` puts a
 * `:` between the name and the `=`, and a pattern that stops at the name silently
 * skips the whole export — a data export the guard would then never see.
 *
 * Capturing the initializer in the match removes the `line.indexOf('=')` slicing
 * bug, which could pick the wrong `=` in a line that holds more than one.
 *
 * Known corner: the type group `[^=]+` stops at the **first** `=`, so a type
 * annotation that contains one (`Foo<A = B>`) is mis-captured — the initializer
 * then reads `B> = …` and the export is classified as data. There is no
 * type-annotated `export const` declaration in any client module today.
 */
const CONST_EXPORT_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(.*)$/;

/** `export function NAME(…)` / `export async function NAME(…)` */
const FUNCTION_EXPORT_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;

/** `export let NAME` / `export var NAME` */
const VARIABLE_EXPORT_RE = /^export\s+(?:let|var)\s+([A-Za-z_$][\w$]*)/;

/**
 * A namespace import: `import * as NAME from '…'`.
 *
 * Anchored to the start of a line, for the same reason as the import pattern.
 */
const NAMESPACE_IMPORT_RE = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gm;

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

/**
 * Remove comments from a source file, keeping the string literals.
 *
 * The import parsers need the specifier, and a specifier is a string literal —
 * so this strips comments only. `stripCommentsAndStrings` cannot be used here:
 * it would take the module path with it.
 *
 * A multi-line block comment is the reason the parsers need this at all: such a
 * comment can put an `import` line at the start of a line, and a line-start
 * anchor alone would not see it as a comment.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Remove comments and string literals from a source file.
 *
 * The namespace member scan looks for `alias.member` in the source text. A comment
 * that mentions the member, or a string that contains it, is not an access — and
 * reporting one would flag legal code.
 *
 * The order is comments first, then strings. Neither can *add* text, so the only
 * error this can make is a missed access, never a false positive.
 */
export function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
}

/**
 * The members a namespace alias is used with, e.g. `voices.TTS_VOICES`.
 *
 * The alias must be a **standalone identifier**. `\b` is a word boundary, not an
 * identifier boundary, so a plain `\b` also matches a property of an unrelated
 * object (`payload.sidebar.RADICALS`) — the `.` before the alias is a word
 * boundary too. The lookbehind rejects that, and an identifier character before
 * the alias rejects `subSidebar.RADICALS`.
 *
 * The source is stripped of comments and string literals first: a comment that
 * mentions the member, or a string that contains it, is not an access, and
 * reporting one would flag legal code.
 */
export function collectMemberAccesses(source: string, alias: string): string[] {
  const members = new Set<string>();
  const pattern = new RegExp(`(?<![.\\w$])${alias}\\.([A-Za-z_$][\\w$]*)`, 'g');
  const code = stripCommentsAndStrings(source);
  let match = pattern.exec(code);
  while (match !== null) {
    members.add(match[1]);
    match = pattern.exec(code);
  }
  return [...members];
}

/** The names a `{ … }` clause imports, with inline `type` markers removed. */
export function parseImportedNames(clause: string): string[] {
  return clause
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => !entry.startsWith('type '))
    .map((entry) => entry.replace(/\s+as\s+.*$/, '').trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Every named import and named re-export of a source file.
 *
 * The source is stripped of comments first: a commented-out import is not an
 * import, and reporting one would flag legal code.
 */
export function parseNamedBindings(source: string): Array<{ clause: string; specifier: string }> {
  const bindings: Array<{ clause: string; specifier: string }> = [];
  const code = stripComments(source);
  for (const pattern of [NAMED_IMPORT_RE, NAMED_REEXPORT_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(code);
    while (match !== null) {
      bindings.push({ clause: match[1], specifier: match[2] });
      match = pattern.exec(code);
    }
  }
  return bindings;
}

/**
 * Every namespace import of a source file.
 *
 * The source is stripped of comments first, for the same reason as the named
 * imports: a commented-out namespace import is not an import.
 */
export function parseNamespaceImports(source: string): Array<{ alias: string; specifier: string }> {
  const namespaces: Array<{ alias: string; specifier: string }> = [];
  const code = stripComments(source);
  NAMESPACE_IMPORT_RE.lastIndex = 0;
  let match = NAMESPACE_IMPORT_RE.exec(code);
  while (match !== null) {
    namespaces.push({ alias: match[1], specifier: match[2] });
    match = NAMESPACE_IMPORT_RE.exec(code);
  }
  return namespaces;
}
