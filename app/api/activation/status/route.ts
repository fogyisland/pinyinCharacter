import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getActivationStatus } from '@/lib/activation';

/**
 * GET /api/activation/status — read-only view of the singleton activate row.
 * Public (no auth) because the /activate locked page needs to render status
 * for users who can't log in. Returns minimal fields; never exposes
 * installation_data (could contain internal server fingerprint).
 */
export async function GET() {
  return withErrorHandling(async () => {
    const s = await getActivationStatus();
    if (!s) {
      return NextResponse.json({
        ok: true,
        data: { ready: false },  // pre-init or DB unreachable
      });
    }
    return NextResponse.json({
      ok: true,
      data: {
        ready: true,
        shortName: s.shortName,
        isActivated: s.isActivated,
        activatedAt: s.activatedAt,
        isExpired: s.isExpired,
        expireDate: s.expireDate,
        isLocked: s.isLocked,
        lastHeartbeatAt: s.lastHeartbeatAt,
        lastCloudSyncAt: s.lastCloudSyncAt,
        cloudEndpoint: s.cloudEndpoint,
      },
    });
  });
}
