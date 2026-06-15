import { NextRequest, NextResponse } from 'next/server';
import { synthesize, type AudioFormat } from '@/lib/tts-edge';
import { getTtsConfig } from '@/lib/tts-config';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const schema = z.object({
  text: z.string().min(1).max(1000),
  voice: z.enum(['male', 'female']).default('female'),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const cfg = await getTtsConfig();
    const voiceName = parsed.data.voice === 'male' ? cfg.voiceMale : cfg.voiceFemale;
    const buffer = await synthesize({
      voiceName,
      text: parsed.data.text,
      format: cfg.audioFormat as AudioFormat,
    });

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
