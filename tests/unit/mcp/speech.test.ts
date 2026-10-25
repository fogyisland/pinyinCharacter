import { beforeEach, describe, expect, it, vi } from 'vitest';

// The speech endpoint is a live WebSocket service that answers 403 often, so
// the test replaces it with a stub: the point of the test is the MCP
// contract — the audio block on success, the upstream_error envelope on
// failure — not the service itself.
vi.mock('@/lib/tts-edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tts-edge')>();
  return { ...actual, synthesize: vi.fn() };
});

import { synthesize, TtsUpstreamError } from '@/lib/tts-edge';
import { connectTestClient } from './harness';

/**
 * The speech tool.
 *
 * The audio is returned as an MCP audio content block, and a failing
 * upstream is reported with its reason instead of being swallowed.
 */

/** The content blocks of a tool result. */
function blocks(result: unknown): { type: string; text?: string; data?: string; mimeType?: string }[] {
  return (result as { content?: { type: string; text?: string; data?: string; mimeType?: string }[] })
    .content ?? [];
}

/** The parsed envelope of a tool result. */
function envelope(result: unknown): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
} {
  const text = blocks(result).find((entry) => entry.type === 'text')?.text ?? '';
  return JSON.parse(text) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
}

beforeEach(() => {
  vi.mocked(synthesize).mockReset();
});

describe('the speech tool', () => {
  it('returns the audio as an audio content block', async () => {
    const audio = Buffer.from('ID3-fake-mp3-payload');
    vi.mocked(synthesize).mockResolvedValue(audio);

    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'synthesize_speech',
        arguments: { text: '你好' },
      });

      const audioBlock = blocks(result).find((entry) => entry.type === 'audio');
      expect(audioBlock, 'no audio block in the result').toBeTruthy();
      expect(audioBlock?.mimeType).toBe('audio/mpeg');
      expect(audioBlock?.data).toBe(audio.toString('base64'));

      const payload = envelope(result);
      expect(payload.ok).toBe(true);
      expect(payload.data?.text).toBe('你好');
      expect(payload.data?.voice).toBe('zh-CN-XiaoxiaoNeural');
      expect(payload.data?.byteLength).toBe(audio.byteLength);
    } finally {
      await close();
    }
  });

  it('passes the voice and the format through', async () => {
    vi.mocked(synthesize).mockResolvedValue(Buffer.from('x'));

    const { client, close } = await connectTestClient();
    try {
      await client.callTool({
        name: 'synthesize_speech',
        arguments: {
          text: '爱',
          voice: 'zh-CN-YunxiNeural',
          format: 'audio-16khz-128kbitrate-mono-mp3',
        },
      });

      expect(synthesize).toHaveBeenCalledWith({
        voiceName: 'zh-CN-YunxiNeural',
        text: '爱',
        format: 'audio-16khz-128kbitrate-mono-mp3',
      });
    } finally {
      await close();
    }
  });

  it('reports a failing upstream with its reason', async () => {
    vi.mocked(synthesize).mockRejectedValue(
      new TtsUpstreamError('上游返回 403', 'auth', 403),
    );

    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'synthesize_speech',
        arguments: { text: '你好' },
      });

      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('upstream_error');
      expect(payload.error?.message).toMatch(/auth/);
      expect(payload.error?.details?.reason).toBe('auth');
      expect(payload.error?.details?.upstreamStatus).toBe(403);
    } finally {
      await close();
    }
  });

  it('refuses an empty text', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'synthesize_speech',
        arguments: { text: '   ' },
      });
      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('bad_input');
      expect(synthesize).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
