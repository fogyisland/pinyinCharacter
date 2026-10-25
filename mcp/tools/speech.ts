import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { synthesize, TtsUpstreamError } from '@/lib/tts-edge';
import type { AudioFormat } from '@/lib/tts-edge';
import { McpError } from '../errors';
import { runTool } from '../tool-result';
import { requireText } from './shared';

/**
 * The speech tools — the reading of a piece of text.
 *
 * The audio comes from the same Edge TTS endpoint the site's own "play"
 * button uses. The upstream is unreliable (it answers 403 often), so the
 * failure is reported with its reason instead of being swallowed.
 */

/** The annotations every read-only tool carries. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** The voices the endpoint offers. */
const VOICE = z.enum([
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaoyiNeural',
  'zh-CN-XiaomengNeural',
  'zh-CN-YunjianNeural',
  'zh-CN-YunxiNeural',
  'zh-CN-YunyangNeural',
]);

/** The audio formats the endpoint offers. */
const FORMAT = z.enum([
  'audio-24khz-48kbitrate-mono-mp3',
  'audio-24khz-96kbitrate-mono-mp3',
  'audio-16khz-32kbitrate-mono-mp3',
  'audio-16khz-128kbitrate-mono-mp3',
]);

/** The voice used when the caller does not pick one. */
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

/** The format used when the caller does not pick one. */
const DEFAULT_FORMAT: AudioFormat = 'audio-24khz-48kbitrate-mono-mp3';

export function registerSpeechTools(server: McpServer): void {
  server.registerTool(
    'synthesize_speech',
    {
      title: 'Read a piece of text out loud',
      description:
        'The spoken reading of a piece of text — the same voice the site uses. The ' +
        'audio is returned as an MP3 block together with the metadata of the ' +
        'synthesis. The upstream is not always reachable; a failure says why.',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .max(200)
          .describe('the text to read out, e.g. "你好" or "爱"'),
        voice: VOICE.optional().describe(`the voice (default ${DEFAULT_VOICE})`),
        format: FORMAT.optional().describe(`the audio format (default ${DEFAULT_FORMAT})`),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(async () => {
        const text = requireText(args.text, 'text', 200);
        const voiceName = args.voice ?? DEFAULT_VOICE;
        const format = (args.format ?? DEFAULT_FORMAT) as AudioFormat;

        let audio: Buffer;
        try {
          audio = await synthesize({ voiceName, text, format });
        } catch (error) {
          if (error instanceof TtsUpstreamError) {
            throw new McpError(
              'upstream_error',
              `the speech service did not answer — ${error.reason}: ${error.message}`,
              { reason: error.reason, upstreamStatus: error.upstreamStatus },
            );
          }
          throw error;
        }

        return {
          data: {
            text,
            voice: voiceName,
            format,
            mimeType: 'audio/mpeg',
            byteLength: audio.byteLength,
          },
          extraContent: [
            {
              type: 'audio',
              data: audio.toString('base64'),
              mimeType: 'audio/mpeg',
            },
          ],
        };
      }),
  );
}
