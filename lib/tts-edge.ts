import WebSocket from 'ws';
import { randomBytes } from 'crypto';

const ENDPOINT = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CRLF_CR_LF = Buffer.from('\r\n\r\n');

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

export async function synthesize(opts: SynthesizeOpts): Promise<Buffer> {
  const format = opts.format ?? 'audio-24khz-48kbitrate-mono-mp3';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise<Buffer>((resolve, reject) => {
    const url = `${ENDPOINT}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${randomHex(16)}`;
    const ws = new WebSocket(url);
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | null = null;
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; fn(); };

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try { ws.close(); } catch {}
    };

    timer = setTimeout(() => {
      cleanup();
      settle(() => reject(new Error('Edge TTS timeout')));
    }, timeoutMs);

    ws.on('error', (err) => {
      cleanup();
      settle(() => reject(err));
    });

    ws.on('open', () => {
      // 1) SSML config
      const ssml = buildSsml(opts.voiceName, format, opts.text);
      ws.send(`Content-Type:application/ssml+xml\r\nX-Timestamp:${ts()}\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data) => {
      const buf = data as Buffer;
      // 协议: "X-RequestId:...<CRLF><CRLF>binary"
      const sep = buf.indexOf(CRLF_CR_LF);
      if (sep < 0) return;
      const header = buf.subarray(0, sep).toString('utf8');
      if (!header.includes('Path:audio')) return;
      chunks.push(buf.subarray(sep + 4));
      // Note: X-StreamIndex appears on every audio frame, so we rely on 'close' as end-of-stream
    });

    ws.on('close', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (chunks.length === 0) {
        settle(() => reject(new Error('Edge TTS closed with no audio')));
      } else {
        settle(() => resolve(Buffer.concat(chunks)));
      }
    });
  });
}

export function buildSsml(voiceName: string, format: string, text: string): string {
  // Note: `voiceName` (validated via KEY_VALIDATORS regex) and `format` (AudioFormat union)
  // are caller-validated and safe; only `text` needs XML escaping.
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
  <voice name='${voiceName}'>
    <prosody pitch='+0Hz' rate='+0%'>${safe}</prosody>
  </voice>
</speak>`;
}

function ts(): string {
  // e.g. "2026-06-15T12:34:56.789Z"
  return new Date().toISOString();
}

function randomHex(len: number): string {
  return randomBytes(len).toString('hex');
}
