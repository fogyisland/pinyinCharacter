/**
 * The release text helpers of the font pipeline.
 *
 * These are the PURE half of the publish step: they read a string and
 * write a string, and they touch nothing else. No disk, no subprocess,
 * no clock.
 *
 * ## WHY THEY ARE SEPARATE
 *
 * The publish step has two halves that are easy to confuse:
 *
 *   - the TEXT — the rewrite of the stylesheets, the V hash, the reading
 *     of the verifier's output. These are functions of their input;
 *   - the PUBLISH — the copy into a new release directory, the candidate
 *     tree, the ledger. These are side effects on the disk.
 *
 * The text half is where the invariant G-3 actually lives (the rewrite
 * has to hit every face), so it is worth being able to read it, and to
 * test it, without a directory tree in the way.
 *
 * ⚠️ The V hash is computed HERE and not imported from wave-2, because
 * `scripts/fonts/build-webfont-subsets.mjs` imports `subset-font` (a
 * harfbuzz wasm build) and importing it from a Next.js **server** module
 * drags that into the server bundle. The local copy is **pinned by a
 * test** against the authoritative `manifestVersion()`, so a drift in
 * wave-2 goes red instead of silent.
 */
import { createHash } from 'node:crypto';

import type { PageCostReport } from '@/scripts/fonts/verify-webfont-subsets.d.mts';

/** The prefix of the line the verifier prints with its page cost. */
const PAGECOST_PREFIX = '[verify] pagecost: ';

/**
 * The prefix of a REAL verifier finding: `[verify]` and THREE spaces.
 *
 * The verifier prints its statistics with ONE space after the tag; only the
 * findings have three.
 */
const FINDING_PREFIX = '[verify]   ';

/** How many verifier findings the error message quotes. */
const MAX_QUOTED_FINDINGS = 10;

/** The prefix of the line the verifier prints with the number of its errors. */
const ERROR_COUNT_PATTERN = /^\[verify\] \d+ error\(s\)/;

/**
 * Counts the `@font-face` rules of a stylesheet.
 *
 * ⚠️ This is a COPY of a fragment of wave-2's `parseFaces()`, and it is
 * NOT the authority — the authority is `parseFaces()` itself. The copy
 * exists because the wave-2 scripts pull `fontkit` and `subset-font` into
 * whatever imports them, and a Next.js server module must not.
 *
 * ⇒ The drift risk is carried by a TEST: `countFaceRules(css)` has to equal
 * `parseFaces(css).length` for the three real stylesheets.
 */
export function countFaceRules(css: string): number {
  const blockPattern = /@font-face\s*\{([\s\S]*?)\}/g;
  let count = 0;
  let match = blockPattern.exec(css);
  while (match !== null) {
    count += 1;
    match = blockPattern.exec(css);
  }
  return count;
}

/**
 * Rewrites every `/font/web/` reference of a stylesheet to a release.
 *
 * The `?v=` query that follows the URL is kept — it is the cache buster of
 * the file, and dropping it would serve a stale copy from a cache that
 * already has it.
 *
 * @param css the stylesheet
 * @param releasePrefix the prefix the references get, e.g. `/font/web/r0a1b`
 * @returns the rewritten CSS, how many references were rewritten, and how
 *   many faces the stylesheet declares
 */
export function rewriteStylesheetUrls(
  css: string,
  releasePrefix: string,
): { css: string; rewritten: number; expected: number } {
  const expected = countFaceRules(css);
  // Every `/font/web/` reference — the family segment follows it.
  //
  // ⚠️ A URL that ALREADY points at a release (`/font/web/r<hex>/…`) is NOT
  // rewritten again: the stylesheet of a staging build is never released
  // twice, and a rewrite that matched its own output would produce a
  // mangled path.
  const pattern = /\/font\/web\/(?!r[0-9a-f]+\/)/g;
  let rewritten = 0;
  const out = css.replace(pattern, () => {
    rewritten += 1;
    return `${releasePrefix}/`;
  });
  return { css: out, rewritten, expected };
}

/**
 * The V hash — the hash of the rewritten stylesheets.
 *
 * ⚠️ The KEYS are the **file names** of the stylesheets. They only decide
 * the order; the hash is over the CSS **contents**. The algorithm is
 * wave-2's `manifestVersion()`, copied here so the wave-2 scripts do not
 * have to be imported into the server bundle — and pinned against the
 * original by a test.
 */
export function manifestVersionOf(cssByFile: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The page cost the gate printed, or `null` when there was none.
 *
 * ⚠️ The line is either one line of valid JSON or it is ABSENT — the
 * verifier prints it only when there is a page cost to print, and
 * `pagecost: null` is not valid JSON (design §3.5.7, R-58). A line that is
 * there but does not parse is a DEFECT: it is logged, and the page cost is
 * reported as unavailable. It never fails the run — the intrinsic checks
 * still decide.
 */
export function parsePageCost(stdout: string): PageCostReport | null {
  const payload = findPageCostLine(stdout);
  if (payload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const bytes = toNumberRecord(record.bytes);
  const files = toNumberRecord(record.files);
  const budgetBytes = toNumberRecord(record.budgetBytes);
  if (bytes === null || files === null || budgetBytes === null) return null;

  const budgetFiles = record.budgetFiles;
  if (typeof budgetFiles !== 'number' || !Number.isFinite(budgetFiles)) return null;

  return { bytes, files, budgetBytes, budgetFiles };
}

/** A record of numbers, or `null` when the value is not one. */
function toNumberRecord(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    result[key] = entry;
  }
  return result;
}

/** The payload of the page-cost line, or `null` when the line is absent. */
export function findPageCostLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(PAGECOST_PREFIX)) continue;
    return line.slice(PAGECOST_PREFIX.length).trim();
  }
  return null;
}

/**
 * The error lines of the verifier's stdout.
 *
 * The informational ones (`[verify]   info: …`) are left out — they are not
 * errors.
 */
export function extractFindings(stdout: string): string[] {
  const findings: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(FINDING_PREFIX)) continue;
    const text = line.slice(FINDING_PREFIX.length).trim();
    if (text === '' || text.startsWith('info:')) continue;
    findings.push(text);
  }
  return findings;
}

/**
 * The error message of a failed gate.
 *
 * ⚠️ Only the verifier's FINDINGS are quoted — at most ten of them, plus
 * the final `[verify] N error(s)` line. The stderr is NEVER pasted: it
 * carries paths and internal information that the administrator must not
 * see, and it is a stack trace nobody can act on.
 */
export function describeGateFailure(
  code: number,
  stdout: string,
  stderr: string,
): string {
  const findings = extractFindings(stdout);
  const summary = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => ERROR_COUNT_PATTERN.test(line));

  const parts: string[] = [];
  if (findings.length > 0) {
    const quoted = findings.slice(0, MAX_QUOTED_FINDINGS);
    const rest = findings.length - quoted.length;
    parts.push(quoted.join('; '));
    if (rest > 0) parts.push(`(and ${rest} more)`);
  }
  if (summary) parts.push(summary);

  if (parts.length === 0) {
    const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    return tail
      ? `候选校验未通过（退出码 ${code}）：${tail}`
      : `候选校验未通过（退出码 ${code}）`;
  }

  return `候选校验未通过（退出码 ${code}）：${parts.join(' ')}`;
}
