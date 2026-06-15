import { Communicate } from 'edge-tts-universal';

export type AudioFormat =
  | 'audio-24khz-48kbitrate-mono-mp3'
  | 'audio-24khz-96kbitrate-mono-mp3'
  | 'audio-16khz-32kbitrate-mono-mp3'
  | 'audio-16khz-128kbitrate-mono-mp3';

export interface SynthesizeOpts {
  voiceName: string;            // e.g. 'zh-CN-YunjianNeural'
  text: string;
  format?: AudioFormat;
  timeoutMs?: number;
}

/**
 * Synthesize text to MP3 using Microsoft Edge's online TTS service.
 *
 * Implementation note: we use `edge-tts-universal` (a maintained wrapper that
 * handles the current `Sec-MS-GEC-Token` auth + WebSocket framing correctly)
 * instead of re-implementing the protocol by hand. Earlier attempts to use the
 * `ws` package directly worked in CLI tests but dropped binary frames when
 * called from inside a Next.js dev server, likely because of how Node's HTTP
 * keep-alive and the WebSocket `ws.send` masking interact in that runtime.
 */
export async function synthesize(opts: SynthesizeOpts): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const communicate = new Communicate(opts.text, {
    voice: opts.voiceName,
  });

  // Race the streaming against a hard timeout. `edge-tts-universal` may take
  // 5-10s on first call (TCP + TLS handshake to speech.platform.bing.com), so
  // a generous default is required.
  const chunks: Buffer[] = [];
  const streamPromise = (async () => {
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data);
      }
    }
    return Buffer.concat(chunks);
  })();

  const timeoutPromise = new Promise<Buffer>((_, reject) => {
    setTimeout(() => reject(new Error('Edge TTS timeout')), timeoutMs);
  });

  try {
    return await Promise.race([streamPromise, timeoutPromise]);
  } catch (e) {
    const err = e as Error;
    process.stderr.write(`[tts-edge] error: name=${err.name} message=${err.message} voice=${opts.voiceName} text="${opts.text.slice(0, 20)}"\n`);
    (e as any).ttsErrorName = err.name;
    throw e;
  }
}
