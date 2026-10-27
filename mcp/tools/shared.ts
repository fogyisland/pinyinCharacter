import { McpError } from '../errors';

/**
 * The checks the tool bodies share.
 *
 * The char arguments are validated here rather than in the JSON schema on
 * purpose: the schema is generated from a zod shape, and a refinement that
 * the schema generator cannot express would either be dropped or break the
 * shape. The tool body is the last line of defence anyway — it is what
 * keeps a user-supplied string from reaching a file path.
 */

/** The CJK blocks a Han character may come from. */
function isCjkCodePoint(code: number): boolean {
  if (code >= 0x3400 && code <= 0x4dbf) return true; // extension A
  if (code >= 0x4e00 && code <= 0x9fff) return true; // unified ideographs
  if (code >= 0xf900 && code <= 0xfaff) return true; // compatibility ideographs
  if (code >= 0x20000 && code <= 0x323af) return true; // extensions B - H
  return false;
}

/**
 * Is the value exactly one Han character?
 *
 * A single code point, not a single UTF-16 unit — the extensions beyond the
 * basic plane are surrogate pairs, so `value.length === 1` would reject
 * half of them.
 */
export function isCjkChar(value: string): boolean {
  const points = Array.from(value);
  if (points.length !== 1) return false;
  return isCjkCodePoint(points[0]!.codePointAt(0)!);
}

/**
 * The char a tool was asked about, or a `bad_input` error.
 *
 * The check also keeps the char out of a file path: `data/content/<char>.json`
 * is built from the value, so anything but a Han character would be a path
 * traversal.
 */
export function requireCjkChar(value: string, argument = 'char'): string {
  if (!isCjkChar(value)) {
    throw new McpError(
      'bad_input',
      `${argument} must be exactly one Han character (a CJK ideograph) — got ${JSON.stringify(value)}`,
      { argument, value },
    );
  }
  return value;
}

/** A non-empty text argument, or a `bad_input` error. */
export function requireText(value: string, argument: string, maxLength = 5000): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new McpError('bad_input', `${argument} must not be empty`, { argument });
  }
  if (trimmed.length > maxLength) {
    throw new McpError(
      'bad_input',
      `${argument} must be at most ${maxLength} characters — got ${trimmed.length}`,
      { argument, length: trimmed.length },
    );
  }
  return trimmed;
}

/** A page number, or a `bad_input` error. */
export function requirePage(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new McpError('bad_input', `page must be an integer of at least 1 — got ${value}`, {
      page: value,
    });
  }
  return value;
}

/**
 * The slug of a classical book, or a `bad_input` error.
 *
 * A slug becomes a file path — `data/classics/<slug>.json` — so it may only
 * hold lowercase letters, digits and dashes: the same rule the site's own API
 * route uses (`classicSlugParamSchema` in lib/validators.ts). The value that
 * is echoed back is cut short, so a long string cannot inflate the answer.
 */
export function requireClassicSlug(value: string, argument = 'slug'): string {
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new McpError(
      'bad_input',
      `${argument} must be lowercase letters, digits and dashes — got ${JSON.stringify(value.slice(0, 64))}`,
      { argument, value: value.slice(0, 64) },
    );
  }
  return value;
}
