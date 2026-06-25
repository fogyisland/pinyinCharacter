import { NextResponse } from 'next/server';
import { isSetupComplete, isSetupRouteEnabled } from '@/lib/setup';

/**
 * Read-only status endpoint used by /init page on mount to decide
 * whether to show the wizard form or the "already done, go to login"
 * card. Returns { setupComplete, routeEnabled }.
 */
export async function GET() {
  const setupComplete = await isSetupComplete();
  const routeEnabled = await isSetupRouteEnabled();
  return NextResponse.json({
    ok: true,
    data: { setupComplete, routeEnabled },
  });
}
