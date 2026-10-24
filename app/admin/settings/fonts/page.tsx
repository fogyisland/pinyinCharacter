import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getActiveEraFonts } from '@/lib/era-fonts';
import { FontConfigForm } from '@/components/admin/FontConfigForm';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function FontSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const fonts = await getActiveEraFonts();
  return (
    <div>
      <PageHeader
        title="字源字体"
        description="选择每个时代使用的字体。默认字体已配好,可在「/etymology/[字]」查看实际效果。"
      />
      <FontConfigForm initial={fonts} />
    </div>
  );
}
