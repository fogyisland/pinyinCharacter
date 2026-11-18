import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { WecomWebhookForm } from '@/components/admin/WecomWebhookForm';
import { WecomDeliveryHistory } from '@/components/admin/WecomDeliveryHistory';
import { listWebhooks } from '@/lib/wecom-webhooks';

export const dynamic = 'force-dynamic';

export default async function AdminWecomPage() {
  const webhooks = await listWebhooks();
  return (
    <div>
      <PageHeader
        title="企业微信"
        description="把站点的通知转发到企业微信群。每个群自己勾选要收哪几类通知。"
      />
      <div className="space-y-4">
        <Panel title="转发设置">
          <p className="text-sm text-ink-soft mb-3">
            转发由后台的定时任务（scheduler）推送，每分钟一次。如果 scheduler
            没有启用，消息会一直排队而不会发出 —— 请到「定期更新」页面确认它已开启。
          </p>
          <WecomWebhookForm initial={webhooks} />
        </Panel>
        <WecomDeliveryHistory />
      </div>
    </div>
  );
}
