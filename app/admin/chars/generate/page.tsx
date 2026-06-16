import Link from 'next/link';
import { GenerateCharsForm } from '@/components/admin/GenerateCharsForm';

export const dynamic = 'force-dynamic';

export default function AdminCharsGeneratePage() {
  return (
    <div>
      <Link href="/admin/chars" className="text-sm text-ink-soft hover:text-ink">← 返回覆盖率</Link>
      <h1 className="text-xl font-semibold mb-2 mt-3">逐字生成内容</h1>
      <p className="text-sm text-ink-soft mb-4">为指定汉字生成字典字段、字源故事、或罕见字释义/故事。每次提交逐字处理,已有值的字段会被跳过。</p>
      <GenerateCharsForm />
    </div>
  );
}