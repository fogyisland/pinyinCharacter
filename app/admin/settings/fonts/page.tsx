import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getActiveEraFonts } from '@/lib/era-fonts';
import { FontConfigForm } from '@/components/admin/FontConfigForm';

export const dynamic = 'force-dynamic';

export default async function FontSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const fonts = await getActiveEraFonts();
  return (
    <div className="card-paper rounded-lg p-6">
      <h1 className="text-lg font-semibold text-ink mb-1">字源字体</h1>
      <p className="text-sm text-ink-soft mb-6">
        选择每个时代使用的字体。默认字体已配好,可在「/etymology/[字]」查看实际效果。
      </p>
      <FontConfigForm initial={fonts} />
    </div>
  );
}