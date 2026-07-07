import { NextResponse } from 'next/server';
import { isSetupComplete, isSetupRouteEnabled, isInitWizardAdminDone } from '@/lib/setup';

/**
 * Read-only status endpoint used by /init page on mount and by the
 * orchestrator to decide which wizard screen (or locked card) to show.
 * Returns { setupComplete, routeEnabled, adminDone }.
 */
export async function GET() {
  const [setupComplete, routeEnabled, adminDone] = await Promise.all([
    isSetupComplete(),
    isSetupRouteEnabled(),
    isInitWizardAdminDone(),
  ]);
  return NextResponse.json({
    ok: true,
    data: { setupComplete, routeEnabled, adminDone },
  });
}