import type { IncomingMessage } from 'node:http';
import { McpError } from './errors';

/**
 * The request body reader.
 *
 * The body of an MCP request is JSON, and it is small (a tool call and its
 * arguments). The limit is here so a broken or hostile client cannot make
 * the server buffer an unbounded amount of memory.
 */

/** The largest body the server reads, in bytes. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The body of the request, read as text. */
export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(
          new McpError('bad_input', `the request body is larger than ${MAX_BODY_BYTES} bytes`),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', (error) => reject(error));
  });
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The request body, parsed as JSON.
 *
 * A body that is not JSON is a `bad_input` error, not a crash: the client
 * sent something the protocol does not allow.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new McpError('bad_input', 'the request body is not valid JSON', {
      reason: (error as Error).message,
    });
  }
}
