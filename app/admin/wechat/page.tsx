import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { WechatConfigForm } from '@/components/admin/WechatConfigForm';
import { WechatBroadcastForm } from '@/components/admin/WechatBroadcastForm';
import { WechatBroadcastTable } from '@/components/admin/WechatBroadcastTable';
import { getWechatConfig } from '@/lib/wechat-config';
import { listBroadcasts } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

/**
 * The WeChat announcement screen.
 *
 * ⚠️ The admin layout already renders the sidebar, so this page does not
 * import the sidebar component, does not lay itself out in a flex row,
 * and does not write its own heading — `PageHeader` is the one header.
 *
 * ⚠️ The rows are read on the server. The follower count is NOT: it needs
 * a live call to WeChat, and a server component must not block the whole
 * page on a third-party API — `WechatConfigForm` fetches it after mount.
 */
export default async function AdminWechatPage() {
  const config = await getWechatConfig();
  const broadcasts = await listBroadcasts();
  return (
    <div>
      <PageHeader
        title="微信公众号"
        description="用服务号模板消息把公告推送给公众号的关注者。"
      />
      <div className="space-y-4">
        <Panel title="配置">
          <p className="text-sm text-ink-soft mb-3">
            推送由后台的定时任务（scheduler）完成，默认每 60 分钟跑一次。如果
            scheduler 没有启用，公告会一直排队而不会发出 —— 请到「定期更新」页面
            确认它已开启（scheduler 整体默认是关的，而「微信公告」这个任务默认是开的）。
          </p>
          <WechatConfigForm initialConfig={config} />
        </Panel>
        <Panel title="写公告">
          <WechatBroadcastForm />
        </Panel>
        <Panel title="公告记录">
          <WechatBroadcastTable initialBroadcasts={broadcasts} />
        </Panel>
      </div>
    </div>
  );
}
