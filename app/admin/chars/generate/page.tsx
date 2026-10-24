import { GenerateCharsForm } from '@/components/admin/GenerateCharsForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { AdminLink } from '@/components/admin/AdminButton';

export const dynamic = 'force-dynamic';

export default function AdminCharsGeneratePage() {
  return (
    <div>
      <PageHeader
        title="逐字生成内容"
        description="为指定汉字生成字典字段、字源故事、或罕见字释义/故事。每次提交逐字处理,已有值的字段会被跳过。"
        actions={
          <AdminLink href="/admin/chars" variant="ghost">
            ← 返回覆盖率
          </AdminLink>
        }
      />
      <GenerateCharsForm />
    </div>
  );
}
