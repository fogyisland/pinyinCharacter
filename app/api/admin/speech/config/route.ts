import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { SPEECH_DAILY_LIMIT_KEY } from '@/lib/azure-speech';

export const dynamic = 'force-dynamic';

/**
 * The keys this panel manages.
 *
 * Region + key: everything Azure's short-audio endpoint needs. The key is a
 * secret, so it is never echoed — the GET reports only whether one exists.
 */
const CONFIG_KEYS = ['speech.region', 'speech.key', 'speech.daily_limit'] as const;

/**
 * The region must be a plain lowercase identifier.
 *
 * It is interpolated into a hostname (`<region>.stt.speech.microsoft.com`),
 * so a value carrying a slash or a dot could redirect the request — and the
 * subscription key goes with it. This is a trusted-input boundary, exactly
 * like `ai.base_url`.
 */
const REGION_PATTERN = /^[a-z]{2,20}$/;

/** The daily cap: whole digits only. `0` means unlimited. */
const LIMIT_PATTERN = /^\d{1,4}$/;

/**
 * GET /api/admin/speech/config — what the panel shows.
 *
 * The key is reported as a boolean, never as a value: a page that can read a
 * secret is a page that can leak it through a screenshot.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const all = await getAllConfig();
    return NextResponse.json({
      ok: true,
      data: {
        config: {
          'speech.region': all['speech.region'] ?? '',
          'speech.daily_limit': all[SPEECH_DAILY_LIMIT_KEY] ?? '',
        },
        hasKey: Boolean(all['speech.key']),
      },
    });
  });
}

/**
 * PUT /api/admin/speech/config — save the region and/or the key.
 *
 * A field left empty is treated as UNCHANGED, not as a deletion. The form
 * shows the key blank (it cannot show the stored value), so an empty value
 * means "I did not touch this"; wiping the key on every save would lock the
 * feature out after one careless click.
 */
export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return badRequest('bad_input', 'bad input');

    const updates: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      const raw = body[key];
      if (raw === undefined) continue;
      const value = String(raw).trim();
      // Empty means "unchanged" — skipped, not written.
      if (value === '') continue;
      if (key === 'speech.region' && !REGION_PATTERN.test(value)) {
        return badRequest(
          'bad_region',
          'region 只有小写字母（例如 eastasia / westus / southeastasia）',
        );
      }
      if (key === 'speech.daily_limit' && !LIMIT_PATTERN.test(value)) {
        // A cap that is not a number silently becomes 0 = unlimited in
        // `resolveDailyLimit`, which is the direction that costs money.
        return badRequest('bad_limit', 'daily_limit 必须是 0–9999 的整数（0 表示不限）');
      }
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('empty', '没有要保存的内容');
    }

    try {
      await setConfigBatch(updates, auth.user.id);
    } catch (error) {
      return badRequest('validation', (error as Error).message);
    }

    // A key is a secret: the audit row says it changed, never what it is.
    await writeAudit({
      userId: auth.user.id,
      event: 'speech_config_updated',
      metadata: {
        keys: Object.keys(updates),
        ...Object.fromEntries(
          Object.entries(updates).map(([key, value]) => [
            key,
            key === 'speech.key' ? '***' : value,
          ]),
        ),
      },
    });

    const all = await getAllConfig();
    return NextResponse.json({
      ok: true,
      data: {
        config: {
          'speech.region': all['speech.region'] ?? '',
          'speech.daily_limit': all[SPEECH_DAILY_LIMIT_KEY] ?? '',
        },
        hasKey: Boolean(all['speech.key']),
      },
    });
  });
}
