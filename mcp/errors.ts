/**
 * The MCP server's error vocabulary.
 *
 * The codes mirror the site's own API envelope (lib/api-handler.ts):
 * `{ ok: false, error: { code, message } }`. A client that already knows
 * the site's API can read the MCP errors with the same vocabulary.
 */
export type McpErrorCode =
  /** The arguments did not match the tool's schema. */
  | 'bad_input'
  /** The requested char / poem / sutra / book does not exist. */
  | 'not_found'
  /** The request carried no usable credentials. */
  | 'unauthorized'
  /** The data the tool needs is not readable on this machine. */
  | 'data_unavailable'
  /** An upstream service (the TTS endpoint) failed. */
  | 'upstream_error'
  /** A bug in the tool. */
  | 'internal_error';

/** An error a tool raises on purpose — it carries a code and details. */
export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: McpErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.details = details;
  }
}

/** A 404 for a named thing, with the name in the details. */
export function notFound(what: string, id: string | number): McpError {
  return new McpError('not_found', `${what} ${JSON.stringify(String(id))} does not exist`, {
    what,
    id: String(id),
  });
}
