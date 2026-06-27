import { CampaignForm } from '@/components/admin/CampaignForm';

export const dynamic = 'force-dynamic';

export default function NewCampaignPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">新建营销邮件</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        填写主题和正文,选择受众。保存后是草稿,可在列表页点"发送"触发异步群发。
        邮件底部会自动追加退订链接。
      </p>
      <CampaignForm />
    </div>
  );
}