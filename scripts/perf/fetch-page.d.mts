/**
 * Type declarations for scripts/perf/fetch-page.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when a test imports the helpers, and
 * keeps `tsc --noEmit` honest about the shapes involved.
 *
 * ⚠️ The signature of `fetchPage` is the one the three perf probes share,
 * and it is FIXED: the probes must not be able to ask for a page WITHOUT
 * the self check, because a page that is not a page (the five byte redirect
 * of the initialization gate) would make every probe report green while it
 * measures nothing.
 */

import type { Agent } from 'node:http';

/**
 * The part of a response the self check looks at.
 */
export interface ResponseLike {
  status: number;
  contentType: string;
  location: string;
  bytes: number;
}

/**
 * A response as it comes off the wire, before any judgement about it.
 */
export interface RawResponse extends ResponseLike {
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** The milliseconds between the request and the first byte of the answer. */
  ttfbMs: number;
}

/**
 * The command line every probe of this wave understands.
 */
export interface CommonArgs {
  /** The origin the probe reads. */
  base: string;
  /** The cookie the probe sends; an empty string sends no cookie at all. */
  cookie: string;
  /** The arguments the probe itself has to read. */
  rest: string[];
}

/**
 * The keep alive agent of an origin — one per origin, shared by the whole
 * process, so the page and its assets travel over one connection.
 */
export declare function getAgent(target: URL): Agent;

/**
 * Read `--base` and `--cookie` out of the command line and leave the rest
 * for the probe. `--cookie ''` is legal and means "send no cookie".
 */
export declare function parseCommonArgs(argv: string[]): CommonArgs;

/**
 * One request, without any judgement about the response.
 */
export declare function fetchResource(
  url: string,
  options?: {
    cookie?: string;
    agent?: Agent;
    timeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<RawResponse>;

/**
 * One line description of a response, for the messages of the scripts.
 */
export declare function describeResponse(response: ResponseLike): string;

/**
 * The self check of a page response: status 200, a `text/html` content type
 * and a body of more than 10 000 bytes. Throws when the response is not a
 * page, naming the condition that failed and the response it got.
 */
export declare function assertHtmlResponse(response: ResponseLike, url: string): void;

/**
 * Read a page and check it before it is measured.
 */
export declare function fetchPage(
  url: string,
  options?: { cookie?: string },
): Promise<{ body: string; bytes: number; contentType: string; status: number }>;

/** The cookie the initialization gate of the site looks at. */
export declare const DEFAULT_COOKIE: string;

/** The smallest body a real page may have. */
export declare const MIN_PAGE_BYTES: number;

/** The pages the probes measure. */
export declare const MEASURED_PAGES: string[];

/** The origin the probes read when nobody names one. */
export declare const DEFAULT_BASE: string;
