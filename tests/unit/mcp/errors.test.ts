import { describe, expect, it, vi } from 'vitest';
import { McpError, notFound } from '@/mcp/errors';
import { failureResult, runTool, successResult } from '@/mcp/tool-result';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The envelope the tools answer with.
 *
 * A tool that fails on purpose keeps its code; anything else is a bug and
 * becomes `internal_error` — the client gets a message that leaks nothing,
 * and the server log gets the whole story.
 */

/** The parsed envelope of a result. */
function envelopeOf(result: CallToolResult): {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
} {
  const text = result.content.find((entry) => entry.type === 'text');
  if (!text || text.type !== 'text') throw new Error('the result carries no text block');
  return JSON.parse(text.text) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
}

describe('the tool envelope', () => {
  it('carries the payload twice — as text and as structured content', () => {
    const result = successResult({ data: { char: '爱' } });
    expect(envelopeOf(result)).toEqual({ ok: true, data: { char: '爱' } });
    expect(result.structuredContent).toEqual({ ok: true, data: { char: '爱' } });
    expect(result.isError).toBeUndefined();
  });

  it('appends the extra content blocks after the text block', () => {
    const result = successResult({
      data: { byteLength: 3 },
      extraContent: [{ type: 'audio', data: 'AAA', mimeType: 'audio/mpeg' }],
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[1]).toEqual({
      type: 'audio',
      data: 'AAA',
      mimeType: 'audio/mpeg',
    });
  });

  it('keeps the code of an error a tool raised on purpose', () => {
    const result = failureResult(new McpError('not_found', 'poem 7 does not exist', { id: 7 }));
    expect(result.isError).toBe(true);
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('not_found');
    expect(envelope.error?.message).toBe('poem 7 does not exist');
    expect(envelope.error?.details).toEqual({ id: 7 });
  });

  it('leaves the details out when there are none', () => {
    const result = failureResult(new McpError('bad_input', 'char must be a Han character'));
    expect(envelopeOf(result).error?.details).toBeUndefined();
  });

  it('hides an unexpected error behind internal_error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = failureResult(new Error('ENOENT: no such file'));
      const envelope = envelopeOf(result);
      expect(envelope.error?.code).toBe('internal_error');
      expect(envelope.error?.message).not.toMatch(/ENOENT/);
      // The whole story goes to the log, not to the client.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('turns a thrown error into a result', async () => {
    const result = await runTool(async () => {
      throw new McpError('data_unavailable', 'the radical map is missing');
    });
    expect(envelopeOf(result).error?.code).toBe('data_unavailable');
  });

  it('returns the payload of a tool that works', async () => {
    const result = await runTool(async () => ({ data: { char: '爱' } }));
    expect(envelopeOf(result)).toEqual({ ok: true, data: { char: '爱' } });
  });
});

describe('the not-found error', () => {
  it('names the thing and the id', () => {
    const error = notFound('poem', 7);
    expect(error.code).toBe('not_found');
    expect(error.message).toBe('poem "7" does not exist');
    expect(error.details).toEqual({ what: 'poem', id: '7' });
  });

  it('quotes a string id too', () => {
    expect(notFound('classic book', 'shiji').message).toBe('classic book "shiji" does not exist');
  });
});
