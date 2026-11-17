import { NextRequest, NextResponse } from 'next/server';
import { synthesize, TtsUpstreamError, type AudioFormat } from '@/lib/tts-edge';
import { getTtsConfig } from '@/lib/tts-config';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { checkAttemptLimit } from '@/lib/ratelimit';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const schema = z.object({
  // The server cap was 10 000 characters while every real client in this
  // project sends 500-800 per request (`lib/tts.ts` batches at 500,
  // `SutraAudioPlayer` at 800). A single request could therefore burn
  // 12-20x the upstream work a legitimate request needs — and this route
  // is unauthenticated, so that is an amplification lever.
  //
  // 2 000 leaves generous headroom above the legitimate batch size and
  // still bounds one request to a quarter of what it used to allow.
  text: z.string().min(1).max(2000),
  voice: z.enum(['male', 'female']).default('female'),
});

/** Synthesis requests allowed per IP per window. */
const MAX_IP_REQUESTS = 30;
/** The window the request budget is measured over. */
const WINDOW_MS = 60 * 1000;

/**
 * 把合成失败映射成合适的 HTTP 状态码。
 *
 * 上游 Edge TTS 出错不是本服务自己的 bug，用 502 / 504 比笼统的 500 更准确，
 * 也让前端能把「上游拒绝」「超时」「协议异常」区分开。
 */
function ttsFailureResponse(error: unknown): NextResponse {
  if (error instanceof TtsUpstreamError) {
    const mapping: Record<TtsUpstreamError['reason'], { code: string; message: string; status: number }> = {
      timeout: { code: 'tts_timeout', message: '语音合成超时，请稍后重试', status: 504 },
      auth: { code: 'tts_upstream_auth', message: 'Edge 语音服务拒绝了本次请求', status: 502 },
      protocol: { code: 'tts_upstream_protocol', message: 'Edge 语音服务返回了无法解析的数据', status: 502 },
      network: { code: 'tts_upstream_network', message: '无法连接 Edge 语音服务', status: 502 },
    };
    const entry = mapping[error.reason];
    console.error('[api/tts]', error.name, error.message);
    return NextResponse.json({ ok: false, error: { code: entry.code, message: entry.message } }, { status: entry.status });
  }
  console.error('[api/tts]', (error as Error).name, (error as Error).message);
  return NextResponse.json(
    { ok: false, error: { code: 'server', message: 'server error' } },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    // Rate limit per IP. This route proxies to an external speech service,
    // so every request costs the server a WebSocket, some CPU and some
    // upstream quota. Unbounded, it was both a cost amplifier and a way
    // to exhaust the upstream quota so that LEGITIMATE users get denied.
    // The budget is per minute and generous enough for a reader working
    // through a chapter (which batches at 500-800 characters per request).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const limit = checkAttemptLimit(`tts:ip:${ip}`, MAX_IP_REQUESTS, WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: { code: 'rate_limited', message: '语音请求过于频繁，请稍后再试' } },
        { status: 429 },
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const cfg = await getTtsConfig();
    const voiceName = parsed.data.voice === 'male' ? cfg.voiceMale : cfg.voiceFemale;

    let buffer: Buffer;
    try {
      buffer = await synthesize({
        voiceName,
        text: parsed.data.text,
        format: cfg.audioFormat as AudioFormat,
      });
    } catch (error) {
      return ttsFailureResponse(error);
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  });
}
