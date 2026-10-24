import { CampaignForm } from '@/components/admin/CampaignForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { AdminLink } from '@/components/admin/AdminButton';

export const dynamic = 'force-dynamic';

export default function NewCampaignPage() {
  return (
    <div>
      <PageHeader
        title="新建营销邮件"
        description="填写主题和正文,选择受众。保存后是草稿,可在列表页点「发送」触发异步群发,邮件底部会自动追加退订链接。"
        actions={
          <AdminLink href="/admin/email/campaigns" variant="secondary" size="sm">
            返回列表
          </AdminLink>
        }
      />
      <Panel title="邮件内容" description="主题会显示在收件箱列表中,正文支持 HTML。">
        <CampaignForm />
      </Panel>
    </div>
  );
}
