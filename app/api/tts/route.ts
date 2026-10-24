import { NextRequest, NextResponse } from 'next/server';
import { synthesize, TtsUpstreamError, type AudioFormat } from '@/lib/tts-edge';
import { getTtsConfig } from '@/lib/tts-config';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const schema = z.object({
  text: z.string().min(1).max(10000),
  voice: z.enum(['male', 'female']).default('female'),
});

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
