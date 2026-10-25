import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpError } from './errors';

/**
 * The envelope every MCP tool returns.
 *
 * The site answers `{ ok: true, data }` / `{ ok: false, error }` on its own
 * API routes; the same envelope is used here so a client that knows one
 * knows the other. The payload is delivered twice — as a JSON text block
 * (every client reads text) and as `structuredContent` (clients that
 * understand it do not have to parse the text).
 */
export interface McpEnvelope {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** A tool that produces a payload plus extra content blocks (audio, image). */
export interface McpToolPayload {
  /** The JSON payload handed back as `data`. */
  data: unknown;
  /** Extra content blocks appended after the text block. */
  extraContent?: CallToolResult['content'];
}

/** The success result of a tool. */
export function successResult(payload: McpToolPayload): CallToolResult {
  const envelope: McpEnvelope = { ok: true, data: payload.data };
  const content: CallToolResult['content'] = [
    { type: 'text', text: JSON.stringify(envelope, null, 2) },
  ];
  if (payload.extraContent) content.push(...payload.extraContent);
  return {
    content,
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

/** The failure result of a tool. */
export function failureResult(error: unknown): CallToolResult {
  const envelope: McpEnvelope =
    error instanceof McpError
      ? {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
          },
        }
      : {
          ok: false,
          error: {
            code: 'internal_error',
            message: 'the tool failed — the server log has the details',
          },
        };
  if (!(error instanceof McpError)) {
    // An unexpected error is a bug: it is logged in full, while the client
    // gets a message that does not leak the server's internals.
    console.error('[mcp] a tool failed', error);
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

/**
 * Run a tool's body and turn whatever it throws into a result.
 *
 * The tool's own errors (`McpError`) keep their code; anything else is a
 * bug and becomes `internal_error`.
 */
export async function runTool(produce: () => Promise<McpToolPayload>): Promise<CallToolResult> {
  try {
    return successResult(await produce());
  } catch (error) {
    return failureResult(error);
  }
}
