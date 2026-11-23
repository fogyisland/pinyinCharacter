import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { isSpeechConfigured, resolveDailyLimit, type SpeechFailure } from '@/lib/azure-speech';
import { assessPronunciation } from '@/lib/azure-assessment';
import { countAssessmentsToday, recordAssessment } from '@/lib/speech-store';

export const dynamic = 'force-dynamic';

/**
 * The largest recording this route will forward, in bytes.
 *
 * A learner reading one word needs about a second; 5 MB of 16 kHz mono WAV is
 * roughly 160 seconds. The limit exists because an unbounded body is an
 * unbounded allocation, and because the request is forwarded to a service
 * that bills per audio second.
 */
const MAX_BYTES = 5 * 1024 * 1024;

/** The longest reference text accepted: a word or a short phrase. */
const MAX_REFERENCE = 32;

/** Failure → HTTP status, so the panel can decide whether to retry. */
function statusOf(reason: SpeechFailure): number {
  switch (reason) {
    case 'unconfigured':
      return 503;
    case 'auth':
      return 502;
    case 'rate-limit':
      return 429;
    case 'bad-request':
      return 400;
    case 'upstream':
      return 502;
    case 'unknown':
      return 502;
    default:
      // An unknown reason is treated as an upstream problem: retrying is the
      // only sensible action, and 502 says "not your fault".
      return 502;
  }
}

/**
 * GET /api/speech/assess — is the paid path available?
 *
 * Readable without a login, because it answers two separate questions:
 *
 *   configured  the operator set a key — the feature EXISTS on this site.
 *   loggedIn    the CALLER may use it — the call costs money, so the POST
 *               requires a session.
 *
 * The panel needs both: showing 「精评」 to a visitor who is not logged in
 * would offer a button that can only fail, and hiding it from everyone
 * because the visitor is anonymous would hide a real feature.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const [configured, user] = await Promise.all([isSpeechConfigured(), getCurrentUser()]);
    return NextResponse.json({ ok: true, data: { configured, loggedIn: user !== null } });
  });
}

/**
 * POST /api/speech/assess?reference=<word> — score one recording.
 *
 * The audio is read into memory, forwarded, and dropped with the request. It
 * is never written to disk and never logged: a learner's voice is not ours to
 * keep.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    // Not `unauthorized()`: that answers the English word "unauthorized",
    // which the panel would show as the learner's error message. A learner
    // who is not logged in needs to be told what to do.
    if (!user) return unauthorized('login_required', '精评需要登录后使用。跟读不需要登录，可以先用它。');

    const url = new URL(req.url);
    const reference = (url.searchParams.get('reference') ?? '').trim();
    if (reference === '' || reference.length > MAX_REFERENCE) {
      return badRequest('bad_reference', 'reference text is required (max 32 characters)');
    }

    // The quota is checked BEFORE the audio is read and BEFORE Azure is
    // called: this is the only guard between a retry loop and a bill. `0`
    // means unlimited, matching the other limits on the site.
    const limit = await resolveDailyLimit();
    if (limit > 0) {
      const used = await countAssessmentsToday(user.id);
      if (used >= limit) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'daily_limit',
              message: `今天的精评次数用完了（每天 ${limit} 次）。跟读不受影响，明天再来。`,
            },
          },
          { status: 429 },
        );
      }
    }

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'audio_too_large', message: `录音太大（上限 ${MAX_BYTES / 1024 / 1024} MB）` },
        },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return badRequest('empty_audio', '录音是空的，请再读一遍');
    }
    if (bytes.byteLength > MAX_BYTES) {
      // A request without a content-length can only be judged after reading.
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'audio_too_large', message: `录音太大（上限 ${MAX_BYTES / 1024 / 1024} MB）` },
        },
        { status: 413 },
      );
    }

    const result = await assessPronunciation(bytes, reference);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: { code: result.reason, message: result.message } },
        { status: statusOf(result.reason) },
      );
    }
    // Only a SUCCESS is billed, so only a success is counted: a 429 or a bad
    // key costs nothing and must not eat the learner's daily quota.
    await recordAssessment(user.id, result.assessment);
    return NextResponse.json({ ok: true, data: { assessment: result.assessment } });
  });
}
