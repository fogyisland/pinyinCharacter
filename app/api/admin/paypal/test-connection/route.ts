import { NextResponse } from 'next/server';
import { withErrorHandling, serviceUnavailable } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPayPalConfig, getPayPalAccessToken } from '@/lib/paypal';
import { writeAudit } from '@/lib/audit';

export async function POST() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const cfg = await getPayPalConfig();
    if (!cfg) {
      return serviceUnavailable('paypal_not_configured', 'PayPal 凭据未配置完整');
    }
    try {
      const token = await getPayPalAccessToken(cfg);
      return NextResponse.json({
        ok: true,
        data: { ok: true, message: `连接成功,token 长度 ${token.length}` },
      });
    } catch (err) {
      await writeAudit({
        userId: auth.user.id,
        event: 'paypal_config_updated',
        metadata: { action: 'test_connection_failed', error: (err as Error).message },
      });
      return serviceUnavailable('paypal_unreachable', `连接失败: ${(err as Error).message}`);
    }
  });
}
