import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasFeature } from '@/lib/membership';
import { llmChat } from '@/lib/llm';
import { getConfig } from '@/lib/config';
import { logAiCall, checkAiRateLimit, checkAnonRateLimit } from '@/lib/ai-calls';

const VALID_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB after base64 decode ~ 6.67MB raw

function isCjkBmpChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Extension A
    (cp >= 0xf900 && cp <= 0xfaff)     // CJK Compatibility Ideographs
  );
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) ?? null;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid_image', message: '请求体格式错误' }, { status: 400 }); }

  const image = typeof body?.image === 'string' ? body.image : '';
  if (!image || !VALID_PREFIXES.some((p) => image.startsWith(p))) {
    return NextResponse.json({ ok: false, error: 'invalid_image', message: '图片格式或大小不支持' }, { status: 400 });
  }
  // Approximate decoded size: base64 length × 3/4, subtract padding.
  const decodedApprox = Math.floor(image.length * 3 / 4);
  if (decodedApprox > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: 'invalid_image', message: '图片过大' }, { status: 400 });
  }

  const user = await getCurrentUser();

  // Gating: anonymous vs logged-in
  if (user) {
    if (!await hasFeature(user.id, 'ai_calls')) {
      return NextResponse.json({ ok: false, error: 'membership_required', message: '拍照识别需要 AI 会员权限' }, { status: 403 });
    }
    if (!await checkAiRateLimit(user.id)) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '今日次数已用完,明天再来' }, { status: 429 });
    }
  } else {
    if (!ip) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '无法识别客户端' }, { status: 429 });
    }
    const { exceeded } = await checkAnonRateLimit(ip);
    if (exceeded) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '今日试用次数已用完,请登录后继续使用' }, { status: 429 });
    }
  }

  // LLM call
  const model = (await getConfig('ai.model')) ?? 'unknown';
  const start = Date.now();
  let raw = '';
  try {
    const result = await llmChat({
      baseUrl: (await getConfig('ai.base_url')) ?? 'https://api.openai.com/v1',
      apiKey: (await getConfig('ai.api_key')) ?? '',
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请识别此图中的单个汉字,只返回该字符,无其他文字' },
          { type: 'image_url', image_url: { url: image, detail: 'low' } },
        ],
      }],
      maxTokens: 16,
      temperature: 0,
    });
    raw = result.content.trim();
  } catch (err) {
    await logAiCall({
      userId: user?.id ?? null, feature: 'char-recognize', model,
      status: 'error', durationMs: Date.now() - start,
      error: (err as Error).message,
      ip, metadata: { ip },
    });
    const isTimeout = (err as Error).message.includes('timeout');
    return NextResponse.json({
      ok: false,
      error: isTimeout ? 'timeout' : 'provider_error',
      message: isTimeout ? '识别超时,请重试' : '识别服务暂时不可用',
    }, { status: isTimeout ? 504 : 502 });
  }

  if (!isCjkBmpChar(raw)) {
    await logAiCall({
      userId: user?.id ?? null, feature: 'char-recognize', model,
      status: 'error', durationMs: Date.now() - start,
      error: `not_cjk: ${raw.slice(0, 20)}`,
      ip, metadata: { ip, raw: raw.slice(0, 20) },
    });
    return NextResponse.json({ ok: false, error: 'not_recognized', message: '未识别到汉字,请重试' }, { status: 502 });
  }

  await logAiCall({
    userId: user?.id ?? null, feature: 'char-recognize', model,
    status: 'ok', durationMs: Date.now() - start,
    ip, metadata: { ip, char: raw },
  });
  return NextResponse.json({ ok: true, char: raw });
}