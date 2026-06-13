import Link from 'next/link';
import { GenerateEtymologyForm } from '@/components/admin/GenerateEtymologyForm';

export const dynamic = 'force-dynamic';

export default function AdminCharsGeneratePage() {
  return (
    <div>
      <Link href="/admin/chars" className="text-sm text-ink-soft hover:text-ink">← 返回覆盖率</Link>
      <h1 className="text-xl font-semibold mb-2 mt-3">手动触发生成</h1>
      <p className="text-sm text-ink-soft mb-4">为指定汉字生成字源演变故事</p>
      <GenerateEtymologyForm />
    </div>
  );
}
